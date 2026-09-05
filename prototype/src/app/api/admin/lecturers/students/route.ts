import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { deriveStudentAccess } from "@/lib/access";
import {
  belongsToLecturer,
  isAssigned,
  readAssignment,
  studentWhereForLecturer,
} from "@/lib/lecturer-assignment";
import { requiredDepositFor, tuitionFeeFor, isReceivedPayment, isRegistrationFeePayment } from "@/lib/payment";
import { setStudentTutor } from "@/lib/tutor-pairing";

/**
 * Which students a tutor teaches, from the office's side.
 *
 * This replaces the private-students screen, which could only ever pair
 * one-to-one students. That limit was wrong in both directions. It left the
 * office unable to say "this group student is in Frau Mami's class" when the
 * class description did not reach them — an online A2 student whose tutor
 * takes the afternoon sitting, say — and it hid the pairing UI entirely unless
 * "Private" was ticked, so nobody knew the mechanism existed at all.
 *
 * GET answers two questions at once, because the office needs both on one
 * screen: who is in this tutor's class already (and by which of the two
 * routes), and who else could be added.
 */

export const dynamic = "force-dynamic";

function money(amount: number) {
  return Number.isFinite(amount) ? amount : 0;
}

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
  currentTutorId: string | null;
  currentTutorName: string | null;
  /** In this tutor's class because the office named them, not by matching. */
  namedByOffice: boolean;
};

const STUDENT_SHAPE = {
  id: true,
  level: true,
  sessionSlot: true,
  classType: true,
  pathway: true,
  deliveryMode: true,
  studentCode: true,
  admission: true,
  tutorId: true,
  user: { select: { name: true, email: true } },
  branch: { select: { name: true } },
  payments: { select: { amount: true, status: true, description: true } },
  tutor: { select: { id: true, user: { select: { name: true, email: true } } } },
} as const;

type RawStudent = {
  id: string;
  level: string;
  sessionSlot: string;
  classType: string;
  pathway: string;
  deliveryMode: string;
  studentCode: string | null;
  tutorId: string | null;
  user: { name: string | null; email: string };
  branch: { name: string } | null;
  payments: Array<{ amount: number; status: string; description?: string | null }>;
  tutor: { id: string; user: { name: string | null; email: string } } | null;
};

function toRow(student: RawStudent, lecturerId: string | null): StudentRow {
  const totalPaid = student.payments
    .filter((payment) => isReceivedPayment(payment.status) && !isRegistrationFeePayment(payment.description))
    .reduce((sum, payment) => sum + payment.amount, 0);

  const feeLookup = {
    level: student.level,
    branch: student.branch?.name ?? null,
    classType: student.classType,
    pathway: student.pathway,
  };
  const access = deriveStudentAccess({
    totalPaid,
    tuitionFee: tuitionFeeFor(feeLookup),
    requiredDeposit: requiredDepositFor(feeLookup),
  });

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
    currentTutorId: student.tutor?.id ?? null,
    currentTutorName: student.tutor ? student.tutor.user.name || student.tutor.user.email : null,
    namedByOffice: Boolean(lecturerId && student.tutorId === lecturerId),
  };
}

/** GET ?lecturerId=&q= — this tutor's roster, plus search results to add from. */
export async function GET(request: NextRequest) {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  const lecturerId = (request.nextUrl.searchParams.get("lecturerId") ?? "").trim();
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();

  const lecturer = lecturerId
    ? await prisma.lecturer.findUnique({ where: { id: lecturerId } })
    : null;

  if (lecturerId && !lecturer) {
    return NextResponse.json({ error: "Tutor not found" }, { status: 404 });
  }

  const assignment = lecturer ? readAssignment(lecturer) : null;
  const rosterWhere = lecturer && assignment ? studentWhereForLecturer(assignment, lecturer.id) : null;

  const [rosterRaw, searchRaw] = await Promise.all([
    rosterWhere
      ? prisma.student.findMany({
          where: { ...(rosterWhere as Record<string, unknown>), status: "active" } as never,
          select: STUDENT_SHAPE,
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
    // The search reaches every student on purpose. The old private-only limit
    // is exactly what stopped the office recording a real pairing.
    prisma.student.findMany({
      where: query
        ? {
            OR: [
              { studentCode: { contains: query, mode: "insensitive" as const } },
              { user: { name: { contains: query, mode: "insensitive" as const } } },
              { user: { email: { contains: query, mode: "insensitive" as const } } },
            ],
          }
        : {},
      select: STUDENT_SHAPE,
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
  ]);

  const roster = (rosterRaw as unknown as RawStudent[])
    .filter((student) => (assignment ? belongsToLecturer(assignment, lecturerId, student) : false))
    .map((student) => toRow(student, lecturerId || null));

  return NextResponse.json({
    roster,
    results: (searchRaw as unknown as RawStudent[]).map((student) => toRow(student, lecturerId || null)),
    // So the panel can say "12 of these come from the class description" and
    // make the difference between the two routes visible rather than folklore.
    matchedByAssignment: roster.filter((student) => !student.namedByOffice).length,
    namedCount: roster.filter((student) => student.namedByOffice).length,
    hasClassAssignment: assignment ? isAssigned(assignment) : false,
  });
}

/** POST — name a student onto a tutor, or clear the pairing with lecturerId: null. */
export async function POST(request: NextRequest) {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => null);
  const studentId = typeof body?.studentId === "string" ? body.studentId : "";
  const lecturerId = typeof body?.lecturerId === "string" && body.lecturerId ? body.lecturerId : null;

  if (!studentId) {
    return NextResponse.json({ error: "studentId is required" }, { status: 400 });
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
