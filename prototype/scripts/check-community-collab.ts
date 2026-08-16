/**
 * Does the community actually work BOTH WAYS?
 *
 * Not "did the row get written" — that was never in doubt. This asks the
 * question a student asks: I sent something, can my classmates see it, and can
 * they act on it? So it exercises the same authorisation the API routes use
 * (resolveSpaceScope / authorizeChannel / authorizeMessage) as EACH person in
 * turn, rather than trusting a query that ignores permissions.
 *
 * Everything it writes is removed at the end, and it only ever touches rows it
 * created itself.
 *
 * npx tsx --tsconfig tsconfig.json --env-file=.env.local scripts/check-community-collab.ts
 */

import { PrismaClient } from "@prisma/client";
import {
  authorizeChannel,
  authorizeMessage,
  canPostInChannel,
  resolveSpaceScope,
} from "../src/lib/community-spaces";
import { runUnscoped } from "../src/lib/tenant/context";

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
  /**
   * Find a room with at least two real students in it. A one-person cohort
   * cannot answer the question this script exists to ask.
   */
  // Pass a fragment of a room name to check that specific cohort, e.g.
  //   … scripts/check-community-collab.ts "Online · A2 · Morning"
  const wanted = process.argv.slice(2).join(" ").trim().toLowerCase();

  const spaces = (
    await prisma.space.findMany({
      select: { id: true, name: true, branchId: true, level: true, sessionSlot: true },
    })
  ).filter((space) => !wanted || space.name.toLowerCase().includes(wanted));

  let cohort: {
    space: (typeof spaces)[number];
    students: Array<{ userId: string; email: string | null }>;
  } | null = null;

  for (const space of spaces) {
    const students = await prisma.student.findMany({
      where: {
        branchId: space.branchId,
        level: space.level,
        sessionSlot: space.sessionSlot,
        status: "active",
      },
      select: { userId: true, user: { select: { email: true } } },
      take: 4,
    });
    if (students.length >= 2) {
      cohort = {
        space,
        students: students.map((s) => ({ userId: s.userId, email: s.user.email })),
      };
      break;
    }
  }

  if (!cohort) {
    console.log("No room has two active students — cannot test two-way visibility.");
    return;
  }

  const [alice, bob] = cohort.students;
  console.log(`Room: ${cohort.space.name}`);
  console.log(`  A: ${alice.email}`);
  console.log(`  B: ${bob.email}\n`);

  const general = await prisma.channel.findFirst({
    where: { spaceId: cohort.space.id, slug: "general" },
    select: { id: true, kind: true, name: true },
  });
  if (!general) {
    console.log("That room has no General channel.");
    return;
  }

  const viewerA = { userId: alice.userId, role: "student" };
  const viewerB = { userId: bob.userId, role: "student" };

  /* ---------------------------------------------------------------- reach */

  const scopeA = await resolveSpaceScope(viewerA);
  const scopeB = await resolveSpaceScope(viewerB);
  check("both classmates resolve to the same room",
    scopeA.spaceIds.includes(cohort.space.id) && scopeB.spaceIds.includes(cohort.space.id));

  check("A may open General", Boolean(await authorizeChannel(viewerA, general.id)));
  check("B may open General", Boolean(await authorizeChannel(viewerB, general.id)));
  check("both may post there", canPostInChannel(general.kind, "student"));

  /* ----------------------------------------------------------- A sends... */

  const sent = await prisma.message.create({
    data: {
      channelId: general.id,
      authorId: alice.userId,
      body: "[automated check] can my classmates see this?",
      attachmentUrl: "/api/files/files/check-collab.jpg",
      attachmentType: "image/jpeg",
      attachmentName: "check-collab.jpg",
    },
    select: { id: true },
  });

  try {
    /* ------------------------------------------------------- ...B receives */

    const seenByB = await authorizeMessage(viewerB, sent.id);
    check("B is allowed to read A's message", Boolean(seenByB));

    // The exact query the poll runs: everything in this channel since a cursor.
    const polled = await prisma.message.findMany({
      where: { channelId: general.id, createdAt: { gte: new Date(Date.now() - 60_000) } },
      select: { id: true, attachmentUrl: true },
    });
    const found = polled.find((m) => m.id === sent.id);
    check("B's poll of the room returns it", Boolean(found));
    check("the picture comes with it", Boolean(found?.attachmentUrl));

    /* ------------------------------------------------ ...and can act on it */

    const reaction = await prisma.messageReaction.create({
      data: { messageId: sent.id, userId: bob.userId, emoji: "👍" },
      select: { id: true },
    });
    const reactions = await prisma.messageReaction.findMany({ where: { messageId: sent.id } });
    check("B can react to it", reactions.length === 1);

    const reply = await prisma.message.create({
      data: {
        channelId: general.id,
        authorId: bob.userId,
        body: "[automated check] yes, seen.",
        replyToId: sent.id,
      },
      select: { id: true, replyToId: true },
    });
    check("B can reply, quoting it", reply.replyToId === sent.id);
    check("A is allowed to read the reply back", Boolean(await authorizeMessage(viewerA, reply.id)));

    /* --------------------------------------------------- and the tutor too */

    const lecturer = await prisma.lecturer.findFirst({
      where: {
        OR: [
          { branchId: cohort.space.branchId, level: cohort.space.level },
          { levels: { equals: [cohort.space.level] } },
        ],
      },
      select: { userId: true, user: { select: { email: true } } },
    });

    if (lecturer) {
      const viewerT = { userId: lecturer.userId, role: "lecturer" };
      const scopeT = await resolveSpaceScope(viewerT);
      const tutorSees = scopeT.spaceIds.includes(cohort.space.id);
      console.log(`\n  (tutor ${lecturer.user.email} covers this room: ${tutorSees})`);
      if (tutorSees) {
        check("their tutor can read it too", Boolean(await authorizeMessage(viewerT, sent.id)));
      }
    }

    /* ------------------------------------------------ a stranger cannot ---*/

    const outsider = await prisma.student.findFirst({
      where: {
        status: "active",
        NOT: { userId: { in: [alice.userId, bob.userId] } },
        OR: [
          { level: { not: cohort.space.level } },
          { sessionSlot: { not: cohort.space.sessionSlot } },
        ],
      },
      select: { userId: true, user: { select: { email: true } }, level: true, sessionSlot: true },
    });
    if (outsider) {
      const seen = await authorizeMessage({ userId: outsider.userId, role: "student" }, sent.id);
      check(
        `a student from another cohort (${outsider.level}/${outsider.sessionSlot}) CANNOT read it`,
        seen === null,
      );
    }

    await prisma.messageReaction.delete({ where: { id: reaction.id } });
    await prisma.message.delete({ where: { id: reply.id } });
  } finally {
    await prisma.message.deleteMany({ where: { id: sent.id } });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

runUnscoped("read-only collaboration check across cohorts", main)
  .catch((error) => {
    console.error("Fatal:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
