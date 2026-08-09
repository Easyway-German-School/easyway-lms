/**
 * Issues a key the way the console does, then calls the public API with it.
 *
 * The half of this that matters is the second half. Key generation has unit
 * tests; what those cannot tell you is whether a key issued by the console is
 * accepted by the door — the two halves agree on a format, a hash and a scope
 * string, and a format bug between them is invisible until a partner reports
 * that their brand new credential does not work. That happened once already
 * with the underscore in the secret, and roughly half of all issued keys were
 * dead before anyone noticed.
 *
 * Needs the dev server running.
 *
 *   node scripts/prove-api-key.mjs [baseUrl]
 */

import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";

const base = process.argv[2] ?? "http://localhost:3000";
const prisma = new PrismaClient();

/** Same construction as src/lib/api/keys.ts, including the `_` → `-` mapping. */
function generate(environment) {
  const prefix = crypto.randomBytes(4).toString("hex");
  const secret = crypto.randomBytes(32).toString("base64url").replace(/_/g, "-");
  const plaintext = `ewk_${environment}_${prefix}_${secret}`;
  return {
    plaintext,
    prefix,
    keyHash: crypto.createHash("sha256").update(plaintext).digest("hex"),
  };
}

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const SLUG = "key-proof-school";
await prisma.tenant.deleteMany({ where: { slug: SLUG } });

const tenant = await prisma.tenant.create({
  data: { name: "Key Proof School", slug: SLUG, status: "active", credit: { create: {} } },
  select: { id: true, name: true },
});

const good = generate("test");
const key = await prisma.apiKey.create({
  data: {
    tenantId: tenant.id,
    name: "proof",
    prefix: good.prefix,
    keyHash: good.keyHash,
    environment: "test",
    scopes: "identity:read,students:read",
  },
  select: { id: true },
});

async function call(headers) {
  const response = await fetch(`${base}/api/v1/me`, { headers });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

console.log("\na freshly issued key:");
const authorized = await call({ authorization: `Bearer ${good.plaintext}` });
check("is accepted", authorized.status === 200, `HTTP ${authorized.status}`);
check(
  "names its own school and nobody else's",
  authorized.body?.data?.tenant?.name === tenant.name,
  authorized.body?.data?.tenant?.name,
);
check("reports itself as a sandbox key", authorized.body?.data?.sandbox === true);
check(
  "never echoes the secret back",
  !JSON.stringify(authorized.body ?? {}).includes(good.plaintext.split("_")[3]),
);

console.log("\nthe x-api-key header works too:");
const viaHeader = await call({ "x-api-key": good.plaintext });
check("is accepted", viaHeader.status === 200, `HTTP ${viaHeader.status}`);

console.log("\nwhat is refused:");
const none = await call({});
check("no key at all", none.status === 401, `HTTP ${none.status}`);

const wrong = await call({ authorization: `Bearer ${generate("test").plaintext}` });
check("a well-formed key nobody issued", wrong.status === 401, `HTTP ${wrong.status}`);

const junk = await call({ authorization: "Bearer not-a-key" });
check("a malformed key", junk.status === 401, `HTTP ${junk.status}`);

const inQuery = await fetch(`${base}/api/v1/me?apiKey=${good.plaintext}`);
check(
  "a key in the query string, where logs and CDNs would keep it",
  inQuery.status === 401,
  `HTTP ${inQuery.status}`,
);

console.log("\nafter revocation:");
await prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
const revoked = await call({ authorization: `Bearer ${good.plaintext}` });
check("the same key stops working", revoked.status === 401, `HTTP ${revoked.status}`);
check(
  "and is not told why",
  revoked.body?.error?.message === none.body?.error?.message,
  "a distinct message would confirm the key once existed",
);

await prisma.tenant.deleteMany({ where: { slug: SLUG } });
const gone = await prisma.apiKey.findUnique({ where: { id: key.id } });
check("deleting the school took its keys with it", gone === null);

await prisma.$disconnect();
console.log(failures === 0 ? "\nthe key path holds." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
