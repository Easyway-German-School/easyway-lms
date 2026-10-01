/**
 * What the admin "Recording" page shows: is our own recorder working, what will it cost if it is not, and
 * what is coming. Pure assembly (no database or network), so the wording of every warning is tested.
 */

import type { RecorderDirectory } from "@/lib/recorder-directory";
import type { FallbackPolicy } from "@/lib/recording-fallback";

export type RecorderHealth = "ok" | "idle" | "warning" | "critical" | "off";

export type RecorderStatus = {
  mode: "livekit" | "recorder" | "recorder-only";
  fleet: boolean;
  health: RecorderHealth;
  headline: string;
  warnings: string[];
  servers: { id: string; capacity: number; active: number }[];
  directoryAgeSeconds: number | null;
  fallback: { mode: FallbackPolicy["mode"]; afterMinutes: number; monthlyCapMinutes: number | null; minutesUsed: number; estimatedCostUsd: number };
  month: { ownRecordings: number; liveKitRecordings: number };
  forecast: { liveNow: number; peakNext24h: number; nextClassAt: string | null };
};

/** LiveKit Egress transcoding, per minute, as billed in September 2026. */
export const LIVEKIT_USD_PER_MINUTE = 0.02;

export function buildRecorderStatus(input: {
  mode: RecorderStatus["mode"];
  fleet: boolean;
  directory: RecorderDirectory | null;
  now: Date;
  policy: FallbackPolicy;
  liveKitMinutesThisMonth: number;
  ownRecordings: number;
  liveKitRecordings: number;
  forecast: { liveNow: number; buckets: { start: string; end: string; classes: number }[] } | null;
}): RecorderStatus {
  const { directory, now, policy, forecast } = input;
  const warnings: string[] = [];
  const servers = (directory?.servers ?? []).map((s) => ({ id: s.id, capacity: s.capacity, active: s.active }));
  const directoryAgeSeconds = directory ? Math.max(0, Math.round((now.getTime() - new Date(directory.updatedAt).getTime()) / 1000)) : null;

  const horizon = now.getTime() + 24 * 3_600_000;
  const upcoming = (forecast?.buckets ?? []).filter((b) => new Date(b.end).getTime() > now.getTime() && new Date(b.start).getTime() < horizon && b.classes > 0);
  const peakNext24h = upcoming.reduce((m, b) => Math.max(m, b.classes), 0);
  const nextClassAt = upcoming.length ? upcoming.map((b) => b.start).sort()[0] : null;
  const liveNow = forecast?.liveNow ?? 0;
  const capacity = servers.reduce((sum, s) => sum + s.capacity, 0);

  let health: RecorderHealth = "ok";
  let headline = "Our own recorder is on duty.";

  if (input.mode === "livekit") {
    health = "off";
    headline = "Our own recorder is switched off. LiveKit records every class and is billed per minute.";
  } else if (input.fleet && !directory) {
    const busy = liveNow > 0 || peakNext24h > 0;
    health = liveNow > 0 ? "critical" : busy ? "warning" : "idle";
    headline = busy
      ? "No recorder server has reported in the last 10 minutes."
      : "No recorder server is running, and no class is due today. That is normal.";
    if (busy) warnings.push("The recorder scheduler is not reporting. Classes cannot be recorded by us until it is back.");
  } else if (directory && liveNow > capacity) {
    health = "critical";
    headline = `${liveNow} classes are live but our servers can record only ${capacity}.`;
    warnings.push("Some classes are not being recorded by our own recorder.");
  } else if (directory && directoryAgeSeconds !== null && directoryAgeSeconds > 180) {
    health = "warning";
    warnings.push(`The server list is ${Math.round(directoryAgeSeconds / 60)} minutes old; the scheduler may be stuck.`);
  }

  if (input.mode !== "livekit" && policy.mode === "never") warnings.push("LiveKit recording is off: a class our servers cannot take goes unrecorded.");
  if (policy.mode === "immediate") warnings.push("The LiveKit safety net starts at once and costs money. Set RECORDER_FALLBACK=delayed to give our servers time first.");
  if (policy.monthlyCapMinutes === null && policy.mode !== "never") warnings.push("The LiveKit safety net has no monthly cap. Set RECORDER_FALLBACK_MONTHLY_CAP_MINUTES (600 is about $12).");
  if (policy.monthlyCapMinutes !== null && input.liveKitMinutesThisMonth >= policy.monthlyCapMinutes) {
    warnings.push("The LiveKit budget for this month is used up. Further classes that need it go unrecorded.");
    if (health === "ok" || health === "idle") health = "warning";
  }

  return {
    mode: input.mode,
    fleet: input.fleet,
    health,
    headline,
    warnings,
    servers,
    directoryAgeSeconds,
    fallback: {
      mode: policy.mode,
      afterMinutes: policy.afterMinutes,
      monthlyCapMinutes: policy.monthlyCapMinutes,
      minutesUsed: input.liveKitMinutesThisMonth,
      estimatedCostUsd: Math.round(input.liveKitMinutesThisMonth * LIVEKIT_USD_PER_MINUTE * 100) / 100,
    },
    month: { ownRecordings: input.ownRecordings, liveKitRecordings: input.liveKitRecordings },
    forecast: { liveNow, peakNext24h, nextClassAt },
  };
}
