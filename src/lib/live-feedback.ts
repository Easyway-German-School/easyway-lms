import { prisma } from "@/lib/prisma";
import { staleCutoff } from "@/lib/live-presence";
import { notifyInBackground, KIND } from "@/lib/notify";

/**
 * "HOW WAS THAT CLASS?" — asked of everybody who was in it, students AND the tutor.
 *
 * The answer is a note to the office (a 1–5 rating plus what to improve), filed as
 * a `BetaFeedback` row so it lands in the same Becca's-inbox the office already
 * reads. The class is identified inside `path` (`/live/<sessionId> · <title>`),
 * which is what lets one person rate each class once without a new table.
 *
 * WHEN SOMEONE IS ASKED — a person is due a rating for the most recent class
 * they were actually in when:
 *   - the class is over (ended, or its heartbeat has gone quiet) and ran long
 *     enough to be a class rather than a test, within the last two days;
 *   - they have not already answered for it;
 *   - and they have not answered for ANY class recently. A student in class five
 *     days a week must not be asked five times a week: after an answer they are
 *     left alone for three days (a tutor, who teaches more, for one).
 *
 * Skipping is remembered on the device, not here — "not now" is not an answer, and
 * it must not count against the cooldown.
 */

export type FeedbackRole = "student" | "tutor";

export const LIVE_FEEDBACK_KIND: Record<FeedbackRole, string> = {
  student: "live_class",
  tutor: "live_class_tutor",
};

const HOUR = 60 * 60 * 1000;
/** Classes older than this are no longer asked about — the moment has passed. */
const LOOKBACK_MS = 48 * HOUR;
/** After an answer, how long before the same person is asked about another class. */
const COOLDOWN_MS: Record<FeedbackRole, number> = { student: 72 * HOUR, tutor: 24 * HOUR };
/** A session shorter than this was a test or a false start, not a class worth rating. */
const MIN_CLASS_MINUTES = 10;

const MAX_MESSAGE = 2000;

export type FeedbackDue = { sessionId: string; title: string; startedAt: Date; role: FeedbackRole };

type SessionFacts = { id: string; title: string; startedAt: Date; endedAt: Date | null; lastSeenAt: Date };

function isOver(session: SessionFacts, now: Date): boolean {
  return session.endedAt !== null || session.lastSeenAt < staleCutoff(now);
}

function minutesRun(session: SessionFacts): number {
  const end = session.endedAt ?? session.lastSeenAt;
  return (end.getTime() - session.startedAt.getTime()) / 60_000;
}

function sessionIdOf(path: string | null): string | null {
  const match = path?.match(/^\/live\/([^\s·]+)/);
  return match ? match[1] : null;
}

async function whoIs(userId: string): Promise<{ role: FeedbackRole; studentId?: string; lecturerId?: string } | null> {
  const [lecturer, student] = await Promise.all([
    prisma.lecturer.findUnique({ where: { userId }, select: { id: true } }),
    prisma.student.findUnique({ where: { userId }, select: { id: true } }),
  ]);
  if (lecturer) return { role: "tutor", lecturerId: lecturer.id };
  if (student) return { role: "student", studentId: student.id };
  // An admin silently observing, a parent, a stray account — never asked.
  return null;
}

/** The sessions this person actually took part in, newest first. */
async function sessionsTakenPartIn(
  userId: string,
  who: NonNullable<Awaited<ReturnType<typeof whoIs>>>,
  since: Date,
): Promise<SessionFacts[]> {
  const select = { id: true, title: true, startedAt: true, endedAt: true, lastSeenAt: true } as const;

  if (who.role === "student") {
    const invites = await prisma.liveClassInvite.findMany({
      where: { studentId: who.studentId, status: "joined", session: { startedAt: { gte: since } } },
      orderBy: { session: { startedAt: "desc" } },
      take: 10,
      select: { session: { select } },
    });
    return invites.map((invite) => invite.session);
  }

  return prisma.liveClassSession.findMany({
    where: { startedAt: { gte: since }, OR: [{ lecturerId: who.lecturerId }, { startedByUserId: userId }] },
    orderBy: { startedAt: "desc" },
    take: 10,
    select,
  });
}

/**
 * The class this person should be asked about right now, or null.
 * `sessionId` narrows it to one specific class (the end-of-class screen asks
 * about the class that just finished, not "whichever is due").
 */
