import { prisma } from "@/lib/prisma";
import { computeFee, isPlausibleDateOfBirth, uniqueReferenceCode } from "@/lib/booking";
import { invoiceNumberFor } from "@/lib/invoice";
import { sendJourneyStep } from "@/lib/journey";

/**
 * The office lane. A candidate registers on Panthexa (the official ÖSD
 * platform, where Easyway is a tenant) and pays Easyway directly; all we get is
 * the registration. Someone at the desk keys it in here ONCE, and everything the
 * office used to do by hand — the reference, the invoice, the booking email —
 * happens from that one form: Document A goes out with the invoice PDF attached
 * (Operations Manual §11 steps 2–3).
 *
 * Only what the invoice itself needs is required. Address, country of birth and
 * the ID block are things Panthexa doesn't hand us; the candidate completes them
 * from the Document C link, and admission is blocked until they do.
 */

export const PANTHEXA_MODULES = ["full", "written", "oral"] as const;

export type PanthexaIntakeInput = {
  sessionId: string;
  fullName: string;
  email: string;
  phone: string;
  gender?: string;
  dateOfBirth: string; // ISO date
  placeOfBirth: string;
  nationality: string;
  /** "full" (written + oral) or any of written / oral. */
  modules: string[];
  express?: boolean;
  /** The date they registered on Panthexa (ISO date); defaults to today. */
  registeredOn?: string;
  panthexaReference?: string;
  // Anything extra the office happens to have — never required.
  countryOfBirth?: string;
  addressLine?: string;
  city?: string;
  isRepeatAttempt?: boolean;
  specialNeeds?: string;
};

export type PanthexaIntakeResult =
  | { ok: true; bookingId: string; referenceCode: string; invoiceNumber: string; feeTotal: number; emailSent: boolean }
  | { ok: false; error: string; code: "not_found" | "duplicate" | "invalid" };

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createPanthexaBooking(input: PanthexaIntakeInput): Promise<PanthexaIntakeResult> {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  if (!fullName) return { ok: false, error: "The candidate's full name is required.", code: "invalid" };
  if (!EMAIL_SHAPE.test(email)) return { ok: false, error: "That email address doesn't look right.", code: "invalid" };
  if (!input.phone.trim()) return { ok: false, error: "A phone number is required.", code: "invalid" };
  if (!input.placeOfBirth.trim() || !input.nationality.trim()) return { ok: false, error: "Place of birth and nationality are required.", code: "invalid" };
  if (!isPlausibleDateOfBirth(input.dateOfBirth)) return { ok: false, error: "Enter a valid date of birth.", code: "invalid" };

  const modules = input.modules.length ? input.modules : ["full"];
  if (modules.some((m) => !(PANTHEXA_MODULES as readonly string[]).includes(m)) || (modules.includes("full") && modules.length > 1)) {
    return { ok: false, error: "Modules must be the whole exam, or written and/or oral.", code: "invalid" };
  }

  const session = await prisma.examSession.findUnique({ where: { id: input.sessionId }, include: { modulePrices: true } });
  if (!session) return { ok: false, error: "That sitting does not exist.", code: "not_found" };

  // Same person, same sitting: one booking. Catches the office keying a candidate in twice.
  const existing = await prisma.examBooking.findFirst({
    where: { sessionId: session.id, email, status: { not: "cancelled" } },
    select: { referenceCode: true },
  });
  if (existing) {
    return { ok: false, error: `${email} already has a booking for this sitting (${existing.referenceCode}).`, code: "duplicate" };
  }

  const examFee = computeFee(session, modules);
  if (examFee === null) {
    return { ok: false, error: `This sitting has no price for ${modules.join(" + ")} — set its written/oral prices under Sittings first.`, code: "invalid" };
  }
  const express = Boolean(input.express);
  if (express && session.expressFee <= 0) {
    return { ok: false, error: "This sitting doesn't offer the express result — set an express fee under Sittings first.", code: "invalid" };
  }
  const expressFee = express ? session.expressFee : 0;

  const registeredAt = input.registeredOn ? new Date(input.registeredOn) : new Date();
  if (Number.isNaN(registeredAt.getTime())) return { ok: false, error: "Enter a valid Panthexa registration date.", code: "invalid" };

  const referenceCode = await uniqueReferenceCode(session.startDate.getFullYear());
  const booking = await prisma.examBooking.create({
    data: {
      referenceCode,
      invoiceNumber: invoiceNumberFor(referenceCode),
      sessionId: session.id,
      source: "panthexa",
      panthexaReference: input.panthexaReference?.trim() || null,
      registeredAt,
      addedByOffice: true,
      fullName,
      email,
      phone: input.phone.trim(),
      gender: input.gender?.trim() || null,
      dateOfBirth: new Date(input.dateOfBirth),
      placeOfBirth: input.placeOfBirth.trim(),
      nationality: input.nationality.trim(),
      countryOfBirth: input.countryOfBirth?.trim() || null,
      addressLine: input.addressLine?.trim() || null,
      city: input.city?.trim() || null,
      isRepeatAttempt: input.isRepeatAttempt ?? false,
      specialNeeds: input.specialNeeds?.trim() || null,
      modules,
      express,
      expressFee,
      feeTotal: examFee + expressFee,
    },
  });

  // Document A with the invoice. If the email can't go right now the booking still
  // exists and the daily sweep retries it — the office never has to re-key anything.
  const sent = await sendJourneyStep(booking.id, "booking_received").catch((error) => {
    console.error(`Document A failed for ${referenceCode}:`, error);
    return { ok: false as const, error: String(error) };
  });

  return { ok: true, bookingId: booking.id, referenceCode, invoiceNumber: booking.invoiceNumber!, feeTotal: booking.feeTotal, emailSent: sent.ok };
}
