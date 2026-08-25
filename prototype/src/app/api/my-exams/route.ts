import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { myExams, isCandidateRole } from "@/lib/candidates";
import { listOpenExams } from "@/lib/exam-centre";
import { isExamBodyLive } from "@/lib/tenant/features";
import { featuresForCurrentTenant } from "@/lib/tenant/features-server";

/**
 * Everything the signed-in person has booked, plus what they could still book.
 *
 * Works for students and exam candidates alike — the difference is only what
 * comes back alongside it, not a separate endpoint.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true, name: true, email: true },
    });

    const student = await prisma.student.findUnique({
      where: { userId: session.user.id },
      select: { level: true, branchId: true, studentCode: true },
    });

    const [registered, available, features] = await Promise.all([
      myExams(session.user.id),
      // Deliberately NOT filtered to the student's own branch. An exam centre
      // is not a classroom: someone at the Abuja branch may well sit an ÖSD
      // exam in Lagos, and hiding those sittings would just look like the
      // school offers no exams. Each sitting shows its centre so the choice
      // is theirs.
      listOpenExams(),
      featuresForCurrentTenant(),
    ]);

    const bookedExamIds = new Set(registered.map((r) => r.examId).filter(Boolean));

    return NextResponse.json({
      isCandidate: isCandidateRole(user?.role),
      isStudent: Boolean(student),
      name: user?.name ?? null,
      studentCode: student?.studentCode ?? null,
      level: student?.level ?? null,
      upcoming: registered.filter((r) => !r.isPast),
      past: registered.filter((r) => r.isPast),
      // Never offer a sitting they already hold a seat for, and never offer
      // one whose awarding body isn't live for this tenant — the server-side
      // half of the gate; MyExamsPanel used to do this filtering alone, which
      // left the booking endpoint itself wide open.
      available: available.filter((e) => !bookedExamIds.has(e.id) && isExamBodyLive(features, e.examBody)),
      goetheReferralUrl: features.examCentre.goetheReferralUrl,
    });
  } catch (error) {
    console.error("my-exams failed:", error);
    return NextResponse.json({ error: "Unable to load your exams" }, { status: 500 });
  }
}
