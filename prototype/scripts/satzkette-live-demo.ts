/**
 * Exercises Satzkette end to end against the live database, using the real
 * createMatch / submitTurn / openLapsedTurns - not reimplementations of them.
 *
 * SAFETY. Port Harcourt B2 has an empty roster, so no real student is in it and
 * nobody real can be pinged. Three FIXTURE students are moved into it for the
 * duration and moved back in the `finally` block, whatever happens. The match,
 * its turns and every notification raised are deleted at the end.
 *
 * Run:  npx tsx scripts/satzkette-live-demo.ts
 */
import { prisma } from "@/lib/prisma";
import { runUnscoped, runWithTenant } from "@/lib/tenant/context";
import {
  createMatch,
  openLapsedTurns,
  rosterFor,
  submitTurn,
  TURN_NOTIFY_KIND,
} from "@/lib/satzkette-server";
import { assembleStory, type Constraint } from "@/lib/satzkette";

const SPACE_NAME = "Port Harcourt · B2";
const FIXTURE_EMAILS = [
  "hybrid.test@ew.test",
  "physical.test@ew.test",
  "onlineonly.test@ew.test",
];

const line = (s = "") => console.log(s);
const head = (s: string) => {
  line();
  line("=".repeat(72));
  line(s);
  line("=".repeat(72));
};

