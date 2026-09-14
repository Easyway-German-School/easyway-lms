/**
 * The database side of the exam campaign — see exam-campaign.ts for the shape
 * and the pure helpers. Kept apart so that file stays prisma-free and the
 * popup / banner / public page can import it on the client.
 */

import { prisma } from "@/lib/prisma";
import {
  DEFAULT_EXAM_CAMPAIGN,
  EXAM_CAMPAIGN_KEY,
  parseExamCampaign,
  type ExamCampaignConfig,
} from "@/lib/exam-campaign";

/**
 * This tenant's campaign config, falling back to the built-in ÖSD-October-2026
 * defaults when the office has never opened the screen. Never throws.
 */
export async function readExamCampaign(
  tenantId: string | null | undefined,
): Promise<ExamCampaignConfig> {
  if (!tenantId) return { ...DEFAULT_EXAM_CAMPAIGN };
  try {
    const row = await prisma.schoolSetting.findUnique({
      where: { tenantId_key: { tenantId, key: EXAM_CAMPAIGN_KEY } },
    });
    return parseExamCampaign(row?.value) ?? { ...DEFAULT_EXAM_CAMPAIGN };
  } catch {
    return { ...DEFAULT_EXAM_CAMPAIGN };
  }
}

/**
 * Every tenant that has a saved campaign row, for the cron reminder sweep.
 * A tenant that has never touched the screen is intentionally absent — the
 * default config ships `enabled: true`, and firing a school-wide reminder at a
 * school that never opted in would be wrong. The office enables it by saving
 * the screen once (which also lets them tailor the copy first).
 */
export async function readAllExamCampaigns(): Promise<
  Array<{ tenantId: string; config: ExamCampaignConfig }>
> {
  const rows = await prisma.schoolSetting.findMany({
    where: { key: EXAM_CAMPAIGN_KEY },
    select: { tenantId: true, value: true },
  });
  return rows.map((row) => ({
    tenantId: row.tenantId,
    config: parseExamCampaign(row.value) ?? { ...DEFAULT_EXAM_CAMPAIGN },
  }));
}

export async function writeExamCampaign(
  tenantId: string,
  config: ExamCampaignConfig,
): Promise<void> {
  await prisma.schoolSetting.upsert({
    where: { tenantId_key: { tenantId, key: EXAM_CAMPAIGN_KEY } },
    update: { value: config as unknown as object },
    create: { tenantId, key: EXAM_CAMPAIGN_KEY, value: config as unknown as object },
  });
}
