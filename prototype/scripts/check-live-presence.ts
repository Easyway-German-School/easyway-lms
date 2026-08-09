/**
 * Exercises the live-class presence layer against the real database.
 *
 * `npm run check:live`
 *
 * Everything it creates is removed at the end, and it refuses to touch a
 * LiveClassSession it did not open itself. It is safe to run against the live
 * database while a real class is in progress — which is deliberate, because the
 * one time you most want to check this code is when something is wrong now.
 */

import { PrismaClient } from "@prisma/client";
import {
  addInvites,
  closeLiveSession,
  declineInvite,
  liveSessionByCode,
  liveSessionForStudent,
  markInviteJoined,
  mayJoinPrivateRoom,
  openLiveSession,
  touchLiveSession,
} from "../src/lib/live-presence";

const prisma = new PrismaClient();

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log("\nLive presence check\n");

  const student = await prisma.student.findFirst({
    where: { status: "active", classType: "group" },
    select: { id: true, branchId: true, level: true, sessionSlot: true, classType: true, userId: true },
  });
  const other = await prisma.student.findFirst({
    where: { status: "active", id: { not: student?.id ?? "" } },
    select: { id: true, branchId: true, level: true, sessionSlot: true, classType: true },
  });

  if (!student || !other) {
    console.log("Need at least two active students to run this. Nothing was changed.");
    return;
  }

  const roomName = `ew-selftest-${Date.now()}`;
  const created: string[] = [];

  try {
    // --- Opening ----------------------------------------------------------
    const session = await openLiveSession({
      roomName,
      title: "Self-test · A1 · Morning",
      kind: "cohort",
      branchId: student.branchId,
      level: student.level,
      sessionSlot: student.sessionSlot,
      startedByUserId: student.userId,
    });
    created.push(session.id);

    check("opens a session", Boolean(session.id));
    check("mints a 6-character code", /^[A-Z0-9]{6}$/.test(session.joinCode), session.joinCode);

    // --- Idempotency ------------------------------------------------------
    const again = await openLiveSession({
      roomName,
      title: "Self-test · A1 · Morning",
      kind: "cohort",
      branchId: student.branchId,
      level: student.level,
      sessionSlot: student.sessionSlot,
      startedByUserId: student.userId,
    });
    check("a reload adopts the open session rather than starting a second", again.id === session.id);
    check("…and keeps the same code", again.joinCode === session.joinCode);

    // --- Code lookup ------------------------------------------------------
    const byCode = await liveSessionByCode(session.joinCode.toLowerCase());
    check("a code resolves case-insensitively", byCode?.id === session.id);
    check("an unknown code resolves to nothing", (await liveSessionByCode("ZZZZZZ")) === null);

    // --- Who sees it ------------------------------------------------------
    const seen = await liveSessionForStudent(student);
    check("the cohort's own student sees it", seen?.id === session.id);

    const outsider = await liveSessionForStudent({
      ...other,
      // Forced onto a different sitting: same branch and level, different class.
      sessionSlot: student.sessionSlot === "morning" ? "evening" : "morning",
      classType: "group",
    });
    check("a student on another sitting does NOT see it", outsider?.id !== session.id);

    // --- Invites ----------------------------------------------------------
    await addInvites(session.id, [other.id]);
    const invited = await liveSessionForStudent(other);
    check("an invited student sees it even from another cohort", invited?.id === session.id);
    check("…and is marked as invited by name", invited?.invited === true);

    await markInviteJoined(session.id, other.id);
    const joinedRow = await prisma.liveClassInvite.findFirst({
      where: { sessionId: session.id, studentId: other.id },
      select: { status: true, joinedAt: true },
    });
    check("joining records the arrival", joinedRow?.status === "joined" && Boolean(joinedRow?.joinedAt));

    await declineInvite(session.id, other.id);
    const declined = await prisma.liveClassInvite.findFirst({
      where: { sessionId: session.id, studentId: other.id },
      select: { status: true },
    });
    check("declining is recorded", declined?.status === "declined");

    const reRung = await addInvites(session.id, [other.id]);
    const rung = await prisma.liveClassInvite.findFirst({
      where: { sessionId: session.id, studentId: other.id },
      select: { status: true, ringCount: true },
    });
    check("ringing again revives a declined invite", reRung === 1 && rung?.status === "invited");
    check("…and counts the rings", (rung?.ringCount ?? 0) >= 2);

    // --- Staleness --------------------------------------------------------
    await prisma.liveClassSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(Date.now() - 10 * 60_000) },
    });
    check("a session with no heartbeat for 10 minutes is not live", (await liveSessionForStudent(student)) === null);
    check("…and its code stops working", (await liveSessionByCode(session.joinCode)) === null);

    await touchLiveSession(roomName);
    check("a heartbeat brings it back", (await liveSessionForStudent(student))?.id === session.id);

    // --- Private rooms: the hole this closed ------------------------------
    const booking = await prisma.privateClass.findFirst({ select: { id: true, studentId: true, lecturerId: true } });
    if (booking) {
      check(
        "the booked student may join their own private room",
        await mayJoinPrivateRoom({ privateClassId: booking.id, studentId: booking.studentId }),
      );

      const stranger = await prisma.student.findFirst({
        where: { id: { not: booking.studentId }, status: "active" },
        select: { id: true },
      });
      if (stranger) {
        check(
          "ANOTHER STUDENT MAY NOT — this is the hole that was open",
          (await mayJoinPrivateRoom({ privateClassId: booking.id, studentId: stranger.id })) === false,
        );
      }

      check(
        "an unknown private class id lets nobody in",
        (await mayJoinPrivateRoom({ privateClassId: "does-not-exist", studentId: booking.studentId })) === false,
      );
    } else {
      console.log("  SKIP  private-room checks — no PrivateClass rows in this database");
    }

    // --- Closing ----------------------------------------------------------
    await closeLiveSession(roomName);
    check("ending the class closes it", (await liveSessionForStudent(student)) === null);
  } finally {
    // Only rows this run created. A real class in progress is untouched.
    await prisma.liveClassInvite.deleteMany({ where: { sessionId: { in: created } } });
    await prisma.liveClassSession.deleteMany({ where: { id: { in: created } } });
    console.log(`\n  cleaned up ${created.length} test session(s)`);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
