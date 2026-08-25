/**
 * Proves the per-tenant feature registry against the real database.
 *
 * The unit tests in features.test.ts check `parseFeatures` in isolation,
 * which answers "does the merge logic work" but not "does a tenant with no
 * SchoolSetting row actually get EasyWay's own behaviour back" — the one
 * assertion that matters most here, since it is the regression test for
 * "this wave changed nothing for the tenant that already exists".
 *
 *   npx tsx scripts/prove-tenant-features.ts
 */

import { PrismaClient } from "@prisma/client";
import { DEFAULT_FEATURES, FEATURES_KEY } from "../src/lib/tenant/features";
import { featuresFor, forgetFeatures } from "../src/lib/tenant/features-server";

const prisma = new PrismaClient();
const SLUG_A = "features-proof-school-a";
const SLUG_B = "features-proof-school-b";

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function cleanup() {
  await prisma.tenant.deleteMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
}

async function main() {
  await cleanup();

  const tenantA = await prisma.tenant.create({
    data: { name: "Features Proof School A", slug: SLUG_A, status: "active" },
    select: { id: true },
  });
  const tenantB = await prisma.tenant.create({
    data: { name: "Features Proof School B", slug: SLUG_B, status: "active" },
    select: { id: true },
  });

  console.log("\na brand-new tenant, no SchoolSetting row at all:");
  const bare = await featuresFor(tenantA.id);
  check(
    "resolves to exactly EasyWay's own defaults",
    JSON.stringify(bare) === JSON.stringify(DEFAULT_FEATURES),
    JSON.stringify(bare),
  );

  console.log("\na partial override:");
  await prisma.schoolSetting.create({
    data: {
      tenantId: tenantA.id,
      key: FEATURES_KEY,
      value: { games: { onlineCohortRequiresLiveClass: false } },
    },
  });
  forgetFeatures();
  const overridden = await featuresFor(tenantA.id);
  check("flips the touched flag", overridden.games.onlineCohortRequiresLiveClass === false);
  check(
    "leaves the untouched sibling at its default",
    JSON.stringify(overridden.examCentre) === JSON.stringify(DEFAULT_FEATURES.examCentre),
  );

  console.log("\na garbage stored value:");
  await prisma.schoolSetting.update({
    where: { tenantId_key: { tenantId: tenantA.id, key: FEATURES_KEY } },
    data: { value: "not an object" },
  });
  forgetFeatures();
  const degraded = await featuresFor(tenantA.id);
  check(
    "degrades to the full defaults rather than throwing",
    JSON.stringify(degraded) === JSON.stringify(DEFAULT_FEATURES),
    JSON.stringify(degraded),
  );

  console.log("\ntenant B, never touched:");
  const bTenantFeatures = await featuresFor(tenantB.id);
  check(
    "is invisible to tenant A's override — B still reads pure defaults",
    JSON.stringify(bTenantFeatures) === JSON.stringify(DEFAULT_FEATURES),
  );

  console.log("\ndeleting the tenant:");
  await prisma.tenant.delete({ where: { id: tenantA.id } });
  const orphanRow = await prisma.schoolSetting.findFirst({
    where: { tenantId: tenantA.id, key: FEATURES_KEY },
  });
  check("cascades the SchoolSetting row away with it", orphanRow === null);

  await cleanup();
  await prisma.$disconnect();
  console.log(failures === 0 ? "\nthe feature registry holds." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
