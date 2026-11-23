/**
 * The self-healing response to 2026-11-23's incident: a push-server tick
 * running too hot overloaded the primary database badly enough that SSH to
 * the DB box itself stopped responding. Nobody was watching a number that
 * would have said so in time — this is that number, with an automatic
 * response, so the SAME incident shape cannot repeat silently for hours
 * before a human notices a WhatsApp group complaining.
 *
 * Same "five rules" discipline as auto-heal.ts's portal-resync pattern —
 * this is a SECOND, separately-reasoned case, not a generic "try something"
 * fallback:
 *
 *   1. RE-DERIVE BEFORE ACTING. Every run reads pg_stat_activity fresh.
 *   2. NEVER TOUCHES ANYTHING BUT ITS OWN SCOPE. This pattern can only ever
 *      recommend stopping or restarting ONE named service (push-server) on
 *      ONE box. It cannot touch a student's data, a payment, or the
 *      database itself — only whether the one thing that overloaded it last
 *      time is allowed to keep running.
 *   3. ONE ACTION PER COOLDOWN. A flapping load number must not mean
 *      stop/start/stop/start every minute — that is its own outage.
 *   4. RATE-CAPPED. Implicit in the cooldown here: at most one stop and one
 *      restart per cooldown window, not an unbounded loop.
 *   5. LOGGED. Every decision, acted on or not, goes to AutoHealLog — same
 *      table the portal-resync pattern already uses (studentId/tenantId
 *      stay null for an infra-level decision; `detail` carries the real
 *      numbers that triggered it).
 *
 * WHERE THE ACTUAL systemctl CALL HAPPENS: deliberately not in this file.
 * This function only DECIDES. scripts/infra-guard.ts (run by crontab ON the
 * push-server box, where systemctl is actually meaningful) carries out
 * whatever this returns. Keeping the decision pure and the side effect in
 * the runner is the same separation cron-jobs.ts/cron-lanes.ts already uses.
 */
import { prisma } from "@/lib/prisma";

export const INFRA_DB_BREAKER_PATTERN = "infra-push-server-db-breaker";

/** Above this many active (non-idle) Postgres connections, the DB is under real strain — see 2026-11-23's incident, where push-server's typing tick ran unbounded. */
const ACTIVE_CONNECTIONS_TRIP_THRESHOLD = 40;
/** Below this, it's safe to let push-server run again. Lower than the trip point on purpose — a breaker that reopens right at the edge it just tripped at flaps. */
const ACTIVE_CONNECTIONS_RESET_THRESHOLD = 20;
/** Don't act again until this long has passed since the last stop/restart this pattern made. */
const COOLDOWN_MS = 5 * 60_000;

export type InfraGuardDecision =
  | { action: "none"; reason: "disabled" | "no_pattern" | "healthy" | "already_stopped" | "already_running" | "cooldown" }
  | { action: "stop_push_server"; activeConnections: number }
  | { action: "restart_push_server"; activeConnections: number }
  | { action: "dry_run_stop"; activeConnections: number }
  | { action: "dry_run_restart"; activeConnections: number };

export type PushServerRunningState = "running" | "stopped";

/**
 * Pure decision function. Takes the push-server's CURRENT running state
 * (the runner checks `systemctl is-active`, since this lib has no OS
 * access) and decides what, if anything, should change.
 */
