import { prisma } from "@/lib/prisma";

/**
 * Official Easyway student identifiers.
 *
 * Format:  EW/yyyy/LEVEL/BATCHMONTH/BNNN     e.g. EW/2026/A1/JAN/L001
 *
 *   EW          fixed school prefix
 *   yyyy        year the student enrolled
 *   LEVEL       the class they entered at (A1…C2)
 *   BATCHMONTH  three-letter month of their batch, e.g. JAN
 *   B           block letter — see below
 *   NNN         enrolment number within that block
 *
 * THE BLOCK LETTER exists for scale. The old format was a flat four-digit
 * counter, so at a few thousand students a year the last four characters were
 * an undifferentiated run of digits: "0847" and "8047" look alike on a printed
 * form and read alike over a phone, and neither says anything about the
 * student. Blocking the sequence in hundreds gives every code a letter that
 * narrows a search to a hundred people before a single digit is read.
 *
 * The letters run A…Z and then double (AA, AB …), so the scheme does not run
 * out; at 100 students per block that is 2,600 in single letters alone, per
 * level per batch per year.
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

/** How many students share one block letter. */
export const BLOCK_SIZE = 100;

/**
 * Turn a zero-based block index into its letter: 0→A, 25→Z, 26→AA, 27→AB.
 * Spreadsheet-column numbering, which people already read without being told.
 */
export function blockLetter(index: number): string {
  let n = Math.max(0, Math.floor(index));
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

export function formatStudentCode(parts: {
  year: number;
  level: string;
  batchMonth: string;
  sequence: number;
}): string {
  const level = (parts.level || "A1").toUpperCase();
  // Sequence is 1-based; student 1 is L…001 of block A, student 101 opens B.
  const zeroBased = Math.max(0, parts.sequence - 1);
  const letter = blockLetter(Math.floor(zeroBased / BLOCK_SIZE));
  const withinBlock = String((zeroBased % BLOCK_SIZE) + 1).padStart(3, "0");
  return `EW/${parts.year}/${level}/${parts.batchMonth}/${letter}${withinBlock}`;
}

/**
 * Allocate the next free code for a student.
 *
 * The sequence is derived by counting the year's existing codes, which can
 * collide if two students sign up in the same instant. Rather than lock the
 * table, we retry on the unique-constraint violation — cheap, and correct at
 * any volume this school will see.
 */
export async function generateStudentCode(input: {
  level: string;
  batch?: unknown;
  now?: Date;
}): Promise<string> {
  const now = input.now ?? new Date();
  const year = now.getFullYear();
  const batchMonth = toBatchMonth(input.batch, now);

  const issuedThisYear = await prisma.student.count({
    where: { studentCode: { startsWith: `EW/${year}/` } },
  });

  return formatStudentCode({
    year,
    level: input.level,
    batchMonth,
    sequence: issuedThisYear + 1,
  });
}

/** Assign a code to a student that does not have one, retrying on collision. */
export async function assignStudentCode(studentId: string, input: {
  level: string;
  batch?: unknown;
  now?: Date;
}): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = await generateStudentCode({
      ...input,
      // Nudge the sequence forward on each retry by counting again.
      now: input.now,
    });

    try {
      await prisma.student.update({
        where: { id: studentId },
        data: { studentCode: code },
      });
      return code;
    } catch (error: any) {
      // P2002 = another signup took this number first; recount and retry.
      if (error?.code !== "P2002") throw error;
    }
  }

  // Five collisions means something structural is wrong, but a missing code
  // must never block a signup — the backfill script can repair it later.
  console.error(`Could not allocate a student code for ${studentId}`);
  return null;
}
