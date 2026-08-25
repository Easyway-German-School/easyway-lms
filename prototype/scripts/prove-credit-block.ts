/**
 * Proves the API credit-block guard against the real database.
 *
 * The one boundary condition worth getting wrong here is the sign: a fresh
 * tenant sits at balanceKobo=0, graceKobo=0 (schema defaults), so the refusal
 * has to trigger on strictly-negative headroom, not on zero-or-less — `<= 0`
 * would lock out every newly onboarded school on their very first request.
 *
 *   npx tsx scripts/prove-credit-block.ts
 */

import { PrismaClient } from "@prisma/client";
import { creditBlocked, forgetCredit } from "../src/lib/usage/guard";

const prisma = new PrismaClient();
const SLUG = "credit-block-proof-school";

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function main() {
  await prisma.tenant.deleteMany({ where: { slug: SLUG } });
  const tenant = await prisma.tenant.create({
    data: { name: "Credit Block Proof School", slug: SLUG, status: "active", credit: { create: {} } },
    select: { id: true },
  });

  console.log("\na freshly onboarded school (0 balance, 0 grace):");
  let blocked = await creditBlocked(tenant.id);
  check("is NOT blocked", blocked === false, JSON.stringify(blocked));

  console.log("\none kobo past zero, with no grace:");
  await prisma.tenantCredit.update({ where: { tenantId: tenant.id }, data: { balanceKobo: BigInt(-1) } });
  forgetCredit(tenant.id);
  blocked = await creditBlocked(tenant.id);
  check("IS blocked", blocked !== false, JSON.stringify(blocked));

  console.log("\nthe same balance, but with grace to cover it:");
  await prisma.tenantCredit.update({ where: { tenantId: tenant.id }, data: { graceKobo: BigInt(100) } });
  forgetCredit(tenant.id);
  blocked = await creditBlocked(tenant.id);
  check("is NOT blocked — the grace allowance covers it", blocked === false, JSON.stringify(blocked));

  console.log("\nexactly exhausting the grace:");
  await prisma.tenantCredit.update({
    where: { tenantId: tenant.id },
    data: { balanceKobo: BigInt(-100), graceKobo: BigInt(100) },
  });
  forgetCredit(tenant.id);
  blocked = await creditBlocked(tenant.id);
  check(
    "balance + grace == 0 is NOT blocked (strictly less-than, not less-or-equal)",
    blocked === false,
    JSON.stringify(blocked),
  );

  console.log("\none kobo past the grace:");
  await prisma.tenantCredit.update({ where: { tenantId: tenant.id }, data: { balanceKobo: BigInt(-101) } });
  forgetCredit(tenant.id);
  blocked = await creditBlocked(tenant.id);
  check("IS blocked", blocked !== false, JSON.stringify(blocked));

  console.log("\na top-up, applied directly to the row:");
  await prisma.tenantCredit.update({ where: { tenantId: tenant.id }, data: { balanceKobo: BigInt(5_000_00) } });
  console.log("  (before forgetCredit — the 30s cache should still say blocked)");
  const stillCached = await creditBlocked(tenant.id);
  check("the cache holds the stale answer until invalidated", stillCached !== false);
  forgetCredit(tenant.id);
  blocked = await creditBlocked(tenant.id);
  check("and clears once the cache is dropped", blocked === false, JSON.stringify(blocked));

  await prisma.tenant.deleteMany({ where: { slug: SLUG } });
  await prisma.$disconnect();
  console.log(failures === 0 ? "\nthe credit guard holds." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
