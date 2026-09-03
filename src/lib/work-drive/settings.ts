/**
 * Per-tenant Work Drive configuration, and the one place that reads it.
 *
 * Two knobs, both stored as SchoolSetting rows (key/value JSON, keyed by
 * tenant), the same mechanism `class.sessions` uses:
 *
 *   work_drive.enabled   is the feature switched on for this school at all
 *   work_drive.quota     how many bytes of storage it may use, null = the
 *                        platform default (QUOTA_DEFAULT_BYTES below)
 *
 * Defaults are conservative in opposite directions on purpose. The feature is
 * OFF until a school (or the platform console) turns it on — nobody gets a new
 * top-level nav item they did not ask for. The quota, once the feature is on,
 * defaults to a real allowance rather than zero, because a drive you cannot put
 * anything in is not a soft launch, it is a broken page.
 *
 * Reads must never throw: a row hand-edited into nonsense degrades to the
 * default, it does not take down /admin/work-drive. Writes (the settings screen
 * and the platform console) validate with `{ strict: true }` and reject
 * nonsense rather than store it.
 */

import { prisma } from "@/lib/prisma";

export const WORK_DRIVE_ENABLED_KEY = "work_drive.enabled";
export const WORK_DRIVE_QUOTA_KEY = "work_drive.quota";

/**
 * The allowance a school gets when the feature is on and nobody has set a
 * number. 20 GiB — comfortably more than a few years of policy PDFs, meeting
 * decks and scanned contracts, and far short of anything that would be a
 * surprise on the object-storage bill. Revisit with the EduPrime billing model
 * (docs/WORK_DRIVE.md, Phase 5).
 */
export const QUOTA_DEFAULT_BYTES = 20 * 1024 * 1024 * 1024;

export type WorkDriveQuota = {
  /** null means "use QUOTA_DEFAULT_BYTES" — kept distinct from 0, which is a
   *  deliberate freeze. */
  bytes: number | null;
};

export function parseEnabled(value: unknown): boolean {
  if (value === true) return true;
  if (value && typeof value === "object" && "enabled" in value) {
    return (value as { enabled?: unknown }).enabled === true;
  }
  return false;
}

export function parseQuota(value: unknown): WorkDriveQuota;
export function parseQuota(value: unknown, options: { strict: true }): WorkDriveQuota | null;
export function parseQuota(value: unknown, options?: { strict?: boolean }): WorkDriveQuota | null {
  const strict = options?.strict === true;
  const fallback = strict ? null : { bytes: null };

  if (value == null) return { bytes: null };
  if (!value || typeof value !== "object") return fallback;

  const raw = (value as { bytes?: unknown }).bytes;
  if (raw == null) return { bytes: null };

  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;

  return { bytes: Math.floor(n) };
}

/** The effective byte ceiling for a tenant: their number, or the default. */
export function quotaBytes(quota: WorkDriveQuota | null | undefined): number {
  const b = quota?.bytes;
  return typeof b === "number" ? b : QUOTA_DEFAULT_BYTES;
}

async function readSetting(tenantId: string | null | undefined, key: string): Promise<unknown> {
  if (!tenantId) return undefined;
  const row = await prisma.schoolSetting.findUnique({
    where: { tenantId_key: { tenantId, key } },
    select: { value: true },
  });
  return row?.value;
}

/** Is the Work Drive switched on for this tenant? */
export async function workDriveEnabled(tenantId: string | null | undefined): Promise<boolean> {
  return parseEnabled(await readSetting(tenantId, WORK_DRIVE_ENABLED_KEY));
}

/** This tenant's storage quota, resolved through the default. */
export async function workDriveQuota(tenantId: string | null | undefined): Promise<WorkDriveQuota> {
  return parseQuota(await readSetting(tenantId, WORK_DRIVE_QUOTA_KEY));
}

/** Both knobs in one round trip, for the page that needs them together. */
export async function workDriveConfig(
  tenantId: string | null | undefined,
): Promise<{ enabled: boolean; quota: WorkDriveQuota; quotaBytes: number }> {
  if (!tenantId) {
    return { enabled: false, quota: { bytes: null }, quotaBytes: QUOTA_DEFAULT_BYTES };
  }
  const rows = await prisma.schoolSetting.findMany({
    where: { tenantId, key: { in: [WORK_DRIVE_ENABLED_KEY, WORK_DRIVE_QUOTA_KEY] } },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const quota = parseQuota(byKey.get(WORK_DRIVE_QUOTA_KEY));
  return {
    enabled: parseEnabled(byKey.get(WORK_DRIVE_ENABLED_KEY)),
    quota,
    quotaBytes: quotaBytes(quota),
  };
}
