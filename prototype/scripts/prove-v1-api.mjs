/**
 * Calls every /api/v1 endpoint with a real key, from a real second tenant, and
 * checks it cannot see the first tenant's school.
 *
 * This is the question the whole platform rests on: not "does the filter get
 * added" — the unit tests cover that — but "if I hold a valid key for school B
 * and ask for students, do I get school A's students". The only convincing
 * answer is to hold the key and ask.
 *
 * Needs the dev server running.
 *
 *   node scripts/prove-v1-api.mjs [baseUrl]
 */

import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";

const base = process.argv[2] ?? "http://localhost:3000";
const prisma = new PrismaClient();
const SLUG = "v1-proof-school";

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

function generate(environment) {
  const prefix = crypto.randomBytes(4).toString("hex");
  const secret = crypto.randomBytes(32).toString("base64url").replace(/_/g, "-");
  const plaintext = `ewk_${environment}_${prefix}_${secret}`;
  return { plaintext, prefix, keyHash: crypto.createHash("sha256").update(plaintext).digest("hex") };
}

await prisma.tenant.deleteMany({ where: { slug: SLUG } });

const root = await prisma.tenant.findUnique({ where: { slug: "easyway" }, select: { id: true } });
const rootStudents = await prisma.student.count({ where: { tenantId: root.id } });

const tenant = await prisma.tenant.create({
  data: { name: "V1 Proof School", slug: SLUG, status: "active", credit: { create: {} } },
  select: { id: true },
});

/** One student of its own, so "empty" and "isolated" cannot be confused. */
const user = await prisma.user.create({
  data: {
    email: `v1proof-${Date.now()}@example.com`,
    name: "Proof Student",
    password: "not-a-real-hash",
    role: "STUDENT",
    tenantId: tenant.id,
  },
  select: { id: true },
});
const ownStudent = await prisma.student.create({
  data: { userId: user.id, tenantId: tenant.id, level: "B1", studentCode: `PRF${Date.now()}` },
  select: { id: true, studentCode: true },
});

const key = generate("live");
await prisma.apiKey.create({
  data: {
    tenantId: tenant.id,
    name: "v1 proof",
    prefix: key.prefix,
    keyHash: key.keyHash,
    environment: "live",
    scopes: "identity:read,students:read,payments:read,classes:read,attendance:read,usage:read",
  },
});

const noScopes = generate("live");
await prisma.apiKey.create({
  data: {
    tenantId: tenant.id,
    name: "v1 proof, identity only",
    prefix: noScopes.prefix,
    keyHash: noScopes.keyHash,
    environment: "live",
    scopes: "identity:read",
  },
});

async function get(path, token = key.plaintext) {
  const response = await fetch(`${base}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

console.log(`\nthe root school has ${rootStudents} students. the proof school has 1.\n`);

console.log("every endpoint answers:");
for (const path of [
  "/api/v1/me",
  "/api/v1/students",
  "/api/v1/payments",
  "/api/v1/classes",
  "/api/v1/attendance",
  "/api/v1/usage",
]) {
  const result = await get(path);
  check(path, result.status === 200, `HTTP ${result.status}`);
}

console.log("\nand shows only its own school:");
const students = await get("/api/v1/students");
const items = students.body?.data?.items ?? [];
check("returns exactly its own one student", items.length === 1, `${items.length} returned`);
check("and it is the right one", items[0]?.id === ownStudent.id);
check(
  `does not leak the root school's ${rootStudents}`,
  items.length < rootStudents || rootStudents === 0,
  `${items.length} vs ${rootStudents}`,
);

console.log("\nfetching another school's row by id:");
const foreign = await prisma.student.findFirst({
  where: { tenantId: root.id },
  select: { id: true },
});
if (foreign) {
  const attempt = await get(`/api/v1/students/${foreign.id}`);
  check("is a 404, not a record", attempt.status === 404, `HTTP ${attempt.status}`);
} else {
  console.log("  skip  the root school has no students to try");
}

console.log("\nits own record, by student code:");
const byCode = await get(`/api/v1/students/${ownStudent.studentCode}`);
check("resolves", byCode.status === 200, `HTTP ${byCode.status}`);
check("and is the same student", byCode.body?.data?.student?.id === ownStudent.id);

console.log("\nscopes are enforced per endpoint:");
const denied = await get("/api/v1/students", noScopes.plaintext);
check("a key without students:read is refused", denied.status === 403, `HTTP ${denied.status}`);
check(
  "and told which scope it lacks",
  String(denied.body?.error?.message ?? "").includes("students:read"),
  denied.body?.error?.message,
);
const allowed = await get("/api/v1/me", noScopes.plaintext);
check("but still reaches /me", allowed.status === 200, `HTTP ${allowed.status}`);

console.log("\nthe register refuses an unbounded scan:");
const wide = await get("/api/v1/attendance?from=2020-01-01&to=2030-01-01");
check("a ten-year window is a 400", wide.status === 400, `HTTP ${wide.status}`);

console.log("\npaging is cursor-based:");
const page = await get("/api/v1/students?limit=1");
check("returns the envelope", Array.isArray(page.body?.data?.items));
check("and says whether there is more", typeof page.body?.data?.hasMore === "boolean");

await prisma.tenant.deleteMany({ where: { slug: SLUG } });
await prisma.user.deleteMany({ where: { id: user.id } });
await prisma.$disconnect();

console.log(failures === 0 ? "\nthe v1 surface holds." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
