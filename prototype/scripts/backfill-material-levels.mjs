/**
 * Copy `course.level` down onto `Material.level` for every row that has a
 * course but no level of its own.
 *
 * WHY THIS EXISTS. Students are found by level. `Material.level` was only ever
 * filled in for class recordings, so for documents the student query had to
 * join through `course.level` — and a relation filter on a NULLABLE relation
 * silently drops every row where the relation is absent. Half the materials at
 * A1 on this database were invisible to students because of it.
 *
 * The upload route now stamps the level at write time. This is the same fix
 * applied backwards, so material uploaded before it does not stay lost.
 *
 * SAFETY: additive and idempotent. It only ever fills a NULL, never overwrites
 * a level somebody set deliberately, and re-running it changes nothing.
 *
 *   node --env-file=.env.local scripts/backfill-material-levels.mjs
 *   node --env-file=.env.local scripts/backfill-material-levels.mjs --apply
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

const orphans = await prisma.material.findMany({
  where: { level: null, courseId: { not: null } },
  select: { id: true, title: true, course: { select: { level: true } } },
});

const fixable = orphans.filter((m) => m.course?.level);

console.log(`Materials with no level of their own : ${orphans.length}`);
console.log(`  ...of which the course knows one   : ${fixable.length}`);

for (const material of fixable) {
  const level = String(material.course.level).toUpperCase();
  console.log(`  ${apply ? "SET " : "would set"} ${level.padEnd(4)}  ${material.title.slice(0, 55)}`);
  if (apply) {
    await prisma.material.update({ where: { id: material.id }, data: { level } });
  }
}

/**
 * The genuinely homeless ones. A material with neither a level nor a course
 * that has one cannot be shown to anybody, and no query change will rescue it —
 * somebody has to say which level it belongs to.
 */
const stranded = await prisma.material.findMany({
  where: { level: null, courseId: null },
  select: { id: true, title: true, kind: true },
});
if (stranded.length) {
  console.log(`\n${stranded.length} material(s) have NO level and NO course — invisible until one is set:`);
  for (const m of stranded) console.log(`  [${m.kind}] ${m.title}`);
}

if (!apply) console.log("\nDry run. Re-run with --apply to write.");

await prisma.$disconnect();
