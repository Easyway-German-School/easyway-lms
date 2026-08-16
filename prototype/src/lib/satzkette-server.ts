import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import {
  MATCH_ABANDONED_AFTER_MS,
  TURN_EXCLUSIVE_MS,
  type Constraint,
  canPlay,
  checkSentence,
  constraintLabel,
  effectiveState,
  nextAssignee,
  parseConstraint,
} from "@/lib/satzkette";

/**
 * Satzkette, the parts that touch the database.
 *
 * Split from `satzkette.ts` for the same reason `live-quiz.ts` is split from
 * `live-quiz-views.ts`: the rules of the game are worth testing without a
 * database in the room, and everything in here is plumbing around them.
 */

/** The notification kind, so a student can mute turn pings without muting the school. */
export const TURN_NOTIFY_KIND = "satzkette.turn";

/* -------------------------------------------------------------------------- */
/* The roster                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Everyone who could be offered a turn in this story, and when they last had one.
 *
 * Membership is resolved the same way the group chat resolves it — branch AND
 * level AND sitting — rather than from a list stored on the match. A roster
 * captured at creation would keep offering turns to a student who left in week
 * two and would never reach one who joined in week three, and both failures are
 * invisible until a story stalls.
 */
export async function rosterFor(
  matchId: string | null,
  spaceId: string | null,
): Promise<Array<{ userId: string; lastTurnAt: Date | null }>> {
  if (!spaceId) return [];

  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { branchId: true, level: true, sessionSlot: true },
  });
  if (!space) return [];

  const students = await prisma.student.findMany({
    where: {
      branchId: space.branchId,
      level: space.level,
      sessionSlot: space.sessionSlot,
      status: "active",
    },
    select: { userId: true },
  });

  const userIds = students.map((student) => student.userId).filter(Boolean) as string[];
  if (userIds.length === 0) return [];

  // A story that does not exist yet has no history, so everyone is equally
  // overdue and the tiebreak in `nextAssignee` decides.
  if (!matchId) return userIds.map((userId) => ({ userId, lastTurnAt: null }));

  // When each of them last WROTE something here — not when they were last
  // asked. Somebody who was offered a turn and let it lapse should be near the
  // front of the queue again, not pushed to the back for not answering.
  const lastTurns = await prisma.gameTurn.groupBy({
    by: ["playerId"],
    where: { matchId, playerId: { in: userIds }, submittedAt: { not: null } },
    _max: { submittedAt: true },
  });

  const lastByUser = new Map(
    lastTurns.map((row) => [row.playerId as string, row._max.submittedAt]),
  );

  return userIds.map((userId) => ({
    userId,
    lastTurnAt: lastByUser.get(userId) ?? null,
  }));
}

/* -------------------------------------------------------------------------- */
/* Starting a story                                                           */
/* -------------------------------------------------------------------------- */

export type CreateMatchInput = {
  spaceId: string;
  title: string;
  prompt?: string | null;
  /** Drawn from in order, wrapping. Empty means turns carry no rule. */
  constraints: Constraint[];
  targetTurns?: number;
  createdById: string;
};

/**
 * Open a story and offer the first turn.
 *
 * Returns null when the cohort has nobody in it, rather than creating a story
 * that can never be played. An empty room is a real state here — a level
 * between intakes — and a match sitting in the Games tab waiting for a player
 * who does not exist is worse than no match at all.
 */
export async function createMatch(input: CreateMatchInput) {
  const roster = await rosterFor(null, input.spaceId);
  if (roster.length === 0) return null;

  const first = nextAssignee(roster);
  if (!first) return null;

  const constraints = input.constraints;
  const targetTurns = Math.max(3, Math.min(30, input.targetTurns ?? 12));

  const match = await prisma.gameMatch.create({
    data: {
      spaceId: input.spaceId,
      title: input.title,
      prompt: input.prompt ?? null,
      createdById: input.createdById,
      targetTurns,
      status: "active",
      // Frozen here, so later turns draw from the deck the story started with
      // rather than whatever the tutor's deck says by then.
      constraints: constraints.length > 0 ? (constraints as unknown as object) : undefined,
      turns: {
        create: {
          assignedToId: first,
          position: 1,
          status: "pending",
          constraint: (constraints[0] as unknown as object) ?? undefined,
          deadline: new Date(Date.now() + TURN_EXCLUSIVE_MS),
        },
      },
    },
    select: { id: true, title: true },
  });

  await pingAssignee(match.id, first, match.title, 1);

  return match;
}

/* -------------------------------------------------------------------------- */
/* Playing a turn                                                             */
/* -------------------------------------------------------------------------- */

