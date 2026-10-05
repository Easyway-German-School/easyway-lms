/**
 * Proves Campus against the real database: the age-band wall, requests, a full
 * duel, and the coin ledger's idempotency.
 *
 * Throwaway students are created and removed again; nothing else is touched.
 * Portal access needs a paid deposit, which is outside what this is proving, so
 * eligibility is seeded directly on the presence rows — everything else (band
 * from birth date, the queries, the scoring, the ledger) is the real code.
 *
 *   npx tsx scripts/prove-campus.ts
 */

import { PrismaClient } from "@prisma/client";

import { runUnscoped, runWithTenant } from "../src/lib/tenant/context";

import {
  awardCoins,
  duelFor,
  heartbeat,
  loadCampusStudent,
  onlineInBand,
  requestsForMe,
  respondToRequest,
  sendRequest,
  submitDuelAnswer,
  type CampusStudent,
} from "../src/lib/campus-server";

const raw = new PrismaClient();
const TAG = "campusproof";

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

type Who = { key: string; email: string; userId: string; studentId: string; dob: string | null; level: string };

async function makeStudent(key: string, dob: string | null, level: string, tenantId: string | null, branchId: string | null): Promise<Who> {
  const email = `${TAG}.${key}@example.test`;
  const user = await raw.user.create({ data: { email, name: `Proof ${key} Tester`, password: "x", role: "STUDENT", tenantId } });
  const student = await raw.student.create({
    data: { userId: user.id, tenantId, branchId, level, admission: dob ? { dob, batch: "October" } : { batch: "October" } },
  });
  return { key, email, userId: user.id, studentId: student.id, dob, level };
}

