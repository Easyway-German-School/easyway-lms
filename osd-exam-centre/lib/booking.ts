import { prisma } from "@/lib/prisma";
import { generateReferenceCode } from "@/lib/reference-code";
import { seatNumberForIndex } from "@/lib/seat-numbering";
import { sendEmail } from "@/lib/email";
import { bookingLink } from "@/lib/config";
import { refundCardPayment, verifyCardPayment } from "@/lib/payments";
import { escapeHtml } from "@/lib/html";

export const MODULES = ["reading", "listening", "writing", "speaking"] as const;
export type ExamModule = (typeof MODULES)[number];

/** The one ownership check every candidate-facing booking route needs. */
export async function resolveOwnedBooking(referenceCode: string, email: string) {
  const booking = await prisma.examBooking.findUnique({ where: { referenceCode } });
  if (!booking || booking.email !== email.trim().toLowerCase()) return null;
  return booking;
}

/** Shared between the booking and manual-add zod schemas so the two never quietly drift apart. */
export const MIN_AGE_YEARS = 5; // ÖSD's own Fit-level exams are aimed at children this young
export const MAX_AGE_YEARS = 100;

export function isPlausibleDateOfBirth(value: string): boolean {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const ageYears = (Date.now() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return ageYears >= MIN_AGE_YEARS && ageYears <= MAX_AGE_YEARS;
}

/**
 * A candidate's ID document must not already be expired on the day they
 * book — the Easyway ÖSD Examination Operations Manual (§7, §12) treats a
 * valid identification document as a precondition for admission, and
 * catching an already-expired one at booking time is cheaper for everyone
 * than catching it at exam-day identity verification.
 */
export function isPlausibleIdExpiry(value: string): boolean {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() > Date.now();
}

export type UpdateBookingDetailsInput = Partial<{
  fullName: string;
  phone: string;
  addressLine: string;
  city: string;
  country: string;
  dateOfBirth: string;
  placeOfBirth: string;
  countryOfBirth: string;
  nationality: string;
  gender: string;
  idType: string;
  idNumber: string;
  idExpiry: string;
  isRepeatAttempt: boolean;
  specialNeeds: string;
}>;

/**
 * A candidate correcting their own typo before paying — a wrong date of
 * birth or a misspelled name is exactly the kind of thing worth fixing
 * before it ends up on a certificate. Deliberately closed off once payment
 * has started (`unpaid` only): a booking under review or already paid needs
 * the office involved in a change, not a silent self-edit. Email is not
 * editable here at all — it's the lookup key a candidate needs to find
 * their own booking again, so changing it needs more care than this.
 */
export async function updateBookingDetails(
  bookingId: string,
  updates: UpdateBookingDetailsInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const booking = await prisma.examBooking.findUnique({ where: { id: bookingId }, select: { paymentStatus: true } });
  if (!booking) return { ok: false, error: "Booking not found" };
  if (booking.paymentStatus !== "unpaid") {
    return { ok: false, error: "This booking can no longer be edited — use \"Need help?\" instead." };
  }
  if (updates.dateOfBirth !== undefined && !isPlausibleDateOfBirth(updates.dateOfBirth)) {
    return { ok: false, error: "Enter a valid date of birth." };
  }
  if (updates.idExpiry !== undefined && !isPlausibleIdExpiry(updates.idExpiry)) {
    return { ok: false, error: "Your ID document must not already be expired." };
  }

  await prisma.examBooking.update({
    where: { id: bookingId },
    data: {
      ...(updates.fullName !== undefined ? { fullName: updates.fullName.trim() } : {}),
      ...(updates.phone !== undefined ? { phone: updates.phone.trim() } : {}),
      ...(updates.addressLine !== undefined ? { addressLine: updates.addressLine.trim() } : {}),
      ...(updates.city !== undefined ? { city: updates.city.trim() } : {}),
      ...(updates.country !== undefined ? { country: updates.country.trim() } : {}),
      ...(updates.dateOfBirth !== undefined ? { dateOfBirth: new Date(updates.dateOfBirth) } : {}),
      ...(updates.placeOfBirth !== undefined ? { placeOfBirth: updates.placeOfBirth.trim() } : {}),
      ...(updates.countryOfBirth !== undefined ? { countryOfBirth: updates.countryOfBirth.trim() } : {}),
      ...(updates.nationality !== undefined ? { nationality: updates.nationality.trim() } : {}),
      ...(updates.gender !== undefined ? { gender: updates.gender.trim() || null } : {}),
      ...(updates.idType !== undefined ? { idType: updates.idType.trim() } : {}),
      ...(updates.idNumber !== undefined ? { idNumber: updates.idNumber.trim() } : {}),
      ...(updates.idExpiry !== undefined ? { idExpiry: new Date(updates.idExpiry) } : {}),
      ...(updates.isRepeatAttempt !== undefined ? { isRepeatAttempt: updates.isRepeatAttempt } : {}),
      ...(updates.specialNeeds !== undefined ? { specialNeeds: updates.specialNeeds.trim() || null } : {}),
    },
  });

  return { ok: true };
}

export type CreateBookingInput = {
  sessionId: string;
  fullName: string;
  email: string;
  phone: string;
  addressLine: string;
  city: string;
  country?: string;
  dateOfBirth: string; // ISO date
  placeOfBirth: string;
  countryOfBirth: string;
  nationality: string;
  gender?: string;
  idType: string;
  idNumber: string;
  idExpiry: string; // ISO date
  isRepeatAttempt?: boolean;
  specialNeeds?: string;
  modules: string[]; // ["full"] or a subset of MODULES
  /** True the instant the candidate ticks the consent checkbox — see ExamBooking.consentAcceptedAt. */
  consentAccepted: boolean;
};

export type CreateBookingResult =
  | { ok: true; referenceCode: string; feeTotal: number }
  | { ok: false; error: string; code: "not_found" | "closed" | "invalid" | "duplicate" | "rate_limited" };

/** More than this many bookings from one email in an hour is spam, not enthusiasm. */
const BOOKING_RATE_LIMIT = 3;
const BOOKING_RATE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Book a place. Deliberately does NOT assign a seat — seats are assigned
 * only once payment is verified (see confirmBooking below), matching "your
 * seat is automatically reserved" being the AFTER-PAYMENT message, not the
 * after-booking one. A booking with no seat yet still reserves nothing
 * physical, so overselling isn't a concern at this step the way it is for
 * confirmBooking's seat count.
 */
export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  if (!input.consentAccepted) {
    return { ok: false, error: "You must accept the rules and data-consent notice to book.", code: "invalid" };
  }

  const email = input.email.trim().toLowerCase();

  const session = await prisma.examSession.findUnique({
    where: { id: input.sessionId },
    include: { modulePrices: true },
  });
  if (!session || !session.published) {
    return { ok: false, error: "That sitting is not available.", code: "not_found" };
  }
  const now = new Date();
  if (now > session.registrationDeadline || session.startDate <= now) {
    return { ok: false, error: "Registration for this sitting has closed.", code: "closed" };
  }

  // Same person, same sitting, twice — a double-click or a genuine repeat
  // attempt, either way one booking is enough. "closed" excludes bookings
  // the candidate has already walked away from.
  const existing = await prisma.examBooking.findFirst({
    where: { sessionId: session.id, email, status: { not: "cancelled" } },
    select: { referenceCode: true },
  });
  if (existing) {
    return {
      ok: false,
      error: `You already have a booking for this sitting (reference ${existing.referenceCode}) — check its status instead of booking again.`,
      code: "duplicate",
    };
  }

  const recentCount = await prisma.examBooking.count({
    where: { email, createdAt: { gte: new Date(now.getTime() - BOOKING_RATE_WINDOW_MS) } },
  });
  if (recentCount >= BOOKING_RATE_LIMIT) {
    return { ok: false, error: "Too many booking attempts from this email recently — please contact the office directly.", code: "rate_limited" };
  }

  const modules = input.modules.length ? input.modules : ["full"];
  const feeTotal = computeFee(session, modules);
  if (feeTotal === null) {
    return { ok: false, error: "Could not price that selection of modules.", code: "invalid" };
  }

  let referenceCode = generateReferenceCode(session.startDate.getFullYear());
  // Collision odds are astronomically low (32^5 space) but the unique
  // constraint means a retry is free insurance rather than a 500 for the one
  // candidate unlucky enough to hit it.
  for (let attempt = 0; attempt < 3; attempt++) {
    const clash = await prisma.examBooking.findUnique({ where: { referenceCode } });
    if (!clash) break;
    referenceCode = generateReferenceCode(session.startDate.getFullYear());
  }

  const booking = await prisma.examBooking.create({
    data: {
      referenceCode,
      sessionId: session.id,
      fullName: input.fullName.trim(),
      email,
      phone: input.phone.trim(),
      addressLine: input.addressLine.trim(),
      city: input.city.trim(),
      country: input.country?.trim() || "Nigeria",
      dateOfBirth: new Date(input.dateOfBirth),
      placeOfBirth: input.placeOfBirth.trim(),
      countryOfBirth: input.countryOfBirth.trim(),
      nationality: input.nationality.trim(),
      gender: input.gender?.trim() || null,
      idType: input.idType.trim(),
      idNumber: input.idNumber.trim(),
      idExpiry: new Date(input.idExpiry),
      isRepeatAttempt: input.isRepeatAttempt ?? false,
      specialNeeds: input.specialNeeds?.trim() || null,
      modules,
      feeTotal,
      consentAcceptedAt: new Date(),
    },
  });

  await sendEmail({
    to: booking.email,
    subject: `Booking received — ${session.title}`,
    html: `
      <p>Hello ${escapeHtml(booking.fullName)},</p>
      <p>We've received your booking for <strong>${session.title}</strong> at ${session.venueName}.</p>
      <p><strong>Reference:</strong> ${booking.referenceCode}<br/>
         <strong>Amount due:</strong> ₦${feeTotal.toLocaleString()}</p>
      <p>Your seat is reserved once payment is confirmed.
         <a href="${bookingLink(booking.referenceCode, booking.email)}">Go to your booking</a> to pay and upload your documents.</p>
    `,
  });

  return { ok: true, referenceCode: booking.referenceCode, feeTotal };
}

