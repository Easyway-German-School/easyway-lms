import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import {
  belongsToLecturer,
  isAssigned,
  studentWhereForLecturer,
} from "@/lib/lecturer-assignment";
import { isReceivedPayment, isRegistrationFeePayment } from "@/lib/payment";
import { accessFromStudent } from "@/lib/student-access";
import { setStudentTutor } from "@/lib/tutor-pairing";
import {
  compareByAction,
  summarizePlans,
  type LinkAction,
  type LinkPlan,
} from "@/lib/tutor-class-match";
import { loadLinkContext, planFor, unlinkStudentFromTutor } from "@/lib/tutor-link";

/**
 * Which students a tutor teaches, from the office's side.
 *
 * GET answers the question the office actually has when it opens a tutor: WHO
 * FITS THIS CLASS, and what would linking each of them do? Not "who are the 25
 * newest students in the school" — which is what this used to return whenever
 * nothing was typed, and is why the list looked like a random sample of the
 * whole LMS instead of the class being set up.
 *
 * `roster` is the class as it stands PLUS everybody who fits it but is not
 * linked yet, each with a `plan` from `lib/tutor-class-match.ts` — the one rule
 * that decides primary vs co-tutor. `results` is a whole-school search, and
 * only runs when the office types something: the way to add somebody OUTSIDE
 * the class (cover, a sitting that moved, a one-to-one).
 */

export const dynamic = "force-dynamic";

function money(amount: number) {
  return Number.isFinite(amount) ? amount : 0;
}

type RowPlan = { action: LinkAction; role: LinkPlan["role"] | null; reason: string };

type StudentRow = {
  id: string;
  name: string;
  email: string;
  studentCode: string | null;
  level: string;
  sessionSlot: string;
  classType: string;
  deliveryMode: string;
  branchName: string | null;
  totalPaid: number;
  tuitionFee: number;
  hasPaid: boolean;
  /** "October 2026" while placed in an intake that has not opened. */
  waitingBatch: string | null;
  /** Intake month, e.g. "September" — shown so batch is visible next to level and sitting. */
  batch: string | null;
  currentTutorId: string | null;
  currentTutorName: string | null;
  /** Extra tutors already on this student. */
  coTutorIds: string[];
  /** In this tutor's class because the office named them (primary or co-tutor), not by matching. */
  namedByOffice: boolean;
  /** How linking this student to THIS tutor would work — see lib/tutor-class-match.ts. */
  plan: RowPlan | null;
};

const STUDENT_SHAPE = {
  id: true,
  branchId: true,
  level: true,
  sessionSlot: true,
  classType: true,
  pathway: true,
  deliveryMode: true,
  hybridOnlineSlot: true,
  studentCode: true,
  admission: true,
  tutorId: true,
  classesStartedAt: true,
  createdAt: true,
  paymentGraceUntil: true,
  user: { select: { name: true, email: true } },
  branch: { select: { name: true } },
  payments: { select: { amount: true, status: true, description: true } },
  tuitionCharges: {
    where: { deletedAt: null },
    select: { id: true, level: true, amount: true, waivedAmount: true, legacyArrears: true, createdAt: true, settledAt: true },
  },
  tutor: { select: { id: true, user: { select: { name: true, email: true } } } },
  coTutors: { select: { lecturerId: true } },
} as const;

type RawStudent = {
  id: string;
  branchId: string | null;
  level: string;
  sessionSlot: string;
  classType: string;
  pathway: string;
  deliveryMode: string;
  hybridOnlineSlot: string | null;
  studentCode: string | null;
  tutorId: string | null;
  classesStartedAt: Date | null;
  createdAt: Date;
  paymentGraceUntil: Date | null;
  /** The batch month lives here — the upcoming-batch lock reads it. */
  admission: unknown;
  user: { name: string | null; email: string };
  branch: { name: string } | null;
  payments: Array<{ amount: number; status: string; description?: string | null }>;
  tuitionCharges: Array<{
    id: string;
    level: string;
    amount: number;
    waivedAmount: number;
    legacyArrears: boolean;
    createdAt: Date;
    settledAt: Date | null;
  }>;
  tutor: { id: string; user: { name: string | null; email: string } } | null;
  coTutors: { lecturerId: string }[];
};

