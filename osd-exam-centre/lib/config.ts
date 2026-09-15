/** Where the "need help" / prep-class CTAs point — the LMS, not this app. */
export const EXAM_PREP_LINK =
  process.env.EXAM_PREP_CLASS_URL || "https://easywayschoollms.com.ng/exams/osd";

/** This app's own public URL, for links inside emails. */
export function siteUrl(): string {
  return process.env.SITE_URL || "http://localhost:3100";
}

/** The direct "manage my booking" link a candidate gets emailed. */
export function bookingLink(referenceCode: string, email: string): string {
  return `${siteUrl()}/booking/${referenceCode}?email=${encodeURIComponent(email)}`;
}
