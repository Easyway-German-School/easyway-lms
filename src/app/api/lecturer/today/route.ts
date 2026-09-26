import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dayKey } from "@/lib/class-sessions";
import { liveWhere } from "@/lib/live-presence";
import { instantToZonedParts } from "@/lib/school-time";
import { ASSESSMENT_TYPES } from "@/lib/grading";
import { pickFocusIndex, sittingNote, sittingStateAt, type SittingState } from "@/lib/tutor-today";
import {
  belongsToLecturer,
  isAssigned,
  readAssignment,
  studentWhereForLecturer,
  teachingGroups,
} from "@/lib/lecturer-assignment";

export const dynamic = "force-dynamic";

/**
 * EVERYTHING THE TUTOR'S DASHBOARD NEEDS TO ACT, IN ONE REQUEST.
 *
 * This route exists because of a click count. Taking a register was four clicks
 * and two dropdowns — find Tracking in the sidebar, open Attendance, pick the
 * class, pick the date — before a single student's name appeared, and every
 * other daily job started the same way. All four of those steps were the tutor
 * telling the portal something it already knew: who they teach, which of those
 * classes is sitting right now, and that "the date" means today.
 *
 * So the answer is computed here, once, server-side, and the dashboard opens on
 * it. `/api/live/state` already answers "am I live" for the panel that watches a
 * running class; this answers the different question of "what am I about to do",
 * which needs the whole teaching day rather than the open room.
 *
 * Nothing here is a new source of truth. The classes come from the admin-set
 * assignment (`teachingGroups`), the hours from `SLOT_DEFAULTS`, the register
 * from the same `(studentId, date)` key the register page writes — so the card
 * cannot drift from the pages it shortcuts.
 */
export async function GET() {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id || String(session.user.role ?? "").toLowerCase() !== "lecturer") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const lecturer = await prisma.lecturer.findUnique({
      where: { userId: session.user.id },
      select: {
        id: true,
        level: true,
        sessionSlot: true,
        branchId: true,
        branchIds: true,
        levels: true,
        sessionSlots: true,
        assignmentGroups: true,
        batches: true,
      },
    });
    if (!lecturer) {
      return NextResponse.json({ error: "Lecturer profile not found" }, { status: 404 });
    }

    // The school's own wall clock, not the server's. Vercel runs UTC; a 17:00
    // Lagos evening class would otherwise read as 16:00 and never be "on now".
    const now = new Date();
    const clock = instantToZonedParts(now);
    const assignment = readAssignment(lecturer);

    const activeBranches = await prisma.branch.findMany({
      where: { status: "active" },
      select: { id: true, name: true },
    });
    const groups = teachingGroups(
      assignment,
      new Map(activeBranches.map((branch) => [branch.id, branch.name])),
      // Rooms are per tutor (PR #149); without this, `isLive` below compares
      // against a room name the session route never opens.
      lecturer.id,
    );

    /**
     * A tutor with no class described by the office still gets a usable card as
     * long as students were named onto them individually — the roster, register
     * and marks all work off named students too. What they do not get is a
     * "class" to go live with, which is the honest answer rather than an empty
     * room.
     */
    const where = studentWhereForLecturer(assignment, lecturer.id);
    const roster = where
      ? (
          await prisma.student.findMany({
            where: { ...(where as Record<string, unknown>), status: "active" } as never,
            select: {
              id: true,
              level: true,
              sessionSlot: true,
              tutorId: true,
              admission: true,
              coTutors: { select: { lecturerId: true } },
            },
          })
        ).filter((student) => belongsToLecturer(assignment, lecturer.id, student))
      : [];

    if (!roster.length && !isAssigned(assignment)) {
      return NextResponse.json({
        assigned: false,
        message: "You have not been assigned a class yet. The school office sets this.",
        groups: [],
        focusKey: null,
        register: null,
        live: null,
        assessmentTypes: ASSESSMENT_TYPES,
        today: { dateKey: clock.dateKey, clock: clock.clock },
      });
    }

    const [marksToday, open] = await Promise.all([
      // "Is today's register already done?" — so the card can say so instead of
      // inviting a tutor to take the same register twice.
      prisma.attendance.count({
        where: { studentId: { in: roster.map((student) => student.id) }, date: dayKey(clock.dateKey) },
      }),
      prisma.liveClassSession.findFirst({
        where: { lecturerId: lecturer.id, ...liveWhere() },
        orderBy: { startedAt: "desc" },
        select: { id: true, title: true, joinCode: true, roomName: true, startedAt: true },
      }),
    ]);

    const states: SittingState[] = groups.map((group) =>
      sittingStateAt(group.sessionSlot, clock.clock, clock.weekday),
    );
    const focus = pickFocusIndex(states);

    return NextResponse.json({
      assigned: true,
      today: { dateKey: clock.dateKey, clock: clock.clock },
      groups: groups.map((group, index) => ({
        key: group.key,
        label: group.label,
        branchName: group.branchName,
        level: group.level,
        sessionSlot: group.sessionSlot,
        batchRange: group.batchRange,
        // How many of this tutor's students sit in THIS group, so the card can
        // say "14 students" rather than the tutor's whole caseload.
        studentCount: roster.filter(
          (student) =>
            String(student.level ?? "").toUpperCase() === group.level &&
            (!group.sessionSlot ||
              String(student.sessionSlot ?? "").toLowerCase() === group.sessionSlot),
        ).length,
        state: states[index],
        note: sittingNote(states[index], group.sessionSlot),
        // Reopens the room already running rather than starting a second one.
        isLive: open ? open.roomName === group.roomName : false,
      })),
      focusKey: focus >= 0 ? groups[focus].key : null,
      register: {
        total: roster.length,
        marked: marksToday,
        // Partial counts as not done: a tutor who saved half a register needs
        // the prompt, and re-saving is idempotent (the route upserts).
        takenToday: roster.length > 0 && marksToday >= roster.length,
      },
      live: open
        ? { id: open.id, title: open.title, joinCode: open.joinCode, startedAt: open.startedAt }
        : null,
      assessmentTypes: ASSESSMENT_TYPES,
    });
  } catch (error) {
    console.error("Tutor today lookup failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
