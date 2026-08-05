import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";

/**
 * Watching the backups for the thing that goes wrong with backups.
 *
 * It is almost never a bad restore. It is that the job stopped running in
 * March and nobody found out until August, because a backup that has quietly
 * failed looks exactly like one that is working — no error reaches anybody,
 * the dashboard is green, the bucket still holds a file with a recent-looking
 * name. Every backup story that ends badly has this shape.
 *
 * So the check here is inverted. It does not ask whether the last backup
 * succeeded; it asks how long it has been since one did, and complains about
 * silence. Nothing has to go wrong for the alarm to sound — it is enough for
 * nothing to happen.
 */

export type BackupKind = "database" | "objects" | "drill";

/**
 * How old the newest success may be before it counts as a failure, in hours.
 *
 * The database figure is 26 rather than 24 so that a daily job which drifts by
 * an hour, or a run that overlaps a clock change, does not page anybody. The
 * drill is monthly with a generous margin because a late verification is a
 * concern, not an emergency.
 */
const STALE_AFTER_HOURS: Record<BackupKind, number> = {
  database: 26,
  objects: 26,
  drill: 40 * 24,
};

const LABELS: Record<BackupKind, string> = {
  database: "Database backup",
  objects: "File backup (photos, materials, recordings)",
  drill: "Restore drill",
};

export type BackupStatus = {
  kind: BackupKind;
  label: string;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  lastError: string | null;
  hoursSinceSuccess: number | null;
  staleAfterHours: number;
  /** ok | stale | failing | never */
  state: "ok" | "stale" | "failing" | "never";
};

export async function assessBackupHealth(): Promise<BackupStatus[]> {
  const kinds: BackupKind[] = ["database", "objects", "drill"];

  return Promise.all(
    kinds.map(async (kind) => {
      const [lastSuccess, lastAttempt] = await Promise.all([
        prisma.backupRun.findFirst({
          where: { kind, status: "success" },
          orderBy: { startedAt: "desc" },
        }),
        prisma.backupRun.findFirst({
          where: { kind },
          orderBy: { startedAt: "desc" },
        }),
      ]);

      const hours = lastSuccess
        ? (Date.now() - lastSuccess.startedAt.getTime()) / 3_600_000
        : null;

      let state: BackupStatus["state"];
      if (!lastSuccess) state = "never";
      else if (hours! > STALE_AFTER_HOURS[kind]) state = "stale";
      else if (lastAttempt?.status === "failed") state = "failing";
      else state = "ok";

      return {
        kind,
        label: LABELS[kind],
        lastSuccessAt: lastSuccess?.startedAt ?? null,
        lastAttemptAt: lastAttempt?.startedAt ?? null,
        lastError: lastAttempt?.status === "failed" ? lastAttempt.error : null,
        hoursSinceSuccess: hours === null ? null : Math.round(hours),
        staleAfterHours: STALE_AFTER_HOURS[kind],
        state,
      };
    }),
  );
}

/**
 * Called by the daily cron. Complains to the super admins when a backup has
 * gone quiet.
 *
 * `dedupeKey` carries the date, so a broken backup produces one message a day
 * rather than one per tick. That matters more than it sounds: an alert that
 * arrives every fifteen minutes gets muted within a week, and a muted alert is
 * the same as no alert at all on the morning it finally matters.
 */
export async function checkBackupHealth(): Promise<{
  checked: number;
  alerted: string[];
}> {
  const statuses = await assessBackupHealth();
  const bad = statuses.filter((s) => s.state !== "ok");
  const today = new Date().toISOString().slice(0, 10);
  const alerted: string[] = [];

  for (const status of bad) {
    const detail =
      status.state === "never"
        ? "It has never run successfully. If it was only just set up, this clears on its first success."
        : status.state === "stale"
          ? `The last good one was ${status.hoursSinceSuccess} hours ago; anything over ${status.staleAfterHours} is a problem.`
          : `The last attempt failed: ${status.lastError ?? "no reason recorded"}.`;

    await notify({
      to: { audience: "admin", capability: "security" },
      title: `${status.label} needs attention`,
      message:
        `${detail} Until this is fixed the school is running without a usable copy of this data. ` +
        `The steps to check it are in docs/SECURITY.md.`,
      kind: "backup-health",
      severity: status.kind === "drill" ? "warning" : "critical",
      link: "/admin/security",
      dedupeKey: `backup-health:${status.kind}:${status.state}:${today}`,
      push: status.kind !== "drill",
    });
    alerted.push(status.kind);
  }

  return { checked: statuses.length, alerted };
}

/** Record the outcome of a backup job. Called by the GitHub Actions runner. */
export async function recordBackupRun(input: {
  kind: BackupKind;
  status: "success" | "failed";
  snapshotId?: string | null;
  sizeBytes?: number | null;
  detail?: unknown;
  error?: string | null;
  startedAt?: Date;
}): Promise<{ id: string }> {
  const run = await prisma.backupRun.create({
    data: {
      kind: input.kind,
      status: input.status,
      snapshotId: input.snapshotId ?? null,
      sizeBytes: input.sizeBytes != null ? BigInt(input.sizeBytes) : null,
      detail: (input.detail ?? null) as never,
      error: input.error ?? null,
      startedAt: input.startedAt ?? new Date(),
      finishedAt: new Date(),
    },
    select: { id: true },
  });
  return run;
}
