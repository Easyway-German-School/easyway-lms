import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMergedSchedule, dayKey, normalizeSlot, TIME_SLOTS } from "@/lib/class-sessions";
import { sessionDurationMonths } from "@/lib/levels";
import { NextRequest, NextResponse } from "next/server";
import { KIND, notify } from "@/lib/notify";
import {
  isAssigned,
  readAssignment,
  type LecturerAssignment,
} from "@/lib/lecturer-assignment";
import { canonicalBatch } from "@/lib/class-batch";
import { batchesForCohort } from "@/lib/class-batches-server";
import { tutorTeachingGroups } from "@/lib/tutor-classes-server";

/**
 * The tutor's control over their students' calendar.
 *
 * This is the one place a tutor changes what a class day actually is: its
 * topic, its clock times, the material to bring, and — the case this exists
 * for — whether it has moved and to when. Students read the same rows
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
  /** The tutor's own row (null for an admin) — needed to list their classes by batch. */
  lecturer: ({ id: string } & NonNullable<Parameters<typeof readAssignment>[0]>) | null;
};

async function requireStaff(): Promise<{ error: NextResponse } | { staff: Staff }> {
  const session = await requireAuthSession();
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
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
      lecturer: user?.lecturer ?? null,
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
function mayEdit(staff: Staff, branchId: string, level: string, slot: string, batch = ""): boolean {
  if (staff.role === "admin") return true;
  const assignment = staff.assignment;
  if (!assignment || !isAssigned(assignment)) return false;
  // A tutor the office pinned to the September batch may not edit October's
  // calendar — and may not write a batch-less row either, which would reach
  // every batch of the sitting.
  const wanted = canonicalBatch(batch);
  const batchOk = (pinned: string | undefined | null) => {
    const only = canonicalBatch(pinned);
    return !only || only === wanted;
  };
  if (assignment.groups.length) {
    return assignment.groups.some(
      (group) =>
        group.branchId === branchId &&
        group.level.toUpperCase() === level.toUpperCase() &&
        group.sessionSlot === slot &&
        batchOk(group.batch),
    );
  }
  if (!assignment.branchIds.includes(branchId)) return false;
  if (!assignment.levels.some((item) => item.toUpperCase() === level.toUpperCase())) return false;
  if (assignment.sessionSlots.length && !assignment.sessionSlots.includes(slot)) return false;
  if (assignment.batches.length && !assignment.batches.some((item) => canonicalBatch(item) === wanted)) return false;
  return true;
}

/**
 * Which batch a write is for — and whether the caller is allowed to touch it.
 *
 * A class day belongs to ONE batch. When the class has more than one batch in it
 * (September and October, say) a write that does not say which is refused rather
 * than guessed: guessing is how a postponement for one batch lands on the other's
 * calendar. The timetable always sends the batch; this is the net under a stale
 * tab or an old client.
 */
async function resolveWriteBatch(
  staff: Staff,
  branchId: string,
  level: string,
  slot: string,
  requested: unknown,
): Promise<{ batch: string } | { error: NextResponse }> {
  const batch = canonicalBatch(requested);
  if (!mayEdit(staff, branchId, level, slot, batch)) {
    return { error: NextResponse.json({ error: "That class is not yours to edit" }, { status: 403 }) };
  }
  if (!batch) {
    const { batches } = await batchesForCohort({ branchId, level, sessionSlot: slot });
    if (batches.length > 1) {
      return {
        error: NextResponse.json(
          {
            error: `This class has more than one batch in it (${batches.map((b) => b.batch).join(", ")}). Choose which batch you are changing.`,
            batches,
          },
          { status: 400 },
        ),
      };
    }
  }
  return { batch };
}

/** GET — the merged timetable for one branch+level, so the tutor edits in context. */
export async function GET(req: NextRequest) {
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;
  const { staff } = auth;

  try {
    const assignment = staff.assignment;

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

    // A tutor gets their own class by default rather than having to find it.
    // An admin has no assignment to fall back on, so they get whatever branch
    // sorts first — the dropdowns let them switch from there.
    //
    // When the admin pinned exact teaching groups, the default MUST be one of
    // those. The flat branchIds/levels/sessionSlots arrays are a union mirror of
    // every group the tutor has ever had, and they are not pruned when a group
    // is removed — so `levels[0]` can point at a level this tutor no longer
    // teaches, and mayEdit() (which checks the groups) then correctly refuses
    // it, and the tutor sees "That class is not yours to edit" on their own
    // timetable. Reading the default from groups[0] keeps GET and mayEdit in
    // step.
    const primaryGroup = assignment?.groups[0] ?? null;

    const branchId =
      req.nextUrl.searchParams.get("branchId") ??
      primaryGroup?.branchId ??
      assignment?.branchIds[0] ??
      (staff.role === "admin" ? branches[0]?.id : null) ??
      null;
    const level =
      req.nextUrl.searchParams.get("level") ??
      primaryGroup?.level ??
      assignment?.levels[0] ??
      "A1";
    // Which sitting is being edited. A branch can run the same level morning
    // and evening, and those are different classes with different topics.
    const slot = normalizeSlot(
      req.nextUrl.searchParams.get("slot") ??
        primaryGroup?.sessionSlot ??
        assignment?.sessionSlots[0] ??
        null,
    );
    // The intake month to build the schedule window from. Explicit param wins;
    // otherwise take it from the teaching group being viewed, so a tutor
    // opening a pinned class lands on the months it actually runs rather than
    // on today. Falls back to the tutor's standalone batch, then to none.
    const pinnedGroupBatch = assignment?.groups.find(
      (group) =>
        group.branchId === branchId &&
        group.level.toUpperCase() === String(level).toUpperCase() &&
        group.sessionSlot.toLowerCase() === slot.toLowerCase(),
    )?.batch;
    const requestedBatch = req.nextUrl.searchParams.get("batch");

    if (!branchId) {
      return NextResponse.json(
        {
          error:
            staff.role === "lecturer"
              ? "You have not been assigned a class yet. The school office sets this."
              : "No branches have been set up yet.",
        },
        { status: 400 },
      );
    }

    // The batches this class really has students in, so the editor can say
    // "September batch · 14 students" next to "October batch · 9 students".
    const cohort = await batchesForCohort({ branchId, level, sessionSlot: slot });

    // Which batch the editor opens on: the one asked for, else the one the office
    // pinned this tutor to, else the longest-running batch in the class. Never
    // left blank when the class has batches — a blank batch is the shared
    // calendar, which is exactly what must not be edited by accident.
    const batch =
      canonicalBatch(requestedBatch) ||
      canonicalBatch(pinnedGroupBatch) ||
      canonicalBatch(assignment?.batches[0]) ||
      cohort.batches[0]?.batch ||
      "";

    if (!mayEdit(staff, branchId, level, slot, batch)) {
      return NextResponse.json({ error: "That class is not yours to edit" }, { status: 403 });
    }

    const schedule = await getMergedSchedule({
      branchId,
      level,
      batch,
      sessionSlot: slot,
      now: new Date(),
      months: sessionDurationMonths(slot),
    });

    // A tutor picks among THEIR classes, one per batch (an admin picks freely).
    const classes =
      staff.role === "lecturer" && staff.lecturer
        ? (await tutorTeachingGroups(staff.lecturer, new Map(branches.map((b) => [b.id, b.name])))).map((group) => ({
            key: group.key,
            branchId: group.branchId,
            branchName: group.branchName,
            level: group.level,
            sessionSlot: group.sessionSlot,
            batch: group.batch,
            label: group.label,
            batchRange: group.batchRange,
          }))
        : [];

    return NextResponse.json({
      ...schedule,
      branches,
      materials,
      timeSlots: TIME_SLOTS,
      assignment,
      /** What the editor is currently pointed at, echoed so the page can lock its controls. */
      context: { branchId, level, slot, batch },
      /** The batches in the class being edited, with their student counts. */
      batches: cohort.batches,
      unplaced: cohort.unplaced,
      /** A tutor's own classes, one per batch. */
      classes,
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
    const {
      branchId,
      level,
      date,
      timeSlot,
      topic,
      notes,
      status,
      startTime,
      endTime,
      materialId,
      postponedTo,
      batch: requestedBatch,
      // Admin-only: assign (or clear, with null) which tutor teaches this class.
      // Distinct from the `lecturerId` a tutor's own save stamps below — never
      // conflate the two, or a tutor moving their own class could silently
      // overwrite an admin's assignment on someone else's cohort.
      assignedLecturerId,
    } = body;

    if (!branchId || !level || !date) {
      return NextResponse.json({ error: "branchId, level and date are required" }, { status: 400 });
    }
    if (status && !STATUSES.includes(status)) {
      return NextResponse.json({ error: `status must be one of ${STATUSES.join(", ")}` }, { status: 400 });
    }

    const slot = normalizeSlot(timeSlot);
    const day = dayKey(date);
    const normalisedLevel = String(level).toUpperCase();

    const resolved = await resolveWriteBatch(staff, branchId, normalisedLevel, slot, requestedBatch);
    if ("error" in resolved) return resolved.error;
    const { batch } = resolved;

    // A move without a new date is the thing students complain about: the
    // class disappears and nobody says when it is. Require the date.
    if (status === "postponed" && !postponedTo) {
      return NextResponse.json(
        { error: "Tell your students the new date — a moved class needs one." },
        { status: 400 },
      );
    }

    // One class per cohort per day. Moving onto a day that already has this
    // cohort's class would stack two on one calendar square, and a student can
    // only read one of them. A row that has itself moved away, or was cancelled,
    // leaves its day free.
    if (status === "postponed" && postponedTo) {
      const target = dayKey(postponedTo);
      // Only THIS batch's calendar can be crowded: its own rows and the old
      // shared ones. The other batch having a class that day is not a clash.
      const mine = { in: batch ? [batch, ""] : [""] };
      const [occupant, alsoMovingHere] = await Promise.all([
        prisma.classSession.findFirst({
          where: { branchId, level: normalisedLevel, date: target, timeSlot: slot, batch: mine },
          orderBy: { batch: "desc" },
          select: { status: true },
        }),
        prisma.classSession.findFirst({
          where: {
            branchId,
            level: normalisedLevel,
            timeSlot: slot,
            batch: mine,
            status: "postponed",
            postponedTo: target,
            NOT: { date: day },
          },
          select: { id: true },
        }),
      ]);
      const busy = (occupant && occupant.status !== "cancelled" && occupant.status !== "postponed") || alsoMovingHere;
      if (busy) {
        return NextResponse.json(
          { error: "This class already has a session on that day — pick a different day." },
          { status: 409 },
        );
      }
    }

    // What this batch's day said before the edit — its own row, or the old shared
    // one it was inheriting — so the announcement only fires on a real change.
    const previous = await prisma.classSession.findFirst({
      where: {
        branchId,
        level: normalisedLevel,
        date: day,
        timeSlot: slot,
        batch: { in: batch ? [batch, ""] : [""] },
      },
      orderBy: { batch: "desc" },
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
      // An admin explicitly assigning/clearing a tutor wins; otherwise, record
      // who last touched the day when we know which lecturer they are (a no-op
      // for an admin, who has no `lecturerId` of their own).
      lecturerId:
        staff.role === "admin" && assignedLecturerId !== undefined
          ? (typeof assignedLecturerId === "string" && assignedLecturerId ? assignedLecturerId : null)
          : staff.lecturerId ?? undefined,
    };

    const saved = await prisma.classSession.upsert({
      where: {
        branchId_level_date_timeSlot_batch: { branchId, level: normalisedLevel, date: day, timeSlot: slot, batch },
      },
      update: data,
      create: {
        branchId,
        level: normalisedLevel,
        date: day,
        timeSlot: slot,
        batch,
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
      batch,
    });

    return NextResponse.json({ session: saved });
  } catch (error) {
    console.error("Lecturer sessions PUT failed:", error);
    return NextResponse.json({ error: "Unable to save this class" }, { status: 500 });
  }
}

/**
 * POST — add a one-off class on a day the rotation engine did not generate.
 *
 * The engine owns which days a cohort normally meets; this is the escape hatch
 * for the extra Saturday revision class, the catch-up session, the day the
 * school adds by hand. It writes a normal ClassSession row, which
 * `getMergedSchedule` now picks up alongside the skeleton, so the class appears
 * on the tutor's timetable and every student's calendar at once.
 */
export async function POST(req: NextRequest) {
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;
  const { staff } = auth;

  try {
    const body = await req.json().catch(() => ({}));
    const { branchId, level, timeSlot, date, topic, startTime, endTime, batch: requestedBatch } = body;

    if (!branchId || !level || !date) {
      return NextResponse.json({ error: "branchId, level and date are required" }, { status: 400 });
    }

    const parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime())) {
      return NextResponse.json({ error: "That date could not be read" }, { status: 400 });
    }

    const slot = normalizeSlot(timeSlot);
    const day = dayKey(date);
    const normalisedLevel = String(level).toUpperCase();

    const resolved = await resolveWriteBatch(staff, branchId, normalisedLevel, slot, requestedBatch);
    if ("error" in resolved) return resolved.error;
    const { batch } = resolved;

    const existing = await prisma.classSession.findUnique({
      where: {
        branchId_level_date_timeSlot_batch: { branchId, level: normalisedLevel, date: day, timeSlot: slot, batch },
      },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: "There is already a class that day for this sitting — open it to edit." },
        { status: 409 },
      );
    }

    const session = await prisma.classSession.create({
      data: {
        branchId,
        level: normalisedLevel,
        date: day,
        timeSlot: slot,
        batch,
        topic: typeof topic === "string" ? topic.trim() || null : null,
        startTime: typeof startTime === "string" ? startTime.trim() || null : null,
        endTime: typeof endTime === "string" ? endTime.trim() || null : null,
        status: "scheduled",
        lecturerId: staff.lecturerId ?? undefined,
      },
      include: {
        material: { select: { id: true, title: true, filePath: true, fileType: true } },
        lecturer: { select: { user: { select: { name: true } } } },
      },
    });

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    console.error("Lecturer sessions POST failed:", error);
    return NextResponse.json({ error: "Unable to add this class" }, { status: 500 });
  }
}

/**
 * Class days are stored as midnight UTC (see `dayKey`), so they must be
 * FORMATTED in UTC too. Without the timeZone pin this renders in the server's
 * local zone, and on any host behind UTC every notification named the day
 * before — telling students a Monday class had moved off a Sunday.
 */
const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
};

/**
 * Tell the class what changed.
 *
 * Only for changes a student would want a message about — a move, a
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
  /** The batch this change is for. Only its students are told. */
  batch: string;
}) {
  const { previous, saved, branchId, level, day, batch } = args;
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
    // Lead with WHERE it went — that is the only thing the student needs.
    title = movedTo ? `Your ${level} class has moved to ${movedTo}` : `Your ${level} class on ${when} has moved`;
    message = movedTo
      ? `It was on ${when}. Your calendar now shows it on the new day.`
      : "Your tutor will confirm the new date shortly.";
    severity = "warning";
  } else if (saved.status === "cancelled" && statusChanged) {
    title = `Your ${level} class on ${when} has been cancelled`;
    message = "It will not be running. Check your calendar for the next session.";
    severity = "warning";
  } else if (saved.status === "scheduled" && previous && previous.status === "postponed") {
    title = `Your ${level} class is back on ${when}`;
    message = "The move has been undone — it runs on its original day again.";
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

  // Name the batch when there is one, so a student reads "your A1 class (September
  // batch)" — and, the point of it, so the OTHER batch is not told theirs moved.
  if (batch) title = title.replace(" class", ` class (${batch} batch)`);

  await notify({
    to: { students: { branchId, level, sessionSlot: args.slot, ...(batch ? { batch } : {}) } },
    kind: saved.status === "postponed" || saved.status === "cancelled" ? KIND.classStarting : KIND.materialPublished,
    severity,
    title,
    message,
    link: "/calendar",
    push: true,
    // One announcement per day per state. A tutor who saves the same
    // move twice does not send it twice.
    dedupeKey: `session:${branchId}:${level}:${batch}:${day.toISOString()}:${saved.status}:${saved.postponedTo?.toISOString() ?? ""}:${saved.materialId ?? ""}`,
  }).catch((error) => console.error("Class change notification failed", error));
}
