/** The public landing page's prep-class banner — the LMS's own ÖSD page, for anonymous visitors. */
export const EXAM_PREP_LINK =
  process.env.EXAM_PREP_CLASS_URL || "https://easywayschoollms.com.ng/exams/osd";

/** The prep-class CTA inside candidate emails. Points inside THIS app: a candidate who registered on
 *  Panthexa has no LMS account, so linking them to the LMS's login-gated ÖSD page would be a dead end. */
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
  email: process.env.OFFICE_EMAIL || "exams@easywaylanguageschool.com",
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
