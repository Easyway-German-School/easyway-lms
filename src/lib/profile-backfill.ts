/**
 * "THE OFFICE SET YOU UP BY HAND — I'M JUST MISSING A FEW BITS."
 *
 * A student who came through the public signup form filled in a long
 * admission form on the way in. A student the office added by hand
 * (`/admin/students`) or imported off a spreadsheet
 * (`/admin/students/import`) did not — those paths only ever carried the
 * fields that make an account *work* (level, branch, batch, a payment), and
 * whatever columns the sheet happened to have. So the school ends up chasing
 * half its roster one WhatsApp message at a time for a date of birth or a
 * next-of-kin.
 *
 * This is the other half of that: an invisible mark on the off-form accounts
 * (`admission.onboardedVia`), a short list of the "important parts" that are
 * still blank, and — everywhere it is read — one rule for whether Becca should
 * ask for them. Six questions, each shown only if we do not already hold it,
 * pre-filled from anything we do. Always skippable; see `profileBackfillSnoozedUntil`.
 *
 * WHERE THE ANSWERS LAND. The typed `StudentProfile` row (one writer:
 * `normalizeProfileInput` / `mergeProfile` in student-profile.ts) for the five
 * that have a column; `admission.goal` for "why German", which does not. The
 * same places the signup form writes, so the admin dossier and the parent
 * dashboard pick them up with no extra wiring.
 */

/**
 * The subset of `StudentProfile` columns this feature reads. A hand-written
 * shape rather than the Prisma type, so both a real `StudentProfile` row and a
 * loose `{}` are assignable without a cast at every call site.
 */
export type ProfileLike = {
  phone?: string | null;
  whatsapp?: string | null;
  dateOfBirth?: Date | string | null;
  city?: string | null;
  stateRegion?: string | null;
  country?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  occupation?: string | null;
};

/**
 * How an account first came into being. Absent on every pre-marker row until
 * `scripts/backfill-onboarded-via.mjs` stamps it; `"signup"` is written by the
 * public form for completeness but never actually depended on — only the two
 * off-form values switch this feature on.
 */
export type OnboardedVia = "signup" | "import" | "manual-add";

const OFF_FORM: ReadonlySet<string> = new Set<OnboardedVia>(["import", "manual-add"]);

/**
 * The six things Becca asks an off-form student for, in the order the wizard
 * walks them. `location` and `emergency` each stand for a small pair of
 * columns; the rest map one-to-one.
 */
export const BACKFILL_FIELDS = [
  "whatsapp",
  "dateOfBirth",
  "location",
  "emergency",
  "occupation",
  "goal",
] as const;

export type BackfillField = (typeof BACKFILL_FIELDS)[number];

export const BACKFILL_FIELD_LABELS: Record<BackfillField, string> = {
  whatsapp: "WhatsApp number",
  dateOfBirth: "Date of birth",
  location: "Where you live",
  emergency: "Emergency contact",
  occupation: "What you do",
  goal: "Why German?",
};

type AdmissionBlob = unknown;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function admissionOf(admission: AdmissionBlob): Record<string, unknown> {
  return admission && typeof admission === "object" ? (admission as Record<string, unknown>) : {};
}

/** The marker the importer / manual-add route stamp. Read-only helper. */
export function onboardedVia(admission: AdmissionBlob): OnboardedVia | null {
  const value = str(admissionOf(admission).onboardedVia).toLowerCase();
  return value === "signup" || value === "import" || value === "manual-add" ? (value as OnboardedVia) : null;
}

/**
 * What the wizard should pre-fill each field with — pulled from whatever we
 * already hold, typed or blob, so an imported student confirms rather than
 * types. Only ever used to seed inputs; never treated as an answer.
 */
export type BackfillPrefill = {
  whatsapp: string;
  dateOfBirth: string;
  city: string;
  stateRegion: string;
  country: string;
  emergencyName: string;
  emergencyPhone: string;
  occupation: string;
  goal: string;
};

