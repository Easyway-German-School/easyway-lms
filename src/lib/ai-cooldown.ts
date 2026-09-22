import { prisma } from "@/lib/prisma";

/**
 * A DURABLE "Groq said no, don't ask again yet" flag, shared across every
 * serverless instance via one row in the existing `AiCache` table.
 *
 * Groq's free tier caps are ACCOUNT-WIDE and PER MODEL — an hourly and a daily
 * budget of audio-seconds for Whisper, a daily budget of tokens for each chat
 * model — and they outlive any one function. Without this, every fresh
 * function (the self-kicking notes runner, the daily cron, an admin pressing
 * "Run now") re-learns "we are out of budget" the expensive way: one more real
 * request, one more 429, one more alarming log line — for however long the
 * actual quota takes to free up (Groq: minutes for an hourly cap, and a daily
 * cap frees up gradually as a rolling 24h window, not at a fixed midnight).
 *
 * Two independent kinds, because Groq's limits are per model group, not one
 * account-wide switch: being out of Whisper's audio-seconds says nothing about
 * whether the chat models (used for summaries and handout write-ups) still
 * have room, and vice versa.
 */
export type CooldownKind = "groq-chat" | "groq-asr";

function keyFor(kind: CooldownKind): string {
  return `cooldown:${kind}`;
}

/**
 * Groq's OWN error message is the one reliable source of the real wait — a
 * standard `Retry-After` header is not always present for an hourly/daily cap,
 * and when it is missing this app's caller falls back to a useless 8s guess.
 * Groq spells it "Please try again in 13m27s." / "9m3s." / "27s." — minutes are
 * optional, seconds are not.
 */
export function parseGroqRetrySeconds(message: string): number | null {
  const match = message.match(/try again in\s+(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/i);
  if (!match) return null;
  const minutes = Number(match[1] ?? 0);
  const seconds = Number(match[2] ?? 0);
  // Rounded UP: undershooting the wait means one more wasted, log-spamming request.
  const total = Math.ceil(minutes * 60 + seconds);
  return total > 0 ? total : null;
}

/**
 * A ceiling on the ceiling. A wait this app mis-parses, or a limit Groq
 * reports as absurdly long, must not lock a quota out far longer than the
 * genuine damage — the next organic trigger (a class ending, the daily cron,
 * an admin press) tries again on its own once this passes, so waiting too
 * long only costs time, never correctness; capping it just bounds that cost.
 */
const MAX_COOLDOWN_MS = 20 * 60 * 1000;
const MIN_COOLDOWN_MS = 1000;

/** Record that this quota is out until `waitSeconds` from now. Best effort — a failed write costs nothing worse than the world before this existed. */
export async function markGroqCooldown(kind: CooldownKind, waitSeconds: number): Promise<void> {
  const until = Date.now() + Math.min(Math.max(waitSeconds * 1000, MIN_COOLDOWN_MS), MAX_COOLDOWN_MS);
  await prisma.aiCache
    .upsert({
      where: { key: keyFor(kind) },
      create: { key: keyFor(kind), task: "cooldown", value: { until }, status: "ready" },
      update: { value: { until } },
    })
    .catch(() => {});
}

/** When this quota is expected to have room again, or 0 if it is not known to be out. */
export async function groqCooldownUntil(kind: CooldownKind): Promise<number> {
  const row = await prisma.aiCache.findUnique({ where: { key: keyFor(kind) } }).catch(() => null);
  const until = Number((row?.value as { until?: number } | null)?.until);
  return Number.isFinite(until) && until > 0 ? until : 0;
}

/** Is this quota known to be out right now. */
export async function groqCoolingDown(kind: CooldownKind): Promise<boolean> {
  return (await groqCooldownUntil(kind)) > Date.now();
}