async function main() {
  const space = await prisma.space.findFirst({
    where: { name: SPACE_NAME },
    select: { id: true, name: true, branchId: true, level: true, sessionSlot: true, tenantId: true },
  });
  if (!space) throw new Error(`No space named ${SPACE_NAME}`);

  const before = await rosterFor(null, space.id);
  if (before.length > 0) {
    throw new Error(
      `REFUSING: ${SPACE_NAME} has ${before.length} member(s). Demo only runs in an empty cohort.`,
    );
  }
  line(`${space.name} roster is empty - safe to use. tenant=${space.tenantId}`);

  const tutor = await prisma.user.findFirst({
    where: { email: "lecturer@easyway.test" },
    select: { id: true, name: true },
  });
  if (!tutor) throw new Error("No fixture lecturer");

  const students = await prisma.student.findMany({
    where: { user: { email: { in: FIXTURE_EMAILS } } },
    select: {
      id: true,
      branchId: true,
      level: true,
      sessionSlot: true,
      status: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });
  if (students.length < 2) throw new Error(`Need >=2 fixtures, found ${students.length}`);

  // Remember exactly where each fixture lives, so it goes back.
  const original = students.map((s) => ({
    id: s.id,
    branchId: s.branchId,
    level: s.level,
    sessionSlot: s.sessionSlot,
    status: s.status,
  }));

  const nameOf = new Map(students.map((s) => [s.user!.id, s.user!.name ?? s.user!.email]));
  let matchId: string | null = null;

  try {
    head("1. Staging three fixture students into the empty cohort");
    for (const s of students) {
      await prisma.student.update({
        where: { id: s.id },
        data: {
          branchId: space.branchId,
          level: space.level,
          sessionSlot: space.sessionSlot,
          status: "active",
        },
      });
      line(`  moved ${s.user!.email}`);
    }

    const roster = await rosterFor(null, space.id);
    line(`  rosterFor now returns ${roster.length} players`);

    head("2. A tutor starts a story (the real createMatch)");
    const constraints: Constraint[] = [
      { rule: "vocab", words: ["Bahnhof"] },
      { rule: "pattern", pattern: "weil", label: 'Use "weil" and send the verb to the end' },
      { rule: "length", minWords: 6 },
      { rule: "grammar", label: "Put your sentence in the perfect tense" },
    ];

    const match = await createMatch({
      spaceId: space.id,
      title: "Der verlorene Koffer",
      prompt: "Am Bahnhof steht ein Koffer, den niemand abholt.",
      constraints,
      targetTurns: 5,
      createdById: tutor.id,
    });
    if (!match) throw new Error("createMatch returned null");
    matchId = match.id;
    line(`  match created: ${match.id}  "${match.title}"`);

    const first = await prisma.gameTurn.findFirst({
      where: { matchId: match.id, position: 1 },
      select: { id: true, assignedToId: true, status: true, deadline: true, constraint: true },
    });
    line(`  turn 1 -> ${nameOf.get(first!.assignedToId)}  status=${first!.status}`);
    line(`  rule: ${JSON.stringify(first!.constraint)}`);
    line(`  deadline: ${first!.deadline.toISOString()}`);

    head("3. A sentence that BREAKS its rule is refused");
    const bad = await submitTurn({
      turnId: first!.id,
      userId: first!.assignedToId,
      sentence: "Ich warte hier auf meinen Zug.", // no "Bahnhof"
    });
    line(`  submitted: "Ich warte hier auf meinen Zug."  (rule was: use "Bahnhof")`);
    line(`  result: ${JSON.stringify(bad)}`);

    head("4. A sentence that OBEYS its rule is accepted");
    const good = await submitTurn({
      turnId: first!.id,
      userId: first!.assignedToId,
      sentence: "Am Bahnhof sah ich einen alten braunen Koffer.",
      });
    line(`  result: ${JSON.stringify(good)}`);

    head("5. Somebody who was NOT asked cannot jump in early");
    const turn2 = await prisma.gameTurn.findFirst({
      where: { matchId: match.id, position: 2 },
      select: { id: true, assignedToId: true, status: true },
    });
    const intruder = roster.find((r) => r.userId !== turn2!.assignedToId)!;
    line(`  turn 2 belongs to ${nameOf.get(turn2!.assignedToId)}`);
    const stolen = await submitTurn({
      turnId: turn2!.id,
      userId: intruder.userId,
      sentence: "Ich habe den Koffer sofort geoeffnet und nichts gefunden.",
    });
    line(`  ${nameOf.get(intruder.userId)} tries anyway -> ${JSON.stringify(stolen)}`);

    head("6. The deadline passes - the turn OPENS to the whole cohort");
    await prisma.gameTurn.update({
      where: { id: turn2!.id },
      data: { deadline: new Date(Date.now() - 60_000) },
    });
    const opened = await openLapsedTurns(new Date());
    line(`  openLapsedTurns opened ${opened} turn(s)`);

    const nowOpen = await prisma.gameTurn.findUnique({
      where: { id: turn2!.id },
      select: { status: true, assignedToId: true },
    });
    line(`  turn 2 status is now "${nowOpen!.status}" (still assigned to ${nameOf.get(nowOpen!.assignedToId)})`);

    const rescued = await submitTurn({
      turnId: turn2!.id,
      userId: intruder.userId,
      sentence: "Niemand hat ihn geholt, weil der Besitzer verschwunden war.",
    });
    line(`  the same student who was refused above now succeeds -> ${JSON.stringify(rescued)}`);

    head("7. The story so far, read back");
    const turns = await prisma.gameTurn.findMany({
      where: { matchId: match.id },
      orderBy: { position: "asc" },
      select: { position: true, sentence: true, playerId: true, status: true, constraint: true },
    });
    for (const t of turns) {
      const who = t.playerId ? nameOf.get(t.playerId) ?? t.playerId : "-";
      line(
        `  ${t.position}. [${t.status.padEnd(9)}] ${t.sentence ?? "(not written yet)"}   - ${who}`,
      );
    }

    head("8. What the class actually sees");
    const written = turns
      .filter((t) => t.sentence)
      .map((t) => t.sentence!.trim())
      .join(" ");
    line(`  "${written}"`);
  } finally {
    head("CLEANUP");
    if (matchId) {
      const delTurns = await prisma.gameTurn.deleteMany({ where: { matchId } });
      const delMatch = await prisma.gameMatch.deleteMany({ where: { id: matchId } });
      line(`  deleted ${delTurns.count} turn(s), ${delMatch.count} match(es)`);
    }
    const delNotif = await prisma.notification.deleteMany({
      where: { kind: TURN_NOTIFY_KIND },
    });
    line(`  deleted ${delNotif.count} notification(s)`);

    for (const o of original) {
      await prisma.student.update({
        where: { id: o.id },
        data: {
          branchId: o.branchId,
          level: o.level,
          sessionSlot: o.sessionSlot,
          status: o.status,
        },
      });
    }
    line(`  restored ${original.length} fixture student(s) to their original cohort`);

    const after = await rosterFor(null, (await prisma.space.findFirst({
      where: { name: SPACE_NAME },
      select: { id: true },
    }))!.id);
    line(`  ${SPACE_NAME} roster is back to ${after.length} - ${after.length === 0 ? "clean" : "CHECK THIS"}`);
  }
}

runUnscoped("one-off live verification of Satzkette across the demo tenant", async () => {
  const space = await prisma.space.findFirst({
    where: { name: SPACE_NAME },
    select: { tenantId: true },
  });
  const tenantId = space?.tenantId;
  if (!tenantId) throw new Error("space has no tenantId");
  return runWithTenant(tenantId, main);
})
  .catch((err) => {
    console.error("\nFAILED:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
