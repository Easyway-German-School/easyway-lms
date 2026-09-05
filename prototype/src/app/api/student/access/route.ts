import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deriveStudentAccess, hasProfilePhoto } from "@/lib/access";
import { requiredDepositFor, tuitionFeeFor, receivedPaymentFilter } from "@/lib/payment";
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
      level: true,
      classType: true,
      pathway: true,
      // Drives which pages exist for this student at all — the live classroom
      // is meaningless to somebody who attends on campus.
      deliveryMode: true,
      // The fee depends on the branch as well as the level — leaving it out
      // would compute an Abuja student's gate at the cheaper Lagos price.
      branch: { select: { name: true } },
      // The clock the part-payment lock runs on: 30 days after the confirmed
      // first day of classes (falling back to enrolment), unless an admin has
      // granted grace.
      classesStartedAt: true,
      createdAt: true,
      paymentGraceUntil: true,
      // Drives the photo lock screen — see hasProfilePhoto below.
      admission: true,
      payments: {
        // Received tuition money only — `receivedPaymentFilter` now excludes
        // the ₦5,000 registration fee, so it cannot push the student past the
        // deposit gate or the balance lock.
        where: receivedPaymentFilter(),
        select: { amount: true },
      },
      // The per-level ledger drives the deposit gate and the balance lock — a
      // student promoted with a balance open below must not walk into the next
      // level for free. See src/lib/finance/ledger.ts.
      tuitionCharges: {
        where: { deletedAt: null },
        select: { id: true, level: true, amount: true, waivedAmount: true, legacyArrears: true, createdAt: true, settledAt: true },
      },
    },
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const totalPaid = student.payments.reduce((sum, payment) => sum + payment.amount, 0);
  const feeLookup = { level: student.level, branch: student.branch?.name ?? null, classType: student.classType, pathway: student.pathway };

  // An on-track tuition payment plan holds the balance lock back, like grace.
  const planStatus = await planStatusForStudent(student.id);

  const access = deriveStudentAccess({
    totalPaid,
    tuitionFee: tuitionFeeFor(feeLookup),
    requiredDeposit: requiredDepositFor(feeLookup),
    deliveryMode: student.deliveryMode,
    // Was selected above for the fee lookup and then dropped, so the portal
    // could not tell a private student from a group one — and hid the live
    // classroom from private students the server was happy to admit.
    classType: student.classType,
    level: student.level,
    charges: student.tuitionCharges,
    classesStartedAt: student.classesStartedAt,
    enrolledAt: student.createdAt,
    paymentGraceUntil: student.paymentGraceUntil,
    paymentPlanOnTrack: planSuppressesLock(planStatus?.adherence ?? null),
  });
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
        severity: "info",
        title: "Your payment is all sorted — just one more thing",
        message:
          "Becca here — great news, your tuition is confirmed and your classes are ready. The only thing between " +
          "you and them is a profile photo, which takes about ten seconds (camera or upload both work). Nothing to " +
          "do with your payment — add one from your profile page and everything opens right back up.",
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
