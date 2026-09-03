/**
 * Per-tenant automatic result release configuration.
 *
 * One `SchoolSetting` row (key/value JSON, keyed by tenant), the same mechanism
 * `work_drive.enabled` and `class.sessions` use.
 *
 *   results.autoRelease  { enabled: boolean; delayDays: number }
 *
 * ON by default with a two-day delay: the school asked for tutors to stop being
 * the bottleneck on results, so the default has to actually do that. The delay
 * exists so a tutor who wants to talk a class through a hard mock first still
 * has a window to hold it back from the gradebook.
 *
 * Reads never throw — a row hand-edited into nonsense degrades to the default.
 * The strict parser is for the settings screen, which rejects nonsense rather
 * than storing it.
 */

import { prisma } from "@/lib/prisma";

export const RESULTS_AUTO_RELEASE_KEY = "results.autoRelease";

export type ResultAutoReleaseConfig = {
  enabled: boolean;
  /** Days after the exam date before an un-held, fully-graded sitting releases. */
  delayDays: number;
};

export const DEFAULT_AUTO_RELEASE: ResultAutoReleaseConfig = { enabled: true, delayDays: 2 };

const MAX_DELAY_DAYS = 60;

export function parseAutoRelease(value: unknown): ResultAutoReleaseConfig;
export function parseAutoRelease(value: unknown, options: { strict: true }): ResultAutoReleaseConfig | null;
export function parseAutoRelease(
  value: unknown,
  options?: { strict?: boolean },
): ResultAutoReleaseConfig | null {
  const strict = options?.strict === true;
  const fallback = strict ? null : { ...DEFAULT_AUTO_RELEASE };

  if (value == null) return { ...DEFAULT_AUTO_RELEASE };
  if (typeof value !== "object") return fallback;

  const raw = value as { enabled?: unknown; delayDays?: unknown };
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_AUTO_RELEASE.enabled;

  const n = typeof raw.delayDays === "number" ? raw.delayDays : Number(raw.delayDays);
  if (raw.delayDays != null && (!Number.isFinite(n) || n < 0 || n > MAX_DELAY_DAYS)) return fallback;
  const delayDays = Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_AUTO_RELEASE.delayDays;

  return { enabled, delayDays };
}

async function readSetting(tenantId: string | null | undefined): Promise<unknown> {
  if (!tenantId) return undefined;
  const row = await prisma.schoolSetting.findUnique({
    where: { tenantId_key: { tenantId, key: RESULTS_AUTO_RELEASE_KEY } },
    select: { value: true },
  });
  return row?.value;
}

/** The effective config for one tenant, resolved through the default. */
export async function resultAutoReleaseConfig(
  tenantId: string | null | undefined,
): Promise<ResultAutoReleaseConfig> {
  return parseAutoRelease(await readSetting(tenantId));
}
