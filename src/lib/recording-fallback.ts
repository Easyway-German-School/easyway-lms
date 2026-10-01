/**
 * When may the LMS fall back to LiveKit's own (paid) recording?
 *
 * The recorder fleet is meant to make LiveKit recording unnecessary: it costs about $1.20 per class-hour,
 * which is what made the September bill $125. Falling back is the safety net for "our recorder could not take
 * this class", and a safety net with no limit is how a surprise bill comes back. So the fallback is
 * PATIENT, CAPPED and OPTIONAL, and every use of it is announced to the admins.
 *
 *   RECORDER_FALLBACK = immediate (default, the original behaviour) | delayed | never
 *     immediate  pay LiveKit the moment our recorder cannot take the class.
 *     delayed    wait (RECORDER_FALLBACK_AFTER_MINUTES, default 12): the tutor's page retries every ~45 s and
 *                the fleet starts a server for an unscheduled class within about 11 minutes, so most gaps close
 *                by themselves and LiveKit is never paid. The first minutes of that class are not recorded.
 *     never      LiveKit recording is OFF entirely (also what RECORDING_BACKEND=recorder-only means).
 *   RECORDER_FALLBACK_MONTHLY_CAP_MINUTES  (optional) a hard monthly ceiling on LiveKit recording minutes.
 *     600 minutes is about $12. Once reached, no more LiveKit recording this month and admins are told.
 *
 * Pure (no database), so every rule is tested exactly.
 */

import { recordingBackend, type Env } from "@/lib/recorder";

export type FallbackMode = "immediate" | "delayed" | "never";
export type FallbackPolicy = { mode: FallbackMode; afterMinutes: number; monthlyCapMinutes: number | null };

export const DEFAULT_FALLBACK_AFTER_MINUTES = 12;

export function fallbackPolicy(env: Env = process.env): FallbackPolicy {
  const requested = String(env.RECORDER_FALLBACK ?? "").trim().toLowerCase();
  // recorder-only has always meant "no LiveKit recording": keep honouring it.
  const mode: FallbackMode =
    recordingBackend(env) === "recorder-only" ? "never" : requested === "never" || requested === "delayed" ? requested : "immediate";
  const after = Number(env.RECORDER_FALLBACK_AFTER_MINUTES);
  const cap = env.RECORDER_FALLBACK_MONTHLY_CAP_MINUTES === undefined || env.RECORDER_FALLBACK_MONTHLY_CAP_MINUTES === "" ? null : Number(env.RECORDER_FALLBACK_MONTHLY_CAP_MINUTES);
  return {
    mode,
    afterMinutes: Number.isFinite(after) && after >= 1 ? Math.min(Math.round(after), 120) : DEFAULT_FALLBACK_AFTER_MINUTES,
    monthlyCapMinutes: cap !== null && Number.isFinite(cap) && cap >= 0 ? Math.round(cap) : null,
  };
}

export type FallbackDecision =
  | { allow: true }
  | { allow: false; reason: "policy-never" | "budget" | "waiting"; detail: string };

/**
 * `classLiveMinutes` is how long this class has been live (null = unknown, e.g. a webinar: do not make it wait).
 * `liveKitMinutesThisMonth` is what LiveKit has recorded (or is recording) this month.
 */
export function decideFallback(input: { policy: FallbackPolicy; classLiveMinutes: number | null; liveKitMinutesThisMonth: number }): FallbackDecision {
  const { policy, classLiveMinutes, liveKitMinutesThisMonth } = input;
  if (policy.mode === "never") return { allow: false, reason: "policy-never", detail: "LiveKit recording is switched off" };
  if (policy.monthlyCapMinutes !== null && liveKitMinutesThisMonth >= policy.monthlyCapMinutes) {
    return { allow: false, reason: "budget", detail: `the monthly LiveKit recording budget (${policy.monthlyCapMinutes} min) is used up` };
  }
  if (policy.mode === "delayed" && classLiveMinutes !== null && classLiveMinutes < policy.afterMinutes) {
    return { allow: false, reason: "waiting", detail: `waiting for a recorder server (${Math.floor(classLiveMinutes)} of ${policy.afterMinutes} min)` };
  }
  return { allow: true };
}

/** First instant of the current school month, in UTC, for "this month's" LiveKit minutes. */
export function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Minutes recorded by LiveKit this month: finished ones by their duration, one still running by how long it has run. */
export function liveKitMinutes(rows: { durationSeconds: number | null; startedAt: Date; status: string }[], now: Date): number {
  const seconds = rows.reduce((sum, r) => {
    if (r.durationSeconds != null) return sum + Math.max(0, r.durationSeconds);
    return r.status === "active" ? sum + Math.max(0, (now.getTime() - r.startedAt.getTime()) / 1000) : sum;
  }, 0);
  return Math.ceil(seconds / 60);
}
