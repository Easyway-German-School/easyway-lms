/**
 * ONE PARSER FOR THE STUDENT PROFILE.
 *
 * Before this, `admission` JSON was hand-typed three times — once each in
 * `api/auth/signup`, `api/admin/students` (manual add / edit) and
 * `api/admin/students/import` (CSV) — each `typeof x === "string" ? x.trim()
 * : undefined`, and each collecting a slightly different set of keys. None of
 * it was queryable: "how many students are in Lagos" meant reading every
 * `admission` blob in JS.
 *
 * `StudentProfile` (prisma/schema.prisma) is the typed home for the fields
 * that matter for record-keeping. `normalizeProfileInput` is the one function
 * every writer calls to build it. `admission` is still written alongside it —
 * it remains the long-tail catch-all for one-off signup-form fields (previous
 * school, subjects, transport route…) that don't earn a column.
 */

export type StudentProfileInput = {
  phone?: string;
  altPhone?: string;
  whatsapp?: string;
  addressLine?: string;
  city?: string;
  stateRegion?: string;
  country?: string;
  postalCode?: string;
  dateOfBirth?: Date;
  gender?: string;
  nationality?: string;
  govIdType?: string;
  govIdNumber?: string;
  photoUrl?: string;
  idProofUrl?: string;
  emergencyName?: string;
  emergencyPhone?: string;
  emergencyRelation?: string;
  guardianName?: string;
  guardianPhone?: string;
  occupation?: string;
  employer?: string;
  priorEducation?: string;
  priorGermanLevel?: string;
  heardFrom?: string;
  visaStatus?: string;
  passportNumber?: string;
  passportExpiry?: Date;
};

const STRING_FIELDS = [
  "phone",
  "altPhone",
  "whatsapp",
  "addressLine",
  "city",
  "stateRegion",
  "country",
  "postalCode",
  "gender",
  "nationality",
  "govIdType",
  "govIdNumber",
  "photoUrl",
  "idProofUrl",
  "emergencyName",
  "emergencyPhone",
  "emergencyRelation",
  "guardianName",
  "guardianPhone",
  "occupation",
  "employer",
  "priorEducation",
  "priorGermanLevel",
  "heardFrom",
  "visaStatus",
  "passportNumber",
] as const satisfies readonly (keyof StudentProfileInput)[];

const DATE_FIELDS = ["dateOfBirth", "passportExpiry"] as const satisfies readonly (keyof StudentProfileInput)[];

/** A source object keyed however the caller likes — request body, CSV row, admission blob. */
type RawSource = Record<string, unknown>;

