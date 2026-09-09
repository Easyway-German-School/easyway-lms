import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability, requireAnyCapability } from "@/lib/admin-roles";
import {
  isValidPaymentStatus,
  isReceivedPayment,
  isRegistrationFeePayment,
  isTravelPackagePathway,
  isTuitionPayment,
  PAYMENT_STATUSES,
  requiredDepositFor,
} from "@/lib/payment";
import { reconcileTravelPackageStudent } from "@/lib/travel-package";

export async function GET() {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const payments = await prisma.payment.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      student: {
        include: { user: true },
      },
      invoice: true,
    },
  });

  return NextResponse.json({ payments });
}

export async function POST(request: Request) {
  /**
   * `payments` OR `enrolment`. The fee book desk records payments here; so does
   * a Customer Care agent clearing one student's way into class. Only this
   * verb is shared — GET/PATCH/DELETE below stay `payments`-only, so an
   * `enrolment` holder can add a payment a student made but cannot browse the
   * ledger, edit an amount, or void a row. The response carries only the row
   * just created and that one student's unlock status.
   */
  const gate = await requireAnyCapability(["payments", "enrolment"]);
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const studentId = typeof body.studentId === "string" && body.studentId.trim() ? body.studentId : "";
  const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
  const currency = typeof body.currency === "string" ? body.currency : "usd";
  const method = typeof body.method === "string" ? body.method.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : null;
  const invoiceId = typeof body.invoiceId === "string" && body.invoiceId.trim() ? body.invoiceId : null;
  const status = typeof body.status === "string" ? body.status : "pending";

  if (!studentId || !amount || !method) {
    return NextResponse.json({ error: "studentId, amount, and method are required" }, { status: 400 });
  }

  if (!isValidPaymentStatus(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${PAYMENT_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const payment = await prisma.payment.create({
      data: {
        studentId,
        amount: Math.round(amount),
        currency,
        method,
        description,
        invoiceId,
        status,
      },
    });

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: {
        level: true,
        classType: true,
        pathway: true,
        branch: { select: { name: true } },
        user: { select: { name: true, email: true } },
        // `description` is needed to tell a tuition payment from the ₦5,000
        // registration fee, which the paywall does not count.
        payments: { select: { amount: true, status: true, description: true } },
      },
    });

    /**
     * TRAVEL PACKAGE — a flat ₦980,000 that replaces the per-level ladder. Make
     * sure the ledger carries the one ₦980,000 charge before we decide anything
     * about "deposit met" or "paid in full": a student mis-filed on the default
     * pathway (or whose charge was raised at the A1 price before the pathway was
     * set) would otherwise have a ₦150k charge here and this very payment would
     * tip them to "settled". No-op for non-Travel-Package students — see
     * src/lib/travel-package.ts.
     */
    try {
      await reconcileTravelPackageStudent({ studentId, setPathway: false });
    } catch (reconcileError) {
      console.error("Travel Package reconcile failed after manual payment", { studentId, reconcileError });
    }

    /**
     * Did this payment just open the student's classes?
     *
     * The office can record any amount at any status (cash and bank-transfer
     * desks need that freedom), but the paywall gates on the cumulative
     * RECEIVED TUITION total reaching the 60% deposit — not on the status
     * label, and NOT counting the ₦5,000 registration fee (see
     * `isTuitionPayment` / `deriveStudentAccess`). So for a hand-entered
     * tuition payment we say plainly whether the student is now unlocked, or —
     * if it is still short — that it is not, with the figures. A registration
     * fee recorded here says nothing (it was never going to unlock anything).
     */
    let warning: string | null = null;
    let notice: string | null = null;
    if (student && isReceivedPayment(status) && !isRegistrationFeePayment(description)) {
      const receivedTuition = student.payments
        .filter((p) => isTuitionPayment({ status: p.status, description: p.description }))
        .reduce((sum, p) => sum + p.amount, 0);
      const deposit = requiredDepositFor({
        level: student.level,
        branch: student.branch?.name ?? null,
        classType: student.classType,
        pathway: student.pathway,
      });
      const who = student.user?.name || student.user?.email || "This student";
      const money = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;
      const gateLabel = isTravelPackagePathway(student.pathway)
        ? `${money(deposit)} minimum first payment for the Travel Package`
        : `60% tuition deposit (${money(deposit)})`;
      if (deposit > 0 && receivedTuition >= deposit) {
        notice =
          `Recorded. ${who} has met the ${gateLabel} — received tuition is now ${money(receivedTuition)}, ` +
          `so their classes are unlocked. If their portal still shows a lock it is the missing-photo step, ` +
          `which only they can clear from their profile.`;
      } else {
        warning =
          `Recorded, but received tuition is ${money(receivedTuition)} — still below the ${gateLabel}. ` +
          `${who}'s classes will NOT unlock until it reaches that.`;
      }
    }

    return NextResponse.json({ payment, warning, notice }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Unable to create payment", detail: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}

/**
 * A cleared payment is a fact about money that moved, not a form field — but a
 * front-desk cash/transfer entry made by hand can be wrong (a digit fat-
 * fingered, the wrong status, the wrong student's row). This lets the office
 * correct one AFTER the fact.
 *
 *   PATCH { id, amount?, status?, method?, description? }
 *
 * A GATEWAY row (Paystack / Stripe — it carries a paymentIntentId or
 * stripeSessionId) is the provider's record of a real settlement; its amount
 * and status are read-only here and only the description (the office's own
 * note) can be edited. A hand-entered row is fully editable.
 *
 * Anything that changes the received total re-runs the Travel Package ledger
 * reconcile, so a corrected amount flows straight through to "owed" / "paid in
 * full" / the paywall.
 */
export async function PATCH(request: Request) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  // `paymentId` is the name the payments page has always sent for a status flip.
  const id =
    (typeof body.id === "string" && body.id.trim()) ||
    (typeof body.paymentId === "string" && body.paymentId.trim()) ||
    "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const existing = await prisma.payment.findUnique({
    where: { id },
    select: {
      id: true,
      studentId: true,
      amount: true,
      status: true,
      method: true,
      paymentIntentId: true,
      stripeSessionId: true,
    },
  });
  if (!existing) return NextResponse.json({ error: "Payment not found" }, { status: 404 });

  const isGateway = Boolean(existing.paymentIntentId || existing.stripeSessionId);

  const data: { amount?: number; status?: string; method?: string; description?: string | null } = {};

  if (body.description !== undefined) {
    data.description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
  }

  if (!isGateway) {
    if (body.amount !== undefined) {
      const amount = Math.round(Number(body.amount));
      if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
      }
      data.amount = amount;
    }
    if (body.status !== undefined) {
      if (!isValidPaymentStatus(body.status)) {
        return NextResponse.json({ error: `status must be one of: ${PAYMENT_STATUSES.join(", ")}` }, { status: 400 });
      }
      data.status = body.status;
    }
    if (body.method !== undefined) {
      const method = typeof body.method === "string" ? body.method.trim() : "";
      if (!method) return NextResponse.json({ error: "method cannot be blank" }, { status: 400 });
      data.method = method;
    }
  } else if (body.amount !== undefined || body.status !== undefined || body.method !== undefined) {
    return NextResponse.json(
      { error: "This payment came from the payment gateway — only its description can be edited here." },
      { status: 400 },
    );
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const payment = await prisma.payment.update({ where: { id }, data });

    // A changed amount/status changes the received total — keep a Travel
    // Package student's ledger in step. No-op for everyone else.
    let travelPackage = null;
    if (data.amount !== undefined || data.status !== undefined) {
      try {
        travelPackage = await reconcileTravelPackageStudent({ studentId: existing.studentId, setPathway: false });
      } catch (reconcileError) {
        console.error("Travel Package reconcile failed after payment edit", { id, reconcileError });
      }
    }

    return NextResponse.json({ payment, travelPackage });
  } catch (error) {
    return NextResponse.json(
      { error: "Unable to update payment", detail: error instanceof Error ? error.message : "Unknown" },
      { status: 500 },
    );
  }
}

