/**
 * How a phone number is SHOWN and DIALLED — pure, so the roster, the finance
 * screens and the CSV call sheets all print the same thing.
 *
 * Numbers arrive in whatever shape a student typed at signup: "0812 345 6789",
 * "08123456789", "+234 812 345 6789", "8123456789", a German "+49 …". The
 * server-side SMS normaliser (lib/sms.ts) is deliberately strict because a
 * billed text to a mangled number is wasted money. A call sheet has the
 * opposite need: if the number is at all readable the team should see it, and if
 * it is not, they should still see exactly what was typed so they can fix it.
 *
 * Nigerian mobiles print in the local form the team dials from a handset
 * ("0812 345 6789"). It has spaces so Excel keeps it as text — a bare
 * "08123456789" loses its leading zero the moment a CSV is opened — and it has
 * no leading "+" so the CSV formula guard does not stamp an apostrophe on it.
 */

export type PhoneParts = {
  /** What to print. */
  display: string;
  /** A `tel:` target, international where we can tell. */
  tel: string;
  /** A wa.me link, only when the number is unambiguously international. */
  whatsapp: string | null;
};

/** Digits of a Nigerian mobile as 234XXXXXXXXXX, or null when it does not read as one. */
function nigerianInternational(digits: string): string | null {
  if (digits.startsWith("234") && digits.length === 13) return digits;
  if (digits.startsWith("0") && digits.length === 11) return `234${digits.slice(1)}`;
  // A bare 10-digit local number whose leading 0 was dropped.
  if (digits.length === 10 && !digits.startsWith("0")) return `234${digits}`;
  return null;
}

export function describePhone(raw: unknown): PhoneParts | null {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return null;

  const digits = text.replace(/\D/g, "");
  if (!digits) return null;

  const ng = nigerianInternational(digits);
  if (ng) {
    const local = `0${ng.slice(3)}`;
    return {
      display: `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`,
      tel: `+${ng}`,
      whatsapp: `https://wa.me/${ng}`,
    };
  }

  // Not a Nigerian mobile. Keep exactly what was typed; only claim it is
  // international (and so WhatsApp-able) when the person wrote the "+".
  const international = text.startsWith("+") || text.startsWith("00");
  const cleaned = international ? digits.replace(/^00/, "") : digits;
  return {
    display: text,
    tel: international ? `+${cleaned}` : digits,
    whatsapp: international ? `https://wa.me/${cleaned}` : null,
  };
}

/** The number as a call sheet prints it — the empty string when there is none. */
export function phoneForSheet(raw: unknown): string {
  return describePhone(raw)?.display ?? "";
}

/**
 * The best number on file for a student: the profile's, else the signup
 * form's. Two places hold it — `StudentProfile.phone` (the typed record) and
 * `Student.admission.phone` (the blob signup wrote first) — and older accounts
 * have only the second.
 */
export function studentPhoneRaw(student: {
  profile?: { phone?: string | null; whatsapp?: string | null } | null;
  admission?: unknown;
}): { phone: string; whatsapp: string } {
  const admission =
    student.admission && typeof student.admission === "object" && !Array.isArray(student.admission)
      ? (student.admission as Record<string, unknown>)
      : {};
  const fromAdmission = typeof admission.phone === "string" ? admission.phone.trim() : "";
  const phone = (student.profile?.phone ?? "").trim() || fromAdmission;
  const whatsapp = (student.profile?.whatsapp ?? "").trim();
  return { phone, whatsapp };
}
