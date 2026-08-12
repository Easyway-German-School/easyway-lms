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
  const branch = await prisma.branch.findFirst({ select: { id: true, name: true, tenantId: true } });

  /**
   * THE TENANT, and why an account without one is useless.
   *
   * These fixtures used to be created with no `tenantId`. The tenant extension
   * reads the scope from the signed-in user, so a user with none puts every
   * query in the request into strict mode with nothing to match — the portal
   * then throws `TenantIsolationError` on the notification bell, the community
   * poll and every page's own data, which reads as the app being broken rather
   * than the fixture being wrong. An account that cannot load a page cannot
   * walk anything through.
   *
   * Taken from the branch these accounts are being put in, so the fixture lands
   * in the same tenant as the students it will sit beside.
   */
  const tenantId =
    branch?.tenantId ??
    (await prisma.tenant.findFirst({ select: { id: true } }))?.id ??
    null;

  const admin = await prisma.user.create({
    data: { email: `admin${SUFFIX}`, name: "Walkthrough Admin", password, role: "ADMIN", adminRole: "super", tenantId },
  });

  const lecturerUser = await prisma.user.create({
    data: { email: `tutor${SUFFIX}`, name: "Walkthrough Tutor", password, role: "LECTURER", tenantId },
  });
  await prisma.lecturer.create({
    data: { userId: lecturerUser.id, branchId: branch?.id ?? null, level: "A1", sessionSlot: "morning", tenantId },
  });

  const studentUser = await prisma.user.create({
    data: { email: `student${SUFFIX}`, name: "Walkthrough Student", password, role: "STUDENT", tenantId },
  });
  await prisma.student.create({
    data: {
      userId: studentUser.id,
      branchId: branch?.id ?? null,
      level: "A1",
      sessionSlot: "morning",
      status: "active",
      tenantId,
    },
  });

  console.log("branch used :", branch?.name ?? "(none in database)");
  console.log("tenant      :", tenantId ?? "(none — the portal will not load)");
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
