import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { canManageWebinar } from "@/lib/work-drive/webinars";

export const dynamic = "force-dynamic";

const W_SELECT = {
  id: true,
  allowQuestions: true,
  tenantId: true,
  event: {
    select: { createdById: true, workspace: { select: { members: { select: { userId: true, role: true } } } } },
  },
} as const;

/** GET — the Q&A queue, top-voted first, then pending before answered. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("events");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const w = await prisma.webinar.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!w) return NextResponse.json({ error: "No such webinar." }, { status: 404 });

  const questions = await prisma.webinarQuestion.findMany({
    where: { webinarId: id },
    orderBy: [{ status: "asc" }, { upvotes: "desc" }, { createdAt: "asc" }],
    select: {
      id: true, body: true, upvotes: true, status: true,
      askedByUserId: true, askedByName: true, answerText: true, answeredAt: true, createdAt: true,
    },
  });
  const askerIds = questions.map((q) => q.askedByUserId).filter(Boolean) as string[];
  const askers = askerIds.length
    ? await prisma.user.findMany({ where: { id: { in: askerIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(askers.map((a) => [a.id, a.name]));
  const myVotes = await prisma.webinarQuestionVote.findMany({
    where: { questionId: { in: questions.map((q) => q.id) }, voterKey: gate.admin.userId },
    select: { questionId: true },
  });
  const voted = new Set(myVotes.map((v) => v.questionId));

  return NextResponse.json({
    questions: questions.map((q) => ({
      ...q,
      askerName: q.askedByUserId ? nameById.get(q.askedByUserId) ?? null : q.askedByName,
      votedByMe: voted.has(q.id),
    })),
  });
}

/** POST — a staff member asks a question. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("events");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const w = await prisma.webinar.findFirst({ where: { id, deletedAt: null }, select: W_SELECT });
  if (!w) return NextResponse.json({ error: "No such webinar." }, { status: 404 });
  if (!w.allowQuestions) return NextResponse.json({ error: "Questions are closed." }, { status: 403 });

  const body = String((await request.json().catch(() => null))?.body ?? "").trim().slice(0, 1000);
  if (!body) return NextResponse.json({ error: "Type a question." }, { status: 400 });

  const q = await prisma.webinarQuestion.create({
    data: { webinarId: id, askedByUserId: gate.admin.userId, body, tenantId: w.tenantId },
    select: { id: true },
  });
  return NextResponse.json({ question: { id: q.id } }, { status: 201 });
}

/** PATCH ?questionId= — mark answered / dismissed (managers only). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("events");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const w = await prisma.webinar.findFirst({ where: { id, deletedAt: null }, select: W_SELECT });
  if (!w) return NextResponse.json({ error: "No such webinar." }, { status: 404 });
  if (!canManageWebinar(w, gate.admin)) {
    return NextResponse.json({ error: "Not yours to moderate." }, { status: 403 });
  }

  const b = await request.json().catch(() => null);
  const questionId = String(b?.questionId ?? "").trim();
  const status = ["pending", "answered", "dismissed"].includes(String(b?.status)) ? String(b.status) : null;
  if (!questionId || !status) return NextResponse.json({ error: "Bad request." }, { status: 400 });

  await prisma.webinarQuestion.updateMany({
    where: { id: questionId, webinarId: id },
    data: {
      status,
      answerText: status === "answered" ? String(b?.answerText ?? "").trim().slice(0, 2000) || null : undefined,
      answeredById: status === "answered" ? gate.admin.userId : undefined,
      answeredAt: status === "answered" ? new Date() : undefined,
    },
  });
  return NextResponse.json({ ok: true });
}
