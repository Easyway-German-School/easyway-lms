import { OFFICE, paymentAccount } from "@/lib/config";
import { formatAmount, nairaInWords } from "@/lib/money";

/**
 * The examination invoice / payment receipt — one document, two states. The
 * school's own template already has a "PAYMENT CONFIRMATION" block (amount
 * received, date, transaction reference, verified by) that sits blank while the
 * invoice is pending, so the receipt is that same page with the block filled
 * and the status flipped to PAID. Manual §42 explicitly lets Easyway issue
 * payment receipts and booking confirmations (never an imitation certificate).
 */

export type InvoiceBooking = {
  referenceCode: string;
  invoiceNumber: string | null;
  fullName: string;
  gender: string | null;
  dateOfBirth: Date;
  placeOfBirth: string;
  nationality: string;
  phone: string;
  email: string;
  modules: string[];
  feeTotal: number;
  express: boolean;
  expressFee: number;
  registeredAt: Date | null;
  createdAt: Date;
  paymentStatus: string;
  amountReceived: number | null;
  paidOn: Date | null;
  transferReference: string | null;
  verifiedBy: string | null;
};

export type InvoiceSession = {
  level: string;
  feeWholeExam: number;
  modulePrices: { module: string; price: number }[];
};

export type FeeLine = { label: string; amount: number };

export type InvoiceModel = {
  invoiceNumber: string;
  registrationCode: string;
  issuedOn: string;
  paid: boolean;
  candidate: { label: string; value: string }[];
  exam: { label: string; value: string }[];
  feeLines: FeeLine[];
  total: number;
  totalInWords: string;
  paymentDetails: { label: string; value: string }[];
  paymentConfirmation: { label: string; value: string }[];
  notes: string[];
};

const LAGOS = "Africa/Lagos";

/** 25.10.1978 — the template's numeric date style. `utc` for a date-of-birth, which is a calendar date, not an instant. */
export function formatNumericDate(date: Date, opts?: { utc?: boolean }): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: opts?.utc ? "UTC" : LAGOS,
  }).format(date).replace(/\//g, ".");
}

/** 25 September, 2026 — the template's issue-date style. */
export function formatIssueDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: LAGOS }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")}, ${get("year")}`;
}

/** EW-OSD-2026-OBB052 → EW-OSD-INV-2026-OBB052. The invoice number is the booking reference in a different hat, on purpose. */
export function invoiceNumberFor(referenceCode: string): string {
  return referenceCode.replace(/^EW-OSD-/, "EW-OSD-INV-");
}

/**
 * A bank narration is "Surname + Invoice No" — surname is the last word of the
 * name as booked. Capped at 12 characters: banks truncate narrations anyway, a
 * triple-barrelled surname would push the invoice number (the part the office
 * actually matches on) off the end, and the candidate copies this string
 * verbatim from the email, so a shortened surname costs them nothing.
 */
export function paymentReferenceFor(fullName: string, invoiceNumber: string): string {
  const surname = (fullName.trim().split(/\s+/).pop() ?? "").toUpperCase().slice(0, 12);
  return `${surname} ${invoiceNumber}`.trim();
}

const MODULE_LABEL: Record<string, string> = {
  written: "Written", oral: "Oral", reading: "Reading", listening: "Listening", writing: "Writing", speaking: "Speaking",
};
const MODULE_ORDER = ["written", "oral", "reading", "listening", "writing", "speaking"];

export function moduleSummary(modules: string[]): string {
  if (modules.includes("full")) return "Written + Oral";
  return [...modules]
    .sort((a, b) => MODULE_ORDER.indexOf(a) - MODULE_ORDER.indexOf(b))
    .map((m) => MODULE_LABEL[m] ?? m)
    .join(" + ");
}

/**
 * Itemise the fee. The booking's `feeTotal` was snapshotted when it was made
 * and is what the candidate actually owes; the session's current price list
 * may have moved since. So the lines are only shown itemised when they still
 * add up to the snapshot — otherwise one honest line beats a breakdown that
 * contradicts the total printed beneath it.
 */
