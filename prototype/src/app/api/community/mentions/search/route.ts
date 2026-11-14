import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authorizeChannel, studentsInSpace } from "@/lib/community-spaces";
import type { MentionType } from "@/lib/chat-mentions";

export const dynamic = "force-dynamic";

/** Enough to fill a short dropdown without it turning into a second scroll area. */
const LIMIT = 6;

type Result = { type: MentionType; id: string; label: string; sub?: string };

/**
 * GET /api/community/mentions/search?channelId=…&q=…
 *
 * What the composer's "@" dropdown calls as a student or tutor types. Scoped
 * to the room's own class — the same branch/level/sitting/batch a Space
 * already resolves to — so a student can never discover, by typing "@", a
 * classmate, assignment or material outside their own cohort.
 */
export async function GET(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const channelId = url.searchParams.get("channelId") ?? "";
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  if (!channelId) return NextResponse.json({ error: "channelId is required" }, { status: 400 });

  const viewer = { userId: session.user.id as string, role: (session.user as any).role };
  const channel = await authorizeChannel(viewer, channelId);
  if (!channel) return NextResponse.json({ error: "Channel not found in your community" }, { status: 403 });

  // A DM thread has no class cohort to search — nothing to tag yet.
  if (!channel.space) return NextResponse.json({ results: [] });

  const space = channel.space;

  const [people, assignments, materials, videos] = await Promise.all([
    searchPeople(space, q),
    searchAssignments(space, q),
    searchMaterials(space, q, "video"),
    searchMaterials(space, q, "document"),
  ]);

  return NextResponse.json({
    results: {
      person: people,
      assignment: assignments,
      material: materials,
      video: videos,
    },
  });
}

async function searchPeople(
  space: { branchId: string; level: string; sessionSlot: string; batch: string },
  q: string,
): Promise<Result[]> {
  const students = await studentsInSpace(space);
  const studentIds = students.map((s) => s.id);
  if (!studentIds.length) return [];

  const rows = await prisma.student.findMany({
    where: { id: { in: studentIds } },
    select: {
      tutorId: true,
      coTutors: { select: { lecturerId: true } },
      user: { select: { id: true, name: true, role: true } },
    },
  });

  const tutorIds = [
    ...new Set(
      rows.flatMap((r) => [r.tutorId, ...r.coTutors.map((c) => c.lecturerId)]).filter((id): id is string => Boolean(id)),
    ),
  ];
  const tutors = tutorIds.length
    ? await prisma.lecturer.findMany({
        where: { id: { in: tutorIds } },
        select: { user: { select: { id: true, name: true } } },
      })
    : [];

  const candidates: Result[] = [
    ...tutors.map((t) => ({ type: "person" as const, id: t.user.id, label: t.user.name ?? "Your tutor", sub: "Tutor" })),
    ...rows
      .filter((r) => r.user)
      .map((r) => ({ type: "person" as const, id: r.user!.id, label: r.user!.name ?? "Classmate", sub: "Classmate" })),
  ];

  const seen = new Set<string>();
  const unique = candidates.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));

  return (q ? unique.filter((c) => c.label.toLowerCase().includes(q)) : unique).slice(0, LIMIT);
}

async function searchAssignments(
  space: { branchId: string; level: string; sessionSlot: string; batch: string },
  q: string,
): Promise<Result[]> {
  const rows = await prisma.assignment.findMany({
    where: {
      published: true,
      level: space.level,
      OR: [{ branchId: null }, { branchId: space.branchId }],
      AND: [
        { OR: [{ sessionSlot: null }, { sessionSlot: space.sessionSlot }] },
        { OR: [{ batch: null }, { batch: space.batch || null }] },
      ],
      ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
    },
    select: { id: true, title: true, type: true },
    orderBy: { createdAt: "desc" },
    take: LIMIT,
  });
  return rows.map((a) => ({ type: "assignment", id: a.id, label: a.title, sub: a.type === "quiz" ? "Quiz" : "Document" }));
}

async function searchMaterials(
  space: { branchId: string; level: string; sessionSlot: string; batch: string },
  q: string,
  kind: "document" | "video",
): Promise<Result[]> {
  const rows = await prisma.material.findMany({
    where: {
      deletedAt: null,
      kind,
      visibleToStudents: true,
      level: space.level,
      OR: [{ branchId: null }, { branchId: space.branchId }],
      ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
    },
    select: { id: true, title: true },
    orderBy: { createdAt: "desc" },
    take: LIMIT,
  });
  return rows.map((m) => ({ type: kind === "video" ? "video" : "material", id: m.id, label: m.title }));
}
