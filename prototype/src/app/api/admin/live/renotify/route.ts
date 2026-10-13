import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import {
  liveWhere,
  announceLiveSession,
  announceLiveToNamedStudents,
  announceLiveToVideoStudents,
  onlyBatchStudents,
  type LiveSessionRow,
} from "@/lib/live-presence";
import { studentsWhoCanEnterLiveClass } from "@/lib/live-eligibility";

export const dynamic = "force-dynamic";

/**
 * ONE-CLICK REPAIR FOR "SOME STUDENTS NEVER GOT THE LIVE PING."
 *
 * Starting a class fires three fan-outs at once, fire-and-forget, the moment
 * the tutor's page opens the room (see the `after()` block in
 * `/api/live/session`): the cohort broadcast (same branch+level+sitting), the
 * named-tutor broadcast (`Student.tutorId` / co-tutors, for students whose
 * cohort fields don't line up with the room they were actually put in), and
 * the hybrid/online broadcast (same branch+level, a different sitting). If
 * any one of those three loses a race — a slow query, a cold start, a
 * student who got their profile photo approved two minutes after the first
 * attempt skipped them — there is nothing left on screen afterwards to say
 * so, and the only thing those students can do is guess at a join code.
 *
 * This replays all three for a session that is STILL live. Nobody already
 * rung gets rung twice: every push shares the original `live-start:<id>`
 * dedupe key, so a student who already has that notification is silently
 * skipped and only the ones who were missed hear the bell now.
 */
export async function POST(request: NextRequest) {
  const gate = await requireCapability("classes");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : null;
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  }

  const session = await prisma.liveClassSession.findFirst({
    where: { id: sessionId, ...liveWhere() },
    include: { lecturer: { select: { id: true, user: { select: { name: true } } } } },
  });
  if (!session) {
    return NextResponse.json({ error: "That class is not live anymore." }, { status: 404 });
  }

  const row: LiveSessionRow = {
    id: session.id,
    roomName: session.roomName,
    joinCode: session.joinCode,
    kind: session.kind,
    title: session.title,
    branchId: session.branchId,
    level: session.level,
    sessionSlot: session.sessionSlot,
    batch: session.batch,
    privateClassId: session.privateClassId,
    startedAt: session.startedAt,
    lecturerName: session.lecturer?.user?.name ?? null,
  };

  // The cohort broadcast — safe to replay even for a private room; it is a
  // no-op there since nobody matches branch+level+sitting for a private id.
  announceLiveSession(row);

  let namedReached = 0;
  if (session.kind === "cohort" && session.lecturer) {
    const named = await prisma.student.findMany({
      where: {
        deletedAt: null,
        OR: [{ tutorId: session.lecturer.id }, { coTutors: { some: { lecturerId: session.lecturer.id } } }],
      },
      select: { id: true, admission: true },
    });
    const reachable = await studentsWhoCanEnterLiveClass(onlyBatchStudents(row, named).map((s) => s.id));
    namedReached = reachable.length;
    announceLiveToNamedStudents(row, reachable);
    await announceLiveToVideoStudents(row);
  }

  return NextResponse.json({ ok: true, namedStudentsConsidered: namedReached });
}
