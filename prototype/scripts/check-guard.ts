import { prisma, unguardedPrisma } from "../src/lib/prisma";
import { runWithAuditActor } from "../src/lib/audit-context";

/**
 * Proves the protections actually engage, against a real database.
 *
 * A guard that is believed to work and does not is worse than no guard, because
 * it buys the confidence to stop being careful. So this exercises each rule for
 * real rather than in a unit test with a mocked client — the failure modes that
 * matter here live in Prisma's query pipeline and in Postgres, and neither of
 * those is present in a mock.
 *
 * It is safe to run against production, which is deliberate — a check nobody
 * dares run is a check nobody runs. It touches exactly one row, a branch named
 * below, which it creates and removes itself. The one genuinely dangerous
 * assertion, that an unscoped deleteMany is refused, runs inside a transaction
 * that always rolls back: if the guard were broken, the rollback undoes it.
 *
 *   npm run check:guard
 */

const MARKER = "__guard_selftest__";

let passed = 0;
let failed = 0;

function ok(label: string) {
  passed += 1;
  console.log(`  PASS  ${label}`);
}

function bad(label: string, detail?: unknown) {
  failed += 1;
  console.log(`  FAIL  ${label}`);
  if (detail) console.log(`        ${detail instanceof Error ? detail.message : String(detail)}`);
}

async function main() {
  console.log("\nGuard self-test\n");

  await runWithAuditActor(
    { userId: undefined, email: "selftest@easyway", role: "script", source: "script" },
    async () => {
      // Clean up anything a previous interrupted run left behind.
      await unguardedPrisma.branch.deleteMany({ where: { name: MARKER } });

      // ---------------------------------------------------------------
      console.log("Soft delete");
      // ---------------------------------------------------------------
      const branch = await prisma.branch.create({
        data: { name: MARKER, location: "nowhere", status: "inactive" },
      });

      await prisma.branch.delete({ where: { id: branch.id } });

      const raw = await unguardedPrisma.branch.findUnique({ where: { id: branch.id } });
      if (raw && raw.deletedAt) ok("delete set deletedAt instead of removing the row");
      else if (!raw) bad("the row was actually deleted — soft delete did NOT engage");
      else bad("the row survived but deletedAt is null");

      const viaFindMany = await prisma.branch.findMany({ where: { name: MARKER } });
      if (viaFindMany.length === 0) ok("findMany hides the deleted row");
      else bad(`findMany returned ${viaFindMany.length} deleted row(s)`);

      const viaFindUnique = await prisma.branch.findUnique({ where: { id: branch.id } });
      if (viaFindUnique === null) ok("findUnique hides the deleted row");
      else bad("findUnique returned a deleted row");

      const counted = await prisma.branch.count({ where: { name: MARKER } });
      if (counted === 0) ok("count excludes the deleted row");
      else bad(`count returned ${counted}`);

      // ---------------------------------------------------------------
      console.log("\nAudit trail");
      // ---------------------------------------------------------------
      const entry = await prisma.auditLog.findFirst({
        where: { model: "Branch", recordId: branch.id, action: "delete" },
        orderBy: { at: "desc" },
      });

      if (!entry) {
        bad("no audit entry was written for the delete");
      } else {
        ok("the delete was recorded");
        const before = entry.before as Record<string, unknown> | null;
        if (before && before.name === MARKER) ok("the before-image holds the row's contents");
        else bad("the before-image is missing or empty");
        if (entry.restorable) ok("the entry is marked restorable");
        else bad("the entry is not restorable");
        if (entry.actorEmail === "selftest@easyway") ok("the actor was recorded");
        else bad(`actor was "${entry.actorEmail}", expected selftest@easyway`);
      }

      // ---------------------------------------------------------------
      console.log("\nThe trail defends itself");
      // ---------------------------------------------------------------
      if (entry) {
        try {
          await prisma.auditLog.update({
            where: { id: entry.id },
            data: { action: "something-else" } as never,
          });
          bad("an audit entry was successfully rewritten");
        } catch {
          ok("the application refuses to rewrite an audit entry");
        }

        try {
          // Straight past the application guard, to see whether Postgres holds.
          await unguardedPrisma.$executeRawUnsafe(
            `UPDATE "AuditLog" SET "action" = 'tampered' WHERE "id" = $1`,
            entry.id,
          );
          bad("raw SQL rewrote an audit entry — the database trigger is not active");
        } catch {
          ok("Postgres refuses to rewrite an audit entry, even from raw SQL");
        }

        try {
          await unguardedPrisma.$executeRawUnsafe(
            `DELETE FROM "AuditLog" WHERE "id" = $1`,
            entry.id,
          );
          bad("raw SQL deleted an audit entry — the database trigger is not active");
        } catch {
          ok("Postgres refuses to delete an audit entry");
        }
      }

      // ---------------------------------------------------------------
      console.log("\nBlast radius");
      // ---------------------------------------------------------------
      try {
        await prisma.$transaction(async (tx) => {
          // If the guard is working this throws before touching anything. If it
          // is not, the deliberate error below rolls the damage back.
          await (tx as typeof prisma).branch.deleteMany({});
          throw new Error("__rollback__");
        });
        bad("an unscoped deleteMany was allowed to run");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("__rollback__")) {
          bad("an unscoped deleteMany was NOT refused (rolled back safely, but the guard did not fire)");
        } else if (message.includes("no WHERE clause")) {
          ok("an unscoped deleteMany is refused");
        } else {
          bad("unscoped deleteMany failed for an unexpected reason", error);
        }
      }

      // ---------------------------------------------------------------
      console.log("\nRestore");
      // ---------------------------------------------------------------
      if (entry) {
        const { restoreFromAudit } = await import("../src/lib/audit-restore");
        const result = await restoreFromAudit(entry.id, entry.actorId);
        if (result.ok) ok(`restore reported success: ${result.message}`);
        else bad(`restore failed: ${result.message}`);

        const back = await prisma.branch.findUnique({ where: { id: branch.id } });
        if (back) ok("the row is visible again after restore");
        else bad("the row is still hidden after restore");
      }

      // ---------------------------------------------------------------
      // Tidy up. The unguarded client, because the guarded one would only
      // soft-delete it and leave the marker row behind forever.
      await unguardedPrisma.branch.deleteMany({ where: { name: MARKER } });

      // The trail's own escape hatch, used exactly as docs/SECURITY.md
      // describes it. Two separate statements in one transaction, because
      // `SET LOCAL` only means anything inside a transaction and Postgres
      // will not accept both in a single prepared statement.
      await unguardedPrisma.$transaction([
        unguardedPrisma.$executeRawUnsafe(`SET LOCAL easyway.audit_prune = 'on'`),
        unguardedPrisma.$executeRawUnsafe(
          `DELETE FROM "AuditLog" WHERE "actorEmail" = 'selftest@easyway'`,
        ),
      ]);
    },
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await unguardedPrisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error("\nSelf-test crashed:", error);
  await unguardedPrisma.branch.deleteMany({ where: { name: MARKER } }).catch(() => {});
  await unguardedPrisma.$disconnect();
  process.exit(1);
});
