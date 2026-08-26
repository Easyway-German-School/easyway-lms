import { prisma } from "@/lib/prisma";
import type { DetectType } from "@/lib/cohort-missions";
import { goalFor } from "@/lib/germany-goals";
import { storySeriesFor } from "@/lib/story/content";
import { getStoryAccess } from "@/lib/story-progress";

/**
 * Did this actually happen, or did somebody just tap a button?
 *
 * `/api/student/missions` used to take a client-sent `done: true` and write
 * it straight to the database — a mission was "complete" the instant a
 * student decided to say so, with nothing behind it. Every check below reads
 * a record the school already keeps for an unrelated reason (grading,
 * attendance, the quiz engine), which is what makes it something other than
 * the same self-report with extra steps.
 *
 * Each check is a single boolean: did this student produce at least one
 * qualifying row today. Cheap, and deliberately not trying to match a
 * mission's exact wording to an exact lesson — a model-written mission and a
 * database record were never going to agree on phrasing, and asking them to
 * would mean rejecting real work because the mission said "Perfekt tense"
 * and the lesson was titled "Talking about yesterday".
 */

function startOfDay(now: Date): Date {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

export type DetectionContext = {
  userId: string;
  studentId: string;
  tenantId: string | null;
  /** Fixed per call so every mission in one batch is judged against the same "today". */
  since: Date;
};

async function didFinishLesson(ctx: DetectionContext): Promise<boolean> {
  const row = await prisma.completion.findFirst({
    where: { studentId: ctx.studentId, status: "completed", completedAt: { gte: ctx.since } },
    select: { id: true },
  });
  return Boolean(row);
}

async function didSubmitAssignment(ctx: DetectionContext): Promise<boolean> {
  const row = await prisma.assignmentSubmission.findFirst({
    where: {
      studentId: ctx.studentId,
      OR: [{ submittedAt: { gte: ctx.since } }, { createdAt: { gte: ctx.since } }],
    },
    select: { id: true },
  });
  return Boolean(row);
}

async function didPlayQuiz(ctx: DetectionContext): Promise<boolean> {
  const row = await prisma.quizGamePlayer.findFirst({
    where: { studentId: ctx.studentId, joinedAt: { gte: ctx.since }, answered: { gt: 0 } },
    select: { id: true },
  });
  return Boolean(row);
}

async function didAttend(ctx: DetectionContext): Promise<boolean> {
  const row = await prisma.attendance.findFirst({
    where: {
      studentId: ctx.studentId,
      date: { gte: ctx.since },
      OR: [{ present: true }, { status: "present" }, { status: "late" }],
    },
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * "voice" and "essay" have no dedicated table — practising pronunciation or
 * drafting an essay doesn't hand in a graded artifact the way an assignment
 * does. The best honest signal is real time spent on the page that does that
 * job, reported by the same tracker that already feeds the admin's usage
 * dashboards (see StudentUsageTracker.tsx). A `view` with real dwell time is
 * weaker than a graded submission — a tab left open would pass — but it is a
 * server-recorded fact about a whole minute of behaviour, not a checkbox a
 * student can flip with no cost. `generic` uses the same signal with no area
 * filter: at minimum, they opened the app and did something today.
 */
const MIN_DWELL_SECONDS = 45;

async function didUseArea(ctx: DetectionContext, areas: string[]): Promise<boolean> {
  const row = await prisma.learnerUsageEvent.findFirst({
    where: {
      userId: ctx.userId,
      occurredAt: { gte: ctx.since },
      OR: [
        { area: { in: areas }, durationSeconds: { gte: MIN_DWELL_SECONDS } },
        { area: { in: areas }, action: { in: ["complete", "submit"] } },
      ],
    },
    select: { id: true },
  });
  return Boolean(row);
}

async function didAnythingToday(ctx: DetectionContext): Promise<boolean> {
  const row = await prisma.learnerUsageEvent.findFirst({
    where: { userId: ctx.userId, occurredAt: { gte: ctx.since } },
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * "scene" gets a real signal instead of the dwell-time proxy "voice"/"essay"
 * use — a personalized story records exactly which beats were completed and
 * when (story-progress.ts's `history`), so there is no need to guess from
 * time-on-page here.
 */
async function didAdvanceStory(ctx: DetectionContext): Promise<boolean> {
  const student = await prisma.student.findUnique({ where: { id: ctx.studentId }, select: { germanyGoal: true } });
  const series = storySeriesFor(student?.germanyGoal);
  if (!series) return false;
  const access = await getStoryAccess(ctx.studentId, goalFor(student?.germanyGoal).id, series);
  if (access.state !== "playable") return false;
  return access.progress.history.some((entry) => new Date(entry.at) >= ctx.since);
}

/** One check per detect type. Unknown types fall through to "anything today". */
export async function detectionFor(type: DetectType, ctx: DetectionContext): Promise<boolean> {
  switch (type) {
    case "lesson":
      return didFinishLesson(ctx);
    case "assignment":
      return didSubmitAssignment(ctx);
    case "quiz":
      return didPlayQuiz(ctx);
    case "attendance":
      return didAttend(ctx);
    case "voice":
      return didUseArea(ctx, ["tandem", "voice-coach", "pronunciation"]);
    case "essay":
      return didUseArea(ctx, ["essay"]);
    case "scene":
      return didAdvanceStory(ctx);
    case "generic":
    default:
      return didAnythingToday(ctx);
  }
}

export function ctxSince(now = new Date()): Date {
  return startOfDay(now);
}
