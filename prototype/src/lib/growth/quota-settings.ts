import { prisma } from "@/lib/prisma";

/**
 * THE DAILY QUOTA — a number, not a policy this codebase gets to invent.
 *
 * No default count. Guessing a number ("5 contacts a day") would be
 * exactly the kind of unverifiable claim the rest of the Growth Desk's
 * trust work (see autoCompleteTasksForLeadActivity in src/lib/growth/tasks.ts)
 * was built to remove — so this starts unset, and the Today tab shows
 * today's real count with no target until the Sales & Marketing Teamlead
 * sets one. Editable from the Team tab, phone or laptop, same as the
 * auto-assign switch next to it.
 *
 * What it counts: SalesTask rows completed today — not clicked, EARNED.
 * Every SalesTask tied to a lead can now only reach "done" via real
 * contact (a note, a call, or a stage change), never a self-click. So
 * this quota is automatically as honest as the completion mechanism
 * underneath it, with no separate anti-fraud logic needed here.
 */

export const GROWTH_QUOTA_KEY = "growth.dailyQuota";

export type GrowthQuotaSettings = {
  count: number | null;
  updatedAt: string | null;
  updatedByName: string | null;
};

export const DEFAULT_GROWTH_QUOTA: GrowthQuotaSettings = {
  count: null,
  updatedAt: null,
  updatedByName: null,
};

export function parseGrowthQuotaSettings(value: unknown): GrowthQuotaSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_GROWTH_QUOTA };
  const raw = value as Record<string, unknown>;
  const count = typeof raw.count === "number" && Number.isFinite(raw.count) && raw.count > 0 ? Math.round(raw.count) : null;
  return {
    count,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    updatedByName: typeof raw.updatedByName === "string" ? raw.updatedByName : null,
  };
}

export async function readGrowthQuotaSettings(tenantId: string | null | undefined): Promise<GrowthQuotaSettings> {
  if (!tenantId) return { ...DEFAULT_GROWTH_QUOTA };
  try {
    const row = await prisma.schoolSetting.findUnique({
      where: { tenantId_key: { tenantId, key: GROWTH_QUOTA_KEY } },
      select: { value: true },
    });
    return parseGrowthQuotaSettings(row?.value);
  } catch (error) {
    console.warn("growth-quota-settings: read failed, treating as unset", error);
    return { ...DEFAULT_GROWTH_QUOTA };
  }
}

/** `count: null` clears the quota — back to a plain daily count with no target. */
export async function writeGrowthQuotaSettings(
  tenantId: string,
  count: number | null,
  by: { name: string | null },
): Promise<GrowthQuotaSettings> {
  const next: GrowthQuotaSettings = { count, updatedAt: new Date().toISOString(), updatedByName: by.name };
  await prisma.schoolSetting.upsert({
    where: { tenantId_key: { tenantId, key: GROWTH_QUOTA_KEY } },
    update: { value: next as unknown as object },
    create: { tenantId, key: GROWTH_QUOTA_KEY, value: next as unknown as object },
  });
  return next;
}
