import { describe, expect, it } from "vitest";
import {
  defaultSessionSettings,
  diffDisabled,
  isModeEnabled,
  isSessionEnabled,
  levelsWithNoMode,
  levelsWithNoSlot,
  nearestEnabledMode,
  nearestEnabledSlot,
  parseSessionSettings,
  type SessionConfig,
} from "@/lib/school-settings";

const row = (over: Partial<SessionConfig> = {}): SessionConfig => ({
  level: "A1",
  morning: true,
  afternoon: true,
  evening: true,
  weekend: true,
  physical: true,
  hybrid: true,
  online: true,
  ...over,
});

describe("parseSessionSettings", () => {
  it("round-trips the mode flags", () => {
    const input = { sessions: [row({ level: "A1", hybrid: false, online: false, weekend: false })] };
    const parsed = parseSessionSettings(input);
    const a1 = parsed.sessions.find((s) => s.level === "A1")!;
    expect(a1.hybrid).toBe(false);
    expect(a1.online).toBe(false);
    expect(a1.weekend).toBe(false);
    expect(a1.physical).toBe(true);
  });

  it("defaults the mode flags to true for a row written before modes existed", () => {
    const legacy = { sessions: [{ level: "A1", morning: true, afternoon: false, evening: true, weekend: true }] };
    const a1 = parseSessionSettings(legacy).sessions.find((s) => s.level === "A1")!;
    expect(a1.afternoon).toBe(false);
    expect(a1.physical).toBe(true);
    expect(a1.hybrid).toBe(true);
    expect(a1.online).toBe(true);
  });

  it("always returns every offered level, in order, even from a partial value", () => {
    const parsed = parseSessionSettings({ sessions: [row({ level: "B1", morning: false })] });
    expect(parsed.sessions.map((s) => s.level)).toEqual(["A1", "A2", "B1", "B2", "C1"]);
    expect(parsed.sessions.find((s) => s.level === "A1")!.morning).toBe(true); // fell back to open
    expect(parsed.sessions.find((s) => s.level === "B1")!.morning).toBe(false);
  });

  it("is lenient on garbage (returns the permissive default) but strict rejects it", () => {
    expect(parseSessionSettings("nonsense")).toEqual(defaultSessionSettings());
    expect(parseSessionSettings({ sessions: [{ level: "A1", hybrid: "yes" }] }, { strict: true })).toBeNull();
  });
});

describe("isSessionEnabled / isModeEnabled", () => {
  const settings = { sessions: [row({ level: "A1", morning: false, hybrid: false })] };
  it("reads a specific toggle, defaulting unknown input to open", () => {
    expect(isSessionEnabled(settings, "A1", "morning")).toBe(false);
    expect(isSessionEnabled(settings, "A1", "afternoon")).toBe(true);
    expect(isSessionEnabled(settings, "A1", "lunchtime")).toBe(true); // unknown slot
    expect(isSessionEnabled(settings, "ZZ", "morning")).toBe(true); // unknown level
    expect(isModeEnabled(settings, "A1", "hybrid")).toBe(false);
    expect(isModeEnabled(settings, "A1", "physical")).toBe(true);
  });
});

describe("nearestEnabledSlot", () => {
  it("moves a morning student to the afternoon", () => {
    expect(nearestEnabledSlot(row({ morning: false }), "morning")).toBe("afternoon");
  });

  it("keeps a weekday student on a weekday even when weekend is open", () => {
    // evening off; afternoon is nearer than weekend and same family
    expect(nearestEnabledSlot(row({ evening: false }), "evening")).toBe("afternoon");
  });

  it("falls back across the family boundary when it has to", () => {
    expect(
      nearestEnabledSlot(row({ morning: false, afternoon: false, evening: false }), "morning"),
    ).toBe("weekend");
  });

  it("sends a weekend student to the nearest weekday", () => {
    expect(nearestEnabledSlot(row({ weekend: false }), "weekend")).toBe("evening");
  });

  it("returns null when the level has nothing left", () => {
    expect(
      nearestEnabledSlot(
        row({ morning: false, afternoon: false, evening: false, weekend: false }),
        "morning",
      ),
    ).toBeNull();
  });
});

describe("nearestEnabledMode", () => {
  it("swaps hybrid and physical", () => {
    expect(nearestEnabledMode(row({ hybrid: false }), "hybrid")).toBe("physical");
    expect(nearestEnabledMode(row({ physical: false }), "physical")).toBe("hybrid");
  });

  it("never routes anyone into or out of online", () => {
    expect(nearestEnabledMode(row({ online: false }), "online")).toBeNull();
  });

  it("returns null when the only campus fallback is also off", () => {
    expect(nearestEnabledMode(row({ hybrid: false, physical: false }), "hybrid")).toBeNull();
  });
});

describe("diffDisabled", () => {
  it("lists only the toggles that flipped on -> off", () => {
    const prev = parseSessionSettings({ sessions: [row({ level: "A1" })] });
    const next = parseSessionSettings({
      sessions: [row({ level: "A1", morning: false, hybrid: false })],
    });
    expect(diffDisabled(prev, next)).toEqual([
      { level: "A1", kind: "slot", key: "morning" },
      { level: "A1", kind: "mode", key: "hybrid" },
    ]);
  });

  it("ignores a toggle turned back on", () => {
    const prev = parseSessionSettings({ sessions: [row({ level: "A1", evening: false })] });
    const next = parseSessionSettings({ sessions: [row({ level: "A1" })] });
    expect(diffDisabled(prev, next)).toEqual([]);
  });
});

describe("levelsWithNoSlot / levelsWithNoMode", () => {
  it("flags a level a save would leave with nothing", () => {
    const settings = parseSessionSettings({
      sessions: [
        row({ level: "A1", morning: false, afternoon: false, evening: false, weekend: false }),
        row({ level: "A2", physical: false, hybrid: false, online: false }),
      ],
    });
    expect(levelsWithNoSlot(settings)).toEqual(["A1"]);
    expect(levelsWithNoMode(settings)).toEqual(["A2"]);
  });
});
