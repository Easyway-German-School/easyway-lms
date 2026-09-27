import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The whole candidate journey against a REAL Postgres: intake → invoice email →
 * payment reminder → payment verification (receipt) → details check → prep
 * note → admission → guide → reminders → results → certificate.
 *
 * Opt-in (OSD_INTEGRATION=1) and refuses to touch anything that looks like a
 * hosted database — it creates and deletes its own rows, but "it cleans up
 * after itself" is not a reason to point it at production.
 *
 *   DATABASE_URL=postgresql://postgres:pw@localhost:54329/osd \
 *   DIRECT_DATABASE_URL=$DATABASE_URL OSD_INTEGRATION=1 npx vitest run lib/journey.integration
 */

const enabled = process.env.OSD_INTEGRATION === "1";
const dbUrl = process.env.DATABASE_URL ?? "";
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl);

// Email is captured, never sent. `failNext` lets one test simulate an SMTP outage.
const outbox: { to: string; subject: string; attachments: string[] }[] = [];
let failNext = false;
vi.mock("@/lib/email", () => ({
  sendEmail: async (input: { to: string; subject: string; attachments?: { filename: string }[] }) => {
    if (failNext) { failNext = false; return false; }
    outbox.push({ to: input.to, subject: input.subject, attachments: (input.attachments ?? []).map((a) => a.filename) });
    return true;
  },
}));

