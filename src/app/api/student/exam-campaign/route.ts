import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { openTicket } from "@/lib/support";
import { readExamCampaign } from "@/lib/exam-campaign-server";
import { campaignPhase } from "@/lib/exam-campaign";

export const dynamic = "force-dynamic";

/**
 * The student's own view of the exam-registration campaign (currently ÖSD
 * October 2026): the public content + this student's "I've registered" /
 * "I asked the office" flags. The daily popup, the pinned banner and the
 * `/exams/osd` page all read this; the POST is how the three buttons on them
 * write back.
 *
 * Scoped entirely to the signed-in user. Nothing here takes an id.
 */

async function loadResponse(userId: string, campaignKey: string) {
  const row = await prisma.examCampaignResponse.findUnique({
    where: { userId_campaignKey: { userId, campaignKey } },
    select: { registered: true, enquired: true, registeredAt: true, enquiredAt: true },
  });
  return {
    registered: row?.registered ?? false,
    enquired: row?.enquired ?? false,
    registeredAt: row?.registeredAt ?? null,
    enquiredAt: row?.enquiredAt ?? null,
  };
}

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const campaign = await readExamCampaign(session.user.tenantId);
  const response = await loadResponse(session.user.id as string, campaign.campaignKey);

  return NextResponse.json({
    campaign,
    phase: campaignPhase(campaign),
    response,
  });
}

export async function POST(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id as string;
  const tenantId = session.user.tenantId ?? null;
  const body = await request.json().catch(() => ({}));
  const action = String(body?.action ?? "");

  const campaign = await readExamCampaign(tenantId);
  const campaignKey = campaign.campaignKey;

  const student = await prisma.student.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (action === "registered" || action === "undo") {
    const registered = action === "registered";
    await prisma.examCampaignResponse.upsert({
      where: { userId_campaignKey: { userId, campaignKey } },
      update: { registered, registeredAt: registered ? new Date() : null },
      create: {
        userId,
        campaignKey,
        tenantId,
        studentId: student?.id ?? null,
        registered,
        registeredAt: registered ? new Date() : null,
      },
    });
    return NextResponse.json({ ok: true, response: await loadResponse(userId, campaignKey) });
  }

  if (action === "enquire") {
    const note = typeof body?.note === "string" ? body.note.trim().slice(0, 1000) : "";
    const openCount = await prisma.supportTicket.count({
      where: { userId, status: { in: ["open", "pending"] } },
    });
    if (openCount < 5) {
      await openTicket({
        userId,
        studentId: student?.id ?? null,
        subject: `${campaign.examBody} exam enquiry`,
        topic: "other",
        body:
          (note ? `${note}\n\n` : "") +
          `I'd like to know more about the ${campaign.examBody} exam campaign — please get in touch.`,
        fromPath: "/exams/osd",
        authorRole: String(session.user.role ?? "student").toLowerCase(),
        authorName: session.user.name ?? null,
      });
    }
    await prisma.examCampaignResponse.upsert({
      where: { userId_campaignKey: { userId, campaignKey } },
      update: { enquired: true, enquiredAt: new Date() },
      create: {
        userId,
        campaignKey,
        tenantId,
        studentId: student?.id ?? null,
        enquired: true,
        enquiredAt: new Date(),
      },
    });
    return NextResponse.json({ ok: true, response: await loadResponse(userId, campaignKey) });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
