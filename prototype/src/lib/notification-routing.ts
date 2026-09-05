import { prisma } from "@/lib/prisma";
import {
  emailsByDefault,
  identityForKind,
  isMailIdentityKey,
  smsByDefault,
  type MailIdentityKey,
} from "@/lib/mail-identity";

/**
 * Which channels a notification kind is allowed to use.
 *
 * One place decides "does a payment receipt email?", and it is a database row
 * an admin can flip, falling back to a code default when no row exists. That
 * fallback is the important part: the table starts EMPTY and the system
 * behaves exactly as before anybody opens the settings page. An admin turning
 * one thing off must not first require seventeen rows to exist.
 *
 * Cached per process for a minute. This is read on the hot path of every
 * notification — a payment webhook that fans out to thirty students would
 * otherwise make thirty identical settings queries — and a minute is well
 * inside the time it takes an admin to tick a box and go looking for the
 * result.
 */

export type ChannelPlan = {
  inApp: boolean;
  push: boolean;
  email: boolean;
  sms: boolean;
  identity: MailIdentityKey;
};

type Row = {
  kind: string;
  inApp: boolean;
  push: boolean;
  email: boolean;
  sms: boolean;
  identity: string | null;
};

const TTL_MS = 60_000;
let cache: { at: number; rows: Map<string, Row> } | null = null;

/** Drop the cache after a write, so the admin sees their own change at once. */
export function invalidateRoutingCache(): void {
  cache = null;
}

async function load(): Promise<Map<string, Row>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  try {
    const rows = await prisma.notificationSetting.findMany();
    const map = new Map(rows.map((r) => [r.kind, r as Row]));
    cache = { at: Date.now(), rows: map };
    return map;
  } catch (error) {
    // A settings table that cannot be read must not stop the school's
    // notifications. Fall through to the code defaults.
    console.warn("notification routing: falling back to defaults", error);
    return new Map();
  }
}

/**
 * The plan for one kind.
 *
 * `pushDefault` is passed in rather than assumed because notify() already has
 * a rule for it — push is on for warning and critical — and that rule stays
 * the default. A stored row overrides it; nothing else does.
 */
export async function planFor(kind: string, pushDefault: boolean): Promise<ChannelPlan> {
  const row = (await load()).get(kind);
  return {
    inApp: row?.inApp ?? true,
    push: row?.push ?? pushDefault,
    email: row?.email ?? emailsByDefault(kind),
    sms: row?.sms ?? smsByDefault(kind),
    identity: isMailIdentityKey(row?.identity) ? row.identity : identityForKind(kind).key,
  };
}

/** Every kind's effective plan, for the admin settings page. */
export async function allPlans(kinds: readonly string[]): Promise<Record<string, ChannelPlan & { configured: boolean }>> {
  const rows = await load();
  const out: Record<string, ChannelPlan & { configured: boolean }> = {};
  for (const kind of kinds) {
    const row = rows.get(kind);
    out[kind] = {
      inApp: row?.inApp ?? true,
      // The page shows the resting default rather than notify()'s
      // severity-dependent one — a checkbox that changes meaning per message
      // is not a setting anybody can reason about.
      push: row?.push ?? true,
      email: row?.email ?? emailsByDefault(kind),
      sms: row?.sms ?? smsByDefault(kind),
      identity: isMailIdentityKey(row?.identity) ? row.identity : identityForKind(kind).key,
      configured: Boolean(row),
    };
  }
  return out;
}
