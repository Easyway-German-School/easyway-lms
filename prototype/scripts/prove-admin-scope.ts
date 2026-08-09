/**
 * Proves the SESSION side is tenant-scoped, the way the API side is proved by
 * prove-v1-api.mjs.
 *
 * It matters just as much and is harder to check: the admin portal is where
 * every student record actually gets read, and its gate had exactly the same
 * ordering bug the API gate did — the scope was installed after an await and
 * never reached the route. The API failed loudly because its endpoints are new.
 * The admin routes would have failed just as loudly the moment anyone signed
 * in, which is a bad way to find out.
 *
 * It mints a NextAuth session token with the app's own secret rather than
 * driving the sign-in form: this is a test harness against a local server, and
 * a script that types passwords into forms is a script that ends up holding
 * passwords.
 *
 *   npx tsx scripts/prove-admin-scope.ts [baseUrl]
 */

import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import { config as loadEnv } from "dotenv";

/**
 * The app reads .env.local through Next; a bare script does not, so the secret
 * has to be loaded explicitly. .env.local first, because that is where the real
 * values live and .env holds the committed defaults.
 */
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const base = process.argv[2] ?? "http://localhost:3000";
const prisma = new PrismaClient();

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function main() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    console.error("NEXTAUTH_SECRET is not set; cannot mint a session for the test.");
    process.exit(1);
  }

  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", tenantId: { not: null } },
    select: { id: true, email: true, role: true, tenantId: true, adminRole: true },
  });

  if (!admin) {
    console.error("No admin with a tenant. Run scripts/run-tenant-backfill.mjs.");
    process.exit(1);
  }

  console.log(`\nas ${admin.email} (adminRole=${admin.adminRole ?? "none"})\n`);

  const token = await encode({
    secret,
    token: {
      id: admin.id,
      email: admin.email,
      role: admin.role,
      tenantId: admin.tenantId,
      sub: admin.id,
    },
  });

  /**
   * Both cookie names, because which one NextAuth reads depends on whether the
   * site is on https. Sending both means this works against localhost and
   * against a deployment without a flag.
   */
  const cookie = `next-auth.session-token=${token}; __Secure-next-auth.session-token=${token}`;

  async function get(path: string) {
    const response = await fetch(`${base}${path}`, { headers: { cookie } });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 200);
    }
    return { status: response.status, body };
  }

  console.log("admin routes that read tenant-owned tables:");
  const paths = [
    "/api/admin/students",
    "/api/admin/branches",
    "/api/admin/payments",
    "/api/admin/lecturers",
    "/api/admin/classes",
  ];

  for (const path of paths) {
    const result = await get(path);
    /**
     * 404 is fine — not every one of these exists. What must never appear is a
     * 500, because in strict mode that is what an unscoped query looks like.
     */
    const ok = result.status !== 500;
    check(
      path,
      ok,
      `HTTP ${result.status}${ok ? "" : " — check the log for TenantIsolationError"}`,
    );
  }

  console.log("\nand the count matches this tenant, not the whole table:");
  const scopedCount = await prisma.student.count({ where: { tenantId: admin.tenantId } });
  const allCount = await prisma.student.count();
  const students = await get("/api/admin/students");
  const body = students.body as { students?: unknown[]; data?: unknown[] } | null;
  const returned = Array.isArray(body?.students)
    ? body!.students!.length
    : Array.isArray(body?.data)
      ? body!.data!.length
      : null;

  if (returned === null) {
    console.log(`  skip  /api/admin/students did not return a list (HTTP ${students.status})`);
  } else {
    check(
      "never more rows than this tenant owns",
      returned <= scopedCount,
      `${returned} returned, tenant has ${scopedCount}, table has ${allCount}`,
    );
  }

  console.log("\nwithout the cookie:");
  const anon = await fetch(`${base}/api/admin/students`);
  check("refused", anon.status === 401 || anon.status === 403, `HTTP ${anon.status}`);

  await prisma.$disconnect();
  console.log(failures === 0 ? "\nthe admin session path holds." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
