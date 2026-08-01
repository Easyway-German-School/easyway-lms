import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMergedSchedule, dayKey, normalizeSlot, TIME_SLOTS } from "@/lib/class-sessions";
import { NextRequest, NextResponse } from "next/server";
import { KIND, notify } from "@/lib/notify";
import {
  isAssigned,
  readAssignment,
  type LecturerAssignment,
} from "@/lib/lecturer-assignment";

/**
 * The tutor's control over their students' calendar.
 *
 * This is the one place a tutor changes what a class day actually is: its
 * topic, its clock times, the material to bring, and — the case this exists
 * for — whether it has been postponed and to when. Students read the same rows
 * through /api/schedule, so an edit here is on their calendar immediately, and
 * they are told about it rather than left to notice.
 *
 * What a tutor may edit is bounded by the assignment the ADMIN gave them. They
 * can move their own class; they cannot reach into somebody else's.
 */

export const dynamic = "force-dynamic";

const STATUSES = ["scheduled", "postponed", "cancelled", "held"];

type Staff = {
  userId: string;
  role: string;
  lecturerId: string | null;
  assignment: LecturerAssignment | null;
};

async function requireStaff(): Promise<{ error: NextResponse } | { staff: Staff }> {
  const session = (await getServerSession(authOptions as any)) as any;
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, lecturer: true },
  });

  const role = (user?.role ?? "").toLowerCase();
  if (role !== "lecturer" && role !== "admin") {
    return { error: NextResponse.json({ error: "Staff access required" }, { status: 403 }) };
  }

  return {
    staff: {
      userId: user!.id,
      role,
      lecturerId: user?.lecturer?.id ?? null,
      // An admin has no assignment and is not bounded by one — the office can
      // fix any branch's timetable, which is the whole point of the office.
      assignment: user?.lecturer ? readAssignment(user.lecturer) : null,
    },
  };
}

/**
 * May this person edit this cohort's timetable?
 *
 * An empty sitting list on the assignment means "every sitting", matching the
 * rule the roster uses — an admin who left the field blank gave the tutor all
 * three, so refusing them here would contradict the roster they can see.
 */
function mayEdit(staff: Staff, branchId: string, level: string, slot: string): boolean {
  if (staff.role === "admin") return true;
  const assignment = staff.assignment;
  if (!assignment || !isAssigned(assignment)) return false;
  if (!assignment.branchIds.includes(branchId)) return false;
  if (!assignment.levels.some((item) => item.toUpperCase() === level.toUpperCase())) return false;
  if (assignment.sessionSlots.length && !assignment.sessionSlots.includes(slot)) return false;
  return true;
}

/** GET — the merged timetable for one branch+level, so the tutor edits in context. */
export async function GET(req: NextRequest) {
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;
  const { staff } = auth;

  try {
    const assignment = staff.assignment;

    // A tutor gets their own class by default rather than having to find it.
    const branchId =
      req.nextUrl.searchParams.get("branchId") ?? assignment?.branchIds[0] ?? null;
    const level = req.nextUrl.searchParams.get("level") ?? assignment?.levels[0] ?? "A1";
    const batch = req.nextUrl.searchParams.get("batch");
    // Which sitting is being edited. A branch can run the same level morning
    // and evening, and those are different classes with different topics.
    const slot = normalizeSlot(req.nextUrl.searchParams.get("slot") ?? assignment?.sessionSlots[0] ?? null);

    if (!branchId) {
      return NextResponse.json(
        {
          error:
            staff.role === "lecturer"
              ? "You have not been assigned a class yet. The school office sets this."
              : "branchId is required",
        },
        { status: 400 },
      );
    }

    if (!mayEdit(staff, branchId, level, slot)) {
      return NextResponse.json({ error: "That class is not yours to edit" }, { status: 403 });
    }

    const schedule = await getMergedSchedule({
      branchId,
      level,
      batch,
      sessionSlot: slot,
      now: new Date(),
      months: 2,
    });

    // Everything the editor needs to populate its dropdowns. A tutor is offered
    // only the branches and levels they were assigned; an admin gets the lot.
    const [branches, materials] = await Promise.all([
      prisma.branch.findMany({
        where: staff.role === "admin" ? {} : { id: { in: assignment?.branchIds ?? [] } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, mode: true },
      }),
      prisma.material.findMany({
        orderBy: { title: "asc" },
        select: { id: true, title: true, fileType: true, course: { select: { level: true } } },
      }),
    ]);

    return NextResponse.json({
      ...schedule,
      branches,
      materials,
      timeSlots: TIME_SLOTS,
      assignment,
      /** What the editor is currently pointed at, echoed so the page can lock its controls. */
      context: { branchId, level, slot },
      canChooseCohort: staff.role === "admin",
    });
  } catch (error) {
    console.error("Lecturer sessions GET failed:", error);
    return NextResponse.json({ error: "Unable to load the timetable" }, { status: 500 });
  }
}

