/**
 * One-off correction: the tutor attendance register used to default every
 * unmarked student to "absent" (see src/app/api/lecturer/attendance/students/route.ts),
 * so registers saved without every row explicitly clicked wrote false absences
 * for students who were actually present. That default is now fixed going
 * forward; this flips every existing Attendance row currently marked absent
 * over to present, at the school's explicit request.
 *
 *   node scripts/fix-attendance-absent-marks.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const before = await prisma.attendance.count({ where: { status: "absent" } });
  console.log(`Found ${before} attendance rows marked absent.`);

  if (before === 0) {
    console.log("Nothing to do.");
    return;
  }

  const result = await prisma.attendance.updateMany({
    where: { status: "absent" },
    data: { status: "present", present: true },
  });

  console.log(`Updated ${result.count} rows to present.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
