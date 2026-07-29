import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { queueEmail } from "@/lib/email-queue";

/**
 * Paying an exam fee.
 *
 * Kept separate from the tuition Paystack flow on purpose: that one is built
 * around pathways, deposit percentages and a Student record, none of which
 * apply to a member of the public paying for one ÖSD seat.
 *
 * Two rules matter here more than anything else:
 *
 *   The amount is read from the Exam on the SERVER. If the client supplied it,
 *   someone would pay ₦1 for an ₦85,000 exam.
 *
 *   Settlement is idempotent. Paystack can deliver a webhook and a redirect
 *   for the same transaction, so marking a registration paid twice must not
 *   record the money twice.
 */

/**
 * Lets whoever just booked pay straight away, before they have claimed their
 * account and set a password. Bound to the one registration, so it cannot be
 * used to pay — or look at — anything else.
 */
export function payToken(registrationId: string): string {
  const secret = process.env.NEXTAUTH_SECRET ?? "easyway-dev-secret";
  return crypto.createHmac("sha256", secret).update(`pay:${registrationId}`).digest("hex").slice(0, 40);
}

export function verifyPayToken(registrationId: string, token: string): boolean {
  const expected = payToken(registrationId);
  if (token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

export type PayableRegistration = {
  id: string;
  examName: string;
  fee: number;
  email: string;
  name: string;
  alreadyPaid: boolean;
};

/**
 * Resolve a registration the caller is allowed to pay for — either because
 * they are signed in as its owner, or because they hold the token issued when
 * it was booked.
 */
export async function resolvePayable(
  registrationId: string,
  opts: { userId?: string | null; token?: string | null },
): Promise<{ ok: true; registration: PayableRegistration } | { ok: false; error: string; status: number }> {
  const registration = await prisma.examRegistration.findUnique({
    where: { id: registrationId },
    include: {
      exam: { select: { fee: true, name: true } },
      student: { select: { userId: true, user: { select: { name: true, email: true } } } },
      user: { select: { name: true, email: true } },
    },
  });

  if (!registration) {
    return { ok: false, error: "That registration does not exist.", status: 404 };
  }

  const ownerId = registration.userId ?? registration.student?.userId ?? null;
  const bySession = Boolean(opts.userId && ownerId && opts.userId === ownerId);
  const byToken = Boolean(opts.token && verifyPayToken(registrationId, opts.token));

  if (!bySession && !byToken) {
    return { ok: false, error: "You cannot pay for this registration.", status: 403 };
  }

  const fee = registration.exam?.fee ?? null;
  if (!fee || fee <= 0) {
    return { ok: false, error: "There is no fee to pay for this sitting.", status: 400 };
  }

  const email =
    registration.student?.user.email ??
    registration.user?.email ??
    registration.candidateEmail ??
    "";
  const name =
    registration.student?.user.name ??
    registration.user?.name ??
    registration.candidateName ??
    "Candidate";

  if (!email) {
    return { ok: false, error: "No email address on this registration.", status: 400 };
  }

  return {
    ok: true,
    registration: {
      id: registration.id,
      examName: registration.examName,
      fee,
      email,
      name,
      alreadyPaid: registration.paymentStatus === "paid" || registration.paymentStatus === "waived",
    },
  };
}

/**
 * Mark a registration settled. Safe to call repeatedly — the second call for
 * the same reference changes nothing and reports success.
 */
export async function settleExamFee(input: {
  registrationId: string;
  reference: string;
  amount: number;
}): Promise<{ settled: boolean; alreadySettled: boolean }> {
  const current = await prisma.examRegistration.findUnique({
    where: { id: input.registrationId },
    select: { paymentStatus: true, paymentReference: true },
  });

  if (!current) return { settled: false, alreadySettled: false };

  if (current.paymentStatus === "paid") {
    return { settled: true, alreadySettled: true };
  }

  await prisma.examRegistration.update({
    where: { id: input.registrationId },
    data: {
      paymentStatus: "paid",
      paymentReference: input.reference,
      amountPaid: input.amount,
      // Paying is what turns a held seat into a confirmed one.
      status: "confirmed",
    },
  });

  // The receipt lives here rather than in either route, so it goes out exactly
  // once whichever path settles first — the redirect after checkout, or the
  // webhook when the payer closed the tab.
  await queueReceipt(input.registrationId, input.reference, input.amount);

  return { settled: true, alreadySettled: false };
}

async function queueReceipt(registrationId: string, reference: string, amount: number) {
  try {
    const registration = await prisma.examRegistration.findUnique({
      where: { id: registrationId },
      select: {
        examName: true, seatNumber: true, examDate: true, candidateEmail: true, candidateName: true,
        student: { select: { id: true, user: { select: { email: true, name: true } } } },
        user: { select: { email: true, name: true } },
      },
    });
    if (!registration) return;

    const to =
      registration.student?.user.email ??
      registration.user?.email ??
      registration.candidateEmail;
    if (!to) return;

    const name =
      registration.student?.user.name ??
      registration.user?.name ??
      registration.candidateName ??
      "there";

    await queueEmail({
      to,
      subject: `Payment received — ${registration.examName}`,
      type: "exam_fee_receipt",
      studentId: registration.student?.id ?? null,
      html: `
        <p>Hello ${name},</p>
        <p>We have received ₦${amount.toLocaleString()} for <strong>${registration.examName}</strong>.
           Your seat is now confirmed.</p>
        <p><strong>Date:</strong> ${new Date(registration.examDate).toDateString()}<br/>
           <strong>Seat:</strong> ${registration.seatNumber ?? "—"}<br/>
           <strong>Reference:</strong> ${reference}</p>
        <p>Please arrive 30 minutes early with a valid photo ID.</p>
      `,
    });
  } catch (error) {
    // A receipt must never undo a settled payment.
    console.warn("Could not queue exam fee receipt:", error);
  }
}
