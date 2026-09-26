import crypto from "node:crypto";

/**
 * A human-typeable booking reference: EW-OSD-2026-4K7QZ. Short enough to read
 * off a phone screen, long enough (5 base32 chars ≈ 25 bits) that guessing
 * one is not a realistic way to look up someone else's booking.
 *
 * Excludes 0/O/1/I — the characters people misread over the phone.
 */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function generateReferenceCode(year = new Date().getFullYear()): string {
  const bytes = crypto.randomBytes(5);
  let code = "";
  for (const byte of bytes) {
    code += ALPHABET[byte % ALPHABET.length];
  }
  return `EW-OSD-${year}-${code}`;
}
