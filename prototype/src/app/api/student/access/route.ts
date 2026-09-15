import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasProfilePhoto } from "@/lib/access";
import { accessFromStudent, STUDENT_ACCESS_SELECT } from "@/lib/student-access";
import { planStatusForStudent, planSuppressesLock } from "@/lib/payment-plans";
import { notify, KIND } from "@/lib/notify";

/**
 * The one question every gated page asks: may this student see class content yet?
 *
 * Deliberately tiny. The five gated pages used to each fetch the full
 * /api/student/profile payload — enrollments, materials, every notification and
 * payment row — only to read two booleans off it. The shell now calls this once
 * per navigation instead.
 */
export async function GET() {
  const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id as string },
    select: {
      id: true,
      // Drives the photo lock screen — see hasProfilePhoto below.
      admission: true,
      // Every field the payment gate itself needs — kept in one place
      // (lib/student-access.ts) so this route cannot drift from it by
      // dropping or retyping a field. See accessFromStudent below.
      ...STUDENT_ACCESS_SELECT,
    },
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // An on-track tuition payment plan holds the balance lock back, like grace.
  const planStatus = await planStatusForStudent(student.id);
  const access = accessFromStudent(student, planSuppressesLock(planStatus?.adherence ?? null));
  const hasPhoto = hasProfilePhoto(student.admission);

  /**
   * The moment a PAID student first hits the photo wall, Becca gets in
   * before they can — a student who has settled their fees and then finds
   * their classes locked reads it as "I paid and now something's wrong",
   * unless something tells them in the same breath that the payment is
   * fine and this is a ten-second, unrelated thing. A registration-only
   * student is already stopped by the payment gate itself, so this only
   * fires for the case that actually needs the reassurance.
   *
   * `dedupeKey` has no date/week component — this fires once ever per
   * student, not on every navigation while they remain locked. The ongoing
   * weekly nudge (`profile-photo-nudge.ts`) still covers everyone who still
   * hasn't fixed it days later, paid or not.
   */
  if (!hasPhoto && access.hasAccess) {
    // Awaited, not fire-and-forget: a serverless function is not guaranteed
    // to keep running an un-awaited promise once the handler returns, and a
    // one-time notice that silently never sends defeats the entire point.
    try {
      await notify({
        to: { userIds: [session.user.id as string] },
        kind: KIND.profilePhotoMissing,
        severity: "warning",
        title: "One step to unlock your portal",
        message:
          "Becca here — your payment is in and your classes are ready. Your portal stays locked until there is a " +
          "photo on your profile; that is the only thing holding it. Open your profile page, tap the camera on your " +
          "photo, and take a selfie or upload one. Everything unlocks the moment it saves.",
        link: "/profile",
        push: true,
        dedupeKey: `photo-lock-hit:${student.id}`,
      });
    } catch (error) {
      console.error("Could not send the photo-lock notice:", error);
    }
  }

  return NextResponse.json({
    ...access,
    // Piggybacks on this endpoint rather than a second round trip — the
    // shell already calls this once per navigation for the payment gate.
    hasPhoto,
  });
}
