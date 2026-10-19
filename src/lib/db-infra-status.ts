/**
 * What the admin "Database infrastructure" page shows: the self-hosted
 * Postgres replacement for Neon — is it healthy, is it backed up, what does
 * it actually cost. Pure assembly (no network calls here), mirroring
 * recorder-status.ts's shape so the two pages read like siblings.
 */

export type DbHealth = "ok" | "warning" | "critical" | "unknown";

export type DbBoxStatus = {
  checkedAt: string | null;
  role: "primary" | "standby" | "unknown";
  postgresActive: boolean;
  pgbouncerActive: boolean;
  diskPercentUsed: number | null;
  connections: string | null;
  lastBackupAgeHours: number | null;
  archiverFailedCount: number | null;
  standbyReplicationState: string | null;
  problems: string[];
  ageSeconds: number | null;
};

export type LinodeInstanceCost = {
  label: string;
  group: "eduprime-db" | "eduprime-recorder" | "eduprime-scheduler" | "other";
  type: string;
  status: string;
  usdPerMonth: number;
};

export type DbInfraStatus = {
  health: DbHealth;
  headline: string;
  warnings: string[];
  box: DbBoxStatus | null;
  billing: {
    instances: LinodeInstanceCost[];
    totalUsdPerMonth: number;
    byGroup: Record<string, number>;
    fetchedAt: string;
    error: string | null;
  } | null;
};

/** A status file older than this is treated as "the monitor stopped reporting", same reasoning as the recorder's scheduler-silence check. */
export const BOX_STATUS_SILENT_SECONDS = 30 * 60;

export function parseDbBoxStatus(raw: unknown, now: Date): DbBoxStatus | null {
  const v = raw as Record<string, unknown> | null;
  if (!v || typeof v !== "object") return null;
  const checkedAt = typeof v.checked_at === "string" ? v.checked_at : null;
  const ageSeconds = checkedAt && Number.isFinite(Date.parse(checkedAt)) ? Math.max(0, Math.round((now.getTime() - Date.parse(checkedAt)) / 1000)) : null;
  const num = (x: unknown) => {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  };
  return {
    checkedAt,
    role: v.role === "primary" || v.role === "standby" ? v.role : "unknown",
    postgresActive: v.postgres_active === "active",
    pgbouncerActive: v.pgbouncer_active === "active",
    diskPercentUsed: num(v.disk_percent_used),
    connections: typeof v.connections === "string" ? v.connections : null,
    lastBackupAgeHours: num(v.last_backup_age_hours),
    archiverFailedCount: num(v.archiver_failed_count),
    standbyReplicationState: typeof v.standby_replication_state === "string" ? v.standby_replication_state : null,
    problems: Array.isArray(v.problems) ? v.problems.filter((p): p is string => typeof p === "string") : [],
    ageSeconds,
  };
}

export function buildDbInfraStatus(input: {
  box: DbBoxStatus | null;
  billing: DbInfraStatus["billing"];
}): DbInfraStatus {
  const { box, billing } = input;
  const warnings: string[] = [];

  if (!box) {
    warnings.push("No status report found yet — the monitor on the database box may never have run, or hasn't published one.");
  } else {
    if (box.ageSeconds !== null && box.ageSeconds > BOX_STATUS_SILENT_SECONDS) {
      warnings.push(`Last status report is ${Math.round(box.ageSeconds / 60)} minutes old — the monitor may have stopped running.`);
    }
    if (!box.postgresActive) warnings.push("Postgres is not active on the primary.");
    if (!box.pgbouncerActive) warnings.push("PgBouncer is not active on the primary.");
    if (box.diskPercentUsed !== null && box.diskPercentUsed >= 85) warnings.push(`Disk is ${box.diskPercentUsed}% full.`);
    if (box.lastBackupAgeHours !== null && box.lastBackupAgeHours >= 26) warnings.push(`Last successful backup was ${box.lastBackupAgeHours}h ago.`);
    if (box.archiverFailedCount !== null && box.archiverFailedCount > 0) warnings.push(`${box.archiverFailedCount} WAL archive failure(s) recorded — point-in-time recovery may have a gap.`);
    if (box.standbyReplicationState && box.standbyReplicationState !== "streaming") warnings.push(`Standby is not streaming (state: ${box.standbyReplicationState}).`);
    warnings.push(...box.problems);
  }

  if (billing?.error) warnings.push(`Billing figures could not be refreshed: ${billing.error}`);

  const health: DbHealth = !box
    ? "unknown"
    : warnings.length === 0
      ? "ok"
      : warnings.some((w) => /not active|not streaming|85%|26h/.test(w))
        ? "critical"
        : "warning";

  const headline =
    health === "unknown"
      ? "No status yet from the database box"
      : health === "ok"
        ? "Primary and standby both healthy, backups current"
        : health === "critical"
          ? "Something needs attention now"
          : "Mostly fine, worth a look";

  return { health, headline, warnings, box, billing };
}
