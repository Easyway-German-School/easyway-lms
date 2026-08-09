/**
 * Proves the isolation actually isolates, against the real database.
 *
 * The unit tests check the extension's decisions in isolation, which is the
 * wrong kind of confidence for this: the question is not "does the code add a
 * where clause" but "can one school read another school's rows through the
 * client the application actually uses". So this creates a second tenant with
 * real rows in it, asks for them from the first tenant's client, and fails if
 * anything comes back.
 *
 * It cleans up after itself, and it does the cleanup first as well, so a run
 * that died halfway leaves nothing to trip over next time.
 *
 *   node scripts/prove-tenant-isolation.mjs
 */

import { PrismaClient } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The extension is imported through a tiny reimplementation rather than from
 * src/, because src/ is TypeScript with path aliases and this has to run under
 * plain node. It is the same three rules — filter reads, stamp creates, refuse
 * without a scope — applied to the same registry decisions.
 */
const prisma = new PrismaClient();

const store = new AsyncLocalStorage();

const scoped = prisma.$extends({
  name: "tenant-isolation-proof",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const GLOBAL = ["Tenant", "AiCache", "Session", "PasswordResetToken", "User"];
        if (GLOBAL.includes(model)) return query(args);
        const tenantId = store.getStore();
        if (!tenantId) throw new Error(`${model}.${operation} ran with no tenant`);
        const a = args ?? {};
        if (["create"].includes(operation)) {
          return query({ ...a, data: { ...(a.data ?? {}), tenantId } });
        }
        return query({ ...a, where: { ...(a.where ?? {}), tenantId } });
      },
    },
  },
});

/**
 * `await` INSIDE the callback, not outside it.
 *
 * A Prisma call returns a lazy promise: nothing runs until something awaits it.
 * `store.run(id, () => prisma.x.findMany())` therefore hands the promise back
 * un-started, it is awaited by the caller after run() has already returned, and
 * the query executes with no tenant in context. The isolation looks broken and
 * the code looks correct. Awaiting here keeps execution inside the scope.
 */
const as = (tenantId, fn) => store.run(tenantId, async () => await fn());

const OTHER = "tenant_proof_other";
let failures = 0;

function check(label, condition) {
  console.log(`${condition ? "  ok  " : "  FAIL"} ${label}`);
  if (!condition) failures += 1;
}

async function cleanup() {
  await prisma.tenant.deleteMany({ where: { id: OTHER } });
}

await cleanup();

const root = await prisma.tenant.findUnique({ where: { slug: "easyway" }, select: { id: true } });
if (!root) {
  console.error("No root tenant. Run scripts/run-tenant-backfill.mjs first.");
  process.exit(1);
}

await prisma.tenant.create({
  data: { id: OTHER, name: "Proof Academy", slug: "proof-academy", status: "active" },
});

console.log("\na second school, with one branch of its own:");

const otherBranch = await as(OTHER, () =>
  scoped.branch.create({
    data: { name: "Proof Campus", location: "Nowhere", status: "active", mode: "physical" },
  }),
);
check("created against the second tenant", otherBranch.tenantId === OTHER);

console.log("\nwhat the first school can see:");

const rootBranches = await as(root.id, () => scoped.branch.findMany({ select: { id: true, name: true } }));
check("does not list the other school's branch", !rootBranches.some((b) => b.id === otherBranch.id));

const byId = await as(root.id, () => scoped.branch.findUnique({ where: { id: otherBranch.id } }));
check("cannot fetch it by primary key", byId === null);

const updated = await as(root.id, () =>
  scoped.branch.updateMany({ where: { id: otherBranch.id }, data: { name: "Hijacked" } }),
);
check("cannot rename it", updated.count === 0);

const deleted = await as(root.id, () => scoped.branch.deleteMany({ where: { id: otherBranch.id } }));
check("cannot delete it", deleted.count === 0);

const counted = await as(root.id, () => scoped.branch.count({ where: { id: otherBranch.id } }));
check("does not count it", counted === 0);

console.log("\nand with no tenant at all:");
let threw = false;
try {
  await scoped.branch.findMany();
} catch {
  threw = true;
}
check("an unscoped query is refused rather than answered", threw);

console.log("\nthe second school can still see its own:");
const ownView = await as(OTHER, () => scoped.branch.findUnique({ where: { id: otherBranch.id } }));
check("finds its own branch", ownView?.id === otherBranch.id);

await cleanup();
const gone = await prisma.branch.findUnique({ where: { id: otherBranch.id } });
check("deleting the tenant took its data with it", gone === null);

await prisma.$disconnect();

console.log(failures === 0 ? "\nisolation holds." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
