import { NextResponse } from "next/server";
import { guardedPrisma } from "@/lib/prisma";
import { currentTenantId } from "@/lib/tenant/context";
import { billingSettingsFor } from "@/lib/usage/billing-settings";

/**
 * Whether a tenant's platform credit has actually run out AND an operator has
 * turned enforcement on for that school.
 *
 * Deliberately its own file, not folded into usage/record.ts. `recordUsage`
 * there states its own contract plainly — "it never breaks the thing it is
 * measuring" — and is called `void`-style (fire-and-forget) from four places
 * that have no way to act on a refusal even if one were thrown. A block has
 * to live at the door a request walks through, not at the meter behind it.
 *
 * ENFORCEMENT IS OPT-IN, PER TENANT, DEFAULT OFF. A negative balance alone is
 * only ever a warning. It blocks only once an operator sets `enforce` in the
 * console (see usage/billing-settings.ts) — which is what keeps a bookkeeping
 * slip, or EasyWay's own running trial balance, from cutting off a live
 * portal full of students.
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

  const [credit, settings] = await Promise.all([
    guardedPrisma.tenantCredit.findUnique({
      where: { tenantId },
      select: { balanceKobo: true, graceKobo: true },
    }),
    billingSettingsFor(tenantId),
  ]);

  // Enforcement off (the default for every tenant) — a balance is a warning,
  // never a wall. Nothing downstream is refused.
  if (!settings.enforce) {
    cache.set(tenantId, { blocked: false, at: Date.now() });
    return false;
  }

  // No credit row at all reads the same as a fresh 0/0 row — not blocked.
  const balanceKobo = credit?.balanceKobo ?? BigInt(0);
  const creditGrace = credit?.graceKobo ?? BigInt(0);
  let settingsGrace = BigInt(0);
  try {
    settingsGrace = BigInt(settings.graceKobo);
  } catch {
    settingsGrace = BigInt(0);
  }
  const graceKobo = creditGrace + settingsGrace;

  const blocked: CreditBlock | false =
    balanceKobo + graceKobo < BigInt(0)
      ? { balanceKobo: balanceKobo.toString(), graceKobo: graceKobo.toString() }
      : false;

  cache.set(tenantId, { blocked, at: Date.now() });
  return blocked;
}

/**
 * The internal-route counterpart to the check `requireApiKey` runs on `/v1`.
 *
 * Call it at the top of a session-authenticated route that spends real money
 * at a provider (a model call, a live-class token, an email send), AFTER the
 * auth/tenant scope is established. Returns a 402 `NextResponse` when this
 * school's credit is exhausted and enforcement is on, or `null` to proceed.
 *
 * Because enforcement is opt-in and off by default, adding this call to a
 * route changes nothing for any existing tenant until an operator flips that
 * tenant's switch — so it is safe to wire in ahead of the rollout.
 */
export async function creditGate(): Promise<NextResponse | null> {
  const tenantId = currentTenantId();
  if (!tenantId) return null;

  const blocked = await creditBlocked(tenantId);
  if (!blocked) return null;

  return NextResponse.json(
    {
      error:
        "This school's platform credit is exhausted. An administrator can top it up under Billing.",
      code: "payment_required",
      balanceKobo: blocked.balanceKobo,
      graceKobo: blocked.graceKobo,
    },
    { status: 402 },
  );
}
