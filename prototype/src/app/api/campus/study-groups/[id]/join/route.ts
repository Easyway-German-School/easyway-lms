import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { campusSession } from "@/lib/campus-api";
import { STUDY_GROUP_CAPACITY } from "@/lib/study-groups";
import { loadStudyGroupViewer, studyGroupScope } from "@/lib/study-groups-server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await campusSession();
  if (!auth.ok) return auth.response;

  const viewerContext = await loadStudyGroupViewer(auth.userId);
  if (!viewerContext.ok) return NextResponse.json({ error: viewerContext.error }, { status: viewerContext.status });
  const { id } = await context.params;

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const group = await tx.studyGroup.findFirst({
          where: {
            id,
            ...studyGroupScope(viewerContext.viewer),
            expiresAt: { gt: new Date() },
          },
          select: {
            id: true,
            _count: { select: { members: true } },
            members: { where: { userId: auth.userId }, select: { id: true } },
          },
        });
        if (!group) return { status: 404 as const, error: "That study group is no longer available." };
        if (group.members.length > 0) return { status: 200 as const, joined: true };
        if (group._count.members >= STUDY_GROUP_CAPACITY) {
          return { status: 409 as const, error: "That study group is full." };
        }

        await tx.studyGroupMember.create({
          data: { groupId: group.id, userId: auth.userId },
        });
        return { status: 200 as const, joined: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ joined: result.joined }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({ error: "Someone just joined. Refresh and try again." }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ joined: true }, { headers: { "Cache-Control": "no-store" } });
    }
    console.error("Could not join Campus study group:", error);
    return NextResponse.json({ error: "Could not join that study group." }, { status: 500 });
  }
}
