import type { ExamBooking, ExamModulePrice, ExamSession } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail, zohoFallbackConfigured, type EmailAttachment } from "@/lib/email";
import { bookingLink, paymentAccount, prepClassesLink, siteUrl } from "@/lib/config";
import { missingAdmissionFields } from "@/lib/candidate-status";
import {
  CRITICAL_JOURNEY_STEPS,
  deliveryLabel,
  emailDeliveryTrustAfter,
  isCriticalJourneyStep,
  needsEmailAttention,
} from "@/lib/email-delivery";
import { arrivalClock, calendarDaysBetween, formatClock, formatDate, formatLongDate } from "@/lib/exam-time";
import { buildInvoice, invoiceNumberFor, moduleSummary, paymentReferenceFor } from "@/lib/invoice";
import { renderInvoicePdf } from "@/lib/invoice-pdf";
import { renderCustomEmail, renderJourneyEmail, type EmailContext, type JourneyStep } from "@/lib/journey-emails";
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
    examRegistrationLink: b.examRegistrationLink,
    examRegistrationDeadline: b.examRegistrationDeadline ? formatDate(b.examRegistrationDeadline) : null,
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
export async function invoicePdfFor(
  b: BookingForJourney,
  now = new Date(),
  opts?: { as?: "invoice" | "receipt" },
): Promise<{ bytes: Uint8Array; filename: string; paid: boolean }> {
  const model = buildInvoice(b, b.session, now, opts);
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
  // Office free-text notes are logged as custom:<timestamp> — they are not
  // journey templates and cannot be re-rendered from a step key.
  if (String(step).startsWith("custom:")) {
    return { ok: false, error: "Custom office emails can’t be auto-resent — write a new one from the candidate card." };
  }
  const booking = await prisma.examBooking.findUnique({ where: { id: bookingId }, include: INCLUDE });
  if (!booking) return { ok: false, error: "Booking not found" };

  const rendered = renderJourneyEmail(step, contextFor(booking, now));

  // The PDF is a courtesy on top of an email that already carries the payment
  // details in its body: if drawing it fails, the email still goes.
  let attachment: EmailAttachment | undefined;
  if (rendered.attach) {
    try {
      const pdf = await invoicePdfFor(booking, now, { as: rendered.attach });
      attachment = { filename: pdf.filename, content: pdf.bytes, contentType: "application/pdf" };
    } catch (error) {
      console.error(`Could not build the ${rendered.attach} PDF for ${booking.referenceCode}:`, error);
    }
  }

  const existing = await prisma.journeyEmail.findUnique({
    where: { bookingId_step: { bookingId, step } },
  });

  // Only skip when we already have a trusted SMTP accept. Failed / queued /
  // pre-support@ "accepted" rows must be allowed through (or force-resent).
  if (!opts?.force && existing) {
    const st = existing.status || "accepted";
    // Trusted accepts skip. Failed/queued retry. Unverified (pre-support@)
    // skips on the automatic path — Drain / Email attention force-resends.
    if (st === "accepted") return { ok: true, skipped: "already sent" };
    if (st !== "failed" && st !== "queued") return { ok: true, skipped: "already sent" };
  }

  if (!existing) {
    await prisma.journeyEmail.create({
      data: {
        bookingId,
        step,
        subject: rendered.subject,
        toEmail: booking.email,
        attachment: attachment?.filename ?? null,
        status: "queued",
        attemptCount: 1,
      },
    });
  } else {
    await prisma.journeyEmail.update({
      where: { bookingId_step: { bookingId, step } },
      data: {
        subject: rendered.subject,
        toEmail: booking.email,
        attachment: attachment?.filename ?? null,
        status: "queued",
        lastError: null,
        attemptCount: { increment: 1 },
      },
    });
  }

  // Critical journey mail: if Zoho/Zepto is wired, hit BOTH providers so a
  // silent Brevo drop does not strand a new registration.
  const dual =
    process.env.EMAIL_DUAL_SEND === "true" ||
    (zohoFallbackConfigured() && isCriticalJourneyStep(step));

  const sent = await sendEmail({
    to: booking.email,
    subject: rendered.subject,
    html: rendered.html,
    attachments: attachment ? [attachment] : undefined,
    dual,
    prefer: opts?.force && zohoFallbackConfigured() ? "zoho" : undefined,
  });

  if (!sent.ok) {
    await prisma.journeyEmail.update({
      where: { bookingId_step: { bookingId, step } },
      data: {
        status: "failed",
        lastError: sent.error,
        provider: sent.tried.join(",") || null,
        sentAt: new Date(),
      },
    }).catch(() => {});
    return { ok: false, error: sent.error || "The email could not be sent — it will be retried automatically." };
  }

  await prisma.journeyEmail.update({
    where: { bookingId_step: { bookingId, step } },
    data: {
      status: "accepted",
      messageId: sent.messageId,
      provider: sent.tried.length > 1 ? sent.tried.join("+") : sent.provider,
      lastError: null,
      sentAt: new Date(),
      subject: rendered.subject,
      toEmail: booking.email,
      attachment: attachment?.filename ?? null,
    },
  });
  return { ok: true };
}

