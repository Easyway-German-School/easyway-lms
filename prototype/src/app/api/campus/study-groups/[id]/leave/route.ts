import { NextResponse } from "next/server";

import { campusSession } from "@/lib/campus-api";
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
    const result = await prisma.$transaction(async (tx) => {
      const group = await tx.studyGroup.findFirst({
        where: { id, ...studyGroupScope(viewerContext.viewer) },
        select: {
          id: true,
          ownerUserId: true,
          members: { orderBy: { joinedAt: "asc" }, select: { userId: true } },
        },
      });
      if (!group) return { status: 404 as const, error: "Study group not found." };
      if (!group.members.some((member) => member.userId === auth.userId)) {
        return { status: 400 as const, error: "You are not in that study group." };
      }

      const nextOwner =
        group.ownerUserId === auth.userId
          ? group.members.find((member) => member.userId !== auth.userId)?.userId
          : undefined;
      if (nextOwner) {
        await tx.studyGroup.update({ where: { id: group.id }, data: { ownerUserId: nextOwner } });
        await tx.studyGroupMember.updateMany({
          where: { groupId: group.id, userId: nextOwner },
          data: { role: "owner" },
        });
      }
      await tx.studyGroupMember.deleteMany({ where: { groupId: group.id, userId: auth.userId } });

      if (group.ownerUserId === auth.userId && !nextOwner) {
        await tx.studyGroup.delete({ where: { id: group.id } });
        return { status: 200 as const, left: true, closed: true };
      }
      return { status: 200 as const, left: true, closed: false };
    });

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not leave Campus study group:", error);
    return NextResponse.json({ error: "Could not leave that study group." }, { status: 500 });
  }
}
