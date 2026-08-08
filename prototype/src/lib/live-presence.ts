import { prisma } from "@/lib/prisma";
import { notifyInBackground, KIND } from "@/lib/notify";
import { cohortRoomName, roomDisplayName } from "@/lib/live-classroom";

/**
 * Whether a class is happening RIGHT NOW, and who has been told.
 *
 * The room name has always existed — it is derived from branch + level + slot,
 * so `/live` was joinable at three in the morning and looked identical to a
 * lesson in progress. What did not exist was any way for a student to learn
 * that their tutor had actually arrived. They were expected to remember the
 * timetable, open the portal, click through to an empty room, and try again
 * later. Almost nobody does that twice.
 *
 * A `LiveClassSession` row is the fact everything else hangs off. It opens when
 * the tutor joins and closes when they leave, and while it is open the bell,
 * the phone, the dashboard banner, the ringing popup and a six-character code
 * are all just different views of the same row.
 */

/**
 * How long an open session survives without a heartbeat.
 *
 * A browser that crashes, a laptop that sleeps, a tutor who closes the tab on a
 * dying battery — none of those send the "I have left" call. Without an expiry
 * the row stays open forever and the dashboard cheerfully invites students to a
 * class that ended on Tuesday, which is a worse failure than missing the class:
 * it teaches them the banner is a lie.
 *
 * Three minutes is the compromise. Long enough to ride out a tunnel, a network
 * switch or a page reload without the class appearing to end; short enough that
 * a genuinely abandoned room clears before the next sitting.
 */
export const LIVE_STALE_AFTER_MS = 3 * 60_000;

/** The heartbeat interval the tutor's client should use. Comfortably inside the expiry. */
export const LIVE_HEARTBEAT_MS = 45_000;

/**
 * Join-code alphabet with the look-alikes removed.
 *
 * A code exists to be read off one screen and typed into another, often off a
 * phone held by somebody else, often in a room with bad light. `I` and `1`, `O`
 * and `0`, `S` and `5` are the pairs that actually get mistyped, so they are not
 * in the alphabet at all. That is cheaper than a "did you mean" screen.
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRTUVWXYZ23479";
const CODE_LENGTH = 6;

function randomCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/** Codes are unique across all sessions ever, so one written down can never open a different class. */
async function uniqueJoinCode(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = randomCode();
    const clash = await prisma.liveClassSession.findUnique({ where: { joinCode: code }, select: { id: true } });
    if (!clash) return code;
  }
  // 27^6 is 387 million; eight collisions means something is very wrong, and a
  // longer code is a better outcome than throwing in the tutor's face.
  return `${randomCode()}${randomCode().slice(0, 2)}`;
}

/** The cutoff a query compares `lastSeenAt` against. */
export function staleCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - LIVE_STALE_AFTER_MS);
}

/** Prisma `where` fragment for "this session is genuinely live". */
export function liveWhere(now: Date = new Date()) {
  return { endedAt: null, lastSeenAt: { gte: staleCutoff(now) } };
}

export type LiveSessionRow = {
  id: string;
  roomName: string;
  joinCode: string;
  kind: string;
  title: string;
  branchId: string | null;
  level: string | null;
  sessionSlot: string | null;
  privateClassId: string | null;
  startedAt: Date;
  lecturerName: string | null;
};

export type OpenLiveSessionInput = {
  roomName: string;
  title: string;
  kind?: "cohort" | "private";
  branchId?: string | null;
  level?: string | null;
  sessionSlot?: string | null;
  privateClassId?: string | null;
  lecturerId?: string | null;
  startedByUserId: string;
  /**
   * Student ids to ring by name. Required for a private session — it is the
   * guest list AND the access control. Optional for a cohort session, where it
   * means "ring these three" rather than the whole roster.
   */
  inviteStudentIds?: string[];
};

/**
 * Open a session, or adopt the one already open in this room.
 *
 * Idempotent on purpose. A tutor reloading the page, or a second device, or the
 * pre-join screen being visited twice, must not start a second class — two open
 * rows for one room means two join codes, and half the students get the one
 * that the tutor is not reading out.
 */
