import type { ExamBooking, ExamModulePrice, ExamSession } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail, type EmailAttachment } from "@/lib/email";
import { bookingLink, paymentAccount, prepClassesLink, siteUrl } from "@/lib/config";
import { missingAdmissionFields } from "@/lib/candidate-status";
import { arrivalClock, calendarDaysBetween, formatClock, formatDate, formatLongDate } from "@/lib/exam-time";
import { buildInvoice, invoiceNumberFor, moduleSummary, paymentReferenceFor } from "@/lib/invoice";
import { renderInvoicePdf } from "@/lib/invoice-pdf";
import { renderJourneyEmail, type EmailContext, type JourneyStep } from "@/lib/journey-emails";
import { dueStep } from "@/lib/journey-schedule";

/**
 * The database half of the candidate journey: build an email's context from a
 * booking, send it at most once, record it in the candidate's file (Operations
 * Manual §46), and run the daily sweep that sends whatever has come due.
 * WHAT is said lives in journey-emails.ts, WHEN in journey-schedule.ts.
 */

export type BookingForJourney = ExamBooking & { session: ExamSession & { modulePrices: ExamModulePrice[] } };

const INCLUDE = { session: { include: { modulePrices: true } } } as const;

export function contextFor(b: BookingForJourney, now = new Date()): EmailContext {
  const invoiceNumber = b.invoiceNumber ?? invoiceNumberFor(b.referenceCode);
  const deadline = b.session.registrationDeadline;
  return {
    fullName: b.fullName,
    email: b.email,
    referenceCode: b.referenceCode,
    invoiceNumber,
    level: b.session.level,
    modulesLabel: moduleSummary(b.modules),
    express: b.express,
    expressFee: b.expressFee,
    feeTotal: b.feeTotal,
    amountReceived: b.amountReceived,
    examDate: formatLongDate(b.session.startDate),
    venueName: b.session.venueName,
    venueAddress: b.session.venueAddress,
    arrivalTime: arrivalClock(b.session.startTime, b.session.arrivalMinutesBefore),
    startTime: formatClock(b.session.startTime),
    seatNumber: b.seatNumber,
    registrationDeadline: deadline.getTime() > now.getTime() ? formatDate(deadline) : null,
    bank: paymentAccount(),
    paymentReference: paymentReferenceFor(b.fullName, invoiceNumber),
    bookingUrl: bookingLink(b.referenceCode, b.email),
    prepUrl: prepClassesLink(b.referenceCode, b.email),
    termsUrl: `${siteUrl()}/terms`,
    missingFields: missingAdmissionFields(b),
    idUploaded: Boolean(b.passportDataPageUrl),
    daysToExam: calendarDaysBetween(now, b.session.startDate),
    certificateCollection: b.certificateCollection,
    candidateDetails: [
      { label: "Full name", value: b.fullName },
      { label: "Date of birth", value: formatDate(b.dateOfBirth) },
      { label: "Place of birth", value: b.placeOfBirth },
      { label: "Nationality", value: b.nationality },
      { label: "Examination", value: `ÖSD Zertifikat ${b.session.level}` },
      { label: "Examination date", value: formatDate(b.session.startDate) },
    ],
  };
}

/** The invoice (pending) or receipt (paid) PDF for a booking — same document, the paid state fills the confirmation block. */
export async function invoicePdfFor(b: BookingForJourney, now = new Date()): Promise<{ bytes: Uint8Array; filename: string; paid: boolean }> {
  const model = buildInvoice(b, b.session, now);
  const bytes = await renderInvoicePdf(model);
  return { bytes, filename: `${model.paid ? "Receipt" : "Invoice"}-${model.invoiceNumber}.pdf`, paid: model.paid };
}

export type SendResult = { ok: true; skipped?: "already sent" } | { ok: false; error: string };

/**
 * Send one journey email — at most once per (booking, step).
 *
 * The log row is CLAIMED before sending, not written after: two triggers
 * racing (the admin's click and the daily sweep, or a double-click) can't both
 * get past the unique constraint, so a candidate never gets the same email
 * twice. If the send then fails, the claim is released so the next sweep
 * retries — a lost email is worse than a late one. `force` re-sends on
 * purpose (the office's "Resend" button) and refreshes the log row.
 */
