import { prisma } from "@/lib/prisma";

/**
 * THE AUTO-ASSIGN SWITCH.
 *
 * On by default — the opposite of src/lib/growth/ai-settings.ts's switch,
 * deliberately for the same reason that file's comment gives: this is
 * EXISTING behaviour (every new lead has always been auto-routed via
 * pickRepForLead) getting an off-switch retrofitted, not a new capability
 * nobody has reviewed. Defaulting it off would silently stop every school's
 * leads from ever reaching a rep until someone discovered the new toggle.
 *
 * Turning it off does not redirect new leads anywhere — they simply sit in
 * the unassigned pool (assignedToId null) until the Sales & Marketing
 * Teamlead hands them out by hand from the Pipeline tab. See
 * autoAssignNewLead in src/lib/growth/leads.ts, the only call site that
 * reads this.
 */

export const GROWTH_AUTO_ASSIGN_KEY = "growth.autoAssign";

export type GrowthAutoAssignSettings = {
  enabled: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
};

export const DEFAULT_GROWTH_AUTO_ASSIGN: GrowthAutoAssignSettings = {
  enabled: true,
  updatedAt: null,
  updatedByName: null,
};

/** Lenient on read: absent or wrong-typed means "on". Only a literal `false` switches it off. */
export function parseGrowthAutoAssignSettings(value: unknown): GrowthAutoAssignSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_GROWTH_AUTO_ASSIGN };
  const raw = value as Record<string, unknown>;
  return {
    enabled: raw.enabled !== false,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    updatedByName: typeof raw.updatedByName === "string" ? raw.updatedByName : null,
  };
}

export async function readGrowthAutoAssignSettings(tenantId: string | null | undefined): Promise<GrowthAutoAssignSettings> {
  if (!tenantId) return { ...DEFAULT_GROWTH_AUTO_ASSIGN };
  try {
    const row = await prisma.schoolSetting.findUnique({
      where: { tenantId_key: { tenantId, key: GROWTH_AUTO_ASSIGN_KEY } },
      select: { value: true },
    });
    return parseGrowthAutoAssignSettings(row?.value);
  } catch (error) {
    // A settings read that fails must not silently stop leads from being
    // worked — on is the safe failure here, the inverse of the AI switch.
    console.warn("growth-auto-assign-settings: read failed, treating as on", error);
    return { ...DEFAULT_GROWTH_AUTO_ASSIGN };
  }
}

export async function writeGrowthAutoAssignSettings(
  tenantId: string,
  enabled: boolean,
  by: { name: string | null },
): Promise<GrowthAutoAssignSettings> {
  const next: GrowthAutoAssignSettings = { enabled, updatedAt: new Date().toISOString(), updatedByName: by.name };
  await prisma.schoolSetting.upsert({
    where: { tenantId_key: { tenantId, key: GROWTH_AUTO_ASSIGN_KEY } },
    update: { value: next as unknown as object },
    create: { tenantId, key: GROWTH_AUTO_ASSIGN_KEY, value: next as unknown as object },
  });
  return next;
}
