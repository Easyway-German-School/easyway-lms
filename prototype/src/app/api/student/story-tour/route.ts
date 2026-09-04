import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * The one-time "how a class story works" coach-mark.
 *
 * Separate from /api/student/onboarding on purpose: that route answers "has
 * this student seen the portal tour", and folding a second unrelated flag into
 * it would make both callers carry the other's concern. This one does nothing
 * but read and set `Student.storyTourSeenAt`.
 *
 * Server-side rather than localStorage for the same reason as the welcome tour:
 * a student who meets the story game on a laptop should not be walked through
 * it again on their phone.
 */

export async function GET() {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const student = await prisma.student.findUnique({
      where: { userId: session.user.id },
      select: { storyTourSeenAt: true },
    });

    // A non-student (a tutor opening the community) has no row and no tour —
    // report it as already seen so the coach-mark never fires for them.
    return NextResponse.json({ seen: student ? Boolean(student.storyTourSeenAt) : true });
  } catch (error) {
    console.error("Story tour lookup failed", error);
    return NextResponse.json({ error: "Could not load your story tour state" }, { status: 500 });
  }
}

/** Marks it finished or skipped. Both end it — neither is a failure. */
export async function POST() {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await prisma.student.updateMany({
      where: { userId: session.user.id },
      data: { storyTourSeenAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Could not save story tour state", error);
    return NextResponse.json({ error: "Could not save your story tour state" }, { status: 500 });
  }
}