export type CreateManualBookingInput = Omit<CreateBookingInput, "consentAccepted">;

/**
 * The office books on a candidate's behalf — a phone call, a walk-in, or a
 * cash payment taken in person. Skips the public rules: no published/
 * deadline check (an admin exercising judgment overrides those), no
 * consent timestamp (there was no online form to consent through — the
 * office is vouching for the data instead), and marks it paid + seated
 * immediately since the office is also confirming payment was received.
 */
export async function createManualBooking(
  input: CreateManualBookingInput,
  adminId: string,
): Promise<CreateBookingResult> {
  const email = input.email.trim().toLowerCase();
  const session = await prisma.examSession.findUnique({
    where: { id: input.sessionId },
    include: { modulePrices: true },
  });
  if (!session) return { ok: false, error: "That sitting does not exist.", code: "not_found" };

  const existing = await prisma.examBooking.findFirst({
    where: { sessionId: session.id, email, status: { not: "cancelled" } },
    select: { referenceCode: true },
  });
  if (existing) {
    return { ok: false, error: `This candidate already has a booking for this sitting (${existing.referenceCode}).`, code: "duplicate" };
  }

  const modules = input.modules.length ? input.modules : ["full"];
  const feeTotal = computeFee(session, modules);
  if (feeTotal === null) return { ok: false, error: "Could not price that selection of modules.", code: "invalid" };

  let referenceCode = generateReferenceCode(session.startDate.getFullYear());
  for (let attempt = 0; attempt < 3; attempt++) {
    const clash = await prisma.examBooking.findUnique({ where: { referenceCode } });
    if (!clash) break;
    referenceCode = generateReferenceCode(session.startDate.getFullYear());
  }

  const booking = await prisma.examBooking.create({
    data: {
      referenceCode,
      sessionId: session.id,
      fullName: input.fullName.trim(),
      email,
      phone: input.phone.trim(),
      addressLine: input.addressLine.trim(),
      city: input.city.trim(),
      country: input.country?.trim() || "Nigeria",
      dateOfBirth: new Date(input.dateOfBirth),
      placeOfBirth: input.placeOfBirth.trim(),
      countryOfBirth: input.countryOfBirth.trim(),
      nationality: input.nationality.trim(),
      gender: input.gender?.trim() || null,
      idType: input.idType.trim(),
      idNumber: input.idNumber.trim(),
      idExpiry: new Date(input.idExpiry),
      isRepeatAttempt: input.isRepeatAttempt ?? false,
      specialNeeds: input.specialNeeds?.trim() || null,
      modules,
      feeTotal,
      addedByOffice: true,
    },
  });

  // Reuses the exact same seat-assignment transaction the public flow does
  // — an office-entered booking is not exempt from the capacity check.
  const confirmed = await confirmBookingPayment(booking.id, adminId, { paymentMethod: "office" });
  if (!confirmed.ok) {
    return { ok: false, error: `Booking created (${referenceCode}) but could not be seated: ${confirmed.error}`, code: "invalid" };
  }

  return { ok: true, referenceCode, feeTotal };
}