export async function decideInfraGuardAction(currentState: PushServerRunningState, now = Date.now()): Promise<InfraGuardDecision> {
  const pattern = await prisma.autoHealPattern.findUnique({ where: { key: INFRA_DB_BREAKER_PATTERN } });
  if (!pattern) return { action: "none", reason: "no_pattern" };
  if (!pattern.enabled) return { action: "none", reason: "disabled" };

  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) FROM pg_stat_activity WHERE state = 'active'
  `;
  const activeConnections = Number(rows[0]?.count ?? 0);

  const lastAction = await prisma.autoHealLog.findFirst({
    where: { pattern: INFRA_DB_BREAKER_PATTERN, action: { in: ["stopped", "restarted", "dry_run_stop", "dry_run_restart"] } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (lastAction && now - lastAction.createdAt.getTime() < COOLDOWN_MS) {
    return { action: "none", reason: "cooldown" };
  }

  const overloaded = activeConnections >= ACTIVE_CONNECTIONS_TRIP_THRESHOLD;
  const recovered = activeConnections <= ACTIVE_CONNECTIONS_RESET_THRESHOLD;

  if (overloaded) {
    if (currentState === "stopped") return { action: "none", reason: "already_stopped" };
    return pattern.dryRun ? { action: "dry_run_stop", activeConnections } : { action: "stop_push_server", activeConnections };
  }

  if (recovered && currentState === "stopped") {
    // Only restart what THIS pattern stopped — see hasActiveStopWithoutRestart below.
    const stoppedByUs = await hasActiveStopWithoutRestart(now);
    if (!stoppedByUs) return { action: "none", reason: "already_stopped" };
    return pattern.dryRun ? { action: "dry_run_restart", activeConnections } : { action: "restart_push_server", activeConnections };
  }

  return { action: "none", reason: "healthy" };
}

/** True if the most recent real stop/restart in the log was a stop (i.e. nobody — human or this pattern — has restarted it since). Stops this pattern from "restarting" a service a human deliberately took down for an unrelated reason. */
async function hasActiveStopWithoutRestart(now: number): Promise<boolean> {
  const last = await prisma.autoHealLog.findFirst({
    where: { pattern: INFRA_DB_BREAKER_PATTERN, action: { in: ["stopped", "restarted"] }, createdAt: { gt: new Date(now - 24 * 60 * 60_000) } },
    orderBy: { createdAt: "desc" },
    select: { action: true },
  });
  return last?.action === "stopped";
}

/** Records what actually happened (or would have, in dry-run) after the runner carries out a decision — or records a no-op decision too, so "healthy" ticks are visible in the Patterns tab, not just silence. */
export async function logInfraGuardDecision(decision: InfraGuardDecision): Promise<void> {
  const action =
    decision.action === "stop_push_server" ? "stopped" :
    decision.action === "restart_push_server" ? "restarted" :
    decision.action === "dry_run_stop" ? "dry_run_stop" :
    decision.action === "dry_run_restart" ? "dry_run_restart" :
    decision.reason;

  await prisma.autoHealLog
    .create({
      data: {
        pattern: INFRA_DB_BREAKER_PATTERN,
        action,
        detail: ("activeConnections" in decision ? { activeConnections: decision.activeConnections } : {}) as never,
      },
    })
    .catch(() => {});
}

export type InfraGuardStats = {
  // Shares AutoHealStats's shape (auto-heal.ts) so the UI can reuse one
  // component. maxPerHour is unused by this pattern's own decision logic
  // (it uses the cooldown above instead) but stays in the type since the
  // underlying AutoHealPattern row always has one.
  pattern: { key: string; enabled: boolean; dryRun: boolean; maxPerHour: number; updatedAt: string };
  last24h: Partial<Record<string, number>>;
  last7d: Partial<Record<string, number>>;
  lastRunAt: string | null;
};

/** What the Patterns tab shows — same shape/spirit as autoHealStats() in auto-heal.ts. */
export async function infraGuardStats(now = Date.now()): Promise<InfraGuardStats | null> {
  const pattern = await prisma.autoHealPattern.findUnique({ where: { key: INFRA_DB_BREAKER_PATTERN } });
  if (!pattern) return null;

  const [rows24h, rows7d, last] = await Promise.all([
    prisma.autoHealLog.groupBy({
      by: ["action"],
      where: { pattern: pattern.key, createdAt: { gt: new Date(now - 24 * 60 * 60_000) } },
      _count: { _all: true },
    }),
    prisma.autoHealLog.groupBy({
      by: ["action"],
      where: { pattern: pattern.key, createdAt: { gt: new Date(now - 7 * 24 * 60 * 60_000) } },
      _count: { _all: true },
    }),
    prisma.autoHealLog.findFirst({ where: { pattern: pattern.key }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);

  const fold = (rows: { action: string; _count: { _all: number } }[]) => {
    const out: Partial<Record<string, number>> = {};
    for (const row of rows) out[row.action] = row._count._all;
    return out;
  };

  return {
    pattern: { key: pattern.key, enabled: pattern.enabled, dryRun: pattern.dryRun, maxPerHour: pattern.maxPerHour, updatedAt: pattern.updatedAt.toISOString() },
    last24h: fold(rows24h),
    last7d: fold(rows7d),
    lastRunAt: last?.createdAt.toISOString() ?? null,
  };
}

/** Flip the kill switch, or toggle dry-run, from the Patterns tab. */
export async function setInfraGuardPattern(patch: { enabled?: boolean; dryRun?: boolean }, updatedById: string): Promise<boolean> {
  const result = await prisma.autoHealPattern
    .update({ where: { key: INFRA_DB_BREAKER_PATTERN }, data: { ...patch, updatedById } })
    .catch(() => null);
  return result !== null;
}