/**
 * ÖSD hands Easyway a candidate's own Panthexa registration link on its own
 * schedule, not ours — so, unlike every other step, this one is never
 * scheduled by the daily sweep (it's deliberately left out of JOURNEY_ORDER).
 * The office pastes the link in and this saves it and sends it immediately,
 * `force`d past the once-only guard so a typo can be corrected and resent.
 */
export async function sendRegistrationLink(bookingId: string, link: string, deadline: Date | null): Promise<SendResult> {
  await prisma.examBooking.update({
    where: { id: bookingId },
    data: { examRegistrationLink: link, examRegistrationDeadline: deadline },
  });
  const result = await sendJourneyStep(bookingId, "registration_link", { force: true });
  if (result.ok) {
    await prisma.examBooking.update({ where: { id: bookingId }, data: { registrationLinkSentAt: new Date() } });
  }
  return result;
}

/**
 * The office's own free-text note to one candidate — not one of the fixed
 * journey steps, so it's logged under its own unique step name each time
 * (`custom:<timestamp>`) rather than the once-per-step slot every other
 * email uses, so sending several of these to the same candidate doesn't
 * collide with each other or overwrite the log.
 */
export async function sendCustomEmail(bookingId: string, subjectLine: string, message: string): Promise<SendResult> {
  const booking = await prisma.examBooking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: "Booking not found" };

  const rendered = renderCustomEmail(booking.fullName, booking.referenceCode, subjectLine, message);
  const sent = await sendEmail({
    to: booking.email,
    subject: rendered.subject,
    html: rendered.html,
    dual: zohoFallbackConfigured(),
  });
  if (!sent.ok) return { ok: false, error: sent.error || "The email could not be sent." };

  await prisma.journeyEmail.create({
    data: {
      bookingId,
      step: `custom:${Date.now()}`,
      subject: rendered.subject,
      toEmail: booking.email,
      status: "accepted",
      messageId: sent.messageId,
      provider: sent.tried.length > 1 ? sent.tried.join("+") : sent.provider,
    },
  });
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

/**
 * Admin "Drain Queue": force-resend the critical money emails that Brevo may
 * have silently dropped, then run the normal due-step sweep for everything else.
 * - Unpaid / pending_verification → booking_received (Invoice PDF)
 * - Paid → payment_confirmed (Receipt PDF)
 */
export async function drainEmailQueue(): Promise<{
  invoices: number;
  receipts: number;
  attentionResent: number;
  sweepSent: number;
  failed: number;
}> {
  const live = await prisma.examBooking.findMany({
    where: { status: { notIn: ["cancelled", "no_show"] } },
    select: {
      id: true,
      paymentStatus: true,
      journeyEmails: { select: { step: true, status: true, sentAt: true } },
    },
  });

  let invoices = 0;
  let receipts = 0;
  let attentionResent = 0;
  let failed = 0;

  const trustAfter = emailDeliveryTrustAfter();
  const alreadyGood = (rows: { step: string; status: string; sentAt: Date }[], step: string) =>
    rows.some((row) => row.step === step && (row.status || "accepted") === "accepted" && row.sentAt.getTime() >= trustAfter.getTime());

  type Job = { bookingId: string; step: JourneyStep; kind: "invoice" | "receipt" | "attention" };
  const jobs: Job[] = [];

  for (const b of live) {
    const moneyStep = (b.paymentStatus === "paid" ? "payment_confirmed" : "booking_received") as JourneyStep;
    // Skip anyone whose invoice/receipt was already accepted after the working From went live.
    // Drain used to force-resend every live booking, so people who already had the mail got it again.
    if (!alreadyGood(b.journeyEmails, moneyStep)) {
      jobs.push({
        bookingId: b.id,
        step: moneyStep,
        kind: moneyStep === "booking_received" ? "invoice" : "receipt",
      });
    }

    for (const row of b.journeyEmails) {
      if (row.step === moneyStep) continue;
      if (!(CRITICAL_JOURNEY_STEPS as readonly string[]).includes(row.step)) continue;
      if (!needsEmailAttention(row)) continue;
      jobs.push({ bookingId: b.id, step: row.step as JourneyStep, kind: "attention" });
    }
  }

  const concurrency = 3;
  for (let i = 0; i < jobs.length; i += concurrency) {
    const chunk = jobs.slice(i, i + concurrency);
    const outcomes = await Promise.all(
      chunk.map(async (job) => {
        try {
          const result = await sendJourneyStep(job.bookingId, job.step, { force: true });
          if (!result.ok) return "failed" as const;
          return job.kind;
        } catch (error) {
          console.error(`Drain queue: ${job.step} failed for ${job.bookingId}:`, error);
          return "failed" as const;
        }
      }),
    );
    for (const outcome of outcomes) {
      if (outcome === "failed") failed++;
      else if (outcome === "invoice") invoices++;
      else if (outcome === "receipt") receipts++;
      else attentionResent++;
    }
  }

  const sweep = await runJourneySweep();
  const sweepSent = Object.values(sweep.sent).reduce((n, v) => n + (v ?? 0), 0);
  return { invoices, receipts, attentionResent, sweepSent, failed: failed + sweep.failed };
}