export function computeFee(
  session: { feeWholeExam: number; modulePrices: { module: string; price: number }[] },
  modules: string[],
): number | null {
  if (modules.length === 1 && modules[0] === "full") return session.feeWholeExam;
  const priceByModule = new Map(session.modulePrices.map((m) => [m.module, m.price]));
  let total = 0;
  for (const m of modules) {
    const price = priceByModule.get(m);
    if (price === undefined) return null;
    total += price;
  }
  return total;
}

/**
 * An admin confirms payment landed. This is the ONE place a seat number is
 * assigned — inside a transaction that re-reads the taken count, so two
 * transfers verified in the same second cannot land on the same seat.
 */
export type ConfirmPaymentResult =
  | { ok: true; seatNumber: number; alreadyConfirmed: boolean }
  | { ok: false; error: string; code: "not_found" | "full" | "amount_mismatch" };

export async function confirmBookingPayment(
  bookingId: string,
  verifiedBy: string,
  opts?: { paymentMethod?: string; reference?: string; expectedAmount?: number },
): Promise<ConfirmPaymentResult> {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.examBooking.findUnique({ where: { id: bookingId } });
    if (!booking) return { ok: false, error: "Booking not found", code: "not_found" };
    if (booking.seatNumber !== null) {
      return { ok: true, seatNumber: booking.seatNumber, alreadyConfirmed: true };
    }

    // Only the card path passes this — Flutterwave's own verified amount,
    // checked against what this booking actually owes before anything is
    // marked paid. Bank transfer skips it: an admin has already looked at
    // the slip and the amount by the time confirmBookingPayment runs there.
    if (opts?.expectedAmount !== undefined && opts.expectedAmount < booking.feeTotal) {
      return {
        ok: false,
        error: `Amount paid (₦${opts.expectedAmount.toLocaleString()}) is less than the ₦${booking.feeTotal.toLocaleString()} fee due.`,
        code: "amount_mismatch",
      };
    }

    const session = await tx.examSession.findUnique({ where: { id: booking.sessionId } });
    const taken = await tx.examBooking.count({
      where: { sessionId: booking.sessionId, seatNumber: { not: null } },
    });
    if (session && taken >= session.capacity) {
      return {
        ok: false,
        error: `This sitting is full (${session.capacity} seats) — do not confirm this payment without arranging a different sitting.`,
        code: "full",
      };
    }
    const seatNumber = seatNumberForIndex(taken);

    await tx.examBooking.update({
      where: { id: bookingId },
      data: {
        paymentStatus: "paid",
        status: "confirmed",
        seatNumber,
        verifiedBy,
        verifiedAt: new Date(),
        ...(opts?.paymentMethod ? { paymentMethod: opts.paymentMethod } : {}),
        ...(opts?.reference ? { transferReference: opts.reference } : {}),
      },
    });

    await sendEmail({
      to: booking.email,
      subject: `Seat confirmed — ${session?.title ?? "your ÖSD exam"}`,
      html: `
        <p>Hello ${escapeHtml(booking.fullName)},</p>
        <p>Your payment has been confirmed. Your seat has been automatically reserved.</p>
        <p><strong>You are in seat no. ${seatNumber}.</strong></p>
        <p><a href="${bookingLink(booking.referenceCode, booking.email)}">Print your admission slip</a> and bring your
           international passport's data page with you on the day.</p>
      `,
    });

    return { ok: true, seatNumber, alreadyConfirmed: false };
  });
}