async function cleanup() {
  const users = await raw.user.findMany({ where: { email: { startsWith: `${TAG}.` } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await raw.campusRequest.deleteMany({ where: { OR: [{ fromUserId: { in: ids } }, { toUserId: { in: ids } }] } });
    await raw.campusDuel.deleteMany({ where: { OR: [{ playerAId: { in: ids } }, { playerBId: { in: ids } }] } });
    await raw.campusPresence.deleteMany({ where: { userId: { in: ids } } });
    const students = await raw.student.findMany({ where: { userId: { in: ids } }, select: { id: true } });
    await raw.coinTransaction.deleteMany({ where: { studentId: { in: students.map((s) => s.id) } } });
    await raw.user.deleteMany({ where: { id: { in: ids } } });
  }
}

async function main() {
  await cleanup();
  const sample = await raw.student.findFirst({ select: { tenantId: true, branchId: true } });
  const tenantId = sample?.tenantId ?? null;
  const branchId = sample?.branchId ?? null;

  const ada = await makeStudent("ada", "2010-05-01", "A1", tenantId, branchId); // minor
  const bola = await makeStudent("bola", "2009-02-11", "B1", tenantId, branchId); // minor
  const chidi = await makeStudent("chidi", "1994-07-20", "A2", tenantId, branchId); // adult
  const dayo = await makeStudent("dayo", null, "A1", tenantId, branchId); // unknown

  try {
    console.log("\nthe age-band wall — worked out from real birth dates:");
    const [a, b, c, d] = (await Promise.all([ada, bola, chidi, dayo].map((w) => loadCampusStudent(w.userId)))) as CampusStudent[];
    check("a 2010 birth date is the minor band", a.band === "minor", a.band);
    check("a 2009 birth date is the minor band", b.band === "minor", b.band);
    check("a 1994 birth date is the adult band", c.band === "adult", c.band);
    check("no birth date is the unknown band — not guessed", d.band === "unknown", d.band);
    check("an unpaid student is not eligible (the portal lock is respected)", a.eligible === false);

    // Eligibility is seeded: paying a deposit is not what is under test.
    for (const [w, s] of [[ada, a], [bola, b], [chidi, c], [dayo, d]] as const) {
      await raw.campusPresence.create({
        data: { userId: w.userId, tenantId, band: s.band, room: "lobby", hidden: false, eligible: true, lastSeenAt: new Date(0) },
      });
    }

    console.log("\nheartbeats:");
    const hb = await heartbeat(ada.userId, "library");
    check("a heartbeat is accepted", hb.ok === true);
    check("it pays the daily visit coins", hb.ok && hb.balance === 5, hb.ok ? String(hb.balance) : "refused");
    await heartbeat(bola.userId, "arena", true); // bola hides
    await heartbeat(chidi.userId, "library");
    await heartbeat(dayo.userId, "library");
    const again = await heartbeat(ada.userId, "library");
    check("a second heartbeat the same day pays nothing more", again.ok && (again.balance === null || again.balance === 5));

    console.log("\nthe shared picture, per band:");
    const minors = await onlineInBand(tenantId, "minor");
    const adults = await onlineInBand(tenantId, "adult");
    const unknown = await onlineInBand(tenantId, "unknown");
    const names = (xs: { userId: string }[]) => xs.map((x) => x.userId);
    check("the minor band contains Ada", names(minors).includes(ada.userId));
    check("a hidden student (Bola) is not shown to anybody", !names(minors).includes(bola.userId));
    check("NO adult appears in the minor band", !names(minors).includes(chidi.userId) && !names(minors).includes(dayo.userId));
    check("NO minor appears in the adult band", !names(adults).includes(ada.userId) && !names(adults).includes(bola.userId));
    check("the unknown band is its own pool", names(unknown).includes(dayo.userId) && !names(unknown).includes(chidi.userId));
    check("faces carry a name but not a surname", minors.find((p) => p.userId === ada.userId)?.name === "Proof T.");

    console.log("\nrequests:");
    const bolaMe = { ...b, eligible: true };
    const adaMe = { ...a, eligible: true };
    const chidiMe = { ...c, eligible: true };
    // Bola is hidden, so she cannot be waved at — and the answer does not say why.
    const toHidden = await sendRequest({ from: adaMe, fromUserId: ada.userId, kind: "wave", toUserId: bola.userId });
    check("a hidden student can't be waved at (same answer as offline)", !toHidden.ok && toHidden.status === 404);
    await heartbeat(bola.userId, "arena", false); // bola comes back
    const wave = await sendRequest({ from: adaMe, fromUserId: ada.userId, kind: "wave", toUserId: bola.userId });
    check("a minor can wave at another online minor", wave.ok === true);
    const waveRows = await raw.notification.findMany({ where: { userId: bola.userId, kind: "campus.wave" } });
    check("the wave reached Bola's bell as exactly one notification", waveRows.length === 1, String(waveRows.length));
    check("…titled with Ada's short name", waveRows[0]?.title === "Proof T. waved at you", waveRows[0]?.title);
    const waveAgain = await sendRequest({ from: adaMe, fromUserId: ada.userId, kind: "wave", toUserId: bola.userId });
    check("waving twice at the same person does not double-notify", waveAgain.ok && waveAgain.duplicate === true && (await raw.notification.count({ where: { userId: bola.userId, kind: "campus.wave" } })) === 1);
    const across = await sendRequest({ from: adaMe, fromUserId: ada.userId, kind: "wave", toUserId: chidi.userId });
    check("a minor CANNOT send to an adult", !across.ok);
    const acrossBack = await sendRequest({ from: chidiMe, fromUserId: chidi.userId, kind: "wave", toUserId: ada.userId });
    check("an adult CANNOT send to a minor", !acrossBack.ok);
    const toSelf = await sendRequest({ from: adaMe, fromUserId: ada.userId, kind: "duel", toUserId: ada.userId });
    check("nobody can challenge themselves", !toSelf.ok);

    console.log("\nan open challenge and the duel:");
    const call = await sendRequest({ from: adaMe, fromUserId: ada.userId, kind: "duel", toUserId: null });
    check("Ada puts out an open challenge", call.ok === true);
    if (!call.ok) throw new Error("no challenge");
    const dup = await sendRequest({ from: adaMe, fromUserId: ada.userId, kind: "duel", toUserId: null });
    check("sending it twice does not stack a second one", dup.ok && dup.duplicate === true);

    const seenByBola = await requestsForMe(bola.userId, tenantId, "minor");
    const seenByChidi = await requestsForMe(chidi.userId, tenantId, "adult");
    check("Bola (same band) sees the open challenge", seenByBola.open.some((r) => r.id === call.id));
    check("Chidi (adult) does NOT see it", seenByChidi.open.length === 0);
    check("Bola also sees Ada's wave", seenByBola.direct.some((r) => r.kind === "wave"));

    const blocked = await respondToRequest({ me: chidiMe, userId: chidi.userId, requestId: call.id, action: "accept" });
    check("an adult CANNOT take a minor's challenge", !blocked.ok);
    const own = await respondToRequest({ me: adaMe, userId: ada.userId, requestId: call.id, action: "accept" });
    check("Ada can't take her own challenge", !own.ok);

    const took = await respondToRequest({ me: bolaMe, userId: bola.userId, requestId: call.id, action: "accept" });
    check("Bola takes it and a duel is created", took.ok && Boolean(took.duelId));
    if (!took.ok || !took.duelId) throw new Error("no duel");
    const duelId = took.duelId;
    const acceptedPing = await raw.notification.findMany({ where: { userId: ada.userId, kind: "campus.accepted" } });
    check("Ada is told her challenge was taken", acceptedPing.length === 1 && acceptedPing[0].link === `/campus/duel/${took.duelId}`, acceptedPing[0]?.link ?? "none");
    const late = await respondToRequest({ me: bolaMe, userId: bola.userId, requestId: call.id, action: "accept" });
    check("a request can only be taken once", !late.ok);

    const row = await raw.campusDuel.findUniqueOrThrow({ where: { id: duelId } });
    check("the duel plays the LOWER level of the two (A1 vs B1)", row.level === "A1", row.level);
    const questions = row.questions as Array<{ noun: string; article: "der" | "die" | "das" }>;
    check("it has eight frozen words", questions.length === 8);

    const view0 = await duelFor(bola.userId, duelId);
    check("a player sees the words but NOT the articles", !!view0 && view0.questions.every((q) => !("article" in q)));
    check("a stranger can't open the duel", (await duelFor(chidi.userId, duelId)) === null);

    const skip = await submitDuelAnswer({ userId: ada.userId, duelId, i: 3, choice: "der", ms: 900 });
    check("answers must arrive in order — no skipping ahead", !skip.ok && skip.status === 409);
    const junk = await submitDuelAnswer({ userId: ada.userId, duelId, i: 0, choice: "dem", ms: 900 });
    check("only der/die/das are accepted", !junk.ok && junk.status === 400);

    // Ada answers everything right and fast; Bola gets half wrong.
    let adaCoins = 0;
    for (let i = 0; i < 8; i += 1) {
      const r = await submitDuelAnswer({ userId: ada.userId, duelId, i, choice: questions[i].article, ms: 800 });
      if (!r.ok) throw new Error(`ada answer ${i}: ${r.error}`);
      adaCoins += r.coins;
    }
    const midView = await duelFor(ada.userId, duelId);
    check("Ada finishing first does not end the duel — it waits for Bola", midView?.result === null && midView?.opponent.finished === false);
    check("Ada is paid for playing the moment she finishes", adaCoins === 8, String(adaCoins));
    const redo = await submitDuelAnswer({ userId: ada.userId, duelId, i: 7, choice: "der", ms: 800 });
    check("an answered word can't be answered again", !redo.ok);

    const wrong = (a: "der" | "die" | "das") => (a === "der" ? "die" : "der");
    let bolaCoins = 0;
    for (let i = 0; i < 8; i += 1) {
      const choice = i % 2 === 0 ? questions[i].article : wrong(questions[i].article);
      const r = await submitDuelAnswer({ userId: bola.userId, duelId, i, choice, ms: 1500 });
      if (!r.ok) throw new Error(`bola answer ${i}: ${r.error}`);
      bolaCoins += r.coins;
    }
    const end = await duelFor(ada.userId, duelId);
    check("both done → the duel closes with a result", end?.status === "done" && end.result !== null);
    check("Ada (all right, faster) wins", end?.result?.winner === "me", JSON.stringify(end?.result));
    const endBola = await duelFor(bola.userId, duelId);
    check("Bola sees it from her side: Ada won", endBola?.result?.winner === "them");

    const result = await raw.notification.findMany({ where: { userId: ada.userId, kind: "campus.duel_result" } });
    check("Ada, who finished first and waited, is told the result when Bola finishes", result.length === 1, String(result.length));
    check("…from HER side: she won, with the score", result[0]?.title === "You beat Proof T." && /1168 – 572/.test(result[0]?.message ?? ""), result[0]?.message);
    check("Bola, who closed the duel on screen, is NOT pinged about it", (await raw.notification.count({ where: { userId: bola.userId, kind: "campus.duel_result" } })) === 0);
    const everyCampusPing = await raw.notification.findMany({ where: { userId: { in: [ada.userId, bola.userId] }, kind: { startsWith: "campus." } }, select: { channel: true } });
    check("Campus pings are never email or SMS rows", everyCampusPing.every((n) => n.channel !== "email" && n.channel !== "sms"), everyCampusPing.map((n) => n.channel).join(","));

    const balances = await raw.student.findMany({ where: { id: { in: [ada.studentId, bola.studentId] } }, select: { id: true, coinBalance: true } });
    const adaBal = balances.find((x) => x.id === ada.studentId)!.coinBalance;
    const bolaBal = balances.find((x) => x.id === bola.studentId)!.coinBalance;
    // Ada: daily 5 + wave? (none received) + wave sent 1 + play 8 + win 7. Bola: daily 0 (first beat was hidden: still paid) -> see ledger.
    const ledgerA = await raw.coinTransaction.aggregate({ where: { studentId: ada.studentId }, _sum: { amount: true } });
    const ledgerB = await raw.coinTransaction.aggregate({ where: { studentId: bola.studentId }, _sum: { amount: true } });
    check("Ada's balance equals her ledger exactly", adaBal === (ledgerA._sum.amount ?? 0), `${adaBal} vs ${ledgerA._sum.amount}`);
    check("Bola's balance equals her ledger exactly", bolaBal === (ledgerB._sum.amount ?? 0), `${bolaBal} vs ${ledgerB._sum.amount}`);
    check("Ada was paid for the win (7) as well as playing (8)", (await raw.coinTransaction.count({ where: { studentId: ada.studentId, reason: "duel_win" } })) === 1);
    check("Bola, who lost, got the playing coins but no win bonus", (await raw.coinTransaction.count({ where: { studentId: bola.studentId, reason: "duel_play" } })) === 1 && (await raw.coinTransaction.count({ where: { studentId: bola.studentId, reason: "duel_win" } })) === 0);
    void adaCoins; void bolaCoins;

    console.log("\nthe ledger is idempotent:");
    const before = adaBal;
    const first = await awardCoins({ studentId: ada.studentId, tenantId, reason: "focus", refKey: "focus:proof:c1" });
    const second = await awardCoins({ studentId: ada.studentId, tenantId, reason: "focus", refKey: "focus:proof:c1" });
    check("the first award pays", first.awarded === true);
    check("the same award again pays NOTHING", second.awarded === false);
    const after = (await raw.student.findUniqueOrThrow({ where: { id: ada.studentId }, select: { coinBalance: true } })).coinBalance;
    check("so the balance moved once, not twice", after === before + 3, `${before} → ${after}`);
  } finally {
    await cleanup();
    await raw.$disconnect();
  }

  console.log(failures === 0 ? "\nAll Campus checks passed.\n" : `\n${failures} Campus check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

// A request is always scoped to one school; run the proof the same way, so the
// tenant guard is exercised rather than bypassed.
async function run() {
  const sample = await raw.student.findFirst({ select: { tenantId: true } });
  return sample?.tenantId ? runWithTenant(sample.tenantId, main) : runUnscoped("prove-campus: no tenant on the dev DB", main);
}

run().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => undefined);
  await raw.$disconnect();
  process.exit(1);
});
