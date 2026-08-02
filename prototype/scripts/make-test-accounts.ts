/**
 * Creates (or removes) three throwaway accounts — one per role — so the app can
 * actually be driven end to end rather than smoke-tested a route at a time.
 *
 *   npx tsx scripts/make-test-accounts.ts          create
 *   npx tsx scripts/make-test-accounts.ts --clean  remove them again
 *
 * Every account is tagged with the same email suffix so cleanup is exact and
 * cannot catch a real person.
 */
import { PrismaClient } from "@prisma/client";
import bcryptjs from "bcryptjs";

const prisma = new PrismaClient();
const SUFFIX = "@walkthrough.test";
const PASSWORD = "Walkthrough123";

async function clean() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: SUFFIX } },
    select: { id: true, email: true },
  });
  for (const user of users) {
    await prisma.student.deleteMany({ where: { userId: user.id } });
    await prisma.lecturer.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }
  console.log(`removed ${users.length} test account(s)`);
}

async function main() {
  if (process.argv.includes("--clean")) return clean();

  await clean();
  const password = await bcryptjs.hash(PASSWORD, 10);
  const branch = await prisma.branch.findFirst({ select: { id: true, name: true } });

  const admin = await prisma.user.create({
    data: { email: `admin${SUFFIX}`, name: "Walkthrough Admin", password, role: "ADMIN", adminRole: "super" },
  });

  const lecturerUser = await prisma.user.create({
    data: { email: `tutor${SUFFIX}`, name: "Walkthrough Tutor", password, role: "LECTURER" },
  });
  await prisma.lecturer.create({
    data: { userId: lecturerUser.id, branchId: branch?.id ?? null, level: "A1", sessionSlot: "morning" },
  });

  const studentUser = await prisma.user.create({
    data: { email: `student${SUFFIX}`, name: "Walkthrough Student", password, role: "STUDENT" },
  });
  await prisma.student.create({
    data: {
      userId: studentUser.id,
      branchId: branch?.id ?? null,
      level: "A1",
      sessionSlot: "morning",
      status: "active",
    },
  });

  console.log("branch used :", branch?.name ?? "(none in database)");
  console.log("admin       :", admin.email);
  console.log("tutor       :", lecturerUser.email);
  console.log("student     :", studentUser.email);
  console.log("password    :", PASSWORD);
}

main()
  .catch((error) => {
    console.error("FAILED:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