/**
 * The card-payment settlement path: verify with Flutterwave, then run the
 * exact same confirmation as the admin's manual bank-transfer verify.
 * Called from both the browser's redirect back and the webhook — safe to
 * call twice for the same transaction, since confirmBookingPayment is
 * idempotent on seatNumber.
 *
 * The one path that does more than that: if confirmation fails because the
 * sitting filled up, the candidate's card has still been charged — a real
 * charge for a seat that no longer exists. Rather than leave that silently
 * unresolved, this immediately requests a Flutterwave refund and marks the
 * booking so it can't be missed on the admin dashboard.
 */
export async function settleCardPayment(
  transactionId: string,
): Promise<{ ok: true; bookingId: string; seatNumber: number } | { ok: false; error: string }> {
  const verified = await verifyCardPayment(transactionId);
  if (!verified.ok) return verified;

  const result = await confirmBookingPayment(verified.bookingId, "flutterwave", {
    paymentMethod: "card",
    reference: transactionId,
    expectedAmount: verified.amount,
  });
  if (result.ok) return { ok: true, bookingId: verified.bookingId, seatNumber: result.seatNumber };

  if (result.code === "full") {
    await refundFilledSittingCharge(verified.bookingId, transactionId, verified.amount);
  }
  return result;
}

async function refundFilledSittingCharge(bookingId: string, transactionId: string, amount: number): Promise<void> {
  const refund = await refundCardPayment(transactionId, amount);
  const booking = await prisma.examBooking.update({
    where: { id: bookingId },
    data: {
      paymentMethod: "card",
      paymentStatus: refund.ok ? "refund_pending" : "refund_failed",
      transferReference: transactionId,
      ...(refund.ok ? { refundRequestedAt: new Date() } : {}),
      transferRejectedReason: refund.ok
        ? "This sitting filled up before your payment could be confirmed. A refund has been requested — it can take a few business days to reflect."
        : `This sitting filled up before your payment could be confirmed. Automatic refund failed (${refund.error}) — the office has been notified to refund you manually.`,
    },
  });

  await sendEmail({
    to: booking.email,
    subject: "Your seat could not be reserved — refund in progress",
    html: `
      <p>Hello ${escapeHtml(booking.fullName)},</p>
      <p>Your card was charged ₦${amount.toLocaleString()} for booking ${booking.referenceCode}, but the sitting filled up
         in the moments before your payment was confirmed — we're sorry for that.</p>
      <p>${refund.ok
        ? "A refund has been requested automatically and should reflect on your card within a few business days."
        : "We could not process the refund automatically — our office has been notified and will refund you directly."}</p>
      <p>Use "Need help?" from <a href="${bookingLink(booking.referenceCode, booking.email)}">your booking page</a> if you
         don't see it resolved within a week.</p>
    `,
  });

  if (!refund.ok) {
    console.error(`AUTOMATIC REFUND FAILED for booking ${bookingId}, transaction ${transactionId}: ${refund.error}. Manual refund required.`);
  }
}