describe.skipIf(!enabled || !isLocal)("candidate journey (real database)", { timeout: 60_000 }, () => {
  const DAY = 86_400_000;
  const T0 = new Date();
  const at = (days: number) => new Date(T0.getTime() + days * DAY);

  let prisma: typeof import("@/lib/prisma").prisma;
  let sessionId = "";
  let bookingId = "";
  let ref = "";
  /**
   * Run the (global) daily sweep at a simulated time and report only the steps that reached
   * THIS test's candidate. The database may hold other candidates (a dev's own test data);
   * their emails are none of this suite's business and must not make it flaky.
   */
  async function sweepNew(now: Date, id = bookingId): Promise<string[]> {
    const { runJourneySweep } = await import("@/lib/journey");
    const before = new Set(await prisma.journeyEmail.findMany({ where: { bookingId: id } }).then((r) => r.map((e) => e.step)));
    await runJourneySweep(now);
    const after = await prisma.journeyEmail.findMany({ where: { bookingId: id }, orderBy: { sentAt: "asc" } });
    return after.map((e) => e.step).filter((step) => !before.has(step));
  }
  const journey = () => prisma.journeyEmail.findMany({ where: { bookingId }, orderBy: { sentAt: "asc" } }).then((rows) => rows.map((r) => r.step));

  beforeAll(async () => {
    prisma = (await import("@/lib/prisma")).prisma;
    const session = await prisma.examSession.create({
      data: {
        level: "B2", title: "ÖSD Zertifikat B2 (integration test)", venueName: "Easyway Test Hall", venueAddress: "Ikeja",
        startDate: at(30), endDate: at(30), registrationDeadline: at(20), capacity: 2,
        feeWholeExam: 210_000, expressFee: 192_500, startTime: "09:00", published: true,
        modulePrices: { create: [{ module: "written", price: 157_500 }, { module: "oral", price: 52_500 }] },
      },
    });
    sessionId = session.id;
  });

  afterAll(async () => {
    if (sessionId) {
      await prisma.examBooking.deleteMany({ where: { sessionId } }); // JourneyEmail cascades
      await prisma.examSession.delete({ where: { id: sessionId } });
    }
    await prisma.$disconnect();
  });

  const intake = {
    fullName: "Dr. Yejide Lamina", email: "Yejide.Lamina@Example.com", phone: "08039215479", gender: "Female",
    dateOfBirth: "1978-10-25", placeOfBirth: "Lagos", nationality: "Nigeria", modules: ["full"],
  };

  it("keys in a Panthexa registration: reference, invoice number, correct fee, and Document A with the invoice attached", async () => {
    const { createPanthexaBooking } = await import("@/lib/panthexa-intake");
    const result = await createPanthexaBooking({ sessionId, ...intake });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    bookingId = result.bookingId;
    ref = result.referenceCode;

    expect(result.invoiceNumber).toBe(ref.replace("EW-OSD-", "EW-OSD-INV-"));
    expect(result.feeTotal).toBe(210_000);
    expect(result.emailSent).toBe(true);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe("yejide.lamina@example.com"); // normalised
    expect(outbox[0].subject).toBe(`[Easyway ÖSD] Booking Received – ${ref}`);
    expect(outbox[0].attachments).toEqual([`Invoice-${result.invoiceNumber}.pdf`]);
    expect(await journey()).toEqual(["booking_received"]);
  });

  it("refuses the same candidate twice, an unpriced module, and an express request the sitting doesn't offer", async () => {
    const { createPanthexaBooking } = await import("@/lib/panthexa-intake");
    const dup = await createPanthexaBooking({ sessionId, ...intake });
    expect(dup).toMatchObject({ ok: false, code: "duplicate" });

    const noExpress = await prisma.examSession.create({
      data: { level: "A1", title: "A1 no express", venueName: "x", venueAddress: "", startDate: at(30), endDate: at(30), registrationDeadline: at(20), capacity: 5, feeWholeExam: 160_000 },
    });
    const express = await createPanthexaBooking({ sessionId: noExpress.id, ...intake, email: "other@example.com", express: true });
    expect(express).toMatchObject({ ok: false, code: "invalid" });
    const oral = await createPanthexaBooking({ sessionId: noExpress.id, ...intake, email: "other@example.com", modules: ["oral"] });
    expect(oral).toMatchObject({ ok: false, code: "invalid" }); // no oral price on that sitting
    await prisma.examSession.delete({ where: { id: noExpress.id } });
  });

  it("stays quiet the same day, then sends exactly one payment reminder the next morning", async () => {
    expect(await sweepNew(at(0))).toEqual([]);
    expect(await sweepNew(at(1))).toEqual(["payment_reminder"]);
    expect(outbox.at(-1)?.attachments[0]).toMatch(/^Invoice-/); // the invoice rides along again
    expect(await sweepNew(at(1))).toEqual([]); // idempotent
    expect(await sweepNew(at(3))).toEqual([]); // and never a second nag
  });

  it("won't verify a part-payment, then verifies the full amount and sends the receipt", async () => {
    const { confirmBookingPayment } = await import("@/lib/booking");
    const short = await confirmBookingPayment(bookingId, "office", { paymentMethod: "bank_transfer", expectedAmount: 100_000 });
    expect(short).toMatchObject({ ok: false, code: "amount_mismatch" });

    const before = outbox.length;
    const full = await confirmBookingPayment(bookingId, "office", {
      paymentMethod: "bank_transfer", expectedAmount: 210_000, paidOn: new Date("2026-09-27"), reference: "MP-TEST-1",
    });
    expect(full).toMatchObject({ ok: true, alreadyConfirmed: false });
    expect(outbox).toHaveLength(before + 1);
    expect(outbox.at(-1)?.subject).toBe(`[Easyway ÖSD] Payment Confirmed – ${ref}`);
    expect(outbox.at(-1)?.attachments[0]).toMatch(/^Receipt-/);

    const row = await prisma.examBooking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(row).toMatchObject({ paymentStatus: "paid", amountReceived: 210_000, transferReference: "MP-TEST-1" });
    expect(row.seatNumber).toBe(50);

    // Verifying twice must not email twice.
    await confirmBookingPayment(bookingId, "office", { expectedAmount: 210_000 });
    expect(outbox).toHaveLength(before + 1);
  });

  it("paces the post-payment emails one per day: details check → (wait) → the single prep-class note", async () => {
    expect(await sweepNew(at(1))).toEqual(["info_check"]);
    expect(await sweepNew(at(2))).toEqual([]);
    expect(await sweepNew(at(3))).toEqual(["prep_invite"]);
    const prep = outbox.at(-1)!;
    expect(prep.subject).toContain("Preparing for ÖSD Zertifikat B2");
    expect(prep.attachments).toEqual([]);
    expect(await sweepNew(at(10))).toEqual([]); // never a second pitch
  });

  it("will not admit until details, confirmation and ID are all in — payment alone isn't admission", async () => {
    const { admitCandidate, confirmInfo } = await import("@/lib/lifecycle");
    expect(await admitCandidate(bookingId)).toMatchObject({ ok: false });
    expect(await confirmInfo(bookingId)).toMatchObject({ ok: false }); // address / ID still blank
  });

  it("admits once everything is in, and a candidate edit after confirming forces a re-confirmation", async () => {
    const { updateBookingDetails, reviewBookingDocuments } = await import("@/lib/booking");
    const { admitCandidate, confirmInfo } = await import("@/lib/lifecycle");

    const filled = await updateBookingDetails(bookingId, {
      addressLine: "1 Unity Road", city: "Ikeja", countryOfBirth: "Nigeria", idType: "International Passport", idNumber: "A1234567", idExpiry: "2031-01-01",
    });
    expect(filled).toEqual({ ok: true });
    expect(await confirmInfo(bookingId)).toEqual({ ok: true });

    // A correction after confirming un-confirms.
    await updateBookingDetails(bookingId, { city: "Lagos" });
    expect((await prisma.examBooking.findUniqueOrThrow({ where: { id: bookingId } })).infoConfirmedAt).toBeNull();
    expect(await confirmInfo(bookingId)).toEqual({ ok: true });

    // No ID upload approved yet → still not admissible.
    expect(await admitCandidate(bookingId)).toMatchObject({ ok: false });
    await prisma.examBooking.update({ where: { id: bookingId }, data: { passportDataPageUrl: "/api/files/x.pdf" } });
    await reviewBookingDocuments(bookingId, "approved");

    const before = outbox.length;
    expect(await admitCandidate(bookingId)).toEqual({ ok: true });
    expect(outbox).toHaveLength(before + 1);
    expect(outbox.at(-1)?.subject).toBe(`[Easyway ÖSD] Admission Confirmed – ${ref}`);
    expect(await admitCandidate(bookingId)).toEqual({ ok: true }); // idempotent
    expect(outbox).toHaveLength(before + 1);

    // Editing is closed once admitted.
    expect(await updateBookingDetails(bookingId, { city: "Abuja" })).toMatchObject({ ok: false });
  });

  it("runs the exam-side emails: guide the day after, one-week reminder, 24-hour reminder — and nothing on exam day", async () => {
    expect(await sweepNew(at(4))).toEqual(["exam_guide"]);
    expect(await sweepNew(at(22))).toEqual([]); // 8 days out
    expect(await sweepNew(at(23))).toEqual(["reminder_7day"]);
    expect(await sweepNew(at(28))).toEqual([]);
    expect(await sweepNew(at(29))).toEqual(["reminder_24h"]);
    expect(await sweepNew(at(30))).toEqual([]);
  });

  it("carries the candidate through results and the certificate", async () => {
    const { markSessionCompleted, releaseResult, markCertificateReady, markCertificateDelivered } = await import("@/lib/lifecycle");
    const { deriveStatus } = await import("@/lib/candidate-status");

    expect(await markCertificateReady(bookingId, "x")).toMatchObject({ ok: false }); // no result yet
    expect(await releaseResult(bookingId)).toMatchObject({ ok: false }); // exam not completed
    expect(await markSessionCompleted(sessionId)).toBe(1);
    // The suite simulates time by passing `now` to the sweep; in real life completion is stamped on exam day (day 30).
    await prisma.examBooking.update({ where: { id: bookingId }, data: { examCompletedAt: at(30) } });

    expect(await sweepNew(at(35))).toEqual([]); // 5 days — too soon to say "pending"
    expect(await sweepNew(at(41))).toEqual(["result_pending"]);

    expect(await releaseResult(bookingId)).toEqual({ ok: true });
    expect(outbox.at(-1)?.subject).toBe(`[Easyway ÖSD] Examination Result Available – ${ref}`);
    expect(await markCertificateReady(bookingId, "From 12 Nov, 10am–4pm, with valid ID")).toEqual({ ok: true });
    expect(outbox.at(-1)?.subject).toBe(`[Easyway ÖSD] Certificate Collection – ${ref}`);
    expect(await markCertificateDelivered(bookingId)).toEqual({ ok: true });

    const row = await prisma.examBooking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(deriveStatus(row).key).toBe("certificate_delivered");
    expect((await journey())).toEqual([
      "booking_received", "payment_reminder", "payment_confirmed", "info_check", "prep_invite",
      "admission", "exam_guide", "reminder_7day", "reminder_24h", "result_pending", "result_released", "certificate_ready",
    ]);
  });

  it("a failed send releases its claim so the next sweep retries, instead of losing the email", async () => {
    const { createPanthexaBooking } = await import("@/lib/panthexa-intake");
    failNext = true;
    const created = await createPanthexaBooking({ sessionId, ...intake, email: "retry@example.com" });
    expect(created).toMatchObject({ ok: true, emailSent: false });
    if (!created.ok) return;
    expect(await prisma.journeyEmail.count({ where: { bookingId: created.bookingId } })).toBe(0);

    expect(await sweepNew(at(0), created.bookingId)).toEqual(["booking_received"]);
    expect(await prisma.journeyEmail.count({ where: { bookingId: created.bookingId, step: "booking_received" } })).toBe(1);
  });
});