/** PUT — create or update the override for a single day. */
export async function PUT(req: NextRequest) {
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;
  const { staff } = auth;

  try {
    const body = await req.json();
    const { branchId, level, date, timeSlot, topic, notes, status, startTime, endTime, materialId, postponedTo } = body;

    if (!branchId || !level || !date) {
      return NextResponse.json({ error: "branchId, level and date are required" }, { status: 400 });
    }
    if (status && !STATUSES.includes(status)) {
      return NextResponse.json({ error: `status must be one of ${STATUSES.join(", ")}` }, { status: 400 });
    }

    const slot = normalizeSlot(timeSlot);
    const day = dayKey(date);
    const normalisedLevel = String(level).toUpperCase();

    if (!mayEdit(staff, branchId, normalisedLevel, slot)) {
      return NextResponse.json({ error: "That class is not yours to edit" }, { status: 403 });
    }

    // A postponement without a new date is the thing students complain about:
    // the class disappears and nobody says when it is. Require the date.
    if (status === "postponed" && !postponedTo) {
      return NextResponse.json(
        { error: "Tell your students the new date — a postponed class needs one." },
        { status: 400 },
      );
    }

    const previous = await prisma.classSession.findUnique({
      where: {
        branchId_level_date_timeSlot: { branchId, level: normalisedLevel, date: day, timeSlot: slot },
      },
      select: { status: true, postponedTo: true, materialId: true, startTime: true, endTime: true },
    });

    const data = {
      topic: typeof topic === "string" ? topic.trim() || null : undefined,
      notes: typeof notes === "string" ? notes.trim() || null : undefined,
      status: status ?? undefined,
      startTime: typeof startTime === "string" ? startTime.trim() || null : undefined,
      endTime: typeof endTime === "string" ? endTime.trim() || null : undefined,
      materialId: materialId === null ? null : (typeof materialId === "string" && materialId ? materialId : undefined),
      // Clearing the postponement is explicit: moving a class back to
      // "scheduled" must drop the old new-date, or the calendar keeps showing
      // a reschedule that is no longer happening.
      postponedTo:
        status && status !== "postponed"
          ? null
          : postponedTo
            ? new Date(postponedTo)
            : postponedTo === null
              ? null
              : undefined,
      // Record who last touched the day, when we know which lecturer they are.
      lecturerId: staff.lecturerId ?? undefined,
    };

    const saved = await prisma.classSession.upsert({
      where: {
        branchId_level_date_timeSlot: { branchId, level: normalisedLevel, date: day, timeSlot: slot },
      },
      update: data,
      create: {
        branchId,
        level: normalisedLevel,
        date: day,
        timeSlot: slot,
        ...data,
        // upsert-create needs concrete values, not the `undefined` no-ops above.
        topic: typeof topic === "string" ? topic.trim() || null : null,
        status: status ?? "scheduled",
      },
      include: {
        material: { select: { id: true, title: true, filePath: true, fileType: true } },
        lecturer: { select: { user: { select: { name: true } } } },
      },
    });

    await announceChange({
      previous,
      saved,
      branchId,
      level: normalisedLevel,
      slot,
      day,
    });

    return NextResponse.json({ session: saved });
  } catch (error) {
    console.error("Lecturer sessions PUT failed:", error);
    return NextResponse.json({ error: "Unable to save this class" }, { status: 500 });
  }
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "long",
  day: "numeric",
  month: "long",
};

/**
 * Tell the class what changed.
 *
 * Only for changes a student would want a message about — a postponement, a
 * cancellation, a new material, a time change. Editing the day's topic is a
 * normal part of preparing a lesson and buzzing two hundred phones for it
 * would train everybody to ignore the notifications that matter.
 */
async function announceChange(args: {
  previous: { status: string; postponedTo: Date | null; materialId: string | null; startTime: string | null; endTime: string | null } | null;
  saved: { status: string; postponedTo: Date | null; materialId: string | null; startTime: string | null; endTime: string | null; material: { title: string } | null };
  branchId: string;
  level: string;
  slot: string;
  day: Date;
}) {
  const { previous, saved, branchId, level, day } = args;
  const when = day.toLocaleDateString("en-GB", DATE_FORMAT);

  const statusChanged = previous?.status !== saved.status;
  const dateChanged = String(previous?.postponedTo ?? "") !== String(saved.postponedTo ?? "");
  const materialAdded = saved.materialId && previous?.materialId !== saved.materialId;
  const timesChanged =
    previous !== null &&
    (previous.startTime !== saved.startTime || previous.endTime !== saved.endTime);

  let title = "";
  let message = "";
  let severity: "info" | "warning" = "info";

  if (saved.status === "postponed" && (statusChanged || dateChanged)) {
    const movedTo = saved.postponedTo
      ? saved.postponedTo.toLocaleDateString("en-GB", DATE_FORMAT)
      : null;
    title = `Your ${level} class on ${when} has been postponed`;
    message = movedTo
      ? `It has been moved to ${movedTo}. Your calendar has been updated.`
      : "Your tutor will confirm the new date shortly.";
    severity = "warning";
  } else if (saved.status === "cancelled" && statusChanged) {
    title = `Your ${level} class on ${when} has been cancelled`;
    message = "It will not be running. Check your calendar for the next session.";
    severity = "warning";
  } else if (saved.status === "scheduled" && previous && previous.status === "postponed") {
    title = `Your ${level} class on ${when} is back on`;
    message = "The postponement has been lifted and the class runs as originally timetabled.";
  } else if (materialAdded) {
    title = `New material for your ${level} class on ${when}`;
    message = saved.material?.title
      ? `Your tutor attached “${saved.material.title}”. Open your calendar to download it before class.`
      : "Your tutor attached a new material. Open your calendar to download it before class.";
  } else if (timesChanged) {
    title = `Your ${level} class on ${when} has a new time`;
    message = `It now runs ${saved.startTime ?? "—"} to ${saved.endTime ?? "—"}.`;
  } else {
    return;
  }

  await notify({
    to: { students: { branchId, level, sessionSlot: args.slot } },
    kind: saved.status === "postponed" || saved.status === "cancelled" ? KIND.classStarting : KIND.materialPublished,
    severity,
    title,
    message,
    link: "/calendar",
    // One announcement per day per state. A tutor who saves the same
    // postponement twice does not send it twice.
    dedupeKey: `session:${branchId}:${level}:${day.toISOString()}:${saved.status}:${saved.postponedTo?.toISOString() ?? ""}:${saved.materialId ?? ""}`,
  }).catch((error) => console.error("Class change notification failed", error));
}
