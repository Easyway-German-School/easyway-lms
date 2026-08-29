import { guardedPrisma } from "@/lib/prisma";
import { currentTenantId } from "@/lib/tenant/context";
import { METERS, PLACEHOLDER_RATES_KOBO, costKobo, meterKey, type MeterName } from "@/lib/usage/meter";
import { forgetCredit } from "@/lib/usage/guard";

/**
 * Writing down what a school used.
 *
 * Three properties this has to have, and each of them is a decision that is
 * expensive to change later:
 *
 *  1. **It never breaks the thing it is measuring.** A failed usage write must
 *     not fail the lesson, the email or the API call it was measuring. Billing
 *     that can take the product down is worse than billing that occasionally
 *     under-counts, and under-counting is recoverable from the source events.
 *  2. **It is idempotent, from the source event.** Webhooks retry and jobs
 *     re-run. The key is derived from what happened, never from a clock or a
 *     random value, so the second delivery of the same fact is rejected as the
 *     duplicate it is. Double-billing is the one class of bug that ends a
 *     platform's reputation in a single incident.
 *  3. **It is append-only.** Corrections are new rows with negative quantities.
 *     A ledger you can edit is not evidence, and the first billing dispute is
 *     the moment that stops being philosophical.
 */

/**
 * `BigInt(0)` rather than the `0n` literal: this project targets ES2017, and
 * BigInt literals need ES2020. The values are still real BigInts — only the way
 * of writing zero changes.
 */
const ZERO = BigInt(0);

export type RecordInput = {
  meter: MeterName;
  quantity: number;
  /**
   * Identifies the SOURCE EVENT, not the recording of it. `aicache:<rowId>`,
   * `livekit:<sessionId>:<identity>`, `email:<messageId>`. Replaying that event
   * a year from now must produce this same string.
   */
  sourceId: string;
  /** Defaults to the tenant in context. Pass explicitly from jobs. */
  tenantId?: string;
  /** When it happened, if that is not now. */
  occurredAt?: Date;
  metadata?: Record<string, unknown>;
};

/**
 * Record one billable event. Never throws.
 *
 * Returns what happened so a caller that cares can log it, and so tests can
 * tell "recorded" from "already had it" — which is the difference between
 * idempotency working and the write silently failing.
 */
export async function recordUsage(
  input: RecordInput,
): Promise<{ recorded: boolean; reason?: string }> {
  try {
    const tenantId = input.tenantId ?? currentTenantId();
    if (!tenantId) {
      /**
       * No tenant means nobody to bill. Not an error — the sign-in page and the
       * certificate verifier legitimately do metered-looking work for no
       * customer — but worth returning honestly rather than silently dropping.
       */
      return { recorded: false, reason: "no tenant in context" };
    }

    if (!METERS[input.meter]) {
      return { recorded: false, reason: `unknown meter ${input.meter}` };
    }

    const quantity = Math.round(Number(input.quantity));
    if (!Number.isFinite(quantity) || quantity === 0) {
      return { recorded: false, reason: "nothing to record" };
    }

    await guardedPrisma.usageEvent.create({
      data: {
        tenantId,
        meter: input.meter,
        quantity,
        idempotencyKey: meterKey(input.meter, input.sourceId),
        occurredAt: input.occurredAt ?? new Date(),
        metadata: (input.metadata ?? undefined) as never,
      },
    });

    return { recorded: true };
  } catch (error) {
    /**
     * A duplicate is the system working, not a failure — so it is reported as
     * such rather than logged as an error somebody has to investigate at 3am.
     */
    if (typeof error === "object" && error && (error as { code?: string }).code === "P2002") {
      return { recorded: false, reason: "already recorded" };
    }
    console.warn("[usage] could not record", input.meter, input.sourceId, error);
    return { recorded: false, reason: "write failed" };
  }
}

/**
 * Fold yesterday's events into the daily rollup, and debit the balance.
 *
 * Invoices never scan the raw ledger. At a million events a month that is a
 * table scan per tenant per invoice, and the finance page would be the slowest
 * thing in the product.
 *
 * The rounding lives here rather than in recordUsage for a reason worth
 * keeping: rounding each event up turns a thousand one-token calls into a
 * thousand roundings, and a customer billed a hundred times what they used is
 * entirely right to be angry. The ceiling belongs once per day per meter.
 */