export async function rejectBookingPayment(bookingId: string, reason: string): Promise<void> {
  const booking = await prisma.examBooking.update({
    where: { id: bookingId },
    data: { paymentStatus: "unpaid", paymentMethod: null, transferRejectedReason: reason },
  });
  await sendEmail({
    to: booking.email,
    subject: "We couldn't confirm your payment",
    html: `<p>Hello ${escapeHtml(booking.fullName)},</p><p>We could not confirm your bank transfer: ${escapeHtml(reason)}</p><p>Your booking is still held — please try again from your booking page.</p>`,
  });
}

/**
 * An admin cancels a booking — a no-show, a duplicate, a mistake. Marks the
 * row rather than deleting it, so the reference code stays a dead end
 * (never reused) and the sitting's history stays intact.
 *
 * Known limitation, deliberately not solved here: this does NOT reclaim the
 * seat number for reassignment. Seats are assigned by COUNTING already-
 * confirmed bookings (see confirmBookingPayment/seatNumberForIndex), not by
 * tracking which physical numbers are free — so cancelling seat 23 leaves
 * seat 23 vacant rather than making it available to the next candidate.
 * Fine for the volumes this runs at (a handful of cancellations per
 * sitting); revisit with a real seat-slot table if that stops being true.
 */
/**
 * An admin cancels a booking that had already been paid by card — a genuine
 * cancellation request, a duplicate, or a mistake. Distinct from the
 * automatic refund in settleCardPayment(), which only fires for one
 * specific case (a sitting filling up mid-payment); this is the general
 * "an admin decided to cancel a paid booking" path. Bank-transfer refunds
 * are never automated here — that money never touched this app's payment
 * processor, so there is nothing for it to refund through an API.
 */
