import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { monthsSinceBatchStart } from "@/lib/promotion";
import { nextLevelAfter, SESSION_MONTHS, WEEKS_OF_TEACHING, sessionDurationMonths, weeksOfTeachingFor } from "@/lib/levels";
import { isLevelSellable, requiredDepositFor, tuitionFeeFor } from "@/lib/payment";
import { ADVANCE_PERKS, perWeekCost, type LevelAdvanceOffer } from "@/lib/level-advance";
import { buildCountdown } from "@/lib/germany-journey";
import { KIND, notify } from "@/lib/notify";
import { getStudentAccess } from "@/lib/student-access";

export const dynamic = "force-dynamic";

/**
 * Does this student's dashboard need to show the "next level" offer?
 *
 * THE SCHOOL DECIDES THIS, NOT THE CALENDAR.
 *
 * This used to be derived from the batch month: two months after the batch
 * name on the admission payload, the portal declared the level finished. That
 * was wrong in the one direction that costs the school money. A student
 * signing up in August for the September batch was read as having started the
 * previous September, so the very first dashboard they ever opened
 * congratulated them on finishing A1 and tried to sell them A2 — before they
 * had attended a single lesson. Nothing else on the screen recovers from that.
 *
 * So the offer now fires off `Student.levelCompletedFor`, which is set in one
 * place only: a super admin marking a batch finished in the cohort console. A
 * human being who was in the building says the level ended, and only then does
 * the student hear about it.
 *
 * The notification is still written here, on read, rather than by a scheduled
 * job — a cron that fires at 3am is one more thing to deploy and to notice has
 * stopped, and writing it when the student opens their dashboard reaches the
 * same person at a moment they are already paying attention.
 * `Student.advanceOfferedFor` makes it fire once per level.
 */
export async function GET() {
  try {
    const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    // Registration date anchored — see lib/batch.ts. Only used for the "how
    // long have you been at this" figures below, never to decide eligibility.
    const monthsElapsed = monthsSinceBatchStart(batch, new Date(), student.createdAt);
    const currentLevel = student.level;
    const nextLevel = nextLevelAfter(currentLevel);
    const branchName = student.branch?.name ?? null;

    // One condition, and a person put it there. The countdown on the journey
    // map is what a student watches while a level runs; this is what they see
    // when the school says it is over.
    const eligible = student.levelCompletedFor === currentLevel && student.levelCompletedAt !== null;

    // pathway is passed through so an Exam Preparatory (or Travel Package)
    // student is quoted their own ladder here, not the ordinary group/private
    // price — the same fee `ensureChargeForLevel` will actually bill them.
    const feeLookup = {
      level: currentLevel,
      branch: branchName,
      classType: student.classType,
      pathway: student.pathway,
    };
    const access = await getStudentAccess(student.id);
    const currentFee = access?.tuitionFee ?? tuitionFeeFor(feeLookup);
    const currentLevelOutstanding = access?.currentLevelOutstanding ?? currentFee;

    const nextFee = nextLevel
      ? tuitionFeeFor({ ...feeLookup, level: nextLevel })
      : 0;

    const offer: LevelAdvanceOffer = {
      eligible,
      currentLevel,
      nextLevel,
      atTopOfLadder: nextLevel === null,
      branchName,
      batch,
      monthsElapsed: monthsElapsed ?? 0,
      // Measured from the day the school signed the level off, not from the
      // batch month — those are different dates whenever a batch runs late,
      // and this one drives how hard the copy pushes.
      monthsSinceFinishing: student.levelCompletedAt
        ? Math.max(
            0,
            (new Date().getFullYear() * 12 + new Date().getMonth()) -
              (student.levelCompletedAt.getFullYear() * 12 + student.levelCompletedAt.getMonth()),
          )
        : 0,
      sessionMonths: sessionDurationMonths(student.sessionSlot),
      weeksOfTeaching: weeksOfTeachingFor(student.sessionSlot),
      tuitionFee: nextFee,
      requiredDeposit: nextLevel ? requiredDepositFor({ ...feeLookup, level: nextLevel }) : 0,
      perWeek: perWeekCost(nextFee, weeksOfTeachingFor(student.sessionSlot)),
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
                ? `Congratulations on finishing ${currentLevel}. There is ₦${currentLevelOutstanding.toLocaleString()} still open on it — clear that and your place in ${nextLevel} is confirmed. ${nextLevel} runs for ${sessionDurationMonths(student.sessionSlot)} months and costs ₦${nextFee.toLocaleString()} at ${branchName || "your branch"}.`
                : `Congratulations on finishing ${currentLevel}. ${nextLevel} runs for ${sessionDurationMonths(student.sessionSlot)} months and costs ₦${nextFee.toLocaleString()} at ${branchName || "your branch"}. Continue now to keep your tutor, your class and your streak.`,
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
    } else if (!eligible && nextLevel && student.classesStartedAt) {
      // Escalating heads-up in the weeks before the level's own clock runs
      // out — separate from the offer above, which only exists once the
      // office has actually signed the level off. This is in-app only, never
      // a modal: the moment queue deliberately keeps commerce out of anything
      // that interrupts (see lib/moment-queue.tsx), and a countdown nudge is
      // exactly that kind of interruption if it pops up over whatever the
      // student opened the dashboard to do.
      try {
        const { daysLeft, phase } = buildCountdown(currentLevel, student.classesStartedAt, {
          now: new Date(),
          months: sessionDurationMonths(student.sessionSlot),
        });

        // Three tiers, one dedupeKey shape each — notify()'s own dedupeKey is
        // the idempotency mechanism (see lib/notify.ts), so no new Student
        // column is needed to track which nudge already fired.
        let dedupeKey: string | null = null;
        if (phase === "overdue") {
          dedupeKey = null;
        } else if (daysLeft <= 7) {
          dedupeKey = `level-nudge:${student.id}:${currentLevel}:final-week`;
        } else if (daysLeft <= 14) {
          dedupeKey = `level-nudge:${student.id}:${currentLevel}:3d:${Math.floor(daysLeft / 3)}`;
        } else if (daysLeft <= 21) {
          dedupeKey = `level-nudge:${student.id}:${currentLevel}:heads-up`;
        }

        if (dedupeKey) {
          await notify({
            to: { studentIds: [student.id] },
            kind: KIND.levelAdvance,
            severity: "info",
            title: daysLeft === 0
              ? `${currentLevel} teaching period ends today`
              : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left in ${currentLevel}`,
            message:
              daysLeft === 0
                ? `Your scheduled ${currentLevel} teaching period ends today. This is a calendar reminder only: it does not confirm a pass or move you to ${nextLevel}. Your school will confirm completion and next steps.`
                : daysLeft === 1
                  ? `Your scheduled ${currentLevel} teaching period ends tomorrow. This reminder does not confirm a pass or move you to ${nextLevel}; your school will confirm completion and next steps.`
                  : `${daysLeft} days remain in your scheduled ${currentLevel} teaching period. This reminder does not change your level; your school will confirm completion and next steps.`,
            link: "/dashboard",
            dedupeKey,
          });
        }
      } catch (nudgeError) {
        console.error("Level-clock nudge failed", nudgeError);
      }
    }

    return NextResponse.json({ offer, notified });
  } catch (error) {
    console.error("Level-advance lookup failed", error);
    return NextResponse.json({ error: "Could not check your level progress" }, { status: 500 });
  }
}
