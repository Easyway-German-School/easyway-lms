/**
 * The "what did it cost and what did it make" half of the admin Class recording page: spend so far (servers
 * plus the LiveKit safety net) against an optional budget, and today's recordings with whether their class notes
 * are ready. Pure (no database or network), so every label is tested.
 */

import { LIVEKIT_USD_PER_MINUTE } from "@/lib/recorder-status";

/** The running server-cost estimate the scheduler keeps in the bucket (see EduPrime-Recorder src/fleet/spend.ts). */
export type ServerSpend = {
  month: string;
  monthUsd: number;
  day: string;
  dayUsd: number;
  serverHoursMonth: number;
  updatedAt: string;
};

export function parseServerSpend(value: unknown): ServerSpend | null {
  const v = value as Partial<ServerSpend> & { version?: number } | null;
  if (!v || typeof v !== "object" || v.version !== 1 || typeof v.month !== "string" || typeof v.day !== "string") return null;
  if (!Number.isFinite(Date.parse(String(v.updatedAt)))) return null;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);
  return { month: v.month, monthUsd: num(v.monthUsd), day: v.day, dayUsd: num(v.dayUsd), serverHoursMonth: num(v.serverHoursMonth), updatedAt: String(v.updatedAt) };
}

export type SpendReport = {
  /** Servers: estimated from the scheduler's own running total; Linode's invoice is the final word. */
  serversTodayUsd: number;
  serversMonthUsd: number;
  serverHoursMonth: number;
  /** The LiveKit safety net, at the September 2026 per-minute price. */
  liveKitTodayUsd: number;
  liveKitMonthUsd: number;
  totalMonthUsd: number;
  budgetUsd: number | null;
  /** 0-100+, or null with no budget. */
  budgetUsedPercent: number | null;
  /** How old the servers figure is, in seconds (null = never reported). */
  serverFigureAgeSeconds: number | null;
};

const money = (x: number) => Math.round(x * 100) / 100;

/** `budget` is the optional monthly ceiling in USD (RECORDING_MONTHLY_BUDGET_USD). */
export function buildSpend(input: {
  now: Date;
  /** School date ("2026-10-05") and month ("2026-10") for `now`, so a stale file from yesterday does not count as today. */
  today: string;
  serverSpend: ServerSpend | null;
  liveKitMinutesToday: number;
  liveKitMinutesMonth: number;
  budgetUsd: number | null;
}): SpendReport {
  const month = input.today.slice(0, 7);
  const s = input.serverSpend;
  const serversMonthUsd = s && s.month === month ? s.monthUsd : 0;
  const serversTodayUsd = s && s.day === input.today ? s.dayUsd : 0;
  const liveKitMonthUsd = input.liveKitMinutesMonth * LIVEKIT_USD_PER_MINUTE;
  const liveKitTodayUsd = input.liveKitMinutesToday * LIVEKIT_USD_PER_MINUTE;
  const total = serversMonthUsd + liveKitMonthUsd;
  return {
    serversTodayUsd: money(serversTodayUsd),
    serversMonthUsd: money(serversMonthUsd),
    serverHoursMonth: s && s.month === month ? Math.round(s.serverHoursMonth * 10) / 10 : 0,
    liveKitTodayUsd: money(liveKitTodayUsd),
    liveKitMonthUsd: money(liveKitMonthUsd),
    totalMonthUsd: money(total),
    budgetUsd: input.budgetUsd,
    budgetUsedPercent: input.budgetUsd && input.budgetUsd > 0 ? Math.round((total / input.budgetUsd) * 100) : null,
    serverFigureAgeSeconds: s ? Math.max(0, Math.round((input.now.getTime() - Date.parse(s.updatedAt)) / 1000)) : null,
  };
}

/** The optional monthly budget from the environment: a positive number, else none. */
export function monthlyBudgetUsd(env: Record<string, string | undefined> = process.env): number | null {
  const n = Number(env.RECORDING_MONTHLY_BUDGET_USD);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* -------------------------------------------------------------------------- */
/* Today's recordings                                                         */
/* -------------------------------------------------------------------------- */

export type NotesState = "ready" | "working" | "waiting" | "none" | "failed" | "n/a";

/** What the class-notes pipeline has done with a recording, in the words the office uses. */
export function describeNotes(recordingStatus: string, transcriptStatus: string | null | undefined): { state: NotesState; label: string } {
  if (recordingStatus !== "completed") {
    return { state: "n/a", label: recordingStatus === "active" ? "Recording now" : recordingStatus === "failed" ? "Recording failed" : recordingStatus === "aborted" ? "Stopped (empty room)" : "-" };
  }
  switch (transcriptStatus) {
    case "ready": return { state: "ready", label: "Notes ready" };
    case "pending":
    case "transcribing":
    case "summarizing":
    case "partial": return { state: "working", label: "Notes being written" };
    case "failed": return { state: "failed", label: "Notes failed (retrying)" };
    case "skipped_too_large": return { state: "failed", label: "Too large to transcribe" };
    case "none": return { state: "none", label: "No speech heard" };
    default: return { state: "waiting", label: "Waiting for notes" };
  }
}

export type RecordingRow = {
  id: string;
  roomName: string;
  level: string | null;
  sessionSlot: string | null;
  egressId: string;
  status: string;
  startedAt: Date;
  durationSeconds: number | null;
  sizeBytes: number | null;
  transcript: { status: string } | null;
};

export type RecordingLine = {
  id: string;
  title: string;
  by: "ours" | "livekit";
  startedAt: string;
  minutes: number | null;
  sizeMb: number | null;
  /** Megabytes per minute of video: a quick read on quality/size (our 720p is about 8). */
  mbPerMinute: number | null;
  recordingState: string;
  notes: ReturnType<typeof describeNotes>;
};

const titleOf = (row: RecordingRow): string => {
  const level = row.level ? row.level.toUpperCase() : "";
  const slot = row.sessionSlot ? row.sessionSlot[0]!.toUpperCase() + row.sessionSlot.slice(1) : "";
  const label = [level, slot].filter(Boolean).join(" · ");
  return label || row.roomName;
};

/** Newest first. `isOurs` says whether the recorder (not LiveKit) made it. */
export function shapeRecordings(rows: RecordingRow[], isOurs: (egressId: string) => boolean): RecordingLine[] {
  return [...rows]
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .map((row) => {
      const minutes = row.durationSeconds ? Math.round((row.durationSeconds / 60) * 10) / 10 : null;
      const sizeMb = row.sizeBytes ? Math.round((row.sizeBytes / 1_000_000) * 10) / 10 : null;
      return {
        id: row.id,
        title: titleOf(row),
        by: isOurs(row.egressId) ? "ours" : "livekit",
        startedAt: row.startedAt.toISOString(),
        minutes,
        sizeMb,
        mbPerMinute: minutes && sizeMb ? Math.round((sizeMb / minutes) * 10) / 10 : null,
        recordingState: row.status,
        notes: describeNotes(row.status, row.transcript?.status),
      };
    });
}
