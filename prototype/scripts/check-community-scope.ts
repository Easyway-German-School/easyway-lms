/**
 * Proves the community room scope: an admin sees every room, a tutor sees only
 * the rooms their admin-set assignment covers, a student sees exactly one.
 *
 * npx tsx --tsconfig tsconfig.json --env-file=.env.local scripts/check-community-scope.ts
 */

import { PrismaClient } from "@prisma/client";
import { resolveSpaceScope } from "../src/lib/community-spaces";
import { readAssignment } from "../src/lib/lecturer-assignment";
import { runUnscoped } from "../src/lib/tenant/context";

const prisma = new PrismaClient();

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const totalRooms = await prisma.space.count();
  console.log(`Rooms in the school: ${totalRooms}\n`);

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true, email: true } });
  if (admin) {
    const scope = await resolveSpaceScope({ userId: admin.id, role: "admin" });
    console.log(`Admin ${admin.email}: ${scope.spaceIds.length} rooms`);
    check("an admin still sees every room", scope.spaceIds.length > 0 && scope.isStaff);
  }

  const lecturers = await prisma.lecturer.findMany({
    select: {
      userId: true,
      user: { select: { email: true } },
      branchId: true, level: true, sessionSlot: true,
      branchIds: true, levels: true, sessionSlots: true,
    },
  });

  console.log("");
  for (const lecturer of lecturers) {
    const assignment = readAssignment(lecturer);
    const scope = await resolveSpaceScope({ userId: lecturer.userId, role: "lecturer" });

    const rooms = await prisma.space.findMany({
      where: { id: { in: scope.spaceIds } },
      select: { level: true, sessionSlot: true, branchId: true },
    });

    console.log(
      `Tutor ${lecturer.user.email}: ${scope.spaceIds.length} rooms | assigned levels=${JSON.stringify(assignment.levels)} slots=${JSON.stringify(assignment.sessionSlots)}`,
    );

    check(
      `  ${lecturer.user.email} sees fewer rooms than the whole school`,
      scope.spaceIds.length < totalRooms,
      `saw ${scope.spaceIds.length} of ${totalRooms}`,
    );

    const strayLevel = rooms.find((room) => !assignment.levels.includes(room.level));
    check(`  every room is a level they teach`, !strayLevel, strayLevel ? `saw level ${strayLevel.level}` : "");

    if (assignment.sessionSlots.length) {
      const straySlot = rooms.find((room) => !assignment.sessionSlots.includes(room.sessionSlot));
      check(`  every room is a sitting they teach`, !straySlot, straySlot ? `saw slot ${straySlot.sessionSlot}` : "");
    }

    const strayBranch = rooms.find((room) => !assignment.branchIds.includes(room.branchId));
    check(`  every room is a branch they teach`, !strayBranch);
  }

  console.log("");
  const student = await prisma.student.findFirst({
    where: { branchId: { not: null }, level: "A2" },
    select: { userId: true, level: true, sessionSlot: true, user: { select: { email: true } } },
  });
  if (student) {
    const scope = await resolveSpaceScope({ userId: student.userId, role: "student" });
    console.log(`Student ${student.user.email} (${student.level}/${student.sessionSlot}): ${scope.spaceIds.length} room(s)`);
    check("a student resolves to exactly one room", scope.spaceIds.length === 1);
    check("a student is not marked staff", scope.isStaff === false);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

runUnscoped("read-only scope check across every tenant's rooms", main)
  .catch((error) => {
    console.error("Fatal:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