export type SubmitResult =
  | { ok: true; matchCompleted: boolean; nextTurnId: string | null }
  | { ok: false; problem: string };

/**
 * Write a sentence into a turn, then open the next one.
 *
 * The whole thing runs in a transaction that re-reads the turn, because two
 * students can reach an OPEN turn within the same second and exactly one of
 * them must win. The loser is told the turn went, not shown an error — losing a
 * race you did not know you were in should not read as a fault.
 */
export async function submitTurn(input: {
  turnId: string;
  userId: string;
  sentence: string;
}): Promise<SubmitResult> {
  const turn = await prisma.gameTurn.findUnique({
    where: { id: input.turnId },
    select: {
      id: true,
      matchId: true,
      position: true,
      assignedToId: true,
      status: true,
      deadline: true,
      submittedAt: true,
      constraint: true,
      match: { select: { id: true, spaceId: true, title: true, targetTurns: true, status: true } },
    },
  });

  if (!turn) return { ok: false, problem: "That turn is no longer there." };
  if (turn.match.status !== "active") {
    return { ok: false, problem: "That story has finished." };
  }
  if (turn.submittedAt) {
    return { ok: false, problem: "Somebody just took that turn." };
  }
  if (!canPlay(turn, input.userId)) {
    return { ok: false, problem: "It is not your turn yet — you will be told when it is." };
  }

  const constraint = parseConstraint(turn.constraint);
  const check = checkSentence(input.sentence, constraint);
  if (!check.ok) return { ok: false, problem: check.problem };

  // The guard against a double-write is the WHERE clause, not a prior read:
  // `submittedAt: null` makes the second of two racing updates match zero rows
  // rather than overwrite the first.
  const claimed = await prisma.gameTurn.updateMany({
    where: { id: turn.id, submittedAt: null },
    data: {
      playerId: input.userId,
      sentence: input.sentence.trim(),
      submittedAt: new Date(),
      status: "submitted",
    },
  });

  if (claimed.count === 0) {
    return { ok: false, problem: "Somebody just took that turn." };
  }

  const isLast = turn.position >= turn.match.targetTurns;
  if (isLast) {
    await prisma.gameMatch.update({
      where: { id: turn.match.id },
      data: { status: "completed", completedAt: new Date() },
    });
    await announceCompletion(turn.match.id, turn.match.spaceId, turn.match.title);
    return { ok: true, matchCompleted: true, nextTurnId: null };
  }

  const next = await openNextTurn({
    matchId: turn.match.id,
    spaceId: turn.match.spaceId,
    title: turn.match.title,
    position: turn.position + 1,
    justPlayedBy: input.userId,
  });

  return { ok: true, matchCompleted: false, nextTurnId: next };
}

/**
 * Offer the next turn to whoever has waited longest.
 *
 * The student who just played is excluded, so a story cannot become two people
 * passing it back and forth while the rest of the class watches — which is what
 * a pure least-recent rule does in a cohort where only two people are engaged.
 */
async function openNextTurn(input: {
  matchId: string;
  spaceId: string | null;
  title: string;
  position: number;
  justPlayedBy: string;
}): Promise<string | null> {
  const roster = await rosterFor(input.matchId, input.spaceId);
  const assignee = nextAssignee(roster, input.justPlayedBy) ?? nextAssignee(roster);
  if (!assignee) return null;

  const constraints = await constraintsForMatch(input.matchId);
  const constraint =
    constraints.length > 0 ? constraints[(input.position - 1) % constraints.length] : null;

  const created = await prisma.gameTurn.create({
    data: {
      matchId: input.matchId,
      assignedToId: assignee,
      position: input.position,
      status: "pending",
      constraint: (constraint as unknown as object) ?? undefined,
      deadline: new Date(Date.now() + TURN_EXCLUSIVE_MS),
    },
    select: { id: true },
  });

  await pingAssignee(input.matchId, assignee, input.title, input.position);
  return created.id;
}

/** The deck this story was started with. */
async function constraintsForMatch(matchId: string): Promise<Constraint[]> {
  const match = await prisma.gameMatch.findUnique({
    where: { id: matchId },
    select: { constraints: true },
  });
  if (!Array.isArray(match?.constraints)) return [];

  return match.constraints
    .map((entry) => parseConstraint(entry))
    .filter((entry): entry is Constraint => entry !== null);
}

/* -------------------------------------------------------------------------- */
/* The deadline job                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Turn every lapsed turn from `pending` into `open`, and tell the cohort.
 *
 * This is the mechanic that keeps chains alive, so it is worth being clear
 * about what it does NOT do: it never skips a turn, never reassigns it, and
 * never penalises the student who missed it. The turn stays exactly where it
 * was and simply stops being exclusive.
 *
 * Idempotent — a second run finds nothing still `pending` past its deadline —
 * so a cron that fires twice is harmless.
 */
