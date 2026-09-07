import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { parseExamCampaign, DEFAULT_EXAM_CAMPAIGN } from "@/lib/exam-campaign";
import { readExamCampaign, writeExamCampaign } from "@/lib/exam-campaign-server";
import { deliverExamCampaignReminder } from "@/lib/exam-campaign-reminders";

export const dynamic = "force-dynamic";

/**
 * The office's control panel for the exam-registration campaign — the on/off
 * switch, the dates / fees / links, and a live tracker of who has marked
 * themselves registered vs enquired vs neither. See src/lib/exam-campaign.ts.
 */

async function tracker(campaignKey: string) {
  const [activeStudents, registered, enquired, recentEnquiries] = await Promise.all([
    prisma.student.count({ where: { status: "active" } }),
    prisma.examCampaignResponse.count({ where: { campaignKey, registered: true } }),
    prisma.examCampaignResponse.count({ where: { campaignKey, enquired: true } }),
    prisma.examCampaignResponse.findMany({
      where: { campaignKey, enquired: true },
      orderBy: { enquiredAt: "desc" },
      take: 12,
      select: {
        enquiredAt: true,
        registered: true,
        user: { select: { name: true, email: true } },
      },
    }),
  ]);

  return {
    activeStudents,
    registered,
    enquired,
    notYetRegistered: Math.max(0, activeStudents - registered),
    recentEnquiries: recentEnquiries.map((row) => ({
      name: row.user?.name ?? row.user?.email ?? "A student",
      at: row.enquiredAt,
      registered: row.registered,
    })),
  };
}

export async function GET() {
  const gate = await requireCapability("exams");
  if (!gate.ok) return gate.response;

  const config = await readExamCampaign(gate.session.user.tenantId);
  return NextResponse.json({ config, defaults: DEFAULT_EXAM_CAMPAIGN, tracker: await tracker(config.campaignKey) });
}

export async function POST(request: Request) {
  const gate = await requireCapability("exams");
  if (!gate.ok) return gate.response;

  const tenantId = gate.session.user.tenantId;
  if (!tenantId) return NextResponse.json({ error: "No school in context" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const action = String(body?.action ?? "save");

  if (action === "save") {
    const config = parseExamCampaign(body?.config, { strict: true });
    if (!config) {
      return NextResponse.json({ error: "That does not look like a campaign." }, { status: 400 });
    }
    if (config.registrationDeadline < config.startPopupsOn) {
      return NextResponse.json(
        { error: "The registration deadline cannot be before the day the popups start." },
        { status: 400 },
      );
    }
    await writeExamCampaign(tenantId, config);
    return NextResponse.json({ ok: true, config, tracker: await tracker(config.campaignKey) });
  }

  if (action === "send-now") {
    const config = await readExamCampaign(tenantId);
    const result = await deliverExamCampaignReminder(config, { force: true });
    return NextResponse.json({ ok: true, result });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
