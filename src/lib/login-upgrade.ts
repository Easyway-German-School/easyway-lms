/**
 * TEMPORARY LOGINS, AND HOW TO TELL ONE.
 *
 * The office adds a paper-form / spreadsheet student who has a phone number and
 * no email. Two machine-minted addresses come out of that:
 *
 *   - the importer's placeholder — `noemail.<hex>@students.placeholder.
 *     easywayschoollms.com.ng` — which reaches nobody, and
 *   - the phone login that `/admin/students/issue-phone-logins` rewrites it to
 *     — `<intl>@student.easywayschoollms.com.ng` — which the student CAN type
 *     but is not a real mailbox and is not theirs.
 *
 * Both are a stopgap. Once the student is in the portal we want them to trade
 * it for their own email and a password they chose — that is what
 * `LoginUpgradeMoment` / `POST /api/student/login-upgrade` do, and this is the
 * one place that decides whether a given address still counts as the stopgap.
 */

export const PHONE_LOGIN_DOMAIN = "student.easywayschoollms.com.ng";

export type LoginKind = "phone" | "placeholder" | "real";

export function classifyLogin(email: string | null | undefined): LoginKind {
  const value = (email ?? "").trim().toLowerCase();
  if (!value) return "real";
  if (value.includes(".placeholder.") || value.includes("noemail")) return "placeholder";
  if (value.endsWith(`@${PHONE_LOGIN_DOMAIN}`)) return "phone";
  return "real";
}

/** A login the student should be nudged to replace with a real one of their own. */
export function isTemporaryLogin(email: string | null | undefined): boolean {
  const kind = classifyLogin(email);
  return kind === "phone" || kind === "placeholder";
}

/**
 * Is `email` a real, self-owned address we can accept as the replacement?
 * A syntax check plus a refusal to swap one machine address for another.
 */
export function isAcceptableReplacementEmail(email: string): boolean {
  const value = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return false;
  if (value.includes("..")) return false;
  return !isTemporaryLogin(value);
}