export async function feedbackDue(userId: string, options: { sessionId?: string } = {}): Promise<FeedbackDue | null> {
  const who = await whoIs(userId);
  if (!who) return null;

  const now = new Date();
  const answers = await prisma.betaFeedback.findMany({
    where: {
      userId,
      kind: LIVE_FEEDBACK_KIND[who.role],
      createdAt: { gte: new Date(now.getTime() - Math.max(LOOKBACK_MS, COOLDOWN_MS[who.role])) },
    },
    select: { path: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const latestAnswer = answers[0]?.createdAt;
  if (latestAnswer && now.getTime() - latestAnswer.getTime() < COOLDOWN_MS[who.role]) return null;

  const answered = new Set(answers.map((row) => sessionIdOf(row.path)).filter((id): id is string => Boolean(id)));
  const sessions = await sessionsTakenPartIn(userId, who, new Date(now.getTime() - LOOKBACK_MS));

  const due = sessions.find(
    (session) =>
      (!options.sessionId || session.id === options.sessionId) &&
      isOver(session, now) &&
      minutesRun(session) >= MIN_CLASS_MINUTES &&
      !answered.has(session.id),
  );
  return due ? { sessionId: due.id, title: due.title, startedAt: due.startedAt, role: who.role } : null;
}

export type SaveFeedbackResult = { ok: true } | { ok: false; status: number; error: string };

/** File one answer. Refuses a class this person was not in, or has already rated. */
export async function saveFeedback(input: {
  userId: string;
  sessionId: string;
  rating: number;
  message: string;
}): Promise<SaveFeedbackResult> {
  const due = await feedbackDue(input.userId, { sessionId: input.sessionId });
  if (!due) return { ok: false, status: 409, error: "That class isn't waiting for feedback." };

  const rating = Math.min(5, Math.max(1, Math.round(input.rating)));
  const message = input.message.trim().slice(0, MAX_MESSAGE) || "No comment left.";

  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { tenantId: true } });
  const feedback = await prisma.betaFeedback.create({
    data: {
      userId: input.userId,
      tenantId: user?.tenantId ?? null,
      kind: LIVE_FEEDBACK_KIND[due.role],
      message: `[${rating}/5] ${message}`,
      path: `/live/${due.sessionId} · ${due.title}`.slice(0, 200),
    },
  });

  // A poor rating of a live class is a complaint about the live classroom as a
  // whole, not about one session's title — so they fold onto a single route.
  if (rating <= 2) {
    const { recordComplaint } = await import("@/lib/incidents");
    await recordComplaint({
      feedbackId: feedback.id,
      kind: due.role === "tutor" ? "live-rating-tutor" : "live-rating",
      path: "/live",
      message: `[${rating}/5] ${message}`,
      userId: input.userId,
      tenantId: user?.tenantId ?? null,
    }).catch(() => {});
  }

  return { ok: true };
}

/**
 * Tell everybody who was in this class to rate it. Called when the tutor ends
 * the class; the popup on their next visit is the safety net for anyone who
 * misses (or has switched off) the notification.
 */
export async function askAboutClass(sessionId: string): Promise<void> {
  const session = await prisma.liveClassSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      title: true,
      startedAt: true,
      endedAt: true,
      lastSeenAt: true,
      lecturer: { select: { userId: true } },
      invites: { where: { status: "joined" }, select: { student: { select: { userId: true } } } },
    },
  });
  if (!session || minutesRun(session) < MIN_CLASS_MINUTES) return;

  const groups: Array<{ role: FeedbackRole; userIds: string[]; link: string; title: string; message: string }> = [
    {
      role: "student",
      userIds: session.invites.map((invite) => invite.student.userId).filter((id): id is string => Boolean(id)),
      link: "/dashboard",
      title: "How was today's class?",
      message: `Rate ${session.title} and tell us what to improve — it takes ten seconds.`,
    },
    {
      role: "tutor",
      userIds: session.lecturer?.userId ? [session.lecturer.userId] : [],
      link: "/lecturer/dashboard",
      title: "How did the class go?",
      message: `Rate ${session.title} and tell the office anything that got in the way — audio, video, students, materials.`,
    },
  ];

  for (const group of groups) {
    if (group.userIds.length === 0) continue;

    // Same cooldown as the popup: somebody who rated a class recently is not pinged.
    const recent = await prisma.betaFeedback.findMany({
      where: {
        userId: { in: group.userIds },
        kind: LIVE_FEEDBACK_KIND[group.role],
        createdAt: { gte: new Date(Date.now() - COOLDOWN_MS[group.role]) },
      },
      select: { userId: true },
    });
    const skip = new Set(recent.map((row) => row.userId));
    const userIds = group.userIds.filter((id) => !skip.has(id));
    if (userIds.length === 0) continue;

    notifyInBackground({
      to: { userIds },
      kind: KIND.liveFeedbackAsk,
      title: group.title,
      message: group.message,
      link: group.link,
      push: true,
      email: false,
      sms: false,
      dedupeKey: `live-feedback:${session.id}`,
    });
  }
}
