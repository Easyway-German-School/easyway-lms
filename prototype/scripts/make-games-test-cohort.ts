/**
 * Throwaway accounts for driving Satzkette and the live quiz through the real
 * UI, without pinging a real student's phone.
 *
 * Satzkette's createMatch sends a real push to its first assignee — see
 * scripts/satzkette-scan.ts and the note in memory. Every cohort with a real
 * student in it is therefore off-limits for anything beyond the read-only
 * scan. Port Harcourt · B2 has zero students at all as of this run, so three
 * fixture students placed there and nobody else.
 *
 *   npx tsx scripts/make-games-test-cohort.ts          create
 *   npx tsx scripts/make-games-test-cohort.ts --clean  remove them again
 *
 * Tag is @gametest.walkthrough.test, distinct from the existing
 * @walkthrough.test fixtures (different branch, different purpose) so cleanup
 * of one never touches the other.
 */
import { PrismaClient } from "@prisma/client";
import bcryptjs from "bcryptjs";

const prisma = new PrismaClient();
const SUFFIX = "@gametest.walkthrough.test";
const PASSWORD = "Walkthrough123";
const BRANCH_NAME = "Port Harcourt";
const LEVEL = "B2";
const SESSION_SLOT = "morning";

async function clean() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: SUFFIX } },
    select: { id: true, email: true },
  });
  for (const user of users) {
    const student = await prisma.student.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (student) await prisma.payment.deleteMany({ where: { studentId: student.id } });

    const lecturer = await prisma.lecturer.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (lecturer) {
      // Cascades take AssignmentTarget / QuizGamePlayer / QuizGameAnswer with them.
      await prisma.assignment.deleteMany({ where: { lecturerId: lecturer.id } });
      await prisma.quizGame.deleteMany({ where: { lecturerId: lecturer.id } });
    }

    await prisma.gameTurn.deleteMany({ where: { playerId: user.id } });
    await prisma.student.deleteMany({ where: { userId: user.id } });
    await prisma.lecturer.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }
  // Any match/quiz this cohort's students started dies with them once the
  // FK is gone; sweep rows that survive as orphans (assignedTo cascades are
  // SetNull on GameTurn, not on GameMatch/QuizGame).
  const space = await prisma.space.findFirst({
    where: { branch: { name: BRANCH_NAME }, level: LEVEL, sessionSlot: SESSION_SLOT },
    select: { id: true },
  });
  if (space) {
    const matches = await prisma.gameMatch.findMany({ where: { spaceId: space.id }, select: { id: true } });
    for (const m of matches) {
      await prisma.gameTurn.deleteMany({ where: { matchId: m.id } });
      await prisma.gameMatch.delete({ where: { id: m.id } }).catch(() => {});
    }
  }
  console.log(`removed ${users.length} test account(s) and their game rows`);
}

async function main() {
  if (process.argv.includes("--clean")) return clean();

  await clean();

  const branch = await prisma.branch.findFirst({ where: { name: BRANCH_NAME } });
  if (!branch) throw new Error(`branch "${BRANCH_NAME}" not found`);
  const tenantId = branch.tenantId;

  const password = await bcryptjs.hash(PASSWORD, 10);

  const tutorUser = await prisma.user.create({
    data: { email: `tutor${SUFFIX}`, name: "Gametest Tutor", password, role: "LECTURER", tenantId },
  });
  await prisma.lecturer.create({
    data: { userId: tutorUser.id, branchId: branch.id, level: LEVEL, sessionSlot: SESSION_SLOT, tenantId },
  });

  const studentEmails: string[] = [];
  for (const name of ["Amaka", "Chidi", "Efe"]) {
    const email = `${name.toLowerCase()}${SUFFIX}`;
    const studentUser = await prisma.user.create({
      data: { email, name: `Gametest ${name}`, password, role: "STUDENT", tenantId },
    });
    const student = await prisma.student.create({
      data: {
        userId: studentUser.id,
        branchId: branch.id,
        level: LEVEL,
        sessionSlot: SESSION_SLOT,
        status: "active",
        tenantId,
      },
    });
    // Games sit behind the tuition paywall — a registration-only fixture would
    // hit the padlock page instead of the feature being tested.
    await prisma.payment.create({
      data: {
        studentId: student.id,
        amount: 1_000_000,
        currency: "ngn",
        status: "completed",
        method: "manual",
        description: "gametest fixture — marks tuition paid so Games unlocks",
        tenantId,
      },
    });
    studentEmails.push(email);
  }

  console.log("branch   :", branch.name, `(${LEVEL} · ${SESSION_SLOT})`);
  console.log("tenant   :", tenantId);
  console.log("tutor    :", tutorUser.email);
  console.log("students :", studentEmails.join(", "));
  console.log("password :", PASSWORD);
}

main()
  .catch((error) => {
    console.error("FAILED:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