function readString(source: RawSource, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

/**
 * The admission form's date fields were free-typed as DD/MM/YYYY (the
 * majority of real `dob` values on file read that way — e.g. "24/12/2000"),
 * which `new Date(...)` either misreads as MM/DD or rejects outright. Tried
 * first, ahead of the native parser, so a legacy DD/MM/YYYY string backfills
 * correctly instead of silently landing as null or the wrong day.
 */
function parseDayMonthYear(value: string): Date | undefined {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return undefined;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects "31/02/2000" — JS rolls an invalid day into the next month rather
  // than erroring, so a round-trip check is the only way to catch it.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  return date;
}

function readDate(source: RawSource, ...keys: string[]): Date | undefined {
  for (const key of keys) {
    const value = source[key];
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === "string" && value.trim()) {
      const dayMonthYear = parseDayMonthYear(value);
      if (dayMonthYear) return dayMonthYear;
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return undefined;
}

/**
 * Aliases each field is known by across the three writers, so one call works
 * whether it is reading a signup POST body, a manual-add form, or a fuzzy-
 * matched CSV row.
 */
export function normalizeProfileInput(raw: RawSource): StudentProfileInput {
  const input: StudentProfileInput = {
    phone: readString(raw, "phone", "phoneNumber"),
    altPhone: readString(raw, "altPhone", "alternatePhone", "phone2"),
    whatsapp: readString(raw, "whatsapp", "whatsAppNumber"),
    addressLine: readString(raw, "addressLine", "address"),
    city: readString(raw, "city"),
    stateRegion: readString(raw, "stateRegion", "state"),
    country: readString(raw, "country"),
    postalCode: readString(raw, "postalCode", "zip", "zipCode"),
    gender: readString(raw, "gender"),
    nationality: readString(raw, "nationality"),
    govIdType: readString(raw, "govIdType", "idType"),
    govIdNumber: readString(raw, "govIdNumber", "idNumber"),
    photoUrl: readString(raw, "photoUrl"),
    idProofUrl: readString(raw, "idProofUrl"),
    emergencyName: readString(raw, "emergencyName", "emergencyContactName"),
    emergencyPhone: readString(raw, "emergencyPhone", "emergencyContactInfo", "emergencyContactPhone"),
    emergencyRelation: readString(raw, "emergencyRelation", "emergencyContactRelation"),
    guardianName: readString(raw, "guardianName", "fatherName", "motherName", "parentName"),
    guardianPhone: readString(raw, "guardianPhone", "fatherPhone", "motherPhone", "parentPhone"),
    occupation: readString(raw, "occupation", "profession"),
    employer: readString(raw, "employer", "fatherOccupation", "motherOccupation"),
    priorEducation: readString(raw, "priorEducation", "prevSchoolName"),
    priorGermanLevel: readString(raw, "priorGermanLevel", "startingLevel"),
    heardFrom: readString(raw, "heardFrom"),
    visaStatus: readString(raw, "visaStatus"),
    passportNumber: readString(raw, "passportNumber"),
    dateOfBirth: readDate(raw, "dateOfBirth", "dob"),
    passportExpiry: readDate(raw, "passportExpiry"),
  };

  return stripUndefined(input);
}

/**
 * Reconstructs a profile from the legacy `admission` JSON blob — used by the
 * backfill script and by any read path that still needs to fall back to a
 * pre-migration student with no `StudentProfile` row yet.
 */
export function profileFromAdmissionBlob(admission: unknown): StudentProfileInput {
  if (typeof admission !== "object" || admission === null) return {};
  const blob = admission as RawSource;
  return normalizeProfileInput({
    ...blob,
    // The admission blob's own key names, mapped onto the aliases above.
    state: blob.state,
    dob: blob.dob,
    emergencyContactName: blob.emergencyContactName,
    emergencyContactInfo: blob.emergencyContactInfo,
  });
}

/**
 * Read-modify-write merge for a PATCH: a field the caller did not send is left
 * exactly as it was, matching the discipline `api/admin/students` PATCH
 * already applies to the `admission` blob (see its phone/batch handling) so
 * editing one field can never silently clear another.
 *
 * `existing` takes the raw `StudentProfile` row straight from Prisma (or
 * null) — only the known profile fields are read off it, so `id`,
 * `studentId`, `tenantId` and the timestamps never leak into the merged
 * result and back into an `update`/`create` call as if they were being
 * reassigned.
 */
export function mergeProfile(
  existing: RawSource | null | undefined,
  incoming: StudentProfileInput,
): StudentProfileInput {
  return { ...pickProfileFields(existing), ...stripUndefined(incoming) };
}

/** Reads only the typed profile fields off an arbitrary object (a Prisma row, a form payload). */
export function pickProfileFields(source: RawSource | null | undefined): StudentProfileInput {
  return stripUndefined((source ?? {}) as StudentProfileInput);
}

function stripUndefined(input: StudentProfileInput): StudentProfileInput {
  const out: StudentProfileInput = {};
  for (const key of STRING_FIELDS) {
    const value = input[key];
    if (value !== undefined) (out as RawSource)[key] = value;
  }
  for (const key of DATE_FIELDS) {
    const value = input[key];
    if (value !== undefined) (out as RawSource)[key] = value;
  }
  return out;
}

export { STRING_FIELDS as PROFILE_STRING_FIELDS, DATE_FIELDS as PROFILE_DATE_FIELDS };
