import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { EXAM_BODIES } from "@/lib/exam-centre";

/** Staff view of the exam centre: schedule sittings, see who has booked. */

export const dynamic = "force-dynamic";

async function requireExamAdmin() {
  const gate = await requireCapability("exams");
  if (!gate.ok) return gate.response;
  return { userId: gate.session.user.id as string };
}

export async function GET() {
  const auth = await requireExamAdmin();
    if (auth instanceof NextResponse) return auth;

  const [exams, branches] = await Promise.all([
    prisma.exam.findMany({
      orderBy: { examDate: "desc" },
      include: {
        branch: { select: { id: true, name: true } },
        registrations: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true, seatNumber: true, status: true, paymentStatus: true,
            candidateName: true, candidateEmail: true,
            student: { select: { studentCode: true, user: { select: { name: true, email: true } } } },
          },
        },
      },
    }),
    prisma.branch.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return NextResponse.json({
    exams: exams.map((e) => {
      const held = e.registrations.filter((r) => r.status !== "cancelled").length;
      return {
        ...e,
        taken: held,
        remaining: e.capacity === null ? null : Math.max(0, e.capacity - held),
      };
    }),
    branches,
    bodies: EXAM_BODIES,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireExamAdmin();
    if (auth instanceof NextResponse) return auth;

  try {
    const b = await req.json();
    if (!b.name?.trim() || !b.examDate) {
      return NextResponse.json({ error: "A name and exam date are required" }, { status: 400 });
    }

    const examDate = new Date(b.examDate);
    const deadline = b.registrationDeadline ? new Date(b.registrationDeadline) : null;

    // A deadline after the exam itself would let someone book a seat for a
    // sitting that has already happened.
    if (deadline && deadline > examDate) {
      return NextResponse.json(
        { error: "The registration deadline cannot be after the exam date." },
        { status: 400 },
      );
    }

    const exam = await prisma.exam.create({
      data: {
        name: String(b.name).trim(),
        description: b.description?.trim() || null,
        examDate,
        examBody: (EXAM_BODIES as readonly string[]).includes(b.examBody) ? b.examBody : "internal",
        level: b.level || null,
        branchId: b.branchId || null,
        fee: b.fee ? Number(b.fee) : null,
        capacity: b.capacity ? Number(b.capacity) : null,
        registrationDeadline: deadline,
        published: Boolean(b.published),
      },
    });

    return NextResponse.json({ exam });
  } catch (error) {
    console.error("Exam create failed:", error);
    return NextResponse.json({ error: "Unable to create that sitting" }, { status: 500 });
  }
}

/** PATCH — publish/unpublish, or mark a registration paid. */
export async function PATCH(req: NextRequest) {
  const auth = await requireExamAdmin();
    if (auth instanceof NextResponse) return auth;

  try {
    const { examId, published, registrationId, paymentStatus, status } = await req.json();

    if (registrationId) {
      const updated = await prisma.examRegistration.update({
        where: { id: registrationId },
        data: {
          ...(paymentStatus ? { paymentStatus } : {}),
          ...(status ? { status } : {}),
        },
      });
      return NextResponse.json({ registration: updated });
    }

    if (examId) {
      if (published) {
        const exam = await prisma.exam.findUnique({ where: { id: examId }, select: { examDate: true } });
        // Publishing a sitting whose date has passed puts an unbookable entry
        // on the public page.
        if (exam && exam.examDate <= new Date()) {
          return NextResponse.json(
            { error: "That date has already passed — it cannot be published." },
            { status: 400 },
          );
        }
      }
      const updated = await prisma.exam.update({
        where: { id: examId },
        data: { published: Boolean(published) },
      });
      return NextResponse.json({ exam: updated });
    }

    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  } catch (error) {
    console.error("Exam update failed:", error);
    return NextResponse.json({ error: "Unable to update" }, { status: 500 });
  }
}