/** Bookings whose journey mail needs a human look / force-resend. */
export async function listEmailAttention(): Promise<
  {
    bookingId: string;
    referenceCode: string;
    fullName: string;
    email: string;
    paymentStatus: string;
    step: string;
    subject: string;
    status: string;
    sentAt: string;
    messageId: string | null;
    lastError: string | null;
    attemptCount: number;
    reason: string;
  }[]
> {
  const trustAfter = emailDeliveryTrustAfter();
  // Actionable resend queue ONLY: failed / stuck / accepted before working From.
  // Recent "queued at Brevo" accepts are honesty labels on the candidate card —
  // they must NOT sit here or Resend all never clears (attempt 12+ still listed).
  const rows = await prisma.journeyEmail.findMany({
    where: {
      booking: { status: { notIn: ["cancelled", "no_show"] } },
      OR: [
        { status: { in: ["failed", "queued"] } },
        { sentAt: { lt: trustAfter } },
      ],
    },
    include: {
      booking: { select: { id: true, referenceCode: true, fullName: true, email: true, paymentStatus: true } },
    },
    orderBy: { sentAt: "asc" },
  });

  const out: Awaited<ReturnType<typeof listEmailAttention>> = [];
  for (const row of rows) {
    // custom:<timestamp> office notes aren't journey templates — don't list/resend them here.
    if (row.step.startsWith("custom:")) continue;
    if (!needsEmailAttention(row)) continue;
    const label = deliveryLabel(row);
    out.push({
      bookingId: row.booking.id,
      referenceCode: row.booking.referenceCode,
      fullName: row.booking.fullName,
      email: row.booking.email,
      paymentStatus: row.booking.paymentStatus,
      step: row.step,
      subject: row.subject,
      status: row.status,
      sentAt: row.sentAt.toISOString(),
      messageId: row.messageId,
      lastError: row.lastError,
      attemptCount: row.attemptCount,
      reason: label.label,
    });
  }

  // Also surface live bookings missing the registration invoice entirely.
  const missingInvoice = await prisma.examBooking.findMany({
    where: {
      status: { notIn: ["cancelled", "no_show"] },
      journeyEmails: { none: { step: "booking_received" } },
    },
    select: { id: true, referenceCode: true, fullName: true, email: true, paymentStatus: true, createdAt: true },
  });
  for (const b of missingInvoice) {
    out.push({
      bookingId: b.id,
      referenceCode: b.referenceCode,
      fullName: b.fullName,
      email: b.email,
      paymentStatus: b.paymentStatus,
      step: "booking_received",
      subject: "(never sent)",
      status: "missing",
      sentAt: b.createdAt.toISOString(),
      messageId: null,
      lastError: null,
      attemptCount: 0,
      reason: "Missing — registration invoice was never logged",
    });
  }

  return out;
}

export async function resendAttentionEmails(
  items: { bookingId: string; step: string }[],
): Promise<{ sent: number; failed: number; errors: string[] }> {
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const item of items) {
    if (item.step.startsWith("custom:")) {
      // Skip quietly — these aren't auto-resendable journey steps.
      continue;
    }
    try {
      const result = await sendJourneyStep(item.bookingId, item.step as JourneyStep, { force: true });
      if (result.ok) sent++;
      else {
        failed++;
        errors.push(`${item.bookingId}/${item.step}: ${result.error}`);
      }
    } catch (e) {
      failed++;
      errors.push(`${item.bookingId}/${item.step}: ${e instanceof Error ? e.message : "error"}`);
    }
  }
  return { sent, failed, errors };
}
