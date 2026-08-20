/**
 * Issues branch-aware codes to students who do not have one yet.
 *
 * Existing codes are never rewritten because they may already be printed on
 * certificates, exam records, or parent accounts. New codes are allocated in
 * creation order within each year and category:
 * Lagos=L, Abuja=A, Port Harcourt=P, Online=N, Private/VIP=V.
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

function branchLetter(branch, classType) {
  if (classType === "private") return "V";
  if (branch?.mode === "online") return "N";
  const name = String(branch?.name ?? "").trim().toLowerCase();
  if (name.includes("online") || name.includes("virtual") || name.includes("remote")) return "N";
  if (name.includes("lagos")) return "L";
  if (name.includes("abuja")) return "A";
  if (name.includes("port harcourt") || name.includes("portharcourt")) return "P";
  return (name.replace(/[^a-z]/g, "").charAt(0) || "X").toUpperCase();
}

function oldParts(student) {
  const match = String(student.studentCode ?? "").match(/^EW\/(\d{4})\/([^/]+)\/([^/]+)\//);
  return {
    year: match ? Number(match[1]) : student.createdAt.getFullYear(),
    level: match?.[2] || student.level || "A1",
    batch: match?.[3] || student.admission?.batch,
  };
}

async function main() {
  const students = await prisma.student.findMany({
    where: { studentCode: null },
    // Oldest first, so enrolment numbers follow the order people actually joined.
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      level: true,
      classType: true,
      admission: true,
      createdAt: true,
      studentCode: true,
      branch: { select: { name: true, mode: true } },
      user: { select: { name: true } },
    },
  });

  if (!students.length) {
    console.log("No students found — nothing to do.");
    return;
  }

  const counters = new Map();
  const existing = await prisma.student.findMany({
    where: { studentCode: { not: null } },
    select: { studentCode: true },
  });
  for (const { studentCode } of existing) {
    const match = String(studentCode ?? "").match(/^EW\/(\d{4})\/[^/]+\/[^/]+\/([A-Z])(\d+)$/i);
    if (!match) continue;
    const key = `${match[1]}:${match[2].toUpperCase()}`;
    counters.set(key, Math.max(counters.get(key) ?? 0, Number(match[3]) || 0));
  }

  const replacements = [];
  for (const student of students) {
    const parts = oldParts(student);
    const letter = branchLetter(student.branch, student.classType);
    const key = `${parts.year}:${letter}`;
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    const batchMonth = toBatchMonth(parts.batch, student.createdAt);
    const code = `EW/${parts.year}/${parts.level.toUpperCase()}/${batchMonth}/${letter}${String(next).padStart(3, "0")}`;
    replacements.push({ id: student.id, oldCode: student.studentCode, code, name: student.user?.name });
  }

  await prisma.$transaction(async (tx) => {
    for (const replacement of replacements) {
      await tx.student.update({ where: { id: replacement.id }, data: { studentCode: replacement.code } });
      console.log(`  ${replacement.code}  ${replacement.name ?? "(unnamed)"}`);
    }
  }, { timeout: 120000 });

  console.log(`\nMigrated ${replacements.length} student code${replacements.length === 1 ? "" : "s"}.`);
}

main()
  .catch((e) => { console.error("Backfill failed:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
