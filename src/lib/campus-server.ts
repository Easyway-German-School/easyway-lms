/**
 * The database half of Campus — see campus.ts for what it is and the rules it
 * keeps. Everything here is written to be CHEAP: a heartbeat is one or two
 * small queries, the "who is here" picture is shared between everyone in an age
 * band, and nothing holds a connection open.
 *
 * Every query names its tenant explicitly rather than relying on the ambient
 * scope — Campus shows students to each other, so "I assumed the filter was on"
 * is not an acceptable failure mode.
 */

import { Prisma } from "@prisma/client";

import { ageFromDob, dobOfStudent } from "@/lib/age-bands";
import { sanitizeAvatar } from "@/lib/avatar";
import {
  COIN_RULES,
  ONLINE_WINDOW_MS,
  REQUEST_REFUSALS,
  REQUEST_TTL_MS,
  SNAPSHOT_TTL_MS,
  bandOf,
  campusDay,
  displayName,
  isPresenceRoom,
  requestAllowed,
  type Band,
  type CoinReason,
  type PresencePerson,
  type PresenceRoom,
  type RequestKind,
} from "@/lib/campus";
import {
  DUEL_QUESTIONS,
  decideOutcome,
  isArticle,
  lowerLevel,
  pickQuestions,
  publicQuestion,
  scoreAnswer,
  totalPoints,
  type DuelAnswer,
  type DuelQuestion,
} from "@/lib/duel";
import { pingAccepted, pingChallenge, pingDuelResult, pingWave } from "@/lib/campus-notify";
import { prisma } from "@/lib/prisma";
import { getStudentAccess } from "@/lib/student-access";

/* -------------------------------------------------------------------------- */
/* The school's switch                                                        */
/* -------------------------------------------------------------------------- */

const SETTINGS_KEY = "campus.settings";
const SETTINGS_TTL_MS = 60_000;
const settingsCache = new Map<string, { at: number; enabled: boolean }>();

/**
 * Whether Campus is on for this school. Defaults to ON, is read at most once a
 * minute per warm server, and fails open: a hiccup reading the setting must not
 * take the feature down. Setting `{ "enabled": false }` is the cost lever — it
 * makes every Campus endpoint answer "off" without a deploy.
 */
export async function campusEnabled(tenantId: string | null): Promise<boolean> {
  if (!tenantId) return true;
  const cached = settingsCache.get(tenantId);
  if (cached && Date.now() - cached.at < SETTINGS_TTL_MS) return cached.enabled;
  let enabled = true;
  try {
    const row = await prisma.schoolSetting.findUnique({ where: { tenantId_key: { tenantId, key: SETTINGS_KEY } } });
    const value = row?.value as { enabled?: unknown } | null | undefined;
    if (value && value.enabled === false) enabled = false;
  } catch {
    enabled = true;
  }
  settingsCache.set(tenantId, { at: Date.now(), enabled });
  return enabled;
}

/* -------------------------------------------------------------------------- */
/* Who is asking                                                              */
/* -------------------------------------------------------------------------- */

export type CampusStudent = {
  studentId: string;
  tenantId: string | null;
  level: string;
  name: string;
  avatar: unknown;
  band: Band;
  eligible: boolean;
};

/** A student's campus identity, worked out from their records. Null for anyone who is not a student. */
export async function loadCampusStudent(userId: string): Promise<CampusStudent | null> {
  const student = await prisma.student.findUnique({
    where: { userId },
    select: {
      id: true,
      tenantId: true,
      level: true,
      avatar: true,
      admission: true,
      profile: { select: { dateOfBirth: true } },
      user: { select: { name: true } },
    },
  });
  if (!student) return null;

  const age = ageFromDob(dobOfStudent(student.profile, student.admission));
  const access = await getStudentAccess(student.id).catch(() => null);

  return {
    studentId: student.id,
    tenantId: student.tenantId,
    level: student.level,
    name: student.user?.name ?? "Student",
    avatar: sanitizeAvatar(student.avatar),
    band: bandOf(age),
    eligible: Boolean(access?.hasAccess),
  };
}

