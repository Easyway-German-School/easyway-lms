import { describe, expect, it } from "vitest";
import { buildForecast, groupSessionWindow, privateClassWindow, type ForecastGroupSession } from "./recording-forecast";

// Monday 5 Oct 2026. School time is UTC+1, so 10:00 school time is 09:00 UTC.
const D = (day: number) => `2026-10-${String(day).padStart(2, "0")}T00:00:00.000Z`;
const from = new Date("2026-10-05T00:00:00Z");
const to = new Date("2026-10-08T00:00:00Z");

function session(over: Partial<ForecastGroupSession> & { cohortKey: string }): ForecastGroupSession {
  return { date: D(5), startTime: "10:00", endTime: "13:00", status: "scheduled", postponedTo: null, ...over };
}
const forecast = (groupSessions: ForecastGroupSession[], privateClasses: Parameters<typeof buildForecast>[0]["privateClasses"] = []) =>
  buildForecast({ groupSessions, privateClasses, from, to });

describe("one class", () => {
  it("is a single run from its start to its end, in UTC", () => {
    expect(forecast([session({ cohortKey: "a" })])).toEqual([{ start: "2026-10-05T09:00:00.000Z", end: "2026-10-05T12:00:00.000Z", classes: 1 }]);
  });

  it("an empty timetable forecasts nothing", () => {
    expect(forecast([])).toEqual([]);
  });
});

describe("how classes add up", () => {
  it("cohorts at the same time are separate classes", () => {
    const five = ["a", "b", "c", "d", "e"].map((cohortKey) => session({ cohortKey }));
    expect(forecast(five)).toEqual([{ start: "2026-10-05T09:00:00.000Z", end: "2026-10-05T12:00:00.000Z", classes: 5 }]);
  });

  it("the same cohort listed twice is still one class", () => {
    expect(forecast([session({ cohortKey: "a" }), session({ cohortKey: "a" })])[0]!.classes).toBe(1);
  });

  it("a busy morning followed by a quieter afternoon gives two runs", () => {
    const rows = [
      ...["a", "b", "c"].map((cohortKey) => session({ cohortKey })),
      ...["d", "e"].map((cohortKey) => session({ cohortKey, startTime: "13:00", endTime: "15:00" })),
    ];
    expect(forecast(rows)).toEqual([
      { start: "2026-10-05T09:00:00.000Z", end: "2026-10-05T12:00:00.000Z", classes: 3 },
      { start: "2026-10-05T12:00:00.000Z", end: "2026-10-05T14:00:00.000Z", classes: 2 },
    ]);
  });

  it("overlapping classes count together only while they overlap", () => {
    const rows = [session({ cohortKey: "a", endTime: "12:00" }), session({ cohortKey: "b", startTime: "11:00", endTime: "13:00" })];
    expect(forecast(rows).map((b) => b.classes)).toEqual([1, 2, 1]);
  });
});

describe("the timetable changing is picked up with no one editing anything", () => {
  it("a cancelled class (or a closed day) needs no server", () => {
    expect(forecast([session({ cohortKey: "a", status: "cancelled" })])).toEqual([]);
  });

  it("a tutor moving a class to another time moves the forecast with it", () => {
    expect(forecast([session({ cohortKey: "a", startTime: "14:00", endTime: "16:00" })])).toEqual([
      { start: "2026-10-05T13:00:00.000Z", end: "2026-10-05T15:00:00.000Z", classes: 1 },
    ]);
  });

  it("a postponed class appears on its NEW day, not the old one", () => {
    const rows = [session({ cohortKey: "a", status: "postponed", postponedTo: D(7) })];
    expect(forecast(rows)).toEqual([{ start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T12:00:00.000Z", classes: 1 }]);
  });

  it("a postponed class with no new day is not happening", () => {
    expect(forecast([session({ cohortKey: "a", status: "postponed" })])).toEqual([]);
  });

  it("an extra one-off class added on a normal day shows up", () => {
    const rows = [session({ cohortKey: "a" }), session({ cohortKey: "extra", startTime: "15:30", endTime: "17:00" })];
    expect(forecast(rows)).toHaveLength(2);
  });

  it("junk in the schedule (bad times, unknown status) is ignored instead of breaking the forecast", () => {
    expect(forecast([session({ cohortKey: "a", startTime: "ten" }), session({ cohortKey: "b", status: "weird" }), session({ cohortKey: "c", startTime: "13:00", endTime: "10:00" })])).toEqual([]);
  });
});

describe("private lessons", () => {
  const lesson = (over: Partial<Parameters<typeof privateClassWindow>[0]> = {}) => ({ scheduledAt: new Date("2026-10-05T17:00:00Z"), durationMinutes: 60, status: "scheduled", ...over });

  it("a booked lesson needs a recorder for its own time", () => {
    expect(forecast([], [lesson()])).toEqual([{ start: "2026-10-05T17:00:00.000Z", end: "2026-10-05T18:00:00.000Z", classes: 1 }]);
  });

  it("completed, cancelled and skipped lessons do not", () => {
    expect(forecast([], [lesson({ status: "completed" }), lesson({ status: "cancelled" }), lesson({ status: "skipped" })])).toEqual([]);
  });

  it("an unknown length is assumed to be an hour", () => {
    expect(privateClassWindow(lesson({ durationMinutes: null }))!.end.toISOString()).toBe("2026-10-05T18:00:00.000Z");
  });

  it("a lesson that overlaps a group class adds to it", () => {
    const buckets = forecast([session({ cohortKey: "a" })], [lesson({ scheduledAt: new Date("2026-10-05T10:00:00Z"), durationMinutes: 30 })]);
    expect(Math.max(...buckets.map((b) => b.classes))).toBe(2);
  });
});

describe("window", () => {
  it("classes outside the asked-for window are left out", () => {
    const later = session({ cohortKey: "a", date: D(20) });
    expect(forecast([later])).toEqual([]);
  });

  it("a session window is null for a cancelled class", () => {
    expect(groupSessionWindow(session({ cohortKey: "a", status: "cancelled" }))).toBeNull();
  });

  it("a class that straddles a bucket edge keeps every bucket it touches (safe side)", () => {
    const buckets = forecast([session({ cohortKey: "a", startTime: "10:10", endTime: "10:50" })]);
    expect(buckets).toEqual([{ start: "2026-10-05T09:00:00.000Z", end: "2026-10-05T10:00:00.000Z", classes: 1 }]);
  });
});
