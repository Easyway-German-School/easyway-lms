/**
 * Runs 01_backfill.sql and then verifies its own work.
 *
 * There is no psql on the machine this gets run from, and shelling out to a
 * database client that may not exist is a bad dependency for a step that must
 * either happen or visibly fail. Prisma can execute the same SQL.
 *
 * The verification at the end is the part that matters. A backfill that ran
 * against forty-nine of fifty tables looks identical to one that ran against
 * all fifty — until months later, when one school's query returns another
 * school's rows. So this refuses to report success while a single tenant-owned
 * table still holds a row with no owner.
 *
 *   node scripts/run-tenant-backfill.mjs
 */

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(here, "..", "prisma", "migrations", "manual", "001_tenant_platform", "01_backfill.sql");

const prisma = new PrismaClient();

/**
 * Split on the statements this file actually contains: one INSERT and one
 * DO block. BEGIN/COMMIT are stripped because Prisma's $executeRawUnsafe runs
 * each statement in its own implicit transaction and refuses an explicit one.
 * The DO block is atomic on its own, which is where atomicity was needed.
 */
const sql = readFileSync(sqlPath, "utf8");
const insert = /INSERT INTO "Tenant"[\s\S]*?;/.exec(sql);
const doBlock = /DO \$\$[\s\S]*?\$\$;/.exec(sql);

if (!insert || !doBlock) {
  console.error(`Could not find both statements in ${sqlPath}. Refusing to guess.`);
  process.exit(1);
}

console.log("1. creating the root tenant...");
await prisma.$executeRawUnsafe(insert[0]);

console.log("2. backfilling...");
await prisma.$executeRawUnsafe(doBlock[0]);

console.log("3. verifying...");

const tables = await prisma.$queryRawUnsafe(`
  SELECT c.table_name
  FROM information_schema.columns c
  JOIN information_schema.tables tb
    ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
  WHERE c.table_schema = 'public' AND c.column_name = 'tenantId'
    AND tb.table_type = 'BASE TABLE'
    AND c.table_name NOT IN ('ApiKey', 'IdempotencyRecord')
  ORDER BY c.table_name
`);

let orphans = 0;
let rows = 0;

for (const { table_name: table } of tables) {
  const [{ nulls, total }] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) FILTER (WHERE "tenantId" IS NULL) AS nulls, COUNT(*) AS total FROM "${table}"`,
  );
  const n = Number(nulls);
  rows += Number(total);
  if (n > 0) {
    orphans += n;
    console.error(`   ${table}: ${n} row(s) with no tenant`);
  }
}

/**
 * The backfill lifts AuditLog's append-only trigger for one statement. If it
 * ever finishes with the trigger still off, the audit trail is editable and
 * nobody would notice — so that is checked here rather than assumed.
 */
const [trigger] = await prisma.$queryRawUnsafe(
  `SELECT tgenabled FROM pg_trigger WHERE tgname = 'AuditLog_immutable'`,
);
if (!trigger || trigger.tgenabled === "D") {
  console.error("\nFAILED: the AuditLog append-only trigger is disabled or missing. Re-enable it:");
  console.error(`  ALTER TABLE "AuditLog" ENABLE TRIGGER "AuditLog_immutable";`);
  await prisma.$disconnect();
  process.exit(1);
}

const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true, name: true } });
await prisma.$disconnect();

console.log(`\n${tables.length} tenant-owned tables, ${rows} rows`);
console.log(`tenants: ${tenants.map((t) => `${t.slug} (${t.id})`).join(", ")}`);

if (orphans > 0) {
  console.error(`\nFAILED: ${orphans} row(s) still have no tenant.`);
  process.exit(1);
}
console.log("every row has an owner.");
