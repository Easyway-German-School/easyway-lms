import { PrismaClient } from "@prisma/client";

/**
 * Remove Goethe branding from rows that were written before the code stopped
 * producing it.
 *
 * The code defaults are already changed, so nothing new says "Goethe". This is
 * for what is already in the database — exam names, the preferred-exam answer
 * on the profile, seeded course and community copy. Without this the portal
 * shows the old name to anyone who registered before the change.
 *
 * This deliberately goes further than scripts/rename-goethe-pathway.mjs, which
 * left Exam.examBody and the `preferredExam` admission answer alone on the
 * grounds that they name a real institution. That call was reversed: the
 * school does not want the name in the product at all.
 *
 * `examBody: "Goethe"` becomes "internal" because "Goethe" is no longer in
 * EXAM_BODIES — the admin API already coerces unknown bodies the same way.
 * Read the reported counts before applying: if any of those rows are real
 * external sittings, the badge on them will now read "internal".
 *
 *   node scripts/scrub-goethe.mjs          # report only
 *   node scripts/scrub-goethe.mjs --write  # apply
 */

const prisma = new PrismaClient();
const write = process.argv.includes("--write");

/** Ordered: the specific phrases first, then a generic strip of the bare word. */
const RULES = [
  [/Goethe exam mastery/g, "Language training"],
  [/Goethe-Zertifikat/g, "Zertifikat"],
  [/Goethe-Institut/g, "Prüfungsinstitut"],
  [/\bdas Goethe\b/g, "das Institut"],
  [/\bGoethe\s*\/\s*telc\b/gi, "ÖSD / telc"],
  [/\bGoethe(?:\s+exam)?\s+(A1|A2|B1|B2|C1|C2)\b/g, "$1"],
  [/\bGoethe\s+exams?\b/gi, "exam"],
  [/\bGoethe\b[,;]?\s*/g, ""],
];

function scrub(value) {
  let out = value;
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  // Tidy what removing a word leaves behind.
  return out
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\(\s*\)/g, "")
    // Dropping the word can strand the wrong article: "a Goethe exam" → "a exam".
    .replace(/\ba (exam|internal|A1|A2|B1|B2|C1|C2)\b/g, "an $1")
    .trim();
}

/** Every text column that seeded or user-entered Goethe copy can sit in. */
const TARGETS = [
  ["exam", ["name", "description"]],
  ["examRegistration", ["examName"]],
  ["course", ["title", "description"]],
  ["lesson", ["title", "description", "content"]],
  ["pathway", ["name", "headline", "description"]],
  ["notification", ["title", "message"]],
  ["thread", ["title", "body"]],
  ["comment", ["body"]],
  // Student.examReadiness is an Int, so it is not scrubbable text.
  ["student", ["pathway", "outcome", "nextLive"]],
];

async function scrubTextColumns() {
  for (const [model, fields] of TARGETS) {
    for (const field of fields) {
      const rows = await prisma[model].findMany({
        where: { [field]: { contains: "Goethe" } },
        select: { id: true, [field]: true },
      });
      if (rows.length === 0) continue;

      console.log(`${model}.${field}: ${rows.length} row(s)`);
      for (const row of rows) {
        const next = scrub(row[field]);
        console.log(`  "${row[field]}"\n   → "${next}"`);
        if (write) {
          // Pathway.name is unique, so a scrub that collides with an existing
          // row would throw. Skip those and leave them to rename-goethe-pathway.
          if (model === "pathway" && field === "name") {
            const clash = await prisma.pathway.findFirst({
              where: { name: next, id: { not: row.id } },
              select: { id: true },
            });
            if (clash) {
              console.log("   ! name already taken — run rename-goethe-pathway.mjs to merge");
              continue;
            }
          }
          await prisma[model].update({ where: { id: row.id }, data: { [field]: next } });
        }
      }
    }
  }
}

async function scrubExamBody() {
  const count = await prisma.exam.count({ where: { examBody: "Goethe" } });
  console.log(`exam.examBody: ${count} sitting(s) still recorded as Goethe`);
  if (count > 0 && write) {
    const result = await prisma.exam.updateMany({
      where: { examBody: "Goethe" },
      data: { examBody: "internal" },
    });
    console.log(`  → ${result.count} moved to "internal"`);
  }
}

/**
 * `preferredExam` lives inside the admission JSON blob, so it cannot be
 * filtered in SQL — read the students that have one and rewrite the blob.
 */
async function scrubPreferredExam() {
  const students = await prisma.student.findMany({
    where: { admission: { not: null } },
    select: { id: true, admission: true },
  });

  const hits = students.filter(
    (s) => typeof s.admission?.preferredExam === "string" && s.admission.preferredExam.includes("Goethe"),
  );
  console.log(`student.admission.preferredExam: ${hits.length} student(s) still say Goethe`);

  if (write) {
    for (const student of hits) {
      await prisma.student.update({
        where: { id: student.id },
        data: { admission: { ...student.admission, preferredExam: "Not decided yet" } },
      });
    }
    if (hits.length > 0) console.log(`  → ${hits.length} set to "Not decided yet"`);
  }
}

async function main() {
  await scrubTextColumns();
  await scrubExamBody();
  await scrubPreferredExam();
  if (!write) console.log("\nDry run. Re-run with --write to apply.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
