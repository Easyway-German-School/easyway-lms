import { unguardedPrisma as db } from "../src/lib/prisma";

/**
 * Backfill `tenantId` on tenant-owned rows that were written with none.
 *
 * Root cause: sessionless write paths — chiefly the Paystack webhook, which
 * runs `withUnscoped` — give the tenant-isolation extension no tenant in
 * context, so it passes their INSERTs straight through unstamped. Older rows
 * predate the isolation layer entirely. Either way the row then vanishes from
 * every tenant-scoped read: a fully-paid student shows "nothing paid" on her
 * dossier (a top-level `payment.findMany`, scoped) while the roster still
 * counts the payment (a nested `student.include.payments`, which the extension
 * never filters). See scripts/diag-tenantless.ts.
 *
 * Strategy: derive the owner from the row's own user/student link. Anything
 * still NULL afterwards, on a single-tenant database, belongs to the one
 * tenant that exists. Platform operators (`platformRole` set) are left alone —
 * they sit above tenants on purpose.
 *
 *   dry run:  tsx --env-file=.env.local scripts/backfill-tenantless-rows.ts
 *   apply:    tsx --env-file=.env.local scripts/backfill-tenantless-rows.ts --apply
 */

const APPLY = process.argv.includes("--apply");

const VIA_STUDENT = (table: string) => `
  UPDATE "${table}" t SET "tenantId" = s."tenantId"
  FROM "Student" s
  WHERE t."studentId" = s.id AND t."tenantId" IS NULL AND s."tenantId" IS NOT NULL`;

const VIA_USER = (table: string) => `
  UPDATE "${table}" t SET "tenantId" = u."tenantId"
  FROM "User" u
  WHERE t."userId" = u.id AND t."tenantId" IS NULL AND u."tenantId" IS NOT NULL`;

// Ordered: owners first, then rows that derive from them.
const STEPS: Array<{ label: string; sql: string }> = [
  { label: "Student      <- User",     sql: VIA_USER("Student") },
  { label: "Lecturer     <- User",     sql: VIA_USER("Lecturer") },
  { label: "Payment      <- Student",  sql: VIA_STUDENT("Payment") },
  { label: "Invoice      <- Student",  sql: VIA_STUDENT("Invoice") },
  { label: "Enrollment   <- Student",  sql: VIA_STUDENT("Enrollment") },
  { label: "Notification <- Student",  sql: VIA_STUDENT("Notification") },
  { label: "EmailLog     <- Student",  sql: VIA_STUDENT("EmailLog") },
  { label: "JourneyEvent <- Student",  sql: VIA_STUDENT("JourneyEvent") },
  {
    label: "Payment      <- Invoice (student-less rows)",
    sql: `UPDATE "Payment" t SET "tenantId" = i."tenantId"
          FROM "Invoice" i
          WHERE t."invoiceId" = i.id AND t."tenantId" IS NULL AND i."tenantId" IS NOT NULL`,
  },
];

// If NULLs remain on a single-tenant DB they belong to the one tenant.
// `User` excludes platform operators; everything else is unconditional.
const SWEEP: Array<{ table: string; extra?: string }> = [
  { table: "User", extra: `AND "platformRole" IS NULL` },
  { table: "Student" },
  { table: "Lecturer" },
  { table: "Payment" },
  { table: "Invoice" },
  { table: "Enrollment" },
  { table: "Notification" },
  { table: "EmailLog" },
  { table: "JourneyEvent" },
];

const REPORT_TABLES = [
  "User", "Student", "Lecturer", "Payment", "Invoice",
  "Enrollment", "Notification", "EmailLog", "JourneyEvent",
];

async function countNull(table: string): Promise<number> {
  const r: any[] = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "${table}" WHERE "tenantId" IS NULL`,
  );
  return r[0].n;
}

async function main() {
  const tenants: any[] = await db.$queryRaw`SELECT id, slug FROM "Tenant"`;
  console.log(`mode: ${APPLY ? "APPLY" : "DRY RUN"}   tenants: ${tenants.map((t) => t.slug).join(", ") || "(none)"}\n`);

  console.log("BEFORE  (tenantId IS NULL):");
  for (const t of REPORT_TABLES) console.log(`  ${t.padEnd(13)} ${await countNull(t)}`);
  console.log();

  await db
    .$transaction(async (tx) => {
      for (const step of STEPS) {
        const n = await tx.$executeRawUnsafe(step.sql);
        console.log(`  ${APPLY ? "updated" : "would update"} ${String(n).padStart(4)}  ${step.label}`);
      }

      if (tenants.length === 1) {
        const only = tenants[0].id;
        console.log(`\n  single tenant -> sweeping remaining NULLs to "${tenants[0].slug}"`);
        for (const { table, extra } of SWEEP) {
          const n = await tx.$executeRawUnsafe(
            `UPDATE "${table}" SET "tenantId" = $1 WHERE "tenantId" IS NULL ${extra ?? ""}`,
            only,
          );
          if (n > 0) console.log(`  ${APPLY ? "updated" : "would update"} ${String(n).padStart(4)}  ${table} -> sole tenant`);
        }
      } else {
        console.log(`\n  ${tenants.length} tenants — skipping sole-tenant sweep; investigate leftovers by hand`);
      }

      if (!APPLY) throw new Error("__ROLLBACK_DRY_RUN__");
    }, { timeout: 120_000, maxWait: 20_000 })
    .catch((e) => {
      if (e instanceof Error && e.message.includes("__ROLLBACK_DRY_RUN__")) return;
      throw e;
    });

  console.log("\nAFTER  (tenantId IS NULL):");
  for (const t of REPORT_TABLES) console.log(`  ${t.padEnd(13)} ${await countNull(t)}`);
  if (!APPLY) console.log("\n(dry run — nothing was written; re-run with --apply)");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
