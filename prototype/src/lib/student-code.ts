import { prisma } from "@/lib/prisma";

/**
 * Official Easyway student identifiers.
 *
 * Format:  EW/yyyy/LEVEL/BATCHMONTH/NNNN     e.g. EW/2026/A1/JUL/0007
 *
 *   EW          fixed school prefix
 *   yyyy        year the student enrolled
 *   LEVEL       the class they entered at (A1…C2)
 *   BATCHMONTH  three-letter month of their batch, e.g. JUL
 *   NNNN        enrolment number, sequential within the year
 *
 * The code is assigned once at signup and never regenerated. It appears on
 * certificates and exam entries, so a student moving from A1 to A2 keeps the
 * code they were issued — it records where they started, not where they are.
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

export function formatStudentCode(parts: {
  year: number;
  level: string;
  batchMonth: string;
  sequence: number;
}): string {
  const level = (parts.level || "A1").toUpperCase();
  const seq = String(parts.sequence).padStart(4, "0");
  return `EW/${parts.year}/${level}/${parts.batchMonth}/${seq}`;
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