export async function rollUpUsage(day?: Date): Promise<{
  day: string;
  tenants: number;
  rows: number;
  debitedKobo: number;
}> {
  const target = day ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const start = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const grouped = await guardedPrisma.usageEvent.groupBy({
    by: ["tenantId", "meter"],
    where: { occurredAt: { gte: start, lt: end } },
    _sum: { quantity: true },
  });

  const tenants = new Set<string>();
  let rows = 0;
  let debitedKobo = 0;

  for (const group of grouped) {
    const quantity = group._sum.quantity ?? 0;
    if (quantity === 0) continue;

    const meter = group.meter as MeterName;
    if (!METERS[meter]) continue;

    const cost = costKobo(meter, quantity);

    /**
     * Upsert, so a re-run restates the day rather than adding to it. The
     * rollup has to be safe to run twice — a cron that fires late and then
     * catches up is normal, and a rollup that double-counts on retry would
     * bill twice for work that happened once.
     */
    await guardedPrisma.usageDaily.upsert({
      where: { tenantId_meter_day: { tenantId: group.tenantId, meter, day: start } },
      create: { tenantId: group.tenantId, meter, day: start, quantity, costKobo: cost },
      update: { quantity, costKobo: cost },
    });

    tenants.add(group.tenantId);
    rows += 1;
    debitedKobo += cost;
  }

  /**
   * The balance moves once per tenant per day, against the day's total, with
   * the day as the idempotency key. Same reasoning as the rollup: a re-run
   * must not debit twice.
   */
  for (const tenantId of tenants) {
    const dayTotal = await guardedPrisma.usageDaily.aggregate({
      where: { tenantId, day: start },
      _sum: { costKobo: true },
    });
    const amount = BigInt(dayTotal._sum.costKobo ?? 0);
    if (amount === ZERO) continue;

    await debitCredit({
      tenantId,
      amountKobo: amount,
      reference: start.toISOString().slice(0, 10),
      note: `Usage for ${start.toISOString().slice(0, 10)}`,
    });
  }

  return { day: start.toISOString().slice(0, 10), tenants: tenants.size, rows, debitedKobo };
}

/**
 * Move the balance, and record why.
 *
 * The balance column is a cached total; CreditTransaction is the thing it must
 * always agree with. Without the ledger, "why is my balance ₦40,000 when I
 * topped up ₦50,000" has no answer, and a billing question with no answer is a
 * refund.
 *
 * Both writes happen in one transaction for the obvious reason: a balance that
 * moved without a line explaining it is exactly the state that cannot be
 * reconciled afterwards.
 */
export async function debitCredit(input: {
  tenantId: string;
  amountKobo: bigint;
  reference: string;
  note?: string;
}): Promise<{ applied: boolean; balanceKobo: bigint }> {
  return applyCredit({ ...input, kind: "usage", signedAmountKobo: -input.amountKobo });
}

export async function creditTenant(input: {
  tenantId: string;
  amountKobo: bigint;
  reference: string;
  kind?: "topup" | "adjustment" | "refund";
  note?: string;
}): Promise<{ applied: boolean; balanceKobo: bigint }> {
  return applyCredit({
    ...input,
    kind: input.kind ?? "topup",
    signedAmountKobo: input.amountKobo,
  });
}