export async function cancelBooking(bookingId: string, reason: string): Promise<{ refundAttempted: boolean; refundOk: boolean }> {
  const before = await prisma.examBooking.findUnique({ where: { id: bookingId } });
  if (!before) return { refundAttempted: false, refundOk: false };

  const shouldRefund = Boolean(before.paymentStatus === "paid" && before.paymentMethod === "card" && before.transferReference);
  let refundOk = false;

  if (shouldRefund) {
    const refund = await refundCardPayment(before.transferReference!, before.feeTotal);
    refundOk = refund.ok;
  }

  const booking = await prisma.examBooking.update({
    where: { id: bookingId },
    data: {
      status: "cancelled",
      ...(shouldRefund ? { paymentStatus: refundOk ? "refund_pending" : "refund_failed", ...(refundOk ? { refundRequestedAt: new Date() } : {}) } : {}),
    },
  });

  await sendEmail({
    to: booking.email,
    subject: `Booking cancelled — ${booking.referenceCode}`,
    html: `
      <p>Hello ${escapeHtml(booking.fullName)},</p>
      <p>Your booking ${booking.referenceCode} has been cancelled: ${escapeHtml(reason)}</p>
      ${shouldRefund
        ? refundOk
          ? `<p>Your ₦${booking.feeTotal.toLocaleString()} card payment has been refunded — it can take a few business days to reflect.</p>`
          : `<p>Your ₦${booking.feeTotal.toLocaleString()} card payment could not be refunded automatically — the office has been notified and will refund you directly.</p>`
        : ""}
      <p>If this is unexpected, use "Need help?" from <a href="${bookingLink(booking.referenceCode, booking.email)}">your booking page</a>.</p>
    `,
  });

  if (shouldRefund && !refundOk) {
    console.error(`AUTOMATIC REFUND FAILED on admin cancellation for booking ${bookingId}. Manual refund required.`);
  }

  return { refundAttempted: shouldRefund, refundOk };
}

/** Exam day: mark a seated candidate as not having shown up. */
export async function markNoShow(bookingId: string): Promise<void> {
  await prisma.examBooking.update({ where: { id: bookingId }, data: { status: "no_show" } });
}

export async function reviewBookingDocuments(
  bookingId: string,
  decision: "approved" | "rejected",
  reason?: string | null,
): Promise<void> {
  const booking = await prisma.examBooking.update({
    where: { id: bookingId },
    data: {
      documentStatus: decision,
      documentRejectedReason: decision === "rejected" ? reason ?? "Please re-upload a clearer copy." : null,
    },
  });
  if (decision !== "rejected") return;
  await sendEmail({
    to: booking.email,
    subject: "Please re-upload a document",
    html: `<p>Hello ${escapeHtml(booking.fullName)},</p><p>We couldn't accept one of your documents: ${escapeHtml(reason ?? "please re-upload a clearer copy.")}</p><p>Go back to your booking to try again.</p>`,
  });
}
