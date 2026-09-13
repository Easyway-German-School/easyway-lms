import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { studentHasPortalAccess } from "@/lib/student-access";

export const dynamic = "force-dynamic";

async function currentStudent(userId: string) {
  return prisma.student.findUnique({
    where: { userId },
    select: { id: true, tutorialsPromoSeenAt: true },
  });
}

/**
 * Whether this student should see the one-time "come see the new Tutorials
 * page" popup — the exact "portal unlocked" check the lock screen itself
 * runs (studentHasPortalAccess), same shape as /api/student/onboarding.
 */
export async function GET() {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const student = await currentStudent(session.user.id);
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const unlocked = await studentHasPortalAccess(student.id);

    return NextResponse.json({
      due: unlocked && !student.tutorialsPromoSeenAt,
    });
  } catch (error) {
    console.error("Tutorials promo lookup failed", error);
    return NextResponse.json({ error: "Could not load that" }, { status: 500 });
  }
}

/** Marks the popup seen. Shown at most once, ever — every dismissal path counts. */
export async function POST() {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await prisma.student.updateMany({
      where: { userId: session.user.id },
      data: { tutorialsPromoSeenAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Could not save tutorials promo state", error);
    return NextResponse.json({ error: "Could not save that" }, { status: 500 });
  }
}
