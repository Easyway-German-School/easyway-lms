import { prisma } from "@/lib/prisma";

/**
 * THE GROWTH DESK AI SWITCH.
 *
 * Off unless a super admin turns it on — the inverse default of
 * src/lib/fee-reminder-settings.ts's channels, deliberately: those were
 * existing behaviour getting an off-switch retrofitted, so defaulting ON
 * kept every school's behaviour unchanged. This is a brand-new capability
 * nobody has reviewed yet, so it is opt-in.
 *
 * Flipping this ON is necessary but not sufficient — see isGrowthAiActive
 * below. Without an ANTHROPIC_API_KEY configured, the adaptive scoring in
 * src/lib/growth/intelligence.ts and the daily task engine keep working
 * exactly as they do today; this switch only controls the ADDITIONAL
 * layer that reads a lead's notes with Claude (src/lib/ai.ts's
 * analyzeLeadSignal). The built-in algorithm never depends on it.
 */

export const GROWTH_AI_KEY = "growth.ai";

export type GrowthAiSettings = {
  enabled: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
};

export const DEFAULT_GROWTH_AI: GrowthAiSettings = {
  enabled: false,
  updatedAt: null,
  updatedByName: null,
};

/** Strict on read, the opposite of fee-reminder-settings: only a literal `true` turns this on. */
export function parseGrowthAiSettings(value: unknown): GrowthAiSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_GROWTH_AI };
  const raw = value as Record<string, unknown>;
  return {
    enabled: raw.enabled === true,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    updatedByName: typeof raw.updatedByName === "string" ? raw.updatedByName : null,
  };
}

export async function readGrowthAiSettings(tenantId: string | null | undefined): Promise<GrowthAiSettings> {
  if (!tenantId) return { ...DEFAULT_GROWTH_AI };
  try {
    const row = await prisma.schoolSetting.findUnique({
      where: { tenantId_key: { tenantId, key: GROWTH_AI_KEY } },
      select: { value: true },
    });
    return parseGrowthAiSettings(row?.value);
  } catch (error) {
    // A settings read that fails must not silently turn AI ON — off is the
    // safe failure for a cost-bearing feature.
    console.warn("growth-ai-settings: read failed, treating as off", error);
    return { ...DEFAULT_GROWTH_AI };
  }
}

export async function writeGrowthAiSettings(
  tenantId: string,
  enabled: boolean,
  by: { name: string | null },
): Promise<GrowthAiSettings> {
  const next: GrowthAiSettings = { enabled, updatedAt: new Date().toISOString(), updatedByName: by.name };
  await prisma.schoolSetting.upsert({
    where: { tenantId_key: { tenantId, key: GROWTH_AI_KEY } },
    update: { value: next as unknown as object },
    create: { tenantId, key: GROWTH_AI_KEY, value: next as unknown as object },
  });
  return next;
}

/**
 * The real gate every call site should check: the switch is on AND a key
 * is actually configured. Checking only the switch would mean a school
 * that enables this before a key is ever added gets silent no-ops forever
 * with no way to tell why; checking both here, once, means every caller
 * gets the same honest answer.
 */
export async function isGrowthAiActive(tenantId: string | null | undefined): Promise<boolean> {
  // Same check src/lib/ai.ts's own (private) hasKey() makes — duplicated
  // rather than imported, since that function is not exported and this is
  // the one line of logic worth copying rather than widening ai.ts's
  // surface for.
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.startsWith("sk-placeholder")) return false;
  const settings = await readGrowthAiSettings(tenantId);
  return settings.enabled;
}
