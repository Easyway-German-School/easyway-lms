import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { queueEmail } from "@/lib/email-queue";
import { examWhen } from "@/lib/exam-schedule";

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

/**
 * Manual Moniepoint bank-transfer path for an exam fee.
 *
 * No live Monnify (Moniepoint for Business) API integration yet — no
 * merchant keys as of 2026-09-13, so this is the manual version: one
 * school-wide account shown to every candidate, a slip uploaded, an admin
 * checks the bank app and clicks confirm. When Monnify API access lands,
 * "what account does this candidate pay into" becomes a per-booking reserved
 * account generated here instead of a static one — nothing else in the
 * booking flow (upload, admin review, settlement) has to change.
 */
export function manualBankTransferDetails(): { bankName: string; accountName: string; accountNumber: string } {
  return {
    bankName: process.env.EXAM_BANK_NAME || "Moniepoint MFB",
    accountName: process.env.EXAM_BANK_ACCOUNT_NAME || "Easyway German Language School",
    accountNumber: process.env.EXAM_BANK_ACCOUNT_NUMBER || "",
  };
}

/** A candidate uploads their transfer slip. Does not settle the fee — an admin still has to verify it. */
export async function submitBankTransferProof(input: {
  registrationId: string;
  userId?: string | null;
  token?: string | null;
  transferProofUrl: string;
  transferReference?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const resolved = await resolvePayable(input.registrationId, { userId: input.userId, token: input.token });
  if (!resolved.ok) return resolved;
  if (resolved.registration.alreadyPaid) {
    return { ok: false, error: "This fee has already been settled.", status: 409 };
  }

  await prisma.examRegistration.update({
    where: { id: input.registrationId },
    data: {
      paymentMethod: "bank_transfer",
      paymentStatus: "pending_verification",
      transferProofUrl: input.transferProofUrl,
      transferReference: input.transferReference ?? null,
      transferRejectedReason: null,
    },
  });

  try {
    const { notify } = await import("@/lib/notify");
    await notify({
      to: { audience: "admin", capability: "exams" },
      title: "Exam fee slip awaiting verification",
      message: `${resolved.registration.name} uploaded a bank-transfer slip for ${resolved.registration.examName} (₦${resolved.registration.fee.toLocaleString()}). Check the transfer landed, then verify or reject it.`,
      kind: "exam.transfer_proof_submitted",
      severity: "info",
      link: "/admin/exams",
      dedupeKey: `exam-transfer-proof:${input.registrationId}`,
      push: false,
    });
  } catch (error) {
    // A missed office alert must not undo the candidate's upload — the
    // registration list still shows it as pending_verification either way.
    console.warn("Could not notify office of transfer proof:", error);
  }

  return { ok: true };
}

/**
 * An admin confirms the money actually landed. Reuses the same settle path
 * as Paystack (paid + confirmed + one receipt) so the two rails cannot drift
 * apart in what "paid" means.
 */
export async function verifyBankTransfer(
  registrationId: string,
  adminUserId: string,
): Promise<{ ok: true; alreadySettled: boolean } | { ok: false; error: string }> {
  const registration = await prisma.examRegistration.findUnique({
    where: { id: registrationId },
    include: { exam: { select: { fee: true } } },
  });
  if (!registration) return { ok: false, error: "Registration not found" };
  if (registration.paymentStatus === "paid") return { ok: true, alreadySettled: true };

  const amount = registration.exam?.fee ?? registration.amountPaid ?? 0;
  const reference = registration.transferReference || `bank-transfer:${registrationId}`;

  await prisma.examRegistration.update({
    where: { id: registrationId },
    data: {
      paymentStatus: "paid",
      status: "confirmed",
      amountPaid: amount,
      paymentReference: reference,
      transferVerifiedBy: adminUserId,
      transferVerifiedAt: new Date(),
    },
  });

  await queueReceipt(registrationId, reference, amount);
  return { ok: true, alreadySettled: false };
}

/** An admin sends a slip back — wrong amount, wrong account, unreadable. The candidate can resubmit. */
export async function rejectBankTransfer(registrationId: string, reason: string): Promise<void> {
  const registration = await prisma.examRegistration.update({
    where: { id: registrationId },
    data: {
      paymentStatus: "unpaid",
      paymentMethod: null,
      transferRejectedReason: reason,
    },
    select: {
      examName: true, candidateEmail: true, candidateName: true,
      student: { select: { id: true, user: { select: { email: true, name: true } } } },
      user: { select: { email: true, name: true } },
    },
  });

  const to = registration.student?.user.email ?? registration.user?.email ?? registration.candidateEmail;
  if (!to) return;
  const name = registration.student?.user.name ?? registration.user?.name ?? registration.candidateName ?? "there";

  await queueEmail({
    to,
    subject: `We couldn't verify your payment — ${registration.examName}`,
    type: "exam_fee_receipt",
    studentId: registration.student?.id ?? null,
    html: `
      <p>Hello ${name},</p>
      <p>We could not confirm your bank transfer for <strong>${registration.examName}</strong>: ${reason}</p>
      <p>Please check the details and try again — your seat is still held while payment is outstanding, but not yet confirmed.</p>
    `,
  });
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
        <p><strong>When:</strong> ${examWhen(registration.examDate)}<br/>
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
