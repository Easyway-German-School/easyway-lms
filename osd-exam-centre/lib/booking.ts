import { prisma } from "@/lib/prisma";
import { generateReferenceCode } from "@/lib/reference-code";
import { seatNumberForIndex } from "@/lib/seat-numbering";
import { sendEmail } from "@/lib/email";
import { bookingLink } from "@/lib/config";
import { verifyCardPayment } from "@/lib/payments";

export const MODULES = ["reading", "listening", "writing", "speaking"] as const;
export type ExamModule = (typeof MODULES)[number];

/** The one ownership check every candidate-facing booking route needs. */
export async function resolveOwnedBooking(referenceCode: string, email: string) {
  const booking = await prisma.examBooking.findUnique({ where: { referenceCode } });
  if (!booking || booking.email !== email.trim().toLowerCase()) return null;
  return booking;
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
  modules: string[]; // ["full"] or a subset of MODULES
};

export type CreateBookingResult =
  | { ok: true; referenceCode: string; feeTotal: number }
  | { ok: false; error: string; code: "not_found" | "closed" | "invalid" };

/**
 * Book a place. Deliberately does NOT assign a seat — seats are assigned
 * only once payment is verified (see confirmBooking below), matching "your
 * seat is automatically reserved" being the AFTER-PAYMENT message, not the
 * after-booking one. A booking with no seat yet still reserves nothing
 * physical, so overselling isn't a concern at this step the way it is for
 * confirmBooking's seat count.
 */
export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
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
      email: input.email.trim().toLowerCase(),
      phone: input.phone.trim(),
      addressLine: input.addressLine.trim(),
      city: input.city.trim(),
      country: input.country?.trim() || "Nigeria",
      dateOfBirth: new Date(input.dateOfBirth),
      placeOfBirth: input.placeOfBirth.trim(),
      modules,
      feeTotal,
    },
  });

  await sendEmail({
    to: booking.email,
    subject: `Booking received — ${session.title}`,
    html: `
      <p>Hello ${booking.fullName},</p>
      <p>We've received your booking for <strong>${session.title}</strong> at ${session.venueName}.</p>
      <p><strong>Reference:</strong> ${booking.referenceCode}<br/>
         <strong>Amount due:</strong> ₦${feeTotal.toLocaleString()}</p>
      <p>Your seat is reserved once payment is confirmed.
         <a href="${bookingLink(booking.referenceCode, booking.email)}">Go to your booking</a> to pay and upload your documents.</p>
    `,
  });

  return { ok: true, referenceCode: booking.referenceCode, feeTotal };
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
export async function confirmBookingPayment(
  bookingId: string,
  verifiedBy: string,
  opts?: { paymentMethod?: string; reference?: string; expectedAmount?: number },
): Promise<{ ok: true; seatNumber: number; alreadyConfirmed: boolean } | { ok: false; error: string }> {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.examBooking.findUnique({ where: { id: bookingId } });
    if (!booking) return { ok: false, error: "Booking not found" };
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
      };
    }

    const session = await tx.examSession.findUnique({ where: { id: booking.sessionId } });
    const taken = await tx.examBooking.count({
      where: { sessionId: booking.sessionId, seatNumber: { not: null } },
    });
    if (session && taken >= session.capacity) {
      return { ok: false, error: `This sitting is full (${session.capacity} seats) — do not confirm this payment without arranging a different sitting.` };
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
        <p>Hello ${booking.fullName},</p>
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
  if (!result.ok) return result;

  return { ok: true, bookingId: verified.bookingId, seatNumber: result.seatNumber };
}

export async function rejectBookingPayment(bookingId: string, reason: string): Promise<void> {
  const booking = await prisma.examBooking.update({
    where: { id: bookingId },
    data: { paymentStatus: "unpaid", paymentMethod: null, transferRejectedReason: reason },
  });
  await sendEmail({
    to: booking.email,
    subject: "We couldn't confirm your payment",
    html: `<p>Hello ${booking.fullName},</p><p>We could not confirm your bank transfer: ${reason}</p><p>Your booking is still held — please try again from your booking page.</p>`,
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
export async function cancelBooking(bookingId: string, reason: string): Promise<void> {
  const booking = await prisma.examBooking.update({
    where: { id: bookingId },
    data: { status: "cancelled" },
  });
  await sendEmail({
    to: booking.email,
    subject: `Booking cancelled — ${booking.referenceCode}`,
    html: `<p>Hello ${booking.fullName},</p><p>Your booking ${booking.referenceCode} has been cancelled: ${reason}</p><p>If this is unexpected, use "Need help?" from <a href="${bookingLink(booking.referenceCode, booking.email)}">your booking page</a>.</p>`,
  });
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
    html: `<p>Hello ${booking.fullName},</p><p>We couldn't accept one of your documents: ${reason ?? "please re-upload a clearer copy."}</p><p>Go back to your booking to try again.</p>`,
  });
}