/* -------------------------------------------------------------------------- */
/* Coins                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Pay a student some coins — exactly once per `refKey`.
 *
 * The ledger row and the balance move in ONE transaction, and the ledger's
 * unique (studentId, refKey) is what makes this safe: a second attempt with the
 * same key violates the constraint, the whole transaction rolls back, and
 * nothing is paid. Callers can therefore award from anywhere, as often as they
 * like, without ever double-paying.
 */
export async function awardCoins(input: {
  studentId: string;
  tenantId: string | null;
  reason: CoinReason;
  refKey: string;
  amount?: number;
}): Promise<{ awarded: boolean; amount: number }> {
  const amount = input.amount ?? COIN_RULES[input.reason].amount;
  try {
    await prisma.$transaction([
      prisma.coinTransaction.create({
        data: {
          studentId: input.studentId,
          tenantId: input.tenantId,
          amount,
          reason: input.reason,
          refKey: input.refKey,
        },
      }),
      prisma.student.update({ where: { id: input.studentId }, data: { coinBalance: { increment: amount } } }),
    ]);
    return { awarded: true, amount };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { awarded: false, amount: 0 };
    }
    throw error;
  }
}

/**
 * Award a reward that has a daily cap. Counts today's awards of this reason and
 * stops at the cap; `extra` pins the key to a specific thing (a duel id), so
 * the same duel can never pay twice even if the cap has room.
 */
export async function awardCapped(input: {
  studentId: string;
  tenantId: string | null;
  reason: CoinReason;
  extra?: string;
}): Promise<{ awarded: boolean; amount: number }> {
  const rule = COIN_RULES[input.reason];
  const day = campusDay();

  if (rule.once) {
    return awardCoins({ ...input, refKey: `${input.reason}:once` });
  }

  const todays = await prisma.coinTransaction.count({
    where: { studentId: input.studentId, reason: input.reason, refKey: { startsWith: `${input.reason}:${day}:` } },
  });
  if (todays >= (rule.perDay ?? 1)) return { awarded: false, amount: 0 };

  return awardCoins({ ...input, refKey: `${input.reason}:${day}:${input.extra ?? todays + 1}` });
}