export async function openLapsedTurns(now: Date = new Date()): Promise<number> {
  const lapsed = await prisma.gameTurn.findMany({
    where: { status: "pending", submittedAt: null, deadline: { lte: now } },
    select: {
      id: true,
      matchId: true,
      position: true,
      match: { select: { spaceId: true, title: true, status: true } },
    },
    take: 200,
  });

  let opened = 0;
  for (const turn of lapsed) {
    if (turn.match.status !== "active") continue;

    const changed = await prisma.gameTurn.updateMany({
      where: { id: turn.id, status: "pending" },
      data: { status: "open" },
    });
    if (changed.count === 0) continue;
    opened += 1;

    if (!turn.match.spaceId) continue;
    const members = await rosterFor(turn.matchId, turn.match.spaceId);
    if (members.length === 0) continue;

    await notify({
      to: { userIds: members.map((member) => member.userId) },
      kind: TURN_NOTIFY_KIND,
      severity: "info",
      title: `A turn is going spare in "${turn.match.title}"`,
      message: `Sentence ${turn.position} is open to anyone now. First one there writes it.`,
      link: `/games/${turn.matchId}`,
      // Without this, a cron that re-runs before the turn is taken buzzes the
      // whole class again for the same sentence.
      dedupeKey: `satzkette:open:${turn.id}`,
    });
  }

  return opened;
}

/**
 * Close stories nobody has touched in days.
 *
 * A chain sitting open forever fills the Games tab with things that each still
 * claim to be waiting for somebody, which teaches students that the tab is
 * mostly noise — and once they believe that, the turn notification stops
 * working too.
 */
export async function archiveStaleMatches(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - MATCH_ABANDONED_AFTER_MS);

  const result = await prisma.gameMatch.updateMany({
    where: { status: "active", updatedAt: { lte: cutoff } },
    data: { status: "archived" },
  });

  return result.count;
}

/* -------------------------------------------------------------------------- */
/* Telling people                                                             */
/* -------------------------------------------------------------------------- */

/**
 * "It is your turn."
 *
 * The single most important line in this feature. Everything else — the story,
 * the constraint, the leaderboard-that-isn't — exists to make this sentence
 * worth sending, because a turn owed to a person is the reason anybody opens
 * the app on a Saturday.
 */
async function pingAssignee(matchId: string, userId: string, title: string, position: number) {
  await notify({
    to: { userIds: [userId] },
    kind: TURN_NOTIFY_KIND,
    severity: "info",
    title: `Your turn in "${title}"`,
    message: `Sentence ${position} is yours. One sentence in German — the class is waiting.`,
    link: `/games/${matchId}`,
    push: true,
    dedupeKey: `satzkette:turn:${matchId}:${position}`,
  });
}

/** The story is done — everyone who wrote in it should get to read it back. */
async function announceCompletion(matchId: string, spaceId: string | null, title: string) {
  if (!spaceId) return;

  const members = await rosterFor(matchId, spaceId);
  if (members.length === 0) return;

  await notify({
    to: { userIds: members.map((member) => member.userId) },
    kind: TURN_NOTIFY_KIND,
    severity: "info",
    title: `"${title}" is finished`,
    message: "Your class wrote a whole story. Read it back from the start.",
    link: `/games/${matchId}`,
    dedupeKey: `satzkette:done:${matchId}`,
  });
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

/** The turn this person is being waited on for, across every story. */
export async function turnsAwaiting(userId: string) {
  const turns = await prisma.gameTurn.findMany({
    where: {
      submittedAt: null,
      status: { in: ["pending", "open"] },
      match: { status: "active" },
      OR: [{ assignedToId: userId }, { status: "open" }],
    },
    select: {
      id: true,
      position: true,
      status: true,
      deadline: true,
      submittedAt: true,
      assignedToId: true,
      constraint: true,
      match: { select: { id: true, title: true, targetTurns: true } },
    },
    orderBy: { deadline: "asc" },
    take: 20,
  });

  return turns
    .filter((turn) => canPlay(turn, userId))
    .map((turn) => {
      const constraint = parseConstraint(turn.constraint);
      return {
        turnId: turn.id,
        matchId: turn.match.id,
        matchTitle: turn.match.title,
        position: turn.position,
        targetTurns: turn.match.targetTurns,
        state: effectiveState(turn),
        isMine: turn.assignedToId === userId,
        deadline: turn.deadline,
        rule: constraint ? constraintLabel(constraint) : null,
      };
    });
}