export function feeLinesFor(booking: Pick<InvoiceBooking, "modules" | "feeTotal" | "express" | "expressFee">, session: InvoiceSession): FeeLine[] {
  const exam = `ÖSD Zertifikat ${session.level}`;
  const priceOf = new Map(session.modulePrices.map((m) => [m.module, m.price]));
  const examPart = booking.feeTotal - (booking.express ? booking.expressFee : 0);

  let lines: FeeLine[];
  if (booking.modules.includes("full")) {
    const written = priceOf.get("written");
    const oral = priceOf.get("oral");
    lines = written !== undefined && oral !== undefined
      ? [{ label: `${exam} — Written Module`, amount: written }, { label: `${exam} — Oral Module`, amount: oral }]
      : [{ label: `${exam} — Whole examination`, amount: session.feeWholeExam }];
  } else {
    lines = [...booking.modules]
      .sort((a, b) => MODULE_ORDER.indexOf(a) - MODULE_ORDER.indexOf(b))
      .map((m) => ({ label: `${exam} — ${MODULE_LABEL[m] ?? m} Module`, amount: priceOf.get(m) ?? 0 }));
  }

  const itemisedTotal = lines.reduce((sum, l) => sum + l.amount, 0);
  if (itemisedTotal !== examPart) lines = [{ label: `${exam} — Examination fee`, amount: examPart }];
  if (booking.express && booking.expressFee > 0) lines.push({ label: "Express result service", amount: booking.expressFee });
  return lines;
}

export function buildInvoice(booking: InvoiceBooking, session: InvoiceSession, now = new Date()): InvoiceModel {
  const invoiceNumber = booking.invoiceNumber ?? invoiceNumberFor(booking.referenceCode);
  const paid = booking.paymentStatus === "paid";
  const account = paymentAccount();
  const registered = booking.registeredAt ?? booking.createdAt;

  return {
    invoiceNumber,
    registrationCode: booking.referenceCode,
    issuedOn: formatIssueDate(now),
    paid,
    candidate: [
      { label: "Full Name", value: booking.fullName },
      { label: "Gender", value: booking.gender ?? "" },
      { label: "Date of Birth", value: formatNumericDate(booking.dateOfBirth, { utc: true }) },
      { label: "Place of Birth", value: booking.placeOfBirth },
      { label: "Citizenship", value: booking.nationality },
      { label: "Phone", value: booking.phone },
      { label: "Email", value: booking.email },
    ],
    exam: [
      { label: "Examination", value: `ÖSD Zertifikat ${session.level}` },
      { label: "Modules", value: moduleSummary(booking.modules) },
      { label: "Examination Centre", value: OFFICE.examCentreOnInvoice },
      { label: "Registration Code", value: booking.referenceCode },
      { label: "Registration Date", value: formatNumericDate(registered) },
      { label: "Express", value: booking.express ? "Demand" : "No Demand" },
    ],
    feeLines: feeLinesFor(booking, session),
    total: booking.feeTotal,
    totalInWords: nairaInWords(booking.feeTotal),
    paymentDetails: [
      { label: "Account Name:", value: account.accountName },
      { label: "Account number:", value: account.accountNumber },
      { label: "Bank Name:", value: account.bankName },
      { label: "Payment Ref.:", value: paymentReferenceFor(booking.fullName, invoiceNumber) },
    ],
    paymentConfirmation: [
      { label: "Amount Received:", value: paid && booking.amountReceived !== null ? formatAmount(booking.amountReceived) : "" },
      { label: "Date received:", value: paid && booking.paidOn ? formatNumericDate(booking.paidOn) : "" },
      { label: "Transaction Reference:", value: paid ? booking.transferReference ?? "" : "" },
      { label: "Verified by:", value: paid ? (booking.verifiedBy && booking.verifiedBy !== "office" ? booking.verifiedBy : OFFICE.signatory) : "" },
    ],
    notes: [
      `This invoice confirms the examination fee payable to ${account.accountName} for the examination stated above.`,
      "Examination admission is subject to successful payment verification, identity/document verification and completion of all required registration procedures.",
      "The examination status shown on this invoice refers to payment/administrative processing and is separate from any technical status used by the booking platform.",
      "Reserved examination seats cannot be reversed, cancelled, or transferred. All payments are strictly non-refundable.",
      "Please retain this invoice and payment evidence for your records",
    ],
  };
}
