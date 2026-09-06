import { describe, expect, it } from "vitest";

import {
  SCHOOL_TIMEZONE,
  instantToZonedParts,
  schoolDayOffset,
  schoolDayStart,
  viewerTimezone,
  zoneLabel,
  zonedClock,
  zonedDateKey,
  zonedTimeToInstant,
} from "./school-time";

/**
 * The clock is one of the few things in the app that decides whether a tutor
 * and a student are in a room at the same moment, so it is tested for the exact
 * failure it exists to stop: a time typed in one zone stored as if it were
 * another.
 */

describe("zonedTimeToInstant", () => {
  it("reads a Lagos wall-clock time as WAT (UTC+1, no DST)", () => {
    expect(zonedTimeToInstant("2026-09-10", "18:00", "Africa/Lagos").toISOString()).toBe(
      "2026-09-10T17:00:00.000Z",
    );
    // Deep winter — still UTC+1, Lagos never shifts.
    expect(zonedTimeToInstant("2026-01-15", "09:30", "Africa/Lagos").toISOString()).toBe(
      "2026-01-15T08:30:00.000Z",
    );
  });

  it("defaults to the school timezone", () => {
    expect(zonedTimeToInstant("2026-09-10", "18:00").toISOString()).toBe(
      zonedTimeToInstant("2026-09-10", "18:00", SCHOOL_TIMEZONE).toISOString(),
    );
  });

  it("follows DST for a diaspora zone", () => {
    // Berlin in July is CEST (UTC+2).
    expect(zonedTimeToInstant("2026-07-01", "18:00", "Europe/Berlin").toISOString()).toBe(
      "2026-07-01T16:00:00.000Z",
    );
    // Berlin in January is CET (UTC+1).
    expect(zonedTimeToInstant("2026-01-15", "18:00", "Europe/Berlin").toISOString()).toBe(
      "2026-01-15T17:00:00.000Z",
    );
    // London in July is BST (UTC+1); in January GMT (UTC+0).
    expect(zonedTimeToInstant("2026-07-01", "12:00", "Europe/London").toISOString()).toBe(
      "2026-07-01T11:00:00.000Z",
    );
    expect(zonedTimeToInstant("2026-01-15", "12:00", "Europe/London").toISOString()).toBe(
      "2026-01-15T12:00:00.000Z",
    );
  });
});

describe("instantToZonedParts / zonedClock / zonedDateKey", () => {
  it("round-trips a Lagos time", () => {
    const instant = zonedTimeToInstant("2026-09-10", "18:00", "Africa/Lagos");
    expect(zonedClock(instant, "Africa/Lagos")).toBe("18:00");
    expect(zonedDateKey(instant, "Africa/Lagos")).toBe("2026-09-10");
    const parts = instantToZonedParts(instant, "Africa/Lagos");
    expect(parts).toMatchObject({ year: 2026, month: 9, day: 10, hour: 18, minute: 0, weekday: 4 });
  });

  it("shows the same instant in two zones", () => {
    const instant = new Date("2026-07-01T16:00:00.000Z");
    expect(zonedClock(instant, "Africa/Lagos")).toBe("17:00");
    expect(zonedClock(instant, "Europe/Berlin")).toBe("18:00");
  });

  it("crosses midnight into the previous day for a behind-UTC zone", () => {
    const instant = new Date("2026-09-11T02:00:00.000Z");
    expect(zonedDateKey(instant, "America/Los_Angeles")).toBe("2026-09-10");
  });
});

describe("schoolDayStart / schoolDayOffset", () => {
  it("gives midnight Lagos for any instant on that Lagos day", () => {
    // 23:00 UTC on Sep 14 is already Sep 15 in Lagos (01:00).
    expect(schoolDayStart(new Date("2026-09-14T23:30:00Z"), "Africa/Lagos").toISOString()).toBe(
      "2026-09-14T23:00:00.000Z",
    );
    // Midday UTC on Sep 15 is still Sep 15 in Lagos.
    expect(schoolDayStart(new Date("2026-09-15T12:00:00Z"), "Africa/Lagos").toISOString()).toBe(
      "2026-09-14T23:00:00.000Z",
    );
  });

  it("offsets whole school days", () => {
    const base = new Date("2026-09-15T12:00:00Z"); // Sep 15 in Lagos
    expect(schoolDayOffset(base, 3, "Africa/Lagos").toISOString()).toBe("2026-09-17T23:00:00.000Z"); // midnight Sep 18 Lagos
    expect(schoolDayOffset(base, 0, "Africa/Lagos").toISOString()).toBe(schoolDayStart(base, "Africa/Lagos").toISOString());
  });
});

describe("zoneLabel / viewerTimezone", () => {
  it("labels the zones the school actually sees", () => {
    const summer = new Date("2026-07-01T12:00:00.000Z");
    expect(zoneLabel(summer, "Africa/Lagos")).toBe("WAT");
    expect(zoneLabel(summer, "Europe/Berlin")).toBe("CEST");
    expect(zoneLabel(new Date("2026-01-15T12:00:00.000Z"), "Europe/Berlin")).toBe("CET");
  });

  it("falls back to the school zone when the viewer has none", () => {
    expect(viewerTimezone(null)).toBe(SCHOOL_TIMEZONE);
    expect(viewerTimezone("")).toBe(SCHOOL_TIMEZONE);
    expect(viewerTimezone("Europe/Berlin")).toBe("Europe/Berlin");
  });
});