export async function openLiveSession(input: OpenLiveSessionInput): Promise<LiveSessionRow> {
  const now = new Date();

  const existing = await prisma.liveClassSession.findFirst({
    where: { roomName: input.roomName, ...liveWhere(now) },
    orderBy: { startedAt: "desc" },
    include: { lecturer: { select: { user: { select: { name: true } } } } },
  });

  if (existing) {
    await prisma.liveClassSession.update({ where: { id: existing.id }, data: { lastSeenAt: now } });
    if (input.inviteStudentIds?.length) {
      await addInvites(existing.id, input.inviteStudentIds);
    }
    return toRow(existing, existing.lecturer?.user?.name ?? null);
  }

  const created = await prisma.liveClassSession.create({
    data: {
      roomName: input.roomName,
      joinCode: await uniqueJoinCode(),
      kind: input.kind ?? "cohort",
      title: input.title,
      branchId: input.branchId ?? null,
      level: input.level ?? null,
      sessionSlot: input.sessionSlot ?? null,
      privateClassId: input.privateClassId ?? null,
      lecturerId: input.lecturerId ?? null,
      startedByUserId: input.startedByUserId,
      startedAt: now,
      lastSeenAt: now,
    },
    include: { lecturer: { select: { user: { select: { name: true } } } } },
  });

  if (input.inviteStudentIds?.length) {
    await addInvites(created.id, input.inviteStudentIds);
  }

  return toRow(created, created.lecturer?.user?.name ?? null);
}

function toRow(
  row: {
    id: string;
    roomName: string;
    joinCode: string;
    kind: string;
    title: string;
    branchId: string | null;
    level: string | null;
    sessionSlot: string | null;
    privateClassId: string | null;
    startedAt: Date;
  },
  lecturerName: string | null,
): LiveSessionRow {
  return {
    id: row.id,
    roomName: row.roomName,
    joinCode: row.joinCode,
    kind: row.kind,
    title: row.title,
    branchId: row.branchId,
    level: row.level,
    sessionSlot: row.sessionSlot,
    privateClassId: row.privateClassId,
    startedAt: row.startedAt,
    lecturerName,
  };
}

/** Add students to a session's guest list, bumping the ring count for anyone already on it. */
export async function addInvites(sessionId: string, studentIds: string[]): Promise<number> {
  const unique = [...new Set(studentIds.filter(Boolean))];
  let touched = 0;

  for (const studentId of unique) {
    await prisma.liveClassInvite.upsert({
      where: { sessionId_studentId: { sessionId, studentId } },
      // Re-ringing someone who declined puts them back in the "invited" state —
      // a tutor who rings again means it, and a declined row that stays declined
      // would silently swallow the second call.
      update: { ringCount: { increment: 1 }, status: "invited", respondedAt: null },
      create: { sessionId, studentId, status: "invited" },
    });
    touched += 1;
  }

  return touched;
}

/** The tutor is still here. Cheap enough to call every 45 seconds. */
export async function touchLiveSession(roomName: string): Promise<void> {
  await prisma.liveClassSession.updateMany({
    where: { roomName, endedAt: null },
    data: { lastSeenAt: new Date() },
  });
}

/** The class is over. Closes every open row for the room, not just the newest. */
export async function closeLiveSession(roomName: string): Promise<number> {
  const result = await prisma.liveClassSession.updateMany({
    where: { roomName, endedAt: null },
    data: { endedAt: new Date() },
  });
  return result.count;
}

/** Mark an invited student as having actually turned up. */
export async function markInviteJoined(sessionId: string, studentId: string): Promise<void> {
  await prisma.liveClassInvite.updateMany({
    where: { sessionId, studentId },
    data: { status: "joined", joinedAt: new Date() },
  });
}

/** The student said no. Stops the popup ringing at them and tells the tutor. */
export async function declineInvite(sessionId: string, studentId: string): Promise<void> {
  await prisma.liveClassInvite.updateMany({
    where: { sessionId, studentId },
    data: { status: "declined", respondedAt: new Date() },
  });
}

/**
 * The live session this student may join right now, if there is one.
 *
 * Two ways in, and the order matters. A private student's booked one-to-one
 * outranks anything happening in their cohort room — they are not in that
 * cohort — so invites are checked first.
 */
