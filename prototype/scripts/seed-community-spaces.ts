import { prisma } from "@/lib/prisma";
import { runUnscoped } from "@/lib/tenant/context";
import { ensureSpaceForCohort, isOfferedLevel, normalizeSlot } from "@/lib/community-spaces";

/**
 * Opens the chat room for every cohort that actually has students.
 *
 *   npm run seed:spaces
 *
 * Rooms are created lazily when the first student of a sitting opens the hub,
 * so this script is not required for correctness. What it buys is that the
 * room is already there — with its channels — before anybody looks, which
 * matters for a launch where the first person into a room should not be the
 * one who creates it.
 *
 * ---------------------------------------------------------------------------
 * REWRITTEN. The previous version built its own rooms and channels by hand and
 * disagreed with the app on all three counts that matter:
 *
 *   - It invented a five-channel set (general, grammar-help, vocabulary,
 *     announcements, assignments) where the app creates three. Running it
 *     therefore ADDED channels the app never makes and would never clean up.
 *   - It named rooms "Lagos - Level A1 (morning)" where the app names them
 *     "Lagos · A1 · Morning", so seeded and lazily-created rooms did not look
 *     like each other.
 *   - It set no tenantId, and it built the full branch × level × sitting
 *     cartesian product — rooms for cohorts that do not exist, including
 *     levels the school does not teach.
 *
 * It now calls the same `ensureSpaceForCohort` the app calls, for the cohorts
 * the register actually shows. One definition of a room, in one place.
 * ---------------------------------------------------------------------------
 */

async function main() {
  console.log("Opening community rooms for every live cohort\n");

  /**
   * Spans every tenant on purpose: this is an operator script run from a
   * terminal, where there is no signed-in user to take a tenant from.
   */
  await runUnscoped("seeding community rooms across every school", async () => {
    /**
     * The cohorts that actually exist, taken from the register rather than
     * from a cartesian product. A room for a combination nobody is enrolled in
     * is an empty room, and empty rooms are what kill a young community.
     */
    const cohorts = await prisma.student.groupBy({
      by: ["branchId", "level", "sessionSlot"],
      // `level` is a required column, so only the nullable branch needs a
      // guard — a student with no branch has no cohort to open a room for.
      where: { status: "active", branchId: { not: null } },
      _count: { _all: true },
    });

    if (cohorts.length === 0) {
      console.log("No active students with a branch and level. Nothing to open.");
      return;
    }

    const branches = await prisma.branch.findMany({ select: { id: true, name: true, mode: true } });
    const branchById = new Map(branches.map((b) => [b.id, b]));

    let opened = 0;
    let skipped = 0;

    // Sorted so the output reads like a timetable rather than a query plan.
    const sorted = [...cohorts].sort((a, b) => {
      const branchA = branchById.get(a.branchId!)?.name ?? "";
      const branchB = branchById.get(b.branchId!)?.name ?? "";
      return (
        branchA.localeCompare(branchB) ||
        String(a.level).localeCompare(String(b.level)) ||
        String(a.sessionSlot).localeCompare(String(b.sessionSlot))
      );
    });

    for (const cohort of sorted) {
      const branch = branchById.get(cohort.branchId!);
      const label = `${branch?.name ?? "?"} · ${cohort.level} · ${normalizeSlot(cohort.sessionSlot)}`;

      if (!isOfferedLevel(cohort.level)) {
        console.log(`  skip  ${label.padEnd(36)} level not taught`);
        skipped += 1;
        continue;
      }

      const space = await ensureSpaceForCohort({
        branchId: cohort.branchId!,
        branchName: branch?.name,
        level: cohort.level!,
        sessionSlot: cohort.sessionSlot,
      });

      if (!space) {
        console.log(`  skip  ${label.padEnd(36)} no room`);
        skipped += 1;
        continue;
      }

      const mode = branch?.mode === "online" ? " [online]" : "";
      console.log(`  open  ${label.padEnd(36)} ${cohort._count._all} student(s)${mode}`);
      opened += 1;
    }

    console.log(`\n${opened} room(s) open, ${skipped} skipped.`);
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
