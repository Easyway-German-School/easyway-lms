/**
 * WHEN CAMPUS MAY BUZZ A PHONE — and what it says.
 *
 * Real apps do not email you that someone waved. They put a short line on your
 * lock screen, once, at a sensible hour, and they stop when you are already
 * looking at the app. That is the whole design, and it is written down here so
 * it is one set of rules rather than a judgement call in six places:
 *
 *   PHONE, NOT EMAIL.   Everything on Campus is about right now, which is the
 *                       one thing email is slowest at. Mail stays for the
 *                       official things — a receipt, a result, an exam — and
 *                       the Campus kinds are deliberately not in that list.
 *   NOT WHILE YOU'RE HERE.  If the phone was in use on Campus a moment ago the
 *                       bell and the tab badge already say it; a buzz on top
 *                       is just noise.
 *   QUIET HOURS.        Nothing after 21:00 for under-18s, 22:00 for adults,
 *                       until 07:00 (Lagos time). A challenge that expires in
 *                       three minutes is worth nothing at midnight anyway.
 *   A DAILY CEILING.    The surest way to teach somebody to turn notifications
 *                       off is to send too many. Low for minors, higher for
 *                       adults. Anything over the line still lands in the bell
 *                       — it just does not buzz.
 *   ONE THREAD, ONE LINE.  Each duel has its own tag, so "challenged you",
 *                       "took your challenge" and "result" about one duel replace
 *                       each other instead of stacking.
 *   VARIED WORDS.       The same sentence ten times becomes invisible. Each
 *                       kind has a few phrasings, chosen per event.
 *
 * Pure and unit-tested. Never mentions anything a student typed, because there
 * is nothing a student types on Campus.
 */

import type { Band } from "@/lib/campus";
import { KIND } from "@/lib/notification-kinds";

export type CampusKind =
  | typeof KIND.campusWave
  | typeof KIND.campusChallenge
  | typeof KIND.campusAccepted
  | typeof KIND.campusDuelResult;

/** Lagos is UTC+1 all year. */
const LAGOS_OFFSET_H = 1;

export const QUIET_FROM_HOUR: Record<Band, number> = { minor: 21, adult: 22, unknown: 21 };
export const QUIET_TO_HOUR = 7;

/** Buzzes per day, across all Campus kinds. Over this it still reaches the bell. */
export const DAILY_PUSH_CAP: Record<Band, number> = { minor: 4, adult: 8, unknown: 4 };

/** Something stops being worth a buzz this long after the person last looked at the app. */
export const ACTIVE_WINDOW_MS = 2 * 60_000;

/** Kinds with a clock on them may use twice the ceiling — a duel that expires in minutes is the point. */
const TIME_SENSITIVE = new Set<string>([KIND.campusChallenge, KIND.campusAccepted]);

export function lagosHour(now: Date | number): number {
  return (new Date(now).getUTCHours() + LAGOS_OFFSET_H) % 24;
}

/** The start of the current Lagos day, as a UTC instant — for "how many today". */
export function lagosDayStart(now: Date | number): Date {
  const t = new Date(now).getTime() + LAGOS_OFFSET_H * 3_600_000;
  const midnightLagos = Math.floor(t / 86_400_000) * 86_400_000;
  return new Date(midnightLagos - LAGOS_OFFSET_H * 3_600_000);
}

export function inQuietHours(band: Band, now: Date | number): boolean {
  const h = lagosHour(now);
  const from = QUIET_FROM_HOUR[band];
  return h >= from || h < QUIET_TO_HOUR;
}

export type PushVerdict = { push: true } | { push: false; reason: "active" | "quiet" | "cap" };

export function pushVerdict(input: {
  kind: CampusKind;
  band: Band;
  now: Date | number;
  /** How many Campus notifications this person already got today. */
  sentToday: number;
  /** When they were last seen on Campus, or null if never / not known. */
  lastSeenAt: Date | number | null;
}): PushVerdict {
  const now = new Date(input.now).getTime();
  if (input.lastSeenAt !== null && now - new Date(input.lastSeenAt).getTime() <= ACTIVE_WINDOW_MS) {
    return { push: false, reason: "active" };
  }
  if (inQuietHours(input.band, now)) return { push: false, reason: "quiet" };
  const cap = DAILY_PUSH_CAP[input.band] * (TIME_SENSITIVE.has(input.kind) ? 2 : 1);
  if (input.sentToday >= cap) return { push: false, reason: "cap" };
  return { push: true };
}

/* -------------------------------------------------------------------------- */
/* Words                                                                      */
/* -------------------------------------------------------------------------- */

/** A small stable hash, so the same event always reads the same but different events vary. */
function pick<T>(options: readonly T[], seed: string): T {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return options[(h >>> 0) % options.length];
}

export type Copy = { title: string; message: string };

export function waveCopy(name: string, seed: string): Copy {
  return {
    title: `${name} waved at you`,
    message: pick(["Wave back?", "They're online right now.", "Say hi back."], seed),
  };
}

export function challengeCopy(name: string, seed: string): Copy {
  return {
    title: `${name} challenged you`,
    message: pick(
      ["Wortduell — 3 minutes to answer.", "Der, die or das? Take it before it expires.", "Eight words. Think you can win?"],
      seed,
    ),
  };
}

export function acceptedCopy(name: string, seed: string): Copy {
  return {
    title: `${name} took your challenge`,
    message: pick(["The duel is ready — jump in.", "Your move. Eight words.", "They're waiting for you."], seed),
  };
}

export function resultCopy(input: {
  name: string;
  outcome: "won" | "lost" | "draw";
  myPoints: number;
  theirPoints: number;
  coins: number;
  seed: string;
}): Copy {
  const score = `${input.myPoints} – ${input.theirPoints}`;
  const coins = input.coins > 0 ? ` · +${input.coins} coins` : "";
  if (input.outcome === "won") {
    return { title: `You beat ${input.name}`, message: `${score}${coins}. ${pick(["Nice one.", "Clean win.", "Too quick for them."], input.seed)}` };
  }
  if (input.outcome === "draw") {
    return { title: `You drew with ${input.name}`, message: `${score}. ${pick(["Rematch?", "So close.", "Call it even."], input.seed)}` };
  }
  return {
    title: `${input.name} finished — close one`,
    message: `${score}. ${pick(["Rematch?", "You'll get them next time.", "Go again?"], input.seed)}`,
  };
}

/** Where a tap should land. */
export function linkFor(kind: CampusKind, duelId?: string | null): string {
  if (kind === KIND.campusWave) return "/campus";
  if (kind === KIND.campusChallenge) return "/campus/arena";
  return duelId ? `/campus/duel/${duelId}` : "/campus/arena";
}

/** The lock-screen thread: one per duel, one per sender for waves. */
export function tagFor(kind: CampusKind, ref: string): string {
  return `${kind}:${ref}`;
}
