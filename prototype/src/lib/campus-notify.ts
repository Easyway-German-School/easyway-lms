/**
 * Sending Campus's phone notifications — the rules are in
 * campus-notify-policy.ts; this applies them to a real person.
 *
 * Every ping is BEST-EFFORT and never throws: a notification that fails must
 * not fail the wave, the challenge or the duel that caused it.
 *
 * What always happens is the bell row (notify() writes it regardless), so
 * nothing is ever lost — the policy only decides whether the phone also buzzes.
 * Email and SMS are forced off for every Campus kind, so no setting anywhere can
 * turn a wave into an email.
 */

import { type Band } from "@/lib/campus";
import {
  acceptedCopy,
  challengeCopy,
  lagosDayStart,
  linkFor,
  pushVerdict,
  resultCopy,
  tagFor,
  waveCopy,
  type CampusKind,
  type Copy,
} from "@/lib/campus-notify-policy";
import { notify } from "@/lib/notify";
import { KIND } from "@/lib/notification-kinds";
import { prisma } from "@/lib/prisma";

async function send(input: {
  toUserId: string;
  kind: CampusKind;
  copy: Copy;
  /** The thing this is about — a request or duel id. Gives it its own lock-screen line and its own dedupe key. */
  ref: string;
  duelId?: string | null;
}): Promise<void> {
  try {
    const now = new Date();
    const [presence, sentToday] = await Promise.all([
      prisma.campusPresence.findUnique({ where: { userId: input.toUserId }, select: { band: true, lastSeenAt: true } }),
      prisma.notification.count({
        where: { userId: input.toUserId, kind: { startsWith: "campus." }, createdAt: { gte: lagosDayStart(now) } },
      }),
    ]);

    const verdict = pushVerdict({
      kind: input.kind,
      band: (presence?.band as Band | undefined) ?? "unknown",
      now,
      sentToday,
      lastSeenAt: presence?.lastSeenAt ?? null,
    });

    await notify({
      to: { userIds: [input.toUserId] },
      kind: input.kind,
      severity: "info",
      title: input.copy.title,
      message: input.copy.message,
      link: linkFor(input.kind, input.duelId),
      push: verdict.push,
      pushTag: tagFor(input.kind, input.ref),
      // One bell row and one buzz per thing, however many times this is called.
      dedupeKey: `${input.kind}:${input.ref}`,
      // Campus is phone-first: no setting may turn it into mail or a text.
      email: false,
      sms: false,
    });
  } catch (error) {
    console.warn("campus notify failed", error);
  }
}

export const pingWave = (to: string, fromName: string, requestId: string) =>
  send({ toUserId: to, kind: KIND.campusWave, copy: waveCopy(fromName, requestId), ref: requestId });

export const pingChallenge = (to: string, fromName: string, requestId: string) =>
  send({ toUserId: to, kind: KIND.campusChallenge, copy: challengeCopy(fromName, requestId), ref: requestId });

export const pingAccepted = (to: string, byName: string, duelId: string) =>
  send({ toUserId: to, kind: KIND.campusAccepted, copy: acceptedCopy(byName, duelId), ref: duelId, duelId });

export const pingDuelResult = (input: {
  to: string;
  opponentName: string;
  outcome: "won" | "lost" | "draw";
  myPoints: number;
  theirPoints: number;
  coins: number;
  duelId: string;
}) =>
  send({
    toUserId: input.to,
    kind: KIND.campusDuelResult,
    copy: resultCopy({
      name: input.opponentName,
      outcome: input.outcome,
      myPoints: input.myPoints,
      theirPoints: input.theirPoints,
      coins: input.coins,
      seed: input.duelId,
    }),
    ref: input.duelId,
    duelId: input.duelId,
  });