function toDateInput(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = str(value);
  if (!raw) return "";
  // Legacy `admission.dob` is often free-typed DD/MM/YYYY — keep it as-is for
  // display; the POST route re-parses it through the same reader the rest of
  // the app uses. A clean ISO date passes straight through.
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return raw;
}

export function backfillPrefill(admission: AdmissionBlob, profile: ProfileLike | null | undefined): BackfillPrefill {
  const a = admissionOf(admission);
  const p = profile ?? {};
  return {
    whatsapp: str(p.whatsapp) || str(p.phone) || str(a.phone),
    dateOfBirth: toDateInput(p.dateOfBirth) || toDateInput(a.dob),
    city: str(p.city) || str(a.city),
    stateRegion: str(p.stateRegion) || str(a.state),
    country: str(p.country) || str(a.country),
    emergencyName: str(p.emergencyName) || str(a.emergencyContactName),
    emergencyPhone: str(p.emergencyPhone) || str(a.emergencyContactInfo),
    occupation: str(p.occupation) || str(a.profession) || str(a.occupation),
    goal: str(a.goal),
  };
}

/**
 * Which of the six are still genuinely blank.
 *
 * WhatsApp is deliberately strict — a phone number off a walk-in sheet is not
 * a confirmed WhatsApp line, and reaching students on WhatsApp is the whole
 * reason the office wants this — so it counts as missing until `profile.whatsapp`
 * itself is set, even though the wizard pre-fills it from any phone we have.
 * The other five are satisfied by either the typed column or the legacy blob.
 */
export function missingBackfillFields(admission: AdmissionBlob, profile: ProfileLike | null | undefined): BackfillField[] {
  const a = admissionOf(admission);
  const p = profile ?? {};
  const has = {
    whatsapp: Boolean(str(p.whatsapp)),
    dateOfBirth: Boolean(p.dateOfBirth || str(a.dob)),
    location: Boolean(str(p.city) || str(a.city)),
    emergency: Boolean(
      (str(p.emergencyName) || str(a.emergencyContactName)) &&
        (str(p.emergencyPhone) || str(a.emergencyContactInfo)),
    ),
    occupation: Boolean(str(p.occupation) || str(a.profession) || str(a.occupation)),
    goal: Boolean(str(a.goal)),
  };
  return BACKFILL_FIELDS.filter((field) => !has[field]);
}

export type BackfillAssessment = {
  /** The account came in off-form and has not been marked complete. */
  applicable: boolean;
  /** Nothing left to ask — every field held, or the student finished the wizard. */
  done: boolean;
  /** Snoozed by a "skip for now", and still inside the snooze window. */
  snoozed: boolean;
  /** The fields still worth asking for. Empty once `done`. */
  missing: BackfillField[];
  /** Becca should ask now: applicable, not done, not snoozed, something missing. */
  due: boolean;
};

/**
 * THE ONE ANSWER to "should the profile-details prompt show for this student".
 * Called by the /profile card, the moment, the weekly nudge and the admin
 * roster segment, so none of them can drift from the others.
 */
export function assessProfileBackfill(
  admission: AdmissionBlob,
  profile: ProfileLike | null | undefined,
  now: Date = new Date(),
): BackfillAssessment {
  const a = admissionOf(admission);
  const via = onboardedVia(admission);
  const markedComplete = Boolean(str(a.profileBackfilledAt));
  const missing = missingBackfillFields(admission, profile);

  const applicable = Boolean(via && OFF_FORM.has(via) && !markedComplete);
  const done = markedComplete || missing.length === 0;

  const snoozeUntil = str(a.profileBackfillSnoozedUntil);
  const snoozed = Boolean(snoozeUntil) && new Date(snoozeUntil).getTime() > now.getTime();

  return {
    applicable,
    done,
    snoozed,
    missing,
    due: applicable && !done && !snoozed,
  };
}

/** How long a "skip for now" quietens the prompt (the weekly nudge included). */
export const BACKFILL_SNOOZE_DAYS = 14;
