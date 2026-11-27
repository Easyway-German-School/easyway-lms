/**
 * Prep-class handoff into the Easyway LMS.
 *
 * Anonymous visitors and booked candidates who want classes land on LMS
 * signup with Exam Preparatory already selected. Existing LMS students use
 * the sign-in link and go straight to Payments to settle. Journey emails
 * still open THIS app's /prepare first (a Panthexa-only candidate has no LMS
 * session yet) — that page then offers both doors.
 */
const LMS_ORIGIN = "https://easywayschoollms.com.ng";
const EXAM_PREP_PATHWAY = "Exam Preparatory";

export const EXAM_PREP_LINK =
  process.env.EXAM_PREP_CLASS_URL ||
  `${LMS_ORIGIN}/auth/signup?pathway=${encodeURIComponent(EXAM_PREP_PATHWAY)}`;

/** Existing LMS students — sign in, then pay for / continue Exam Preparatory. */
export const EXAM_PREP_SIGNIN_LINK =
  process.env.EXAM_PREP_SIGNIN_URL ||
  `${LMS_ORIGIN}/auth/signin?callbackUrl=${encodeURIComponent("/payments")}`;

/** The prep-class CTA inside candidate emails. Points inside THIS app first. */
export function prepClassesLink(referenceCode: string, email: string): string {
  return `${siteUrl()}/prepare?ref=${encodeURIComponent(referenceCode)}&email=${encodeURIComponent(email)}`;
}

/** This app's own public URL, for links inside emails. */
export function siteUrl(): string {
  return process.env.SITE_URL || "http://localhost:3100";
}

/** The direct "manage my booking" link a candidate gets emailed. */
export function bookingLink(referenceCode: string, email: string): string {
  return `${siteUrl()}/booking/${referenceCode}?email=${encodeURIComponent(email)}`;
}

/**
 * The letterhead every document carries — lifted from the school's own
 * invoice template, so an email and its PDF agree. Env-overridable because the
 * exams mailbox/phone have already changed once between drafts of the manual.
 */
export const OFFICE = {
  schoolName: "EASYWAY GERMAN LANGUAGE SCHOOL",
  centreName: "ÖSD EXAMINATION CENTRE",
  examCentreOnInvoice: "Easyway Language School Ltd.",
  addressLine: process.env.OFFICE_ADDRESS || "23, Unity Road, Ikeja, Lagos",
  // NEXT_PUBLIC_ first: OFFICE.email is also read from NeedHelp.tsx, a client
  // component — Next.js only inlines NEXT_PUBLIC_-prefixed vars into the
  // browser bundle, so the plain OFFICE_EMAIL always resolved to the
  // fallback string there, no matter how the server rendered this page.
  email: process.env.NEXT_PUBLIC_OFFICE_EMAIL || process.env.OFFICE_EMAIL || "exams@easywaylanguageschool.com",
  phone: process.env.OFFICE_PHONE || "+234 708 900 2534",
  website: process.env.OFFICE_WEBSITE || "www.easywaylanguageschool.com",
  /** Signs the booking confirmation (Document A). */
  signatory: "Easyway Examination Department",
};

/** The account candidates pay into — printed on the invoice and in Document A. */
export function paymentAccount(): { bankName: string; accountName: string; accountNumber: string } {
  return {
    bankName: process.env.EXAM_BANK_NAME || "Moniepoint MFB",
    accountName: process.env.EXAM_BANK_ACCOUNT_NAME || "Easyway Sprachschule",
    accountNumber: process.env.EXAM_BANK_ACCOUNT_NUMBER || "6547656725",
  };
}
