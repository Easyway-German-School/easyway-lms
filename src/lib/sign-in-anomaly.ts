import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { SIGN_IN_AUDIT_ACTION } from "@/lib/sign-in-audit";

/**
 * The closest thing this system has to a "someone is trying to get in" alarm.
 *
 * It does one thing, the thing docs/SECURITY.md §8 said was missing: for every
 * staff sign-in in the last day, it checks whether that account has ever been
 * seen at that IP address before. A new address on an admin or tutor account is
 * the earliest cheap signal that a password has been stolen — earlier than the
 * damage, and usually earlier than the person noticing.
 *
 * It compares raw addresses, not countries. A GeoIP lookup would read better in
 * the alert ("signed in from Lagos" vs "…from 41.x.x.x") but needs a database
 * or a paid API to be accurate, and the question here — "is this where they
 * always are?" — is answered just as well by the address itself. Country
 * enrichment is a later refinement, not a blocker.
 *
 * Runs from the daily cron tick. Worst-case latency is one tick: a sign-in at
 * 06:30 with the tick at 06:00 is flagged the next morning. That is acceptable
 * for a signal whose job is to be noticed at all — the alternative was nothing.
 */

/** Slightly over a day, so a late tick never leaves a gap. */
const RECENT_WINDOW_MS = 25 * 60 * 60 * 1000;

/** How far back an address counts as "familiar". */
const HISTORY_DAYS = 90;

function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export type SignInAnomalyResult = {
  /** Recent staff sign-ins examined. */
  checked: number;
  /** Of those, how many were from an unfamiliar address and alerted on. */
  flagged: number;
};

export async function flagUnfamiliarStaffSignIns(
  now: Date = new Date(),
): Promise<SignInAnomalyResult> {
  const windowOpenedAt = new Date(now.getTime() - RECENT_WINDOW_MS);
  const historyStartsAt = new Date(now.getTime() - HISTORY_DAYS * 86_400_000);

  const recent = await prisma.auditLog.findMany({
    where: {
      action: SIGN_IN_AUDIT_ACTION,
      at: { gte: windowOpenedAt },
      actorId: { not: null },
      ip: { not: null },
    },
    select: {
      actorId: true,
      actorEmail: true,
      actorRole: true,
      ip: true,
      at: true,
    },
    orderBy: { at: "asc" },
  });

  if (recent.length === 0) return { checked: 0, flagged: 0 };

  const actorIds = Array.from(
    new Set(recent.map((r: { actorId: string | null }) => r.actorId as string)),
  );

  /**
   * Every sign-in row for those accounts in the retention window, the recent
   * ones included. An address is "familiar" if it appears on a row from BEFORE
   * this run's window opened — so a brand-new address seen twice in the same
   * night is still flagged once, not explained away by its own first sighting.
   */
  const history = await prisma.auditLog.findMany({
    where: {
      action: SIGN_IN_AUDIT_ACTION,
      actorId: { in: actorIds },
      at: { gte: historyStartsAt },
      ip: { not: null },
    },
    select: { actorId: true, ip: true, at: true },
  });

  const familiarByActor = new Map<string, Set<string>>();
  for (const row of history) {
    if (row.at >= windowOpenedAt) continue; // not yet "history"
    let set = familiarByActor.get(row.actorId as string);
    if (!set) familiarByActor.set(row.actorId as string, (set = new Set()));
    set.add(row.ip as string);
  }

  let flagged = 0;
  const alertedThisRun = new Set<string>();

  for (const row of recent) {
    const actorId = row.actorId as string;
    const ip = row.ip as string;
    const familiar = familiarByActor.get(actorId);

    // No prior addresses at all → this is the first sign-in we have on record
    // for the account. That is a baseline, not an anomaly.
    if (!familiar || familiar.size === 0) continue;
    if (familiar.has(ip)) continue;

    const key = `${actorId}:${ip}`;
    if (alertedThisRun.has(key)) continue;
    alertedThisRun.add(key);

    await notify({
      to: { audience: "admin", capability: "security" },
      title: `New sign-in location for ${row.actorEmail ?? "a staff account"}`,
      message:
        `${row.actorEmail ?? "A staff account"} (${row.actorRole ?? "staff"}) just signed in from ${ip}, ` +
        `an address this account has not used in the last ${HISTORY_DAYS} days. ` +
        `If that was them — travelling, a new phone, a different network — there is nothing to do. ` +
        `If it was not, revoke the account in /admin/staff and follow docs/SECURITY.md §2.5.`,
      kind: "security.signin_anomaly",
      severity: "warning",
      link: "/admin/security",
      // Keyed on the account + address, with no date: one alert per new
      // address per account, ever. By the next tick the sign-in row has aged
      // into "history" and stops matching anyway.
      dedupeKey: `signin-anomaly:${actorId}:${ip}`,
      push: true,
    });
    flagged += 1;
  }

  return { checked: recent.length, flagged };
}

/** Exposed for a test that wants to assert the window math without mocking. */
export const _internals = { RECENT_WINDOW_MS, HISTORY_DAYS, dayKey };
