import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";

export const dynamic = "force-dynamic";

/** POST — toggle the signed-in admin's upvote on a question. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; qid: string }> }) {
  const gate = await requireCapability("events");
  if (!gate.ok) return gate.response;
  const { id, qid } = await params;

  const question = await prisma.webinarQuestion.findFirst({
    where: { id: qid, webinarId: id },
    select: { id: true, tenantId: true },
  });
  if (!question) return NextResponse.json({ error: "No such question." }, { status: 404 });

  const voterKey = gate.admin.userId;
  const existing = await prisma.webinarQuestionVote.findFirst({
    where: { questionId: qid, voterKey },
    select: { id: true },
  });

  const voted = await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.webinarQuestionVote.delete({ where: { id: existing.id } });
      await tx.webinarQuestion.update({ where: { id: qid }, data: { upvotes: { decrement: 1 } } });
      return false;
    }
    await tx.webinarQuestionVote.create({ data: { questionId: qid, voterKey, tenantId: question.tenantId } });
    await tx.webinarQuestion.update({ where: { id: qid }, data: { upvotes: { increment: 1 } } });
    return true;
  });

  const fresh = await prisma.webinarQuestion.findUnique({ where: { id: qid }, select: { upvotes: true } });
  return NextResponse.json({ voted, upvotes: fresh?.upvotes ?? 0 });
}
