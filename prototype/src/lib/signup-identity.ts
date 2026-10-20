import { profileFromAdmissionBlob } from "@/lib/student-profile";

type IdentityProfile = {
  phone?: string | null;
  altPhone?: string | null;
  whatsapp?: string | null;
  dateOfBirth?: Date | string | null;
  govIdNumber?: string | null;
};

type StudentIdentity = {
  name: string | null | undefined;
  admission: unknown;
  profile?: IdentityProfile | null;
};

function profileOf(identity: StudentIdentity): IdentityProfile {
  const legacy = profileFromAdmissionBlob(identity.admission);
  const profile = identity.profile;
  return {
    ...legacy,
    phone: profile?.phone || profile?.whatsapp || profile?.altPhone || legacy.phone || legacy.whatsapp || legacy.altPhone,
    dateOfBirth: profile?.dateOfBirth ?? legacy.dateOfBirth,
    govIdNumber: profile?.govIdNumber || legacy.govIdNumber,
  };
}

function nameKey(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]/gu, "");
}

export function phoneIdentityKey(value: string | null | undefined): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : null;
}

function governmentIdKey(value: string | null | undefined): string | null {
  const key = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return key.length >= 6 ? key : null;
}

function dateKey(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
}

/** Exact identity evidence only: email is handled by the account lookup. */
export function sameStudentIdentity(input: StudentIdentity, existing: StudentIdentity): boolean {
  const incomingProfile = profileOf(input);
  const existingProfile = profileOf(existing);
  const incomingId = governmentIdKey(incomingProfile.govIdNumber);
  const existingId = governmentIdKey(existingProfile.govIdNumber);
  if (incomingId && existingId && incomingId === existingId) return true;

  const incomingName = nameKey(input.name);
  const existingName = nameKey(existing.name);
  const incomingPhone = phoneIdentityKey(incomingProfile.phone);
  const existingPhone = phoneIdentityKey(existingProfile.phone);
  const incomingDob = dateKey(incomingProfile.dateOfBirth);
  const existingDob = dateKey(existingProfile.dateOfBirth);

  return Boolean(
    incomingName &&
      incomingName === existingName &&
      incomingPhone &&
      incomingPhone === existingPhone &&
      incomingDob &&
      incomingDob === existingDob,
  );
}