async function applyCredit(input: {
  tenantId: string;
  signedAmountKobo: bigint;
  kind: string;
  reference: string;
  note?: string;
}): Promise<{ applied: boolean; balanceKobo: bigint }> {
  const idempotencyKey = `${input.kind}:${input.tenantId}:${input.reference}`;

  return guardedPrisma.$transaction(async (tx) => {
    const existing = await tx.creditTransaction.findUnique({
      where: { idempotencyKey },
      select: { balanceAfterKobo: true },
    });
    if (existing) {
      // Already applied. Returning the balance it produced rather than the
      // current one would be a lie; returning "not applied" plus the truth is
      // what a caller retrying after a timeout needs to hear.
      const credit = await tx.tenantCredit.findUnique({
        where: { tenantId: input.tenantId },
        select: { balanceKobo: true },
      });
      return { applied: false, balanceKobo: credit?.balanceKobo ?? ZERO };
    }

    const credit = await tx.tenantCredit.upsert({
      where: { tenantId: input.tenantId },
      create: { tenantId: input.tenantId, balanceKobo: input.signedAmountKobo },
      update: { balanceKobo: { increment: input.signedAmountKobo } },
      select: { balanceKobo: true },
    });

    await tx.creditTransaction.create({
      data: {
        tenantId: input.tenantId,
        kind: input.kind,
        amountKobo: input.signedAmountKobo,
        balanceAfterKobo: credit.balanceKobo,
        reference: input.reference,
        idempotencyKey,
        note: input.note ?? null,
      },
    });

    /**
     * A top-up clears the low-balance flag so the next dip warns again. Without
     * this, a school that runs low, tops up and runs low again gets no second
     * warning — which is the case where the warning matters most.
     */
    if (input.signedAmountKobo > ZERO) {
      await tx.tenantCredit.update({
        where: { tenantId: input.tenantId },
        data: { lowBalanceNotifiedAt: null },
      });
    }

    return { applied: true, balanceKobo: credit.balanceKobo };
  }).then((result) => {
    // The balance just moved — in either direction — so the credit-block
    // cache in usage/guard.ts must not keep answering from before the write.
    // Cheapest correct thing: drop it and let the next check re-read.
    forgetCredit(input.tenantId);
    return result;
  });
}

/** What a tenant would be charged for a quantity, at today's rates. */
export function quote(meter: MeterName, quantity: number): number {
  return costKobo(meter, quantity);
}

/**
 * Warn the schools whose credit is running out, once per dip.
 *
 * Not "cut them off". A school losing its register mid-term over a transfer
 * that has not cleared is a worse failure than carrying them for a few days,
 * and a platform that stops a lesson to chase an invoice is one nobody
 * recommends. The warning fires while there is still time to act; the grace
 * allowance covers the gap after that.
 *
 * `lowBalanceNotifiedAt` is what makes it once per dip rather than once per
 * tick. It is cleared on top-up, so a school that runs low, pays, and runs low
 * again is warned both times — which is the case where the warning matters
 * most, and the one a simple "already warned" flag would miss.
 */
export async function warnLowBalances(): Promise<{ checked: number; warned: string[] }> {
  const { emitWebhook } = await import("@/lib/webhooks");
  const { notify } = await import("@/lib/notify");

  const credits = await guardedPrisma.tenantCredit.findMany({
    where: { lowBalanceNotifiedAt: null },
    select: {
      tenantId: true,
      balanceKobo: true,
      lowBalanceKobo: true,
      tenant: { select: { name: true } },
    },
  });

  const warned: string[] = [];

  for (const credit of credits) {
    if (credit.balanceKobo > credit.lowBalanceKobo) continue;

    const naira = (Number(credit.balanceKobo) / 100).toLocaleString("en-NG", {
      style: "currency",
      currency: "NGN",
      maximumFractionDigits: 0,
    });

    await emitWebhook(
      "credit.low",
      { balanceKobo: credit.balanceKobo.toString(), threshold: credit.lowBalanceKobo.toString() },
      { tenantId: credit.tenantId },
    );

    await runWithTenantId(credit.tenantId, async () => {
      await notify({
        to: { audience: "admin", capability: "payments" },
        title: "Platform credit is running low",
        message:
          `The balance is ${naira}. Top up from Platform billing to keep AI drafting, live classes ` +
          `and email running. Nothing stops immediately — this is a heads-up, not a cut-off.`,
        kind: "billing-low-balance",
        severity: "warning",
        link: "/admin/billing",
        dedupeKey: `low-balance:${credit.tenantId}:${new Date().toISOString().slice(0, 10)}`,
      });
    });

    await guardedPrisma.tenantCredit.update({
      where: { tenantId: credit.tenantId },
      data: { lowBalanceNotifiedAt: new Date() },
    });

    warned.push(credit.tenant?.name ?? credit.tenantId);
  }

  return { checked: credits.length, warned };
}

/**
 * notify() fans out to the tenant's own admins, so it has to run inside that
 * tenant's scope — this job spans every tenant and therefore has none of its
 * own. Imported lazily to keep the context module out of this file's import
 * cycle with prisma.
 */
async function runWithTenantId<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  const { runWithTenant } = await import("@/lib/tenant/context");
  return runWithTenant(tenantId, fn);
}

export { METERS, PLACEHOLDER_RATES_KOBO };
