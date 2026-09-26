import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import { OFFICE } from "@/lib/config";
import { admissionChecklist, missingAdmissionFields } from "@/lib/candidate-status";
import { sendJourneyStepSafely } from "@/lib/journey";

/**
 * The office's (and the candidate's) lifecycle actions after payment — the
 * Operations Manual §8 statuses that need a human decision. Each one stamps a
 * timestamp (status is derived from those, see candidate-status.ts) and, where
 * the journey says so, fires the matching email.
 */

type Result = { ok: true } | { ok: false; error: string };

/** The candidate ticks "my details are correct" (Document C's call to action). */
export async function confirmInfo(bookingId: string): Promise<Result> {
  const booking = await prisma.examBooking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: "Booking not found" };
  if (booking.paymentStatus !== "paid") return { ok: false, error: "Details can be confirmed once payment has been verified." };
  const missing = missingAdmissionFields(booking);
  if (missing.length) return { ok: false, error: `Please fill in: ${missing.join(", ")}.` };
  await prisma.examBooking.update({ where: { id: bookingId }, data: { infoConfirmedAt: booking.infoConfirmedAt ?? new Date() } });
  return { ok: true };
}

/**
 * Formal admission (Manual §11 step 10, §12: "A candidate must not simply be
 * admitted because payment has been made"). Enforced here, not just greyed
 * out in the UI: every precondition is re-checked against the database.
 */
export async function admitCandidate(bookingId: string): Promise<Result> {
  const booking = await prisma.examBooking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: "Booking not found" };
  if (booking.status === "cancelled" || booking.status === "no_show") return { ok: false, error: "This booking is cancelled." };
  if (booking.admittedAt) return { ok: true };
  const unmet = admissionChecklist(booking).filter((c) => !c.done).map((c) => c.label.toLowerCase());
  if (unmet.length) return { ok: false, error: `Can't admit yet — still needed: ${unmet.join("; ")}.` };
  if (booking.seatNumber === null) return { ok: false, error: "This candidate has no seat — verify the payment first." };

  await prisma.examBooking.update({ where: { id: bookingId }, data: { admittedAt: new Date() } });
  await sendJourneyStepSafely(bookingId, "admission");
  return { ok: true };
}

/** After the sitting: everyone admitted (and not marked absent) has now completed it. Returns how many. */
export async function markSessionCompleted(sessionId: string): Promise<number> {
  const { count } = await prisma.examBooking.updateMany({
    where: { sessionId, admittedAt: { not: null }, examCompletedAt: null, status: { notIn: ["cancelled", "no_show"] } },
    data: { examCompletedAt: new Date() },
  });
  return count;
}

/** Release one candidate's official result and tell them (Document K). */
export async function releaseResult(bookingId: string): Promise<Result> {
  const booking = await prisma.examBooking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: "Booking not found" };
  if (!booking.examCompletedAt) return { ok: false, error: "Mark the examination as completed first." };
  if (!booking.resultReleasedAt) {
    await prisma.examBooking.update({ where: { id: bookingId }, data: { resultReleasedAt: new Date() } });
  }
  await sendJourneyStepSafely(bookingId, "result_released");
  return { ok: true };
}

/** ÖSD results arrive for a whole sitting at once — release every completed candidate in one go. */
export async function releaseSessionResults(sessionId: string): Promise<{ released: number; failed: number }> {
  const pending = await prisma.examBooking.findMany({
    where: { sessionId, examCompletedAt: { not: null }, resultReleasedAt: null, status: { notIn: ["cancelled", "no_show"] } },
    select: { id: true },
  });
  let failed = 0;
  for (const { id } of pending) {
    const result = await releaseResult(id);
    if (!result.ok) failed++;
  }
  return { released: pending.length - failed, failed };
}

/** The certificate has arrived — tell the candidate how to get it (Document M). */
export async function markCertificateReady(bookingId: string, collection: string): Promise<Result> {
  const booking = await prisma.examBooking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: "Booking not found" };
  if (!booking.resultReleasedAt) return { ok: false, error: "Release the result first." };
  await prisma.examBooking.update({
    where: { id: bookingId },
    data: { certificateReadyAt: booking.certificateReadyAt ?? new Date(), certificateCollection: collection.trim() || null },
  });
  await sendJourneyStepSafely(bookingId, "certificate_ready");
  return { ok: true };
}

export async function markCertificateDelivered(bookingId: string): Promise<Result> {
  const booking = await prisma.examBooking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: "Booking not found" };
  if (!booking.certificateReadyAt) return { ok: false, error: "Mark the certificate as ready first." };
  await prisma.examBooking.update({ where: { id: bookingId }, data: { certificateDeliveredAt: new Date() } });
  return { ok: true };
}

/**
 * "Tell me about prep classes" — the candidate's own hand-raise. Recorded once
 * (so the office sees a warm lead and the journey stops pitching them) and the
 * classes team is emailed. Deliberately no price, no payment, no commitment.
 */
export async function recordPrepInterest(bookingId: string): Promise<Result> {
  const booking = await prisma.examBooking.findUnique({ where: { id: bookingId }, include: { session: { select: { title: true, level: true } } } });
  if (!booking) return { ok: false, error: "Booking not found" };
  if (booking.prepInterestAt) return { ok: true };
  await prisma.examBooking.update({ where: { id: bookingId }, data: { prepInterestAt: new Date() } });

  await sendEmail({
    to: process.env.OFFICE_NOTIFICATION_EMAIL || OFFICE.email,
    subject: `[Easyway ÖSD] Prep-class enquiry – ${booking.referenceCode}`,
    html: `<p>${escapeHtml(booking.fullName)} (${escapeHtml(booking.referenceCode)}) asked about prep classes for <strong>${escapeHtml(booking.session.title)}</strong>.</p>
      <p>Email: ${escapeHtml(booking.email)}<br/>Phone: ${escapeHtml(booking.phone)}<br/>Level: ${escapeHtml(booking.session.level)}</p>
      <p>They asked by tapping the link in the journey email — no payment or commitment yet. Please reach out with class dates.</p>`,
  });
  return { ok: true };
}