function batchOf(admission: unknown): string | null {
  const record = admission && typeof admission === "object" ? (admission as Record<string, unknown>) : {};
  return typeof record.batch === "string" && record.batch ? record.batch : null;
}

function toRow(student: RawStudent, lecturerId: string | null, plan: LinkPlan | null): StudentRow {
  const receivedTuitionPayments = student.payments.filter(
    (payment) => isReceivedPayment(payment.status) && !isRegistrationFeePayment(payment.description),
  );
  // Same computation the student's own portal and the admin remote view run
  // (lib/student-access.ts) — not a hand-rolled copy, which is exactly what
  // let this tag disagree with whether the student could actually get into
  // class. `paymentPlanOnTrack` is skipped: it is its own async query per
  // student, too expensive for a search result of twenty-five, and skipping
  // it only ever makes `hasPaid` STRICTER than the truth, never wrongly "paid".
  const accessInput = { ...student, payments: receivedTuitionPayments };
  const access = accessFromStudent(accessInput);
  const totalPaid = access.totalPaid;
  const coTutorIds = student.coTutors.map((link) => link.lecturerId);

  return {
    id: student.id,
    name: student.user.name || student.user.email,
    email: student.user.email,
    studentCode: student.studentCode,
    level: student.level,
    sessionSlot: student.sessionSlot,
    classType: student.classType,
    deliveryMode: student.deliveryMode,
    branchName: student.branch?.name ?? null,
    totalPaid: money(totalPaid),
    tuitionFee: money(access.tuitionFee),
    // Shown next to every result so nobody hands a class to somebody who has
    // not paid for it without at least seeing that first.
    hasPaid: access.hasAccess,
    waitingBatch: access.batchLocked ? access.batchLabel : null,
    batch: batchOf(student.admission),
    currentTutorId: student.tutor?.id ?? null,
    currentTutorName: student.tutor ? student.tutor.user.name || student.tutor.user.email : null,
    coTutorIds,
    namedByOffice: Boolean(lecturerId && (student.tutorId === lecturerId || coTutorIds.includes(lecturerId))),
    plan: plan ? { action: plan.action, role: plan.role ?? null, reason: plan.reason } : null,
  };
}

