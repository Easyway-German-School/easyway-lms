/**
 * Runs the billing path against the real database, with a throwaway school.
 *
 * The questions worth answering here cannot be answered by unit tests, because
 * they are all about what happens on the second attempt: a webhook that
 * delivers twice, a cron that fires twice, a top-up confirmed twice. Every one
 * of those has a correct answer that is "nothing changes", and the only way to
 * know it holds is to do it twice against a real ledger.
 *
 *   npx tsx scripts/prove-billing.ts
 */

import { PrismaClient } from "@prisma/client";
import { recordUsage, rollUpUsage, creditTenant } from "../src/lib/usage/record";
import { costKobo } from "../src/lib/usage/meter";

const prisma = new PrismaClient();
const SLUG = "billing-proof-school";
const ZERO = BigInt(0);

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

/**
 * Wrapped in a function because tsx compiles this to CommonJS, where
 * top-level await is not available.
 */
async function main() {
  await prisma.tenant.deleteMany({ where: { slug: SLUG } });
  const tenant = await prisma.tenant.create({
    data: { name: "Billing Proof School", slug: SLUG, status: "active", credit: { create: {} } },
    select: { id: true },
  });

  /** Yesterday, because that is the day the rollup folds. */
  const when = new Date(Date.now() - 24 * 60 * 60 * 1000);

  console.log("\nrecording what the school used:");

  const first = await recordUsage({
    tenantId: tenant.id,
    meter: "ai.tokens",
    quantity: 4000,
    sourceId: "claude:msg_proof_1",
    occurredAt: when,
  });
  check("a billable event is recorded", first.recorded);

  const again = await recordUsage({
    tenantId: tenant.id,
    meter: "ai.tokens",
    quantity: 4000,
    sourceId: "claude:msg_proof_1",
    occurredAt: when,
  });
  check("the same event delivered twice is not billed twice", !again.recorded, again.reason);

  await recordUsage({
    tenantId: tenant.id,
    meter: "email.sent",
    quantity: 1,
    sourceId: "emaillog:proof_1",
    occurredAt: when,
  });

  console.log("\nrefusals:");
  const noTenant = await recordUsage({
    meter: "ai.tokens",
    quantity: 10,
    sourceId: "claude:msg_proof_orphan",
    occurredAt: when,
  });
  check("usage with nobody to bill is not invented", !noTenant.recorded, noTenant.reason);

  const zero = await recordUsage({
    tenantId: tenant.id,
    meter: "ai.tokens",
    quantity: 0,
    sourceId: "claude:msg_proof_zero",
    occurredAt: when,
  });
  check("a zero-quantity event writes no row", !zero.recorded, zero.reason);

  console.log("\nthe nightly rollup:");
  const rollup = await rollUpUsage(when);
  check("folds both meters", rollup.rows === 2, `${rollup.rows} row(s)`);

  const expected = costKobo("ai.tokens", 4000) + costKobo("email.sent", 1);
  check("costs what the rate card says", rollup.debitedKobo === expected, `${rollup.debitedKobo} vs ${expected} kobo`);

  const afterFirst = await prisma.tenantCredit.findUnique({
    where: { tenantId: tenant.id },
    select: { balanceKobo: true },
  });
  check(
    "debits the balance, into the negative on a school that has not paid yet",
    afterFirst?.balanceKobo === BigInt(-expected),
    String(afterFirst?.balanceKobo),
  );

  console.log("\nand run again, as a late cron would:");
  await rollUpUsage(when);
  const afterSecond = await prisma.tenantCredit.findUnique({
    where: { tenantId: tenant.id },
    select: { balanceKobo: true },
  });
  check(
    "the balance does not move a second time",
    afterSecond?.balanceKobo === afterFirst?.balanceKobo,
    String(afterSecond?.balanceKobo),
  );

  const dailyRows = await prisma.usageDaily.count({ where: { tenantId: tenant.id } });
  check("and the rollup restates rather than duplicates", dailyRows === 2, `${dailyRows} row(s)`);

  console.log("\na top-up:");
  const topup = await creditTenant({
    tenantId: tenant.id,
    amountKobo: BigInt(5_000_00),
    reference: "paystack_proof_ref_1",
    note: "Proof top-up",
  });
  check("is applied", topup.applied);
  check(
    "and lands on top of what was owed",
    topup.balanceKobo === BigInt(5_000_00) - BigInt(expected),
    String(topup.balanceKobo),
  );

  const replay = await creditTenant({
    tenantId: tenant.id,
    amountKobo: BigInt(5_000_00),
    reference: "paystack_proof_ref_1",
  });
  check("the same payment confirmed twice credits once", !replay.applied);

  console.log("\nthe statement:");
  const statement = await prisma.creditTransaction.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "asc" },
    select: { kind: true, amountKobo: true, balanceAfterKobo: true },
  });
  check("has a line for every movement", statement.length === 2, `${statement.length} line(s)`);
  const summed = statement.reduce((total, row) => total + row.amountKobo, ZERO);
  check(
    "and the lines add up to the balance",
    summed === statement[statement.length - 1]?.balanceAfterKobo,
    `${summed}`,
  );

  await prisma.tenant.deleteMany({ where: { slug: SLUG } });
  const orphans = await prisma.usageEvent.count({ where: { tenantId: tenant.id } });
  check("closing the account takes its ledger with it", orphans === 0);

  await prisma.$disconnect();
  console.log(failures === 0 ? "\nthe billing path holds." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);

}

main();
