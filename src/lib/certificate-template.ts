/**
 * Everything a certificate says that is not a fact about the student.
 *
 * The document used to hardcode all of it — the school's address, the two
 * signatory titles, the German and English headings, the closing sentence. A
 * new Head of Department was therefore a code change and a deploy, which is
 * absurd for a line of text the office reads off a letterhead. It is data now,
 * edited from /admin/certificates, and this module is the shape of that data
 * plus the defaults, which reproduce the school's existing printed certificate
 * exactly.
 *
 * MERGED OVER THE DEFAULTS, FIELD BY FIELD. A stored row that predates a new
 * field, or one somebody cleared, still renders a complete document rather
 * than a certificate with a hole in it. That is why `parseCertificateTemplate`
 * treats empty string as "not set" for every field except the ones where blank
 * is a legitimate choice — the two signatory blocks, which a school with one
 * signatory genuinely wants empty.
 *
 * No prisma import: the admin editor renders a live preview in the browser and
 * needs the defaults there.
 */

export type CertificateTemplate = {
  /* Masthead */
  schoolName: string;
  addressLine: string;
  /** Shown under the address, e.g. an RC number. Blank hides the line. */
  registrationLine: string;

  /* Headings */
  germanTitle: string;
  englishTitle: string;

  /* Body. `{{...}}` tokens are replaced per student — see TOKENS below. */
  certifyLine: string;
  courseLine: string;
  completionLine: string;
  closingLine: string;

  /* Signatories. Either may be blank, which removes that block. */
  leftSignatoryName: string;
  leftSignatoryRole: string;
  rightSignatoryName: string;
  rightSignatoryRole: string;
  /** Optional uploaded signature images, drawn above the rule. */
  leftSignatureUrl: string;
  rightSignatureUrl: string;

  /* Seal */
  sealTopText: string;
  sealBottomText: string;

  /* Design */
  accentColor: string;
  inkColor: string;
  showFlagBar: boolean;
  showSeal: boolean;
  showGuilloche: boolean;
  showVerifyBlock: boolean;
};

/**
 * The school's real certificate, transcribed.
 *
 * Every string here is taken off the printed document rather than invented, so
 * a school that never opens the editor gets what it already hands out.
 */
export const DEFAULT_CERTIFICATE_TEMPLATE: CertificateTemplate = {
  schoolName: "Easyway Language School",
  addressLine: "23 Unity Rd, off Toyin Street, Allen, Ikeja 100271, Lagos.",
  registrationLine: "RC: 3473394",

  germanTitle: "Teilnahmebestätigung",
  englishTitle: "Certificate of Participation",

  certifyLine: "This is to certify that",
  courseLine: "has successfully completed",
  completionLine: "{{level}} German ({{levelName}}) Course.",
  closingLine: "which includes all skills in the German language to a satisfactory standard.",

  leftSignatoryName: "",
  leftSignatoryRole: "Course Director",
  rightSignatoryName: "",
  rightSignatoryRole: "Head of Department",
  leftSignatureUrl: "",
  rightSignatureUrl: "",

  sealTopText: "Excellence",
  sealBottomText: "Achievement",

  // The red off the printed heading, not the portal's orange. A certificate is
  // the school's document, not a screen in the app, and it should not change
  // colour the day somebody edits the theme.
  accentColor: "#D81E22",
  inkColor: "#111111",
  showFlagBar: true,
  showSeal: true,
  showGuilloche: true,
  showVerifyBlock: true,
};

/** Which CEFR level maps to which English name on the completion line. */
export const LEVEL_NAMES: Record<string, string> = {
  A1: "Beginner",
  A2: "Elementary",
  B1: "Intermediate",
  B2: "Upper Intermediate",
  C1: "Advanced",
  C2: "Proficiency",
};

/**
 * The tokens an admin may type into any body line. Listed here so the editor
 * can show them and the renderer can resolve them from one place — a second
 * list in the UI is a list that goes stale the first time one is added.
 */
export const CERTIFICATE_TOKENS = [
  { token: "{{name}}", describes: "The student's full name" },
  { token: "{{level}}", describes: "CEFR level, e.g. A1" },
  { token: "{{levelName}}", describes: "Level in words, e.g. Beginner" },
  { token: "{{branch}}", describes: "Branch the student attended" },
  { token: "{{tutor}}", describes: "Tutor who taught the level" },
  { token: "{{from}}", describes: "Course start date" },
  { token: "{{to}}", describes: "Course end date" },
  { token: "{{year}}", describes: "Year the course ended" },
  { token: "{{serial}}", describes: "Printed serial number" },
  { token: "{{school}}", describes: "School name from the masthead" },
] as const;

const BOOLEAN_FIELDS = ["showFlagBar", "showSeal", "showGuilloche", "showVerifyBlock"] as const;

/**
 * Fields where an empty string is a real choice rather than "unset".
 *
 * A school with one signatory clears the second block deliberately, and
 * merging the default back over it would put "Head of Department" on a
 * document that is not supposed to have one.
 */
const BLANK_IS_MEANINGFUL = new Set<keyof CertificateTemplate>([
  "leftSignatoryName",
  "leftSignatoryRole",
  "rightSignatoryName",
  "rightSignatoryRole",
  "leftSignatureUrl",
  "rightSignatureUrl",
  "registrationLine",
  "sealTopText",
  "sealBottomText",
]);

/** Tolerant of anything: a malformed row must still print a valid certificate. */
export function parseCertificateTemplate(raw: unknown): CertificateTemplate {
  const stored = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const merged = { ...DEFAULT_CERTIFICATE_TEMPLATE };

  for (const key of Object.keys(DEFAULT_CERTIFICATE_TEMPLATE) as Array<keyof CertificateTemplate>) {
    const value = stored[key];

    if ((BOOLEAN_FIELDS as readonly string[]).includes(key)) {
      if (typeof value === "boolean") (merged[key] as boolean) = value;
      continue;
    }

    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed === "" && !BLANK_IS_MEANINGFUL.has(key)) continue;
    (merged[key] as string) = trimmed;
  }

  return merged;
}

/** What the editor sends back, narrowed to the known fields. */
export function serializeCertificateTemplate(input: unknown): CertificateTemplate {
  return parseCertificateTemplate(input);
}

export type TokenValues = {
  name: string;
  level: string;
  branch: string;
  tutor: string;
  from: string;
  to: string;
  year: string;
  serial: string;
  school: string;
};

/**
 * Replace `{{token}}` occurrences in one line.
 *
 * An unknown token is left standing rather than blanked. If somebody types
 * `{{surname}}` the certificate says `{{surname}}`, which is obviously wrong on
 * the preview and gets fixed before anything is printed — silently erasing it
 * would produce a sentence with a hole that reads as intentional.
 */
export function fillTokens(line: string, values: TokenValues): string {
  const levelName = LEVEL_NAMES[values.level.toUpperCase()] ?? values.level;
  const map: Record<string, string> = {
    name: values.name,
    level: values.level,
    levelName,
    branch: values.branch,
    tutor: values.tutor,
    from: values.from,
    to: values.to,
    year: values.year,
    serial: values.serial,
    school: values.school,
  };

  return line.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(map, key) ? map[key] : whole,
  );
}