export async function coinBalanceOf(studentId: string): Promise<number> {
  const row = await prisma.student.findUnique({ where: { id: studentId }, select: { coinBalance: true } });
  return row?.coinBalance ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Presence                                                                   */
/* -------------------------------------------------------------------------- */

/** How long a worked-out band/eligibility is trusted before it is recomputed. */
const CHECK_TTL_MS = 6 * 3_600_000;

export type HeartbeatResult =
  | { ok: false; reason: "not_student" | "locked" | "off" }
  | { ok: true; band: Band; tenantId: string | null; studentId: string | null; balance: number | null; incoming: number; hidden: boolean };

/**
 * "I'm still here." Called every ~90 seconds by a visible phone, so it is built
 * to usually be a single UPDATE: the band and eligibility are only recomputed
 * (a student read, a birth date, an access check) when the row is missing or
 * older than six hours.
 */
export async function heartbeat(userId: string, room: PresenceRoom, hidden?: boolean): Promise<HeartbeatResult> {
  const now = new Date();
  const today = campusDay(now);
  let row = await prisma.campusPresence.findUnique({ where: { userId } });

  let student: CampusStudent | null = null;
  const stale = !row || now.getTime() - row.checkedAt.getTime() > CHECK_TTL_MS;

  if (stale) {
    student = await loadCampusStudent(userId);
    if (!student) return { ok: false, reason: "not_student" };
    if (!(await campusEnabled(student.tenantId))) return { ok: false, reason: "off" };
    row = await prisma.campusPresence.upsert({
      where: { userId },
      create: { userId, tenantId: student.tenantId, band: student.band, room, hidden: hidden ?? false, eligible: student.eligible },
      update: { tenantId: student.tenantId, band: student.band, eligible: student.eligible, checkedAt: now, room, lastSeenAt: now, ...(hidden === undefined ? {} : { hidden }) },
    });
  }

  if (!row) return { ok: false, reason: "not_student" };
  if (!row.eligible) return { ok: false, reason: "locked" };

  const firstToday = campusDay(row.lastSeenAt) !== today;

  if (!stale) {
    if (!(await campusEnabled(row.tenantId))) return { ok: false, reason: "off" };
    row = await prisma.campusPresence.update({
      where: { userId },
      data: { room, lastSeenAt: now, ...(hidden === undefined ? {} : { hidden }) },
    });
  }

  // The first heartbeat of a new day pays the daily visit. A student read is
  // only needed then, and only once a day.
  let balance: number | null = null;
  let studentId: string | null = student?.studentId ?? null;
  if (firstToday || stale) {
    student = student ?? (await loadCampusStudent(userId));
    if (student) {
      studentId = student.studentId;
      await awardCapped({ studentId: student.studentId, tenantId: student.tenantId, reason: "daily" }).catch(() => undefined);
      balance = await coinBalanceOf(student.studentId);
    }
  }

  const incoming = await prisma.campusRequest.count({
    where: { toUserId: userId, status: "open", expiresAt: { gt: now } },
  });

  return { ok: true, band: row.band as Band, tenantId: row.tenantId, studentId, balance, incoming, hidden: row.hidden };
}

/* -------------------------------------------------------------------------- */
/* The shared picture                                                         */
/* -------------------------------------------------------------------------- */

const snapshotCache = new Map<string, { at: number; people: PresencePerson[] }>();

/**
 * Everyone online in one tenant and age band, as a list of people.
 *
 * Cached per (tenant, band) for SNAPSHOT_TTL_MS in the server's memory. That is
 * the whole cost story: however many students have Campus open, the database is
 * asked at most once per band per ten seconds per warm server. A band is the
 * unit — a minor is never in an adult's list because they are never in the same
 * cache entry.
 */
export async function onlineInBand(tenantId: string | null, band: Band): Promise<PresencePerson[]> {
  const key = `${tenantId ?? "-"}:${band}`;
  const cached = snapshotCache.get(key);
  if (cached && Date.now() - cached.at < SNAPSHOT_TTL_MS) return cached.people;

  const since = new Date(Date.now() - ONLINE_WINDOW_MS);
  const rows = await prisma.campusPresence.findMany({
    where: { tenantId, band, eligible: true, hidden: false, lastSeenAt: { gte: since } },
    orderBy: { lastSeenAt: "desc" },
    take: 400,
    select: { userId: true, room: true },
  });

  let people: PresencePerson[] = [];
  if (rows.length) {
    const students = await prisma.student.findMany({
      where: { userId: { in: rows.map((r) => r.userId) } },
      select: { userId: true, level: true, avatar: true, user: { select: { name: true } } },
    });
    const byUser = new Map(students.map((s) => [s.userId, s]));
    people = rows.flatMap((r) => {
      const s = byUser.get(r.userId);
      if (!s) return [];
      return [
        {
          userId: r.userId,
          name: displayName(s.user?.name),
          avatar: sanitizeAvatar(s.avatar),
          level: s.level,
          room: isPresenceRoom(r.room) ? r.room : "lobby",
        },
      ];
    });
  }

  snapshotCache.set(key, { at: Date.now(), people });
  return people;
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                   */
/* -------------------------------------------------------------------------- */

export type SendResult =
  | { ok: true; id: string; duplicate?: boolean }
  | { ok: false; error: string; status: number };

export async function sendRequest(input: {
  from: CampusStudent;
  fromUserId: string;
  kind: RequestKind;
  toUserId: string | null;
}): Promise<SendResult> {
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 3_600_000);

  let toBand: Band | null = null;
  if (input.toUserId) {
    const target = await prisma.campusPresence.findUnique({ where: { userId: input.toUserId } });
    const online = target && target.eligible && !target.hidden && now.getTime() - target.lastSeenAt.getTime() <= ONLINE_WINDOW_MS;
    // The same message whether the person is offline, hidden or in another band: nothing about who is where leaks through a refusal.
    if (!target || !online || target.tenantId !== input.from.tenantId) {
      return { ok: false, error: "That student isn't online right now.", status: 404 };
    }
    toBand = target.band as Band;
  }

  const [sentLastHour, openOutgoing] = await Promise.all([
    prisma.campusRequest.count({ where: { fromUserId: input.fromUserId, createdAt: { gte: hourAgo } } }),
    prisma.campusRequest.count({ where: { fromUserId: input.fromUserId, status: "open", expiresAt: { gt: now } } }),
  ]);

  const gate = requestAllowed({
    sentLastHour,
    openOutgoing: input.kind === "duel" ? openOutgoing : 0,
    fromUserId: input.fromUserId,
    toUserId: input.toUserId,
    fromBand: input.from.band,
    toBand,
  });
  if (!gate.ok) return { ok: false, error: REQUEST_REFUSALS[gate.reason], status: gate.reason === "rate" ? 429 : 400 };

  // One live request of a kind per pair: tapping Challenge twice must not stack two.
  if (input.toUserId) {
    const existing = await prisma.campusRequest.findFirst({
      where: { fromUserId: input.fromUserId, toUserId: input.toUserId, kind: input.kind, status: "open", expiresAt: { gt: now } },
      select: { id: true },
    });
    if (existing) return { ok: true, id: existing.id, duplicate: true };
  } else {
    const existing = await prisma.campusRequest.findFirst({
      where: { fromUserId: input.fromUserId, toUserId: null, kind: input.kind, status: "open", expiresAt: { gt: now } },
      select: { id: true },
    });
    if (existing) return { ok: true, id: existing.id, duplicate: true };
  }

  const created = await prisma.campusRequest.create({
    data: {
      tenantId: input.from.tenantId,
      band: input.from.band,
      kind: input.kind,
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      expiresAt: new Date(now.getTime() + REQUEST_TTL_MS[input.kind]),
    },
    select: { id: true },
  });

  if (input.kind === "wave") {
    await awardCapped({ studentId: input.from.studentId, tenantId: input.from.tenantId, reason: "wave", extra: created.id }).catch(() => undefined);
  }

  // A request aimed at one person reaches their phone (subject to the quiet-hours
  // and daily-ceiling rules). An open call has no single recipient, so it buzzes
  // nobody — people see it when they open the Arena.
  if (input.toUserId) {
    const who = displayName(input.from.name);
    if (input.kind === "wave") await pingWave(input.toUserId, who, created.id);
    else await pingChallenge(input.toUserId, who, created.id);
  }

  return { ok: true, id: created.id };
}

export type RequestCard = {
  id: string;
  kind: RequestKind;
  open: boolean;
  from: { userId: string; name: string; avatar: unknown; level: string };
  expiresAt: string;
};

async function cards(rows: Array<{ id: string; kind: string; toUserId: string | null; fromUserId: string; expiresAt: Date }>): Promise<RequestCard[]> {
  if (!rows.length) return [];
  const senders = await prisma.student.findMany({
    where: { userId: { in: [...new Set(rows.map((r) => r.fromUserId))] } },
    select: { userId: true, level: true, avatar: true, user: { select: { name: true } } },
  });
  const byUser = new Map(senders.map((s) => [s.userId, s]));
  return rows.flatMap((r) => {
    const s = byUser.get(r.fromUserId);
    if (!s) return [];
    return [
      {
        id: r.id,
        kind: r.kind as RequestKind,
        open: r.toUserId === null,
        from: { userId: r.fromUserId, name: displayName(s.user?.name), avatar: sanitizeAvatar(s.avatar), level: s.level },
        expiresAt: r.expiresAt.toISOString(),
      },
    ];
  });
}

/** Requests aimed at me, plus open challenges anyone in my band can take. */
export async function requestsForMe(userId: string, tenantId: string | null, band: Band): Promise<{ direct: RequestCard[]; open: RequestCard[] }> {
  const now = new Date();
  const [direct, open] = await Promise.all([
    prisma.campusRequest.findMany({
      where: { toUserId: userId, status: "open", expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, kind: true, toUserId: true, fromUserId: true, expiresAt: true },
    }),
    prisma.campusRequest.findMany({
      where: { tenantId, band, kind: "duel", toUserId: null, status: "open", expiresAt: { gt: now }, fromUserId: { not: userId } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, kind: true, toUserId: true, fromUserId: true, expiresAt: true },
    }),
  ]);
  return { direct: await cards(direct), open: await cards(open) };
}

export type RespondResult =
  | { ok: true; duelId?: string }
  | { ok: false; error: string; status: number };

export async function respondToRequest(input: {
  me: CampusStudent;
  userId: string;
  requestId: string;
  action: "accept" | "decline" | "cancel";
}): Promise<RespondResult> {
  const now = new Date();
  const req = await prisma.campusRequest.findUnique({ where: { id: input.requestId } });
  if (!req || req.tenantId !== input.me.tenantId) return { ok: false, error: "That request is gone.", status: 404 };

  if (input.action === "cancel") {
    if (req.fromUserId !== input.userId) return { ok: false, error: "Not yours to cancel.", status: 403 };
    await prisma.campusRequest.updateMany({ where: { id: req.id, status: "open" }, data: { status: "cancelled" } });
    return { ok: true };
  }

  // Everything else is the receiving side, in the sender's own age band.
  if (req.fromUserId === input.userId) return { ok: false, error: "You can't answer your own request.", status: 400 };
  if (req.band !== input.me.band) return { ok: false, error: "That request isn't available to you.", status: 404 };
  if (req.toUserId && req.toUserId !== input.userId) return { ok: false, error: "That request isn't for you.", status: 403 };

  if (input.action === "decline") {
    if (!req.toUserId) return { ok: true }; // an open call has nobody to decline it
    await prisma.campusRequest.updateMany({ where: { id: req.id, status: "open" }, data: { status: "declined" } });
    return { ok: true };
  }

  // Accept. The status flip is the lock: only one student can take a request.
  const taken = await prisma.campusRequest.updateMany({
    where: { id: req.id, status: "open", expiresAt: { gt: now } },
    data: { status: "accepted" },
  });
  if (taken.count !== 1) return { ok: false, error: "Too late — that one's gone.", status: 409 };

  if (req.kind === "wave") return { ok: true };

  const sender = await prisma.student.findUnique({ where: { userId: req.fromUserId }, select: { level: true } });
  const level = lowerLevel(sender?.level, input.me.level);

  const duel = await prisma.campusDuel.create({
    data: {
      tenantId: req.tenantId,
      band: req.band,
      level,
      playerAId: req.fromUserId,
      playerBId: input.userId,
      questions: pickQuestions(level, req.id, DUEL_QUESTIONS) as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  await prisma.campusRequest.update({ where: { id: req.id }, data: { duelId: duel.id } });

  // The challenger is usually watching the Arena (and is taken straight in), but
  // if they have wandered off, this is what brings them back.
  await pingAccepted(req.fromUserId, displayName(input.me.name), duel.id);
  return { ok: true, duelId: duel.id };
}

/** The duel a sender should be taken to once somebody accepts their request. */
export async function myRequestOutcome(userId: string, requestId: string): Promise<{ status: string; duelId: string | null } | null> {
  const req = await prisma.campusRequest.findUnique({
    where: { id: requestId },
    select: { fromUserId: true, status: true, duelId: true, expiresAt: true },
  });
  if (!req || req.fromUserId !== userId) return null;
  const status = req.status === "open" && req.expiresAt.getTime() < Date.now() ? "expired" : req.status;
  return { status, duelId: req.duelId };
}

/* -------------------------------------------------------------------------- */
/* Duels                                                                      */
/* -------------------------------------------------------------------------- */

const DUEL_LIFETIME_MS = 30 * 60_000;

type DuelRow = NonNullable<Awaited<ReturnType<typeof prisma.campusDuel.findUnique>>>;

const asAnswers = (value: unknown): DuelAnswer[] => (Array.isArray(value) ? (value as DuelAnswer[]) : []);
const asQuestions = (value: unknown): DuelQuestion[] => (Array.isArray(value) ? (value as DuelQuestion[]) : []);

export type DuelView = {
  id: string;
  level: string;
  status: "active" | "done" | "expired";
  total: number;
  questions: Array<{ noun: string; gloss: string }>;
  mine: Array<{ i: number; choice: string; correct: boolean; points: number; article: string }>;
  myPoints: number;
  opponent: { name: string; avatar: unknown; answered: number; finished: boolean };
  result: null | { winner: "me" | "them" | "draw"; myPoints: number; theirPoints: number };
};

export async function duelFor(userId: string, duelId: string): Promise<DuelView | null> {
  const duel = await prisma.campusDuel.findUnique({ where: { id: duelId } });
  if (!duel) return null;
  const isA = duel.playerAId === userId;
  if (!isA && duel.playerBId !== userId) return null;

  const questions = asQuestions(duel.questions);
  const mine = asAnswers(isA ? duel.answersA : duel.answersB);
  const theirs = asAnswers(isA ? duel.answersB : duel.answersA);

  let status = duel.status as DuelView["status"];
  if (status === "active" && Date.now() - duel.createdAt.getTime() > DUEL_LIFETIME_MS) {
    await prisma.campusDuel.updateMany({ where: { id: duel.id, status: "active" }, data: { status: "expired" } });
    status = "expired";
  }

  const otherId = isA ? duel.playerBId : duel.playerAId;
  const other = await prisma.student.findUnique({
    where: { userId: otherId },
    select: { avatar: true, user: { select: { name: true } } },
  });

  const outcome = decideOutcome({ answersA: asAnswers(duel.answersA), answersB: asAnswers(duel.answersB), playerAId: duel.playerAId, playerBId: duel.playerBId, questions: questions.length });

  return {
    id: duel.id,
    level: duel.level,
    status,
    total: questions.length,
    questions: questions.map(publicQuestion),
    // Only questions I have already answered reveal their article — never an unanswered one.
    mine: mine.map((a) => ({ i: a.i, choice: a.choice, correct: a.correct, points: a.points, article: questions[a.i]?.article ?? "" })),
    myPoints: totalPoints(mine),
    opponent: {
      name: displayName(other?.user?.name),
      avatar: sanitizeAvatar(other?.avatar),
      answered: theirs.length,
      finished: theirs.length >= questions.length,
    },
    result: outcome.done
      ? {
          winner: outcome.draw ? "draw" : outcome.winnerId === userId ? "me" : "them",
          myPoints: isA ? outcome.pointsA : outcome.pointsB,
          theirPoints: isA ? outcome.pointsB : outcome.pointsA,
        }
      : null,
  };
}

export type AnswerResult =
  | { ok: true; correct: boolean; article: string; points: number; finished: boolean; coins: number }
  | { ok: false; error: string; status: number };

/**
 * Take one answer. Scored here, against the frozen question, so the browser
 * never holds an answer it could edit — and answers must arrive in order, so a
 * player cannot skip ahead, re-answer, or submit all eight at once.
 */
export async function submitDuelAnswer(input: {
  userId: string;
  duelId: string;
  i: number;
  choice: unknown;
  ms: number;
}): Promise<AnswerResult> {
  if (!isArticle(input.choice)) return { ok: false, error: "Pick der, die or das.", status: 400 };

  const duel = await prisma.campusDuel.findUnique({ where: { id: input.duelId } });
  if (!duel) return { ok: false, error: "Duel not found.", status: 404 };
  const isA = duel.playerAId === input.userId;
  if (!isA && duel.playerBId !== input.userId) return { ok: false, error: "Duel not found.", status: 404 };
  if (duel.status !== "active" || Date.now() - duel.createdAt.getTime() > DUEL_LIFETIME_MS) {
    return { ok: false, error: "This duel has ended.", status: 410 };
  }

  const questions = asQuestions(duel.questions);
  const mine = asAnswers(isA ? duel.answersA : duel.answersB);
  if (input.i !== mine.length || input.i >= questions.length) {
    return { ok: false, error: "That answer is out of order.", status: 409 };
  }

  const scored = scoreAnswer(questions[input.i], input.i, input.choice, input.ms);
  const next = [...mine, scored];
  await prisma.campusDuel.update({
    where: { id: duel.id },
    data: isA ? { answersA: next as unknown as Prisma.InputJsonValue } : { answersB: next as unknown as Prisma.InputJsonValue },
  });

  const finished = next.length >= questions.length;
  let coins = 0;
  if (finished) coins = await settle(duel, input.userId, isA, next);

  return { ok: true, correct: scored.correct, article: questions[input.i].article, points: scored.points, finished, coins };
}

/**
 * A player has just finished. Pay them for playing right away (waiting for an
 * opponent to finish is not a reason to withhold a reward), and if the other
 * player is also done, close the duel and pay the winner. Every payout is keyed
 * to the duel, so a retry or a race between the two finishers pays once.
 */
async function settle(duel: DuelRow, userId: string, isA: boolean, myAnswers: DuelAnswer[]): Promise<number> {
  const me = await prisma.student.findUnique({ where: { userId }, select: { id: true, tenantId: true } });
  let coins = 0;
  if (me) {
    const played = await awardCapped({ studentId: me.id, tenantId: me.tenantId, reason: "duel_play", extra: duel.id }).catch(() => ({ awarded: false, amount: 0 }));
    coins += played.amount;
  }

  const fresh = await prisma.campusDuel.findUnique({ where: { id: duel.id } });
  if (!fresh) return coins;
  const answersA = isA ? myAnswers : asAnswers(fresh.answersA);
  const answersB = isA ? asAnswers(fresh.answersB) : myAnswers;
  const outcome = decideOutcome({ answersA, answersB, playerAId: duel.playerAId, playerBId: duel.playerBId, questions: asQuestions(duel.questions).length });
  if (!outcome.done) return coins;

  const closed = await prisma.campusDuel.updateMany({
    where: { id: duel.id, status: "active" },
    data: { status: "done", winnerId: outcome.winnerId, finishedAt: new Date() },
  });

  // Whoever closes the duel pays the winner; if the other finisher got there first, the winner's bonus is already paid.
  let winnerCoins = 0;
  if (outcome.winnerId && closed.count === 1) {
    const winner = await prisma.student.findUnique({ where: { userId: outcome.winnerId }, select: { id: true, tenantId: true } });
    if (winner) {
      const won = await awardCapped({ studentId: winner.id, tenantId: winner.tenantId, reason: "duel_win", extra: duel.id }).catch(() => ({ awarded: false, amount: 0 }));
      winnerCoins = won.amount;
      if (outcome.winnerId === userId) coins += won.amount;
    }
  }

  // The player who finished first has been waiting; closing the duel is the
  // moment they find out. Told once (only by whoever actually closed it).
  if (closed.count === 1) {
    const waitingId = isA ? duel.playerBId : duel.playerAId;
    const closer = await prisma.student.findUnique({ where: { userId }, select: { user: { select: { name: true } } } });
    const waitingPoints = isA ? outcome.pointsB : outcome.pointsA;
    const closerPoints = isA ? outcome.pointsA : outcome.pointsB;
    await pingDuelResult({
      to: waitingId,
      opponentName: displayName(closer?.user?.name),
      outcome: outcome.draw ? "draw" : outcome.winnerId === waitingId ? "won" : "lost",
      myPoints: waitingPoints,
      theirPoints: closerPoints,
      coins: outcome.winnerId === waitingId ? winnerCoins : 0,
      duelId: duel.id,
    });
  }
  return coins;
}
