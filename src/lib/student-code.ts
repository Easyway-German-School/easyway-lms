import { prisma } from "@/lib/prisma";
import { isOnlineBranch } from "@/lib/online-branch";

/**
 * Official Easyway student identifiers.
 *
 * Format:  EW/yyyy/LEVEL/BATCHMONTH/BNNN     e.g. EW/2026/A1/JAN/L001
 *
 *   EW          fixed school prefix
 *   yyyy        year the student enrolled
 *   LEVEL       the class they entered at (A1…C2)
 *   BATCHMONTH  three-letter month of their batch, e.g. JAN
 *   B           branch/private letter — see `branchLetter` below
 *   NNN         enrolment number within that branch, that year
 *
 * THE LETTER IS THE BRANCH, not a scale block: L for Lagos, A for Abuja, P
 * for Port Harcourt, N for the online branch, and V for a private/VIP student.
 * A student's code says where they belong before a single digit is read.
 *
 * The number is a straight per-branch, per-year sequence — L001 is Lagos's
 * first admission of the year, A001 is Abuja's, and both exist at once. It is
 * not padded to a hard width beyond three digits: `String(n).padStart(3, "0")`
 * simply grows to "1000" past 999 rather than wrapping or colliding.
 *
 * The code is assigned once at signup and never regenerated. It appears on
 * certificates and exam entries, so a student moving from A1 to A2 keeps the
 * code they were issued — it records where they started, not where they are.
 *
 * Codes issued under the old flat format are still valid and are NOT rewritten:
 * they are printed on certificates and exam entries that already exist, and a
 * student's identifier changing under them would be worse than two formats
 * coexisting. `scripts/backfill-student-codes.mjs` only fills in missing ones.
 */

const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

type BranchLike = { name?: string | null; mode?: string | null } | null | undefined;

/**
 * The one letter that stands for a branch in a student code: L(agos),
 * A(buja), P(ort Harcourt), N for the online branch (mode-driven, same check
 * `isOnlineBranch` uses everywhere else — a branch named "Online" or one
 * whose `mode` is literally `"online"` both count).
 *
 * A campus opened later that matches none of these falls back to its own
 * first letter rather than guessing — legible, and never silently wrong.
 */
export function branchLetter(branch: BranchLike, classType?: string | null): string {
  if (classType === "private") return "V";
  if (isOnlineBranch(branch ?? undefined)) return "N";
  const name = String(branch?.name ?? "").trim().toLowerCase();
  if (name.includes("lagos")) return "L";
  if (name.includes("abuja")) return "A";
  if (name.includes("port harcourt") || name.includes("portharcourt")) return "P";
  const firstLetter = name.replace(/[^a-z]/g, "").charAt(0);
  return (firstLetter || "X").toUpperCase();
}

/** Normalise whatever the admission form recorded as a batch into JAN…DEC. */
export function toBatchMonth(batch: unknown, fallback: Date = new Date()): string {
  const raw = String(batch ?? "").trim().toUpperCase();

  // Already a month name or an abbreviation of one.
  const direct = MONTHS.find((m) => raw.startsWith(m));
  if (direct) return direct;

  // Something date-shaped ("2026-07", "July 2026").
  const parsed = new Date(raw);
  if (raw && !Number.isNaN(parsed.getTime())) return MONTHS[parsed.getMonth()];

  return MONTHS[fallback.getMonth()];
}

export function formatStudentCode(parts: {
  year: number;
  level: string;
  batchMonth: string;
  letter: string;
  sequence: number;
}): string {
  const level = (parts.level || "A1").toUpperCase();
  const number = String(Math.max(1, Math.floor(parts.sequence))).padStart(3, "0");
  return `EW/${parts.year}/${level}/${parts.batchMonth}/${parts.letter}${number}`;
}

/**
 * Allocate the next free code for a student.
 *
 * The sequence is derived by counting that BRANCH's existing codes for the
 * year — L001 and A001 both exist at once, each numbering only their own
 * campus's admissions — which can collide if two students at the same branch
 * sign up in the same instant. Rather than lock the table, we retry on the
 * unique-constraint violation — cheap, and correct at any volume this school
 * will see.
 *
 * `minSequence` lets a caller force the number past whatever the recount
 * says: a retry that recounts against an unchanged DB (its own failed write
 * left no trace) would otherwise regenerate the exact same taken code every
 * time and never actually move forward. See `assignStudentCode`.
 */
export async function generateStudentCode(input: {
  level: string;
  batch?: unknown;
  branch?: BranchLike;
  classType?: string | null;
  now?: Date;
  minSequence?: number;
}): Promise<string> {
  const now = input.now ?? new Date();
  const year = now.getFullYear();
  const batchMonth = toBatchMonth(input.batch, now);
  const letter = branchLetter(input.branch, input.classType);

  // Counted per branch letter rather than across the whole school, so filtered
  // in JS off the year's codes instead of a SQL `contains` — a `contains: "/A"`
  // would also match the "A1" level segment or a batch month that happens to
  // hold that letter, which a plain substring check cannot tell apart.
  const codesThisYear = await prisma.student.findMany({
    where: { studentCode: { startsWith: `EW/${year}/` } },
    select: { studentCode: true },
  });
  const pattern = new RegExp(`/${letter}(\\d+)$`);
  let highest = 0;
  for (const { studentCode } of codesThisYear) {
    const match = studentCode?.match(pattern);
    if (match) highest = Math.max(highest, parseInt(match[1], 10));
  }

  return formatStudentCode({
    year,
    level: input.level,
    batchMonth,
    letter,
    sequence: Math.max(highest + 1, input.minSequence ?? 0),
  });
}

/** Assign a code to a student that does not have one, retrying on collision. */
export async function assignStudentCode(studentId: string, input: {
  level: string;
  batch?: unknown;
  branch?: BranchLike;
  classType?: string | null;
  now?: Date;
}): Promise<string | null> {
  let minSequence = 0;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = await generateStudentCode({ ...input, minSequence });

    // Whatever number this attempt landed on, the next retry (if any) must
    // clear it — a P2002 here means it's taken, and recounting alone can't
    // tell that apart from a stale read, so force the floor up regardless.
    const sequence = parseInt(code.match(/(\d+)$/)?.[1] ?? "0", 10);
    minSequence = sequence + 1;

    try {
      await prisma.student.update({
        where: { id: studentId },
        data: { studentCode: code },
      });
      return code;
    } catch (error: any) {
      // P2002 = another signup took this number first; bump the floor and retry.
      if (error?.code !== "P2002") throw error;
    }
  }

  // Five collisions means something structural is wrong, but a missing code
  // must never block a signup — the backfill script can repair it later.
  console.error(`Could not allocate a student code for ${studentId}`);
  return null;
}
