import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isOnlineBranch } from "@/lib/online-branch";

export const dynamic = "force-dynamic";

async function currentStudent(userId: string) {
  return prisma.student.findUnique({
    where: { userId },
    include: {
      user: { select: { name: true } },
      branch: { select: { name: true, mode: true } },
    },
  });
}

/** What the welcome tour needs to introduce this particular student's portal. */
export async function GET() {
  try {
    const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const student = await currentStudent(session.user.id);
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    return NextResponse.json({
      // First name only. "Welcome, Chidi" reads like a person talking;
      // "Welcome, Chidi Emeka Okafor" reads like a database.
      firstName: (student.user.name || "").trim().split(/\s+/)[0] || null,
      level: student.level,
      branchName: student.branch?.name ?? null,
      isOnlineBranch: isOnlineBranch(student.branch),
      /**
       * physical | hybrid | online. The tour introduces a different portal for
       * each — splitting on the branch alone was wrong for a hybrid student,
       * who is at a campus AND has a live room, and was shown only the campus
       * half of their own product.
       */
      deliveryMode: student.deliveryMode,
      sessionSlot: student.sessionSlot,
      tourSeen: Boolean(student.welcomeTourSeenAt),
    });
  } catch (error) {
    console.error("Onboarding lookup failed", error);
    return NextResponse.json({ error: "Could not load your onboarding" }, { status: 500 });
  }
}

/** Marks the tour finished or skipped. Both end it — neither is a failure. */
export async function POST() {
  try {
    const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await prisma.student.updateMany({
      where: { userId: session.user.id },
      data: { welcomeTourSeenAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Could not save onboarding state", error);
    return NextResponse.json({ error: "Could not save your onboarding" }, { status: 500 });
  }
}
