import { describe, expect, it } from "vitest";
import {
  defaultSessionSettings,
  diffDisabledCells,
  enabledSlotsForMode,
  isCellEnabled,
  isModeEnabled,
  isSessionEnabled,
  levelsWithNoCell,
  nearestEnabledSlotForMode,
  parseSessionSettings,
  type ModeFlags,
  type SessionConfig,
} from "@/lib/school-settings";

const modes = (over: Partial<ModeFlags> = {}): ModeFlags => ({
  physical: true,
  hybrid: true,
  online: true,
  ...over,
});

const row = (level: string, grid?: Partial<Record<string, Partial<ModeFlags>>>): SessionConfig => ({
  level,
  grid: {
    morning: modes(grid?.morning),
    afternoon: modes(grid?.afternoon),
    evening: modes(grid?.evening),
    weekend: modes(grid?.weekend),
  },
});

describe("parseSessionSettings", () => {
  it("round-trips a grid value", () => {
    const parsed = parseSessionSettings({
      sessions: [row("A1", { morning: { online: false }, afternoon: { physical: false } })],
    });
    const a1 = parsed.sessions.find((s) => s.level === "A1")!;
    expect(a1.grid.morning.online).toBe(false);
    expect(a1.grid.morning.physical).toBe(true);
    expect(a1.grid.afternoon.physical).toBe(false);
  });

  it("migrates the old flat shape: cell = session AND mode", () => {
    const legacy = {
      sessions: [
        { level: "A1", morning: false, afternoon: true, evening: true, weekend: true, online: false },
      ],
    };
    const a1 = parseSessionSettings(legacy).sessions.find((s) => s.level === "A1")!;
    // morning was off -> whole morning row off
    expect(a1.grid.morning).toEqual({ physical: false, hybrid: false, online: false });
    // online mode was off -> every online cell off
    expect(a1.grid.afternoon.online).toBe(false);
    // afternoon on + physical absent(=on) -> afternoon physical runs
    expect(a1.grid.afternoon.physical).toBe(true);
    expect(a1.grid.afternoon.hybrid).toBe(true);
  });

  it("returns every offered level in order, filling gaps as fully open", () => {
    const parsed = parseSessionSettings({ sessions: [row("B1", { morning: { physical: false } })] });
    expect(parsed.sessions.map((s) => s.level)).toEqual(["A1", "A2", "B1", "B2", "C1"]);
    expect(parsed.sessions.find((s) => s.level === "A1")!.grid.morning.physical).toBe(true);
    expect(parsed.sessions.find((s) => s.level === "B1")!.grid.morning.physical).toBe(false);
  });

  it("is lenient on garbage but strict rejects it / a missing grid", () => {
    expect(parseSessionSettings("nope")).toEqual(defaultSessionSettings());
    expect(parseSessionSettings({ sessions: [{ level: "A1", morning: true }] }, { strict: true })).toBeNull();
    expect(
      parseSessionSettings(
        { sessions: [{ level: "A1", grid: { morning: { online: "yes" } } }] },
        { strict: true },
      ),
    ).toBeNull();
  });
});

describe("isCellEnabled / isSessionEnabled / isModeEnabled", () => {
  const settings = { sessions: [row("A1", { morning: { online: false, physical: false, hybrid: false }, afternoon: { online: false } })] };
  it("isCellEnabled reads one cell, unknown input open", () => {
    expect(isCellEnabled(settings, "A1", "morning", "online")).toBe(false);
    expect(isCellEnabled(settings, "A1", "afternoon", "physical")).toBe(true);
    expect(isCellEnabled(settings, "A1", "lunch", "online")).toBe(true);
    expect(isCellEnabled(settings, "ZZ", "morning", "online")).toBe(true);
  });
  it("isSessionEnabled = any mode runs the session", () => {
    expect(isSessionEnabled(settings, "A1", "morning")).toBe(false); // all three off
    expect(isSessionEnabled(settings, "A1", "afternoon")).toBe(true); // physical + hybrid still on
  });
  it("isModeEnabled = any session runs the mode", () => {
    expect(isModeEnabled(settings, "A1", "online")).toBe(true); // evening/weekend still online
    const noOnline = { sessions: [row("A1", {
      morning: { online: false }, afternoon: { online: false }, evening: { online: false }, weekend: { online: false },
    })] };
    expect(isModeEnabled(noOnline, "A1", "online")).toBe(false);
  });
});

describe("nearestEnabledSlotForMode", () => {
  it("moves an online-morning student to online-afternoon, staying online", () => {
    expect(nearestEnabledSlotForMode(row("A1", { morning: { online: false } }), "morning", "online")).toBe("afternoon");
  });
  it("keeps a weekday student on a weekday", () => {
    expect(nearestEnabledSlotForMode(row("A1", { evening: { online: false } }), "evening", "online")).toBe("afternoon");
  });
  it("ignores other modes when scanning", () => {
    // afternoon online is off too; morning online must jump to evening, not afternoon
    const r = row("A1", { morning: { online: false }, afternoon: { online: false } });
    expect(nearestEnabledSlotForMode(r, "morning", "online")).toBe("evening");
  });
  it("returns null when no session runs this mode -> caller strands them", () => {
    const r = row("A1", {
      morning: { online: false }, afternoon: { online: false }, evening: { online: false }, weekend: { online: false },
    });
    expect(nearestEnabledSlotForMode(r, "morning", "online")).toBeNull();
  });
});

describe("diffDisabledCells", () => {
  it("lists only cells that flipped on -> off", () => {
    const prev = parseSessionSettings({ sessions: [row("A1")] });
    const next = parseSessionSettings({ sessions: [row("A1", { morning: { online: false }, evening: { hybrid: false } })] });
    expect(diffDisabledCells(prev, next)).toEqual([
      { level: "A1", slot: "morning", mode: "online" },
      { level: "A1", slot: "evening", mode: "hybrid" },
    ]);
  });
});

describe("levelsWithNoCell / enabledSlotsForMode", () => {
  it("flags a level a save would leave completely empty", () => {
    const allOff = row("A1");
    for (const s of ["morning", "afternoon", "evening", "weekend"] as const) {
      allOff.grid[s] = { physical: false, hybrid: false, online: false };
    }
    const settings = parseSessionSettings({ sessions: [allOff, row("A2")] });
    expect(levelsWithNoCell(settings)).toEqual(["A1"]);
  });
  it("enabledSlotsForMode lists the running sessions for a mode", () => {
    const settings = parseSessionSettings({ sessions: [row("A1", { morning: { online: false }, weekend: { online: false } })] });
    expect(enabledSlotsForMode(settings, "A1", "online")).toEqual(["afternoon", "evening"]);
  });
});
