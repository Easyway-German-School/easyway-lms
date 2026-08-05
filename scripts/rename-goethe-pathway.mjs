import { PrismaClient } from "@prisma/client";

/**
 * Rename the school's own pathway branding on existing records.
 *
 * "Goethe exam mastery" was the default pathway every student got, and it was
 * showing on the student profile page as the name of what they had bought.
 * Goethe is an exam body EasyWay prepares people for — it is not the product.
 *
 * The code defaults are already changed; this brings the rows that were
 * written before that in line, so the portal does not show two different names
 * for the same thing depending on when somebody registered.
 *
 * Deliberately untouched: Exam.examBody, ExamRegistration, and the
 * `preferredExam` answer in the admission blob. Those name a real institution
 * and a real booking — renaming them would make the app lie about which exam
 * a student actually sat.
 *
 *   node scripts/rename-goethe-pathway.mjs          # report only
 *   node scripts/rename-goethe-pathway.mjs --write  # apply
 */

const prisma = new PrismaClient();
const write = process.argv.includes("--write");

const RENAMES = [
  { field: "pathway", from: "Goethe exam mastery", to: "Language training" },
  {
    field: "outcome",
    from: "Goethe C1 readiness + German work placement support",
    to: "C1 readiness + German work placement support",
  },
];

async function main() {
  for (const { field, from, to } of RENAMES) {
    const count = await prisma.student.count({ where: { [field]: from } });
    console.log(`${field}: ${count} student(s) still say "${from}"`);
    if (count > 0 && write) {
      const result = await prisma.student.updateMany({
        where: { [field]: from },
        data: { [field]: to },
      });
      console.log(`  → renamed ${result.count} to "${to}"`);
    }
  }

  /**
   * Pathway rows carry the same name, and Enrollment and Course both point at
   * them. `Pathway.name` is unique, so if a "Language training" row already
   * exists this is a MERGE, not a rename — repoint everything at the survivor
   * and drop the duplicate. Renaming blindly fails on the unique index, and
   * deleting blindly would cascade away people's enrolments.
   */
  const old = await prisma.pathway.findFirst({ where: { name: "Goethe exam mastery" } });
  if (!old) {
    console.log('Pathway: no "Goethe exam mastery" row left');
  } else {
    const survivor = await prisma.pathway.findFirst({ where: { name: "Language training" } });
    const [enrolments, courses] = await Promise.all([
      prisma.enrollment.count({ where: { pathwayId: old.id } }),
      prisma.course.count({ where: { pathwayId: old.id } }),
    ]);

    if (!survivor) {
      console.log(`Pathway: renaming the row (${enrolments} enrolments, ${courses} courses)`);
      if (write) {
        await prisma.pathway.update({
          where: { id: old.id },
          data: {
            name: "Language training",
            headline: old.headline?.replace(/Goethe/g, "exam") ?? null,
          },
        });
        console.log('  → renamed to "Language training"');
      }
    } else {
      console.log(
        `Pathway: merging into the existing "Language training" row ` +
          `(${enrolments} enrolments, ${courses} courses to move)`,
      );
      if (write) {
        await prisma.enrollment.updateMany({
          where: { pathwayId: old.id },
          data: { pathwayId: survivor.id },
        });
        await prisma.course.updateMany({
          where: { pathwayId: old.id },
          data: { pathwayId: survivor.id },
        });
        await prisma.pathway.delete({ where: { id: old.id } });
        console.log("  → merged and the duplicate removed");
      }
    }
  }

  if (!write) console.log("\nDry run. Re-run with --write to apply.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
