/**
 * Adopt rows that were written with no tenant.
 *
 *   npx tsx --env-file=.env.local scripts/repair-tenant-orphans.ts            # report only
 *   npx tsx --env-file=.env.local scripts/repair-tenant-orphans.ts --apply    # fix them
 *   npx tsx --env-file=.env.local scripts/repair-tenant-orphans.ts --apply --tenant <id>
 *
 * WHY THIS EXISTS. A Prisma client extension only sees the TOP-LEVEL model of
 * a query, so `user.create({ data: { lecturer: { create: … } } })` wrote a
 * Lecturer the isolation layer never touched, and `User` is a global model
 * whose tenant column nothing stamps at all. Between them, every tutor created
 * from the admin screen after the tenant layer shipped — and every self-signup
 * student — landed owned by nobody.
 *
 * An unowned row is not merely untidy. It is invisible to its own school's
 * tenant-scoped reads, so the admin board stops listing tutors it has just
 * created; and its owner signs in holding a session with no tenant, which in
 * strict isolation makes every query in their portal throw, so the portal
 * bounces them straight back to the sign-in form.
 *
 * The extension no longer produces these (see src/lib/tenant/extension.ts).
 * This adopts the ones already on disk, and stays in the repo because the
 * cheapest way to find out whether that fix held is to run it and see nothing.
 *
 * It refuses to guess when there is more than one tenant: adopting a row into
 * the wrong school is worse than leaving it orphaned, because it is silent.
 */

import { Prisma } from "@prisma/client";

import { unguardedPrisma as prisma } from "../src/lib/prisma";
import { TENANT_OWNED_MODELS } from "../src/lib/tenant/registry";

const apply = process.argv.includes("--apply");
const tenantArgIndex = process.argv.indexOf("--tenant");
const tenantArg = tenantArgIndex >= 0 ? process.argv[tenantArgIndex + 1] : null;

/** `ClassSession` -> `classSession`, which is how the client names the model. */
function clientKey(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/** Can this model's tenantId even be null? Read from the generated schema. */
function nullableTenant(model: string): boolean {
  const entry = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === model);
  const field = entry?.fields.find((candidate) => candidate.name === "tenantId");
  return Boolean(field && !field.isRequired);
}

async function resolveTenant(): Promise<string> {
  if (tenantArg) {
    const found = await prisma.tenant.findUnique({ where: { id: tenantArg }, select: { id: true } });
    if (!found) throw new Error(`No tenant with id ${tenantArg}`);
    return found.id;
  }

  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  if (tenants.length === 0) throw new Error("There are no tenants. Create one before adopting rows into it.");
  if (tenants.length > 1) {
    throw new Error(
      `There are ${tenants.length} tenants, so the owner of an orphaned row cannot be inferred. ` +
        `Re-run with --tenant <id>. Tenants: ${tenants.map((t) => `${t.id} (${t.name})`).join(", ")}`,
    );
  }
  return tenants[0].id;
}

async function main() {
  const tenantId = await resolveTenant();
  console.log(`${apply ? "Adopting" : "Would adopt"} orphaned rows into ${tenantId}\n`);

  let total = 0;
  const skipped: Array<{ model: string; count: number; why: string }> = [];

  /**
   * Users first. A User carries no tenant-owned data itself, but its tenant is
   * what the session is built from — so a tutor whose Lecturer row is adopted
   * while their User row is not still cannot use the portal.
   */
  const orphanUsers = await prisma.user.count({ where: { tenantId: null } });
  if (orphanUsers > 0) {
    total += orphanUsers;
    console.log(`  User${" ".repeat(24)} ${String(orphanUsers).padStart(5)}`);
    if (apply) {
      await prisma.user.updateMany({ where: { tenantId: null }, data: { tenantId } });
    }
  }

  for (const model of TENANT_OWNED_MODELS) {
    const delegate = (prisma as unknown as Record<string, any>)[clientKey(model)];
    if (!delegate?.count) {
      console.warn(`  (skipped ${model}: no such delegate on the client)`);
      continue;
    }

    /**
     * A few tenant-owned tables declare `tenantId` NOT NULL. Prisma rejects
     * `{ tenantId: null }` against those rather than returning zero, so they
     * are identified from the schema and skipped — a column the database will
     * not let be null cannot be holding an orphan.
     */
    if (!nullableTenant(model)) continue;

    const count: number = await delegate.count({ where: { tenantId: null } });
    if (count === 0) continue;

    total += count;

    if (!apply) {
      console.log(`  ${model.padEnd(28)} ${String(count).padStart(5)}`);
      continue;
    }

    /**
     * One model at a time, and a refusal here is reported rather than fatal.
     *
     * `AuditLog` is the case: a Postgres trigger makes it append-only, so its
     * rows cannot be adopted at all. That is the trail doing its job and is not
     * something to work around — an audit row whose history can be rewritten is
     * not an audit row. It is left orphaned and said out loud, and the rest of
     * the repair still runs, which is the whole reason this is not one big
     * transaction.
     */
    try {
      await delegate.updateMany({ where: { tenantId: null }, data: { tenantId } });
      console.log(`  ${model.padEnd(28)} ${String(count).padStart(5)}`);
    } catch (error) {
      total -= count;
      skipped.push({ model, count, why: error instanceof Error ? error.message.split("\n")[0] : "refused" });
      console.log(`  ${model.padEnd(28)} ${String(count).padStart(5)}  REFUSED`);
    }
  }

  if (total === 0 && skipped.length === 0) {
    console.log("  Nothing orphaned. Every row has an owner.");
  } else if (apply) {
    console.log(`\nAdopted ${total} row(s).`);
  } else {
    console.log(`\n${total} row(s) would be adopted. Re-run with --apply.`);
  }

  for (const entry of skipped) {
    console.log(`\nLeft alone: ${entry.count} ${entry.model} row(s) — ${entry.why}`);
  }
}

main()
  .catch((error) => {
    console.error("Failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
