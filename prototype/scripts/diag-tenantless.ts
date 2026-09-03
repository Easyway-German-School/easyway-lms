import { unguardedPrisma as db } from "../src/lib/prisma";

const j = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x), 2);

async function main() {
  const pid = "cmtlflz8i0031ks04n0q2o4zf";
  const sid = "cmtletiaw002ekw04wzm9wtin";

  const audit: any[] = await db.$queryRaw`
    SELECT id, action, model, "recordId", "actorEmail", "actorRole", source, severity, summary, "at"
    FROM "AuditLog"
    WHERE ("model" = 'Payment' AND "recordId" = ${pid})
       OR ("model" = 'Invoice' AND "recordId" = 'cmtlflz83002xks04hyok0kgy')
       OR ("model" = 'Student' AND "recordId" = ${sid})
    ORDER BY "at" DESC`;
  console.log("=== audit rows for this payment / invoice / student ===");
  console.log(j(audit));

  // scope of the tenant-null problem across tenant-owned tables
  for (const [table, join] of [
    ["Payment", `LEFT JOIN "Student" s ON s.id = t."studentId"`],
    ["Invoice", `LEFT JOIN "Student" s ON s.id = t."studentId"`],
    ["Notification", `LEFT JOIN "Student" s ON s.id = t."studentId"`],
    ["EmailLog", `LEFT JOIN "Student" s ON s.id = t."studentId"`],
    ["Enrollment", `LEFT JOIN "Student" s ON s.id = t."studentId"`],
    ["Attendance", `LEFT JOIN "Student" s ON s.id = t."studentId"`],
    ["Certificate", `LEFT JOIN "Student" s ON s.id = t."studentId"`],
    ["TuitionCharge", `LEFT JOIN "Student" s ON s.id = t."studentId"`],
  ] as const) {
    try {
      const rows: any[] = await db.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS "nullTenant",
                COUNT(*) FILTER (WHERE s."tenantId" IS NOT NULL)::int AS "recoverable"
         FROM "${table}" t ${join}
         WHERE t."tenantId" IS NULL`,
      );
      console.log(`${table.padEnd(16)} tenantId IS NULL: ${rows[0].nullTenant}  (recoverable from student: ${rows[0].recoverable})`);
    } catch (e: any) {
      console.log(`${table.padEnd(16)} skip (${e.message.split("\n")[0]})`);
    }
  }

  // total counts for context
  const totals: any[] = await db.$queryRaw`
    SELECT
      (SELECT COUNT(*)::int FROM "Payment") AS "payments",
      (SELECT COUNT(*)::int FROM "Payment" WHERE "tenantId" IS NULL) AS "paymentsNull",
      (SELECT COUNT(*)::int FROM "Payment" WHERE status IN ('completed','partial')) AS "paymentsReceived",
      (SELECT COUNT(*)::int FROM "Payment" WHERE status IN ('completed','partial') AND "tenantId" IS NULL) AS "paymentsReceivedNull"`;
  console.log("\n=== Payment totals ===");
  console.log(j(totals));

  // RLS check
  const rls: any[] = await db.$queryRaw`
    SELECT relname, relrowsecurity, relforcerowsecurity
    FROM pg_class WHERE relname IN ('Payment','Invoice','Student') AND relkind = 'r'`;
  console.log("\n=== RLS on key tables ===");
  console.log(j(rls));
  const pol: any[] = await db.$queryRaw`SELECT schemaname, tablename, policyname, cmd FROM pg_policies WHERE tablename IN ('Payment','Invoice','Student')`;
  console.log("policies:", j(pol));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
