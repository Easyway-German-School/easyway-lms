import { guardedPrisma } from "@/lib/prisma";

/**
 * Whether a tenant's platform credit has actually run out.
 *
 * Deliberately its own file, not folded into usage/record.ts. `recordUsage`
 * there states its own contract plainly — "it never breaks the thing it is
 * measuring" — and is called `void`-style (fire-and-forget) from four places
 * that have no way to act on a refusal even if one were thrown. A block has
 * to live at the door a request walks through, not at the meter behind it.
 *
 * `TenantCredit.balanceKobo`/`graceKobo` have been tracked since the billing
 * layer landed, but nothing has ever refused a request over them — confirmed
 * by grepping usage/record.ts for any check before this file existed.
 */

export type CreditBlock = { balanceKobo: string; graceKobo: string };

/**
 * Cached briefly per tenant. The balance moves once a day from the rollup
 * plus the occasional top-up — not on every request — so this is read far
 * more often than it changes.
 */
const cache = new Map<string, { blocked: CreditBlock | false; at: number }>();
const TTL_MS = 30_000;

export function forgetCredit(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

/**
 * `false` when the tenant may proceed, otherwise the numbers that explain why
 * not.
 *
 * Refuses at `balanceKobo + graceKobo < 0` — strictly less-than. A freshly
 * onboarded tenant has both columns at their schema default of zero, and
 * `<= 0` would block every new customer's very first request. `graceKobo` is
 * "how far past zero this tenant may go before metered work is refused" per
 * its own schema comment, so the boundary has to be the point where even that
 * allowance is exhausted, not the point where it starts being used.
 */
export async function creditBlocked(tenantId: string): Promise<false | CreditBlock> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.blocked;

  const credit = await guardedPrisma.tenantCredit.findUnique({
    where: { tenantId },
    select: { balanceKobo: true, graceKobo: true },
  });

  // No credit row at all reads the same as a fresh 0/0 row — not blocked.
  const balanceKobo = credit?.balanceKobo ?? BigInt(0);
  const graceKobo = credit?.graceKobo ?? BigInt(0);

  const blocked: CreditBlock | false =
    balanceKobo + graceKobo < BigInt(0)
      ? { balanceKobo: balanceKobo.toString(), graceKobo: graceKobo.toString() }
      : false;

  cache.set(tenantId, { blocked, at: Date.now() });
  return blocked;
}
