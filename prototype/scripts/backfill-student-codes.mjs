/**
 * Issues official student codes (EW/yyyy/LEVEL/MONTH/NNNN) to students who
 * predate the scheme.
 *
 * SAFETY: only ever fills a NULL studentCode. Students that already have a
 * code are left untouched, so this is safe to re-run.
 *
 *   node scripts/backfill-student-codes.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function toBatchMonth(batch, fallback) {
  const raw = String(batch ?? "").trim().toUpperCase();
  const direct = MONTHS.find((m) => raw.startsWith(m));
  if (direct) return direct;
  const parsed = new Date(raw);
  if (raw && !Number.isNaN(parsed.getTime())) return MONTHS[parsed.getMonth()];
  return MONTHS[fallback.getMonth()];
}

async function main() {
  const students = await prisma.student.findMany({
    where: { studentCode: null },
    // Oldest first, so enrolment numbers follow the order people actually joined.
    orderBy: { createdAt: "asc" },
    select: { id: true, level: true, admission: true, createdAt: true, user: { select: { name: true } } },
  });

  if (!students.length) {
    console.log("Every student already has a code — nothing to do.");
    return;
  }

  // Seed the per-year counters from codes already issued.
  const counters = new Map();
  const existing = await prisma.student.findMany({
    where: { studentCode: { not: null } },
    select: { studentCode: true },
  });
  for (const { studentCode } of existing) {
    const [, year, , , seq] = studentCode.split("/");
    const n = parseInt(seq, 10);
    if (!Number.isNaN(n)) counters.set(year, Math.max(counters.get(year) ?? 0, n));
  }

  let issued = 0;
  for (const student of students) {
    const enrolled = student.createdAt ?? new Date();
    const year = enrolled.getFullYear();
    const batchMonth = toBatchMonth(student.admission?.batch, enrolled);

    const next = (counters.get(String(year)) ?? 0) + 1;
    counters.set(String(year), next);

    const code = `EW/${year}/${(student.level || "A1").toUpperCase()}/${batchMonth}/${String(next).padStart(4, "0")}`;
    await prisma.student.update({ where: { id: student.id }, data: { studentCode: code } });
    console.log(`  ${code}  ${student.user?.name ?? "(unnamed)"}`);
    issued++;
  }

  console.log(`\nIssued ${issued} student code${issued === 1 ? "" : "s"}.`);
}

main()
  .catch((e) => { console.error("Backfill failed:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
