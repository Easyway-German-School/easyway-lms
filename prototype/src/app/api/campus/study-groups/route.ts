import { NextResponse } from "next/server";

import { campusSession } from "@/lib/campus-api";
import {
  isStudyGroupFocus,
  STUDY_GROUP_CAPACITY,
  studyGroupName,
  studyGroupTiming,
} from "@/lib/study-groups";
import {
  loadStudyGroupViewer,
  publicStudyGroup,
  studyGroupScope,
} from "@/lib/study-groups-server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await campusSession();
  if (!auth.ok) return auth.response;

  const context = await loadStudyGroupViewer(auth.userId);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  const now = new Date();

  try {
    await prisma.studyGroup.deleteMany({
      where: { ...studyGroupScope(context.viewer), expiresAt: { lte: now } },
    });
    const groups = await prisma.studyGroup.findMany({
      where: {
        ...studyGroupScope(context.viewer),
        expiresAt: { gt: now },
      },
      orderBy: [{ startsAt: "asc" }, { createdAt: "desc" }],
      take: 30,
      include: {
        ownerUser: { select: { name: true } },
        members: {
          orderBy: { joinedAt: "asc" },
          select: { userId: true, role: true, user: { select: { name: true } } },
        },
        _count: { select: { members: true } },
      },
    });

    return NextResponse.json(
      {
        groups: groups.map((group) => publicStudyGroup(group, auth.userId)),
        capacity: STUDY_GROUP_CAPACITY,
        cohort: { level: context.viewer.level },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Could not load Campus study groups:", error);
    return NextResponse.json({ error: "Could not load study groups." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await campusSession();
  if (!auth.ok) return auth.response;

  const context = await loadStudyGroupViewer(auth.userId);
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
  const body = (await request.json().catch(() => null)) as { focus?: unknown; startsAt?: unknown } | null;
  if (!body || !isStudyGroupFocus(body.focus)) {
    return NextResponse.json({ error: "Choose a study focus." }, { status: 400 });
  }

  const timing = studyGroupTiming(body.startsAt);
  if (!timing.ok) return NextResponse.json({ error: timing.error }, { status: 400 });

  try {
    const group = await prisma.studyGroup.create({
      data: {
        name: studyGroupName(context.viewer.level, body.focus),
        focus: body.focus,
        level: context.viewer.level,
        sessionSlot: context.viewer.sessionSlot,
        batch: context.viewer.batch,
        band: context.viewer.band,
        startsAt: timing.startsAt,
        expiresAt: timing.expiresAt,
        branch: { connect: { id: context.viewer.branchId } },
        ownerUser: { connect: { id: auth.userId } },
        ...(context.viewer.tenantId ? { tenantRef: { connect: { id: context.viewer.tenantId } } } : {}),
        members: {
          create: {
            role: "owner",
            user: { connect: { id: auth.userId } },
          },
        },
      },
      include: {
        ownerUser: { select: { name: true } },
        members: {
          orderBy: { joinedAt: "asc" },
          select: { userId: true, role: true, user: { select: { name: true } } },
        },
        _count: { select: { members: true } },
      },
    });

    return NextResponse.json(
      { group: publicStudyGroup(group, auth.userId), capacity: STUDY_GROUP_CAPACITY },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Could not create Campus study group:", error);
    return NextResponse.json({ error: "Could not start that study group." }, { status: 500 });
  }
}