/**
 * Void a hand-entered payment recorded in error. Soft delete — the row is kept
 * on disk and out of every read (src/lib/prisma-guard.ts), so it can be
 * restored and the audit trail is intact. A gateway row is never voided from
 * here: if a real settlement needs reversing that is a refund, not a delete.
 */
export async function DELETE(request: Request) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const body = await request.json().catch(() => ({}));
  const id =
    (typeof body.id === "string" && body.id.trim()) || url.searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const existing = await prisma.payment.findUnique({
    where: { id },
    select: { id: true, studentId: true, paymentIntentId: true, stripeSessionId: true },
  });
  if (!existing) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  if (existing.paymentIntentId || existing.stripeSessionId) {
    return NextResponse.json(
      { error: "This payment came from the payment gateway — reverse it with a refund, not a delete." },
      { status: 400 },
    );
  }

  try {
    await prisma.payment.delete({ where: { id } });
    let travelPackage = null;
    try {
      travelPackage = await reconcileTravelPackageStudent({ studentId: existing.studentId, setPathway: false });
    } catch (reconcileError) {
      console.error("Travel Package reconcile failed after payment void", { id, reconcileError });
    }
    return NextResponse.json({ ok: true, travelPackage });
  } catch (error) {
    return NextResponse.json(
      { error: "Unable to void payment", detail: error instanceof Error ? error.message : "Unknown" },
      { status: 500 },
    );
  }
}
