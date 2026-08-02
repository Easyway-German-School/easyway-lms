import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { monthsSinceBatchStart } from "@/lib/promotion";
import { nextLevelAfter, SESSION_MONTHS, WEEKS_OF_TEACHING } from "@/lib/levels";
import { isLevelSellable, requiredDepositFor, tuitionFeeFor } from "@/lib/payment";
import { ADVANCE_PERKS, perWeekCost, type LevelAdvanceOffer } from "@/lib/level-advance";

export const dynamic = "force-dynamic";

/**
 * Does this student's dashboard need to show the "next level" offer?
 *
 * The notification is written here, on read, rather than by a scheduled job.
 * A cron that fires at 3am is one more thing to deploy and to notice has
 * stopped; writing it the first time the finished student opens their
 * dashboard reaches exactly the same person at a moment they are already
 * paying attention. `Student.advanceOfferedFor` makes it fire once per level.
 */
export async function GET() {
  try {
    const session = (await getServerSession(authOptions as any)) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const student = await prisma.student.findUnique({
      where: { userId: session.user.id },
      include: { payments: true, branch: { select: { name: true } } },
    });

    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const admission =
      typeof student.admission === "object" && student.admission !== null
        ? (student.admission as Record<string, unknown>)
        : {};
    const batch = typeof admission.batch === "string" && admission.batch.trim() ? admission.batch : null;

    const monthsElapsed = monthsSinceBatchStart(batch);
    const currentLevel = student.level;
    const nextLevel = nextLevelAfter(currentLevel);
    const branchName = student.branch?.name ?? null;

    // No usable batch means no way to know the level ended. Guessing would
    // congratulate students who are two weeks into A1.
    const eligible = monthsElapsed !== null && monthsElapsed >= SESSION_MONTHS;

    const totalPaid = student.payments
      .filter((payment) => payment.status === "completed")
      .reduce((sum, payment) => sum + payment.amount, 0);
    const currentFee = tuitionFeeFor({ level: currentLevel, branch: branchName });
    const currentLevelOutstanding = Math.max(0, currentFee - totalPaid);

    const nextFee = nextLevel ? tuitionFeeFor({ level: nextLevel, branch: branchName }) : 0;

    const offer: LevelAdvanceOffer = {
      eligible,
      currentLevel,
      nextLevel,
      atTopOfLadder: nextLevel === null,
      branchName,
      batch,
      monthsElapsed: monthsElapsed ?? 0,
      monthsSinceFinishing: Math.max(0, (monthsElapsed ?? 0) - SESSION_MONTHS),
      sessionMonths: SESSION_MONTHS,
      weeksOfTeaching: WEEKS_OF_TEACHING,
      tuitionFee: nextFee,
      requiredDeposit: nextLevel ? requiredDepositFor({ level: nextLevel, branch: branchName }) : 0,
      perWeek: perWeekCost(nextFee),
      sellableOnline: nextLevel ? isLevelSellable(nextLevel) : false,
      currentLevelOutstanding,
      perks: ADVANCE_PERKS,
    };

    // Fire the notification once, the first time we see this student finish
    // this level.
    //
    // The marker is written BEFORE the notification, not after. If the write
    // order were reversed and the marker failed, every dashboard load would
    // send another copy — and a student spammed with six identical "your level
    // is complete" notices trusts none of them. Losing one notification is the
    // cheaper failure, and the dashboard card still shows either way.
    let notified = false;
    if (eligible && student.advanceOfferedFor !== currentLevel) {
      await prisma.student.update({
        where: { id: student.id },
        data: { advanceOfferedFor: currentLevel },
      });

      try {
        await prisma.notification.create({
          data: {
            title: offer.atTopOfLadder
              ? `You have completed ${currentLevel} — the top of the ladder`
              : `Your ${currentLevel} class is complete — ${nextLevel} is next`,
            message: offer.atTopOfLadder
              ? `Congratulations. You have finished ${currentLevel}, the highest level we teach. Speak to your branch about registering for your final exam and collecting your certificate.`
              : currentLevelOutstanding > 0
                ? `Congratulations on finishing ${currentLevel}. There is ₦${currentLevelOutstanding.toLocaleString()} still open on it — clear that and your place in ${nextLevel} is confirmed. ${nextLevel} runs for ${SESSION_MONTHS} months and costs ₦${nextFee.toLocaleString()} at ${branchName || "your branch"}.`
                : `Congratulations on finishing ${currentLevel}. ${nextLevel} runs for ${SESSION_MONTHS} months and costs ₦${nextFee.toLocaleString()} at ${branchName || "your branch"}. Continue now to keep your tutor, your class and your streak.`,
            channel: "in-app",
            studentId: student.id,
            branchId: student.branchId,
            level: currentLevel,
            status: "sent",
            sentAt: new Date(),
          },
        });
        notified = true;
      } catch (notifyError) {
        console.error("Level-advance notification failed", notifyError);
      }
    }

    return NextResponse.json({ offer, notified });
  } catch (error) {
    console.error("Level-advance lookup failed", error);
    return NextResponse.json({ error: "Could not check your level progress" }, { status: 500 });
  }
}