/** GET ?lecturerId=&q= — the class as it stands, who fits it but isn't linked, and (only when asked) a whole-school search. */
export async function GET(request: NextRequest) {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  const lecturerId = (request.nextUrl.searchParams.get("lecturerId") ?? "").trim();
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();

  const context = lecturerId ? await loadLinkContext(lecturerId) : null;
  if (lecturerId && !context) {
    return NextResponse.json({ error: "Tutor not found" }, { status: 404 });
  }

  const assignment = context?.assignment ?? null;
  const assigned = assignment ? isAssigned(assignment) : false;
  const rosterWhere = context && assignment ? studentWhereForLecturer(assignment, context.lecturerId) : null;

  const [rosterRaw, fitRaw, searchRaw] = await Promise.all([
    rosterWhere
      ? prisma.student.findMany({
          where: { ...(rosterWhere as Record<string, unknown>), status: "active" } as never,
          select: STUDENT_SHAPE,
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
    // Everybody at the levels this tutor teaches. The exact branch / sitting /
    // batch / hybrid-half decision is made in memory by `planLink`, because the
    // online half of a hybrid student lives on fields the SQL roster never
    // looks at. Capped so a mis-set tutor cannot pull the whole school.
    assigned && assignment
      ? prisma.student.findMany({
          where: { status: "active", level: { in: assignment.levels } } as never,
          select: STUDENT_SHAPE,
          orderBy: { createdAt: "asc" },
          take: 1500,
        })
      : Promise.resolve([]),
    // Typed searches only. An empty box used to return the 25 newest students
    // in the school, which read as "the students we picked for this tutor".
    query
      ? prisma.student.findMany({
          where: {
            OR: [
              { studentCode: { contains: query, mode: "insensitive" as const } },
              { user: { name: { contains: query, mode: "insensitive" as const } } },
              { user: { email: { contains: query, mode: "insensitive" as const } } },
            ],
          },
          select: STUDENT_SHAPE,
          orderBy: { createdAt: "desc" },
          take: 25,
        })
      : Promise.resolve([]),
  ]);

  const matchedRoster = (rosterRaw as unknown as RawStudent[]).filter((student) =>
    assignment ? belongsToLecturer(assignment, lecturerId, student) : false,
  );

  // The class = what the roster query returns + everybody the rule says fits
  // (which adds the online half of hybrid students). De-duplicated by id.
  const classById = new Map<string, RawStudent>();
  for (const student of matchedRoster) classById.set(student.id, student);
  if (context) {
    for (const student of fitRaw as unknown as RawStudent[]) {
      if (classById.has(student.id)) continue;
      const plan = planFor(context, student);
      if (plan.action !== "no_fit" && plan.action !== "linked") classById.set(student.id, student);
    }
  }

  const roster = [...classById.values()]
    .map((student) => {
      const plan = context ? planFor(context, student) : null;
      // A student the roster query matched but the rule cannot place (an edge
      // case, e.g. a sitting typo) is still on the roster — show them as plain
      // "matched" rather than inventing an action.
      return toRow(student, lecturerId || null, plan && plan.action !== "no_fit" ? plan : null);
    })
    .sort(
      (a, b) =>
        compareByAction(a.plan?.action ?? "linked", b.plan?.action ?? "linked") ||
        a.level.localeCompare(b.level) ||
        a.name.localeCompare(b.name),
    );

  const results = (searchRaw as unknown as RawStudent[]).map((student) =>
    toRow(student, lecturerId || null, context ? planFor(context, student) : null),
  );

  const summary = summarizePlans(roster.map((row) => ({ action: row.plan?.action ?? "linked" })));

  return NextResponse.json({
    roster,
    results,
    summary,
    /** With this off the school allows ONE extra tutor per student, not more. */
    sharedStudentsEnabled: context?.sharedStudentsEnabled ?? false,
    // So the panel can say "12 of these come from the class description" and
    // make the difference between the two routes visible rather than folklore.
    matchedByAssignment: roster.filter((student) => !student.namedByOffice).length,
    namedCount: roster.filter((student) => student.namedByOffice).length,
    hasClassAssignment: assigned,
  });
}

/**
 * POST — put a student on a tutor as PRIMARY (replacing whoever it was), or take
 * them off THIS tutor with `unlink: true`.
 *
 * `lecturerId: null` (clear the primary, whoever it is) is kept for the student
 * roster and the dossier, which call it. The tutor's own panel now sends
 * `unlink` so removing a co-tutor cannot clear somebody else's primary.
 */
export async function POST(request: NextRequest) {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => null);
  const studentId = typeof body?.studentId === "string" ? body.studentId : "";
  const lecturerId = typeof body?.lecturerId === "string" && body.lecturerId ? body.lecturerId : null;

  if (!studentId) {
    return NextResponse.json({ error: "studentId is required" }, { status: 400 });
  }

  if (body?.unlink === true) {
    if (!lecturerId) return NextResponse.json({ error: "lecturerId is required to unlink" }, { status: 400 });
    const result = await unlinkStudentFromTutor({ studentId, lecturerId, assignedById: gate.session.user.id });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, changed: result.changed, was: result.was });
  }

  const result = await setStudentTutor({ studentId, lecturerId });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    success: true,
    tutorName: result.tutorName,
    studentName: result.studentName,
    changed: result.changed,
  });
}