export async function liveSessionForStudent(student: {
  id: string;
  branchId: string | null;
  level: string;
  sessionSlot: string;
  classType: string;
}): Promise<(LiveSessionRow & { invited: boolean; inviteStatus: string | null }) | null> {
  const now = new Date();

  const invite = await prisma.liveClassInvite.findFirst({
    where: {
      studentId: student.id,
      status: { in: ["invited", "joined"] },
      session: liveWhere(now),
    },
    include: {
      session: { include: { lecturer: { select: { user: { select: { name: true } } } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  if (invite) {
    return {
      ...toRow(invite.session, invite.session.lecturer?.user?.name ?? null),
      invited: true,
      inviteStatus: invite.status,
    };
  }

  // A private student sits no cohort rotation, so the cohort room is not theirs
  // to walk into even when it is live — that is somebody else's class.
  if (student.classType === "private") return null;

  const cohort = await prisma.liveClassSession.findFirst({
    where: {
      kind: "cohort",
      branchId: student.branchId,
      level: student.level,
      sessionSlot: student.sessionSlot,
      ...liveWhere(now),
    },
    include: { lecturer: { select: { user: { select: { name: true } } } } },
    orderBy: { startedAt: "desc" },
  });

  if (!cohort) return null;

  return { ...toRow(cohort, cohort.lecturer?.user?.name ?? null), invited: false, inviteStatus: null };
}

/** Look a session up by the code a student typed. Only ever returns a live one. */
export async function liveSessionByCode(code: string): Promise<LiveSessionRow | null> {
  const normalised = String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!normalised) return null;

  const row = await prisma.liveClassSession.findFirst({
    where: { joinCode: normalised, ...liveWhere() },
    include: { lecturer: { select: { user: { select: { name: true } } } } },
  });

  return row ? toRow(row, row.lecturer?.user?.name ?? null) : null;
}

/**
 * May this person hold a token for this room?
 *
 * A private room is the sensitive case: before invites existed, the only thing
 * standing between a student and somebody else's one-to-one lesson was not
 * knowing the id — and the id travelled in a query string. Membership is now
 * checked against the booking and the guest list.
 */
export async function mayJoinPrivateRoom(args: {
  privateClassId: string;
  studentId?: string | null;
  lecturerId?: string | null;
  isAdmin?: boolean;
}): Promise<boolean> {
  if (args.isAdmin) return true;

  const booking = await prisma.privateClass.findUnique({
    where: { id: args.privateClassId },
    select: { studentId: true, lecturerId: true },
  });
  if (!booking) return false;

  if (args.lecturerId && booking.lecturerId === args.lecturerId) return true;
  if (args.studentId && booking.studentId === args.studentId) return true;

  // A tutor may also have been added to the room by whoever opened it, and a
  // second student may have been invited into what began as a one-to-one.
  if (args.studentId) {
    const invited = await prisma.liveClassInvite.findFirst({
      where: {
        studentId: args.studentId,
        session: { privateClassId: args.privateClassId, ...liveWhere() },
      },
      select: { id: true },
    });
    if (invited) return true;
  }

  return false;
}

/**
 * Tell the students their class has started.
 *
 * Deliberately fire-and-forget: a notification service having a bad minute must
 * never delay the tutor's own token, and the class is not less started because
 * the bell did not ring.
 *
 * The dedupe key is the session id, so a tutor who reloads twice does not send
 * three "class has started" pushes to forty people. Re-ringing an individual is
 * a different call with its own key — see `ringStudents`.
 */
export function announceLiveSession(session: LiveSessionRow, opts: { studentIds?: string[] } = {}): void {
  const tutor = session.lecturerName ? `${session.lecturerName} has` : "Your tutor has";
  const link = `/live?code=${session.joinCode}`;

  notifyInBackground({
    // Pinned to branch AND level AND sitting. A branch runs the same level
    // morning, afternoon and evening as three separate classes; telling the
    // evening students that the morning class has started is exactly how a
    // school trains everyone to ignore the bell.
    to: opts.studentIds?.length
      ? { studentIds: opts.studentIds }
      : {
          students: {
            branchId: session.branchId,
            level: session.level,
            sessionSlot: session.sessionSlot,
          },
        },
    kind: KIND.classStarting,
    // Warning rather than info, and not because anything is wrong: severity is
    // what decides whether the phone buzzes, and a class that has already begun
    // is the one notification in this app that is worthless five minutes late.
    severity: "warning",
    title: "Your class is live now",
    message: `${tutor} started ${session.title}. Tap to join.`,
    link,
    dedupeKey: `live-start:${session.id}`,
    push: true,
    emailBody: `${tutor} started ${session.title}.\n\nJoin from the portal, or enter the code ${session.joinCode} at the live class page.`,
  });
}

/** Ring named students again. Separate key per round, so a second ring really rings. */
export function ringStudents(session: LiveSessionRow, studentIds: string[], round: number): void {
  if (!studentIds.length) return;

  notifyInBackground({
    to: { studentIds },
    kind: KIND.classStarting,
    severity: "warning",
    title: session.kind === "private" ? "Your tutor is waiting" : "Your tutor is asking for you",
    message: `${session.lecturerName ?? "Your tutor"} is in ${session.title} and waiting for you.`,
    link: `/live?code=${session.joinCode}`,
    dedupeKey: `live-ring:${session.id}:${round}`,
    push: true,
  });
}

/**
 * The cohort room for a tutor's primary class, and its label, in one place.
 * Callers were rebuilding both by hand and disagreeing about the fallbacks.
 */
export function cohortRoomFor(args: {
  branchName?: string | null;
  level?: string | null;
  sessionSlot?: string | null;
}): { roomName: string; title: string } {
  return {
    roomName: cohortRoomName(args),
    title: roomDisplayName(args),
  };
}
