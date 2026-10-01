import { describe, expect, it } from "vitest";
import { buildSpend, describeNotes, monthlyBudgetUsd, parseServerSpend, shapeRecordings, type RecordingRow } from "./recorder-report";

const now = new Date("2026-10-05T12:00:00Z");
const spend = { month: "2026-10", monthUsd: 3.456, day: "2026-10-05", dayUsd: 0.789, serverHoursMonth: 31.25, updatedAt: "2026-10-05T11:58:00.000Z" };

describe("spend", () => {
  it("adds servers and the LiveKit safety net, and shows the share of the budget", () => {
    const s = buildSpend({ now, today: "2026-10-05", serverSpend: spend, liveKitMinutesToday: 30, liveKitMinutesMonth: 100, budgetUsd: 20 });
    expect(s).toMatchObject({ serversTodayUsd: 0.79, serversMonthUsd: 3.46, liveKitTodayUsd: 0.6, liveKitMonthUsd: 2, totalMonthUsd: 5.46, budgetUsd: 20, budgetUsedPercent: 27, serverFigureAgeSeconds: 120, serverHoursMonth: 31.3 });
  });

  it("no budget set: no percentage, just the figures", () => {
    const s = buildSpend({ now, today: "2026-10-05", serverSpend: spend, liveKitMinutesToday: 0, liveKitMinutesMonth: 0, budgetUsd: null });
    expect(s.budgetUsedPercent).toBeNull();
    expect(s.totalMonthUsd).toBe(3.46);
  });

  it("a stale file from another day or month does not count as today or this month", () => {
    const s = buildSpend({ now, today: "2026-11-01", serverSpend: spend, liveKitMinutesToday: 0, liveKitMinutesMonth: 0, budgetUsd: null });
    expect(s).toMatchObject({ serversTodayUsd: 0, serversMonthUsd: 0, serverHoursMonth: 0 });
  });

  it("no scheduler figure yet: zero, and the age is null so the page can say so", () => {
    const s = buildSpend({ now, today: "2026-10-05", serverSpend: null, liveKitMinutesToday: 0, liveKitMinutesMonth: 0, budgetUsd: null });
    expect(s.serverFigureAgeSeconds).toBeNull();
  });

  it("over budget reads above 100", () => {
    expect(buildSpend({ now, today: "2026-10-05", serverSpend: spend, liveKitMinutesToday: 0, liveKitMinutesMonth: 0, budgetUsd: 2 }).budgetUsedPercent).toBe(173);
  });

  it("reads the budget from the environment, ignoring nonsense", () => {
    expect(monthlyBudgetUsd({ RECORDING_MONTHLY_BUDGET_USD: "60" })).toBe(60);
    for (const bad of [undefined, "", "abc", "-5", "0"]) expect(monthlyBudgetUsd({ RECORDING_MONTHLY_BUDGET_USD: bad })).toBeNull();
  });

  it("reads the scheduler's file, and refuses garbage", () => {
    expect(parseServerSpend({ version: 1, ...spend })).toMatchObject({ monthUsd: 3.456 });
    expect(parseServerSpend(null)).toBeNull();
    expect(parseServerSpend({ version: 2, ...spend })).toBeNull();
    expect(parseServerSpend({ version: 1, month: "x", day: "y", updatedAt: "nope" })).toBeNull();
  });
});

describe("class notes status", () => {
  it("says in plain words where each recording is", () => {
    expect(describeNotes("completed", "ready")).toEqual({ state: "ready", label: "Notes ready" });
    for (const s of ["pending", "transcribing", "summarizing", "partial"]) expect(describeNotes("completed", s).state).toBe("working");
    expect(describeNotes("completed", null)).toEqual({ state: "waiting", label: "Waiting for notes" });
    expect(describeNotes("completed", "none").label).toBe("No speech heard");
    expect(describeNotes("completed", "failed").state).toBe("failed");
    expect(describeNotes("completed", "skipped_too_large").state).toBe("failed");
  });
  it("a recording that is not finished has no notes yet, and says why", () => {
    expect(describeNotes("active", null).label).toBe("Recording now");
    expect(describeNotes("failed", null).label).toBe("Recording failed");
    expect(describeNotes("aborted", null).label).toMatch(/empty room/);
  });
});

describe("today's recordings", () => {
  const row = (over: Partial<RecordingRow>): RecordingRow => ({ id: "a", roomName: "ew-lagos-a1-morning-t-1", level: "a1", sessionSlot: "morning", egressId: "rec_s0a000001-aaaa", status: "completed", startedAt: new Date("2026-10-05T09:00:00Z"), durationSeconds: 7200, sizeBytes: 960_000_000, transcript: { status: "ready" }, ...over });
  const ours = (id: string) => id.startsWith("rec_");

  it("names the class, who recorded it, its size and how heavy it is per minute", () => {
    const [line] = shapeRecordings([row({})], ours);
    expect(line).toMatchObject({ title: "A1 · Morning", by: "ours", minutes: 120, sizeMb: 960, mbPerMinute: 8, notes: { state: "ready" } });
  });

  it("tells LiveKit's recordings apart, newest first", () => {
    const lines = shapeRecordings([row({ id: "old", startedAt: new Date("2026-10-05T07:00:00Z") }), row({ id: "new", egressId: "EG_x", startedAt: new Date("2026-10-05T10:00:00Z") })], ours);
    expect(lines.map((l) => [l.id, l.by])).toEqual([["new", "livekit"], ["old", "ours"]]);
  });

  it("copes with a recording still running (no duration or size yet) and a missing level", () => {
    const [line] = shapeRecordings([row({ status: "active", durationSeconds: null, sizeBytes: null, transcript: null, level: null, sessionSlot: null })], ours);
    expect(line).toMatchObject({ title: "ew-lagos-a1-morning-t-1", minutes: null, sizeMb: null, mbPerMinute: null });
    expect(line!.notes.label).toBe("Recording now");
  });
});