export async function sendJourneyStep(bookingId: string, step: JourneyStep, opts?: { force?: boolean; now?: Date }): Promise<SendResult> {
  const now = opts?.now ?? new Date();
  const booking = await prisma.examBooking.findUnique({ where: { id: bookingId }, include: INCLUDE });
  if (!booking) return { ok: false, error: "Booking not found" };

  const rendered = renderJourneyEmail(step, contextFor(booking, now));

  // The PDF is a courtesy on top of an email that already carries the payment
  // details in its body: if drawing it fails, the email still goes.
  let attachment: EmailAttachment | undefined;
  if (rendered.attach) {
    try {
      const pdf = await invoicePdfFor(booking, now);
      attachment = { filename: pdf.filename, content: pdf.bytes, contentType: "application/pdf" };
    } catch (error) {
      console.error(`Could not build the ${rendered.attach} PDF for ${booking.referenceCode}:`, error);
    }
  }

  const row = { bookingId, step, subject: rendered.subject, toEmail: booking.email, attachment: attachment?.filename ?? null };

  if (!opts?.force) {
    try {
      await prisma.journeyEmail.create({ data: row });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") return { ok: true, skipped: "already sent" };
      throw error;
    }
  }

  const sent = await sendEmail({
    to: booking.email,
    subject: rendered.subject,
    html: rendered.html,
    attachments: attachment ? [attachment] : undefined,
  });

  if (!sent) {
    if (!opts?.force) await prisma.journeyEmail.delete({ where: { bookingId_step: { bookingId, step } } }).catch(() => {});
    return { ok: false, error: "The email could not be sent — it will be retried automatically." };
  }
  if (opts?.force) {
    await prisma.journeyEmail.upsert({
      where: { bookingId_step: { bookingId, step } },
      create: row,
      update: { subject: row.subject, toEmail: row.toEmail, attachment: row.attachment, sentAt: new Date() },
    });
  }
  return { ok: true };
}

/** Fire-and-log wrapper for the immediate, action-triggered sends: an email hiccup must never fail the action that caused it. */
export async function sendJourneyStepSafely(bookingId: string, step: JourneyStep): Promise<boolean> {
  try {
    const result = await sendJourneyStep(bookingId, step);
    return result.ok;
  } catch (error) {
    console.error(`Journey step ${step} failed for booking ${bookingId}:`, error);
    return false;
  }
}

/**
 * The daily sweep: for every live booking, send the ONE step that has come
 * due (see journey-schedule.ts). Idempotent — running it twice sends nothing new.
 */
export async function runJourneySweep(now = new Date()): Promise<{ checked: number; sent: Partial<Record<JourneyStep, number>>; failed: number }> {
  const bookings = await prisma.examBooking.findMany({
    where: { status: { notIn: ["cancelled", "no_show"] }, certificateDeliveredAt: null },
    include: { ...INCLUDE, journeyEmails: { select: { step: true } } },
  });

  const sent: Partial<Record<JourneyStep, number>> = {};
  let failed = 0;

  for (const booking of bookings) {
    const already = new Set(booking.journeyEmails.map((e) => e.step as JourneyStep));
    const step = dueStep(
      {
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        createdAt: booking.createdAt,
        verifiedAt: booking.verifiedAt,
        infoConfirmedAt: booking.infoConfirmedAt,
        admittedAt: booking.admittedAt,
        examCompletedAt: booking.examCompletedAt,
        resultReleasedAt: booking.resultReleasedAt,
        certificateReadyAt: booking.certificateReadyAt,
        prepInterestAt: booking.prepInterestAt,
        missingFields: missingAdmissionFields(booking),
        examStart: booking.session.startDate,
      },
      already,
      now,
    );
    if (!step) continue;
    try {
      const result = await sendJourneyStep(booking.id, step, { now });
      if (result.ok && !result.skipped) sent[step] = (sent[step] ?? 0) + 1;
      if (!result.ok) failed++;
    } catch (error) {
      failed++;
      console.error(`Sweep: ${step} failed for ${booking.referenceCode}:`, error);
    }
  }

  return { checked: bookings.length, sent, failed };
}

