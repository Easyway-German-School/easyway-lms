/**
 * One shared way to mint a temporary password for a student account the
 * office is creating or resetting on someone's behalf — manual add, bulk
 * paste, CSV import, or a locked-out student's reset. Previously each of
 * those places rolled its own generator, one of them a four-digit suffix
 * with barely 13 bits of entropy. This is the stronger 12-character style
 * already proven in the password-reset flow — no ambiguous characters, so
 * it is still safe to read out over the phone — now used everywhere a
 * password gets typed for someone else instead of chosen by them.
 */
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

export function generateTempPassword(length = 12): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return out;
}
