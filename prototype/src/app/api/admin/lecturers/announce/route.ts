import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { KIND, notify } from "@/lib/notify";
import { belongsToLecturer, readAssignment, studentWhereForLecturer } from "@/lib/lecturer-assignment";

export const dynamic = "force-dynamic";

/**
 * The office sending a message to one tutor's class, from the tutor
 * directory — the same roster the "N students" badge on that tutor's card
 * counts. Mirrors /api/lecturer/announcements, which does this for a tutor
 * addressing their own class: resolve who this tutor actually reaches
 * (matched-by-assignment students, not just the ones with `tutorId` set —
 * see belongsToLecturer) and never trust an id list from the request beyond
 * intersecting it with that roster.
 */
export async function POST(request: NextRequest) {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const lecturerId = typeof body.lecturerId === "string" ? body.lecturerId.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const requestedIds = Array.isArray(body.studentIds)
    ? (body.studentIds as unknown[]).filter((id): id is string => typeof id === "string")
    : null;

  if (!lecturerId) return NextResponse.json({ error: "lecturerId is required" }, { status: 400 });
  if (!title || !message) {
    return NextResponse.json({ error: "A title and a message are both required" }, { status: 400 });
  }

  const lecturer = await prisma.lecturer.findUnique({ where: { id: lecturerId } });
  if (!lecturer) return NextResponse.json({ error: "Tutor not found" }, { status: 404 });

  const assignment = readAssignment(lecturer);
  const where = studentWhereForLecturer(assignment, lecturer.id);
  const reachable = where
    ? await prisma.student.findMany({
        where: { ...(where as Record<string, unknown>), status: "active" } as never,
        select: {
          id: true,
          level: true,
          sessionSlot: true,
          classType: true,
          deliveryMode: true,
          admission: true,
          tutorId: true,
          coTutors: { select: { lecturerId: true } },
        },
      })
    : [];
  const roster = reachable.filter((student) => belongsToLecturer(assignment, lecturer.id, student));

  if (roster.length === 0) {
    return NextResponse.json({ error: "This tutor has no students to message" }, { status: 400 });
  }

  const allowed = new Set(roster.map((s) => s.id));
  const targets = requestedIds ? requestedIds.filter((id) => allowed.has(id)) : [...allowed];

  if (targets.length === 0) {
    return NextResponse.json({ error: "Pick at least one student from this tutor's class" }, { status: 400 });
  }

  const result = await notify({
    to: { studentIds: targets },
    kind: KIND.announcement,
    severity: "info",
    title,
    message,
    link: "/notifications",
    senderId: gate.session.user.id,
    push: true,
  });

  return NextResponse.json({ success: true, sentTo: result.created, pushed: result.pushed });
}
