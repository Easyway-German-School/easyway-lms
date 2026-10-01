import { describe, expect, it } from "vitest";
import { NO_CONTROL, applyControlRequest, boostActive, parseSchedulerBeat, parseStoredControl, type Control } from "./recorder-control";

const NOW = new Date("2026-10-05T08:45:00Z");
const apply = (current: Control, request: unknown) => applyControlRequest(current, request, "Mary", NOW);

describe("changing the controls", () => {
  it("pause with a note, then resume (the note is dropped)", () => {
    const paused = apply(NO_CONTROL, { paused: true, pauseNote: "  checking the bill  " });
    expect(paused).toMatchObject({ ok: true, control: { paused: true, pauseNote: "checking the bill", updatedBy: "Mary", updatedAt: NOW.toISOString() } });
    if (!paused.ok) throw new Error();
    const resumed = apply(paused.control, { paused: false });
    expect(resumed).toMatchObject({ ok: true, control: { paused: false, pauseNote: "" } });
  });

  it("days off: add (sorted, no duplicates) and remove", () => {
    let c = NO_CONTROL;
    for (const d of ["2026-12-25", "2026-12-24", "2026-12-25"]) {
      const r = apply(c, { addSkipDate: d });
      if (!r.ok) throw new Error(r.error);
      c = r.control;
    }
    expect(c.skipDates).toEqual(["2026-12-24", "2026-12-25"]);
    const r = apply(c, { removeSkipDate: "2026-12-24" });
    expect(r.ok && r.control.skipDates).toEqual(["2026-12-25"]);
  });

  it("refuses an impossible date instead of storing it", () => {
    for (const bad of ["tomorrow", "2026-13-45", "26-1-1", 5]) expect(apply(NO_CONTROL, { addSkipDate: bad }).ok).toBe(false);
  });

  it("a boost lasts the hours asked for, from now; null cancels it", () => {
    const r = apply(NO_CONTROL, { boost: { classes: 2, hours: 3 } });
    if (!r.ok) throw new Error(r.error);
    expect(r.control.boost).toEqual({ classes: 2, until: "2026-10-05T11:45:00.000Z" });
    expect(boostActive(r.control, NOW)).toBe(true);
    expect(boostActive(r.control, new Date("2026-10-05T12:00:00Z"))).toBe(false);
    const cancelled = apply(r.control, { boost: null });
    expect(cancelled.ok && cancelled.control.boost).toBeNull();
  });

  it("refuses silly numbers: 40 classes, 100 hours, 0 servers", () => {
    expect(apply(NO_CONTROL, { boost: { classes: 40, hours: 1 } }).ok).toBe(false);
    expect(apply(NO_CONTROL, { boost: { classes: 2, hours: 100 } }).ok).toBe(false);
    expect(apply(NO_CONTROL, { maxServers: 0 }).ok).toBe(false);
    expect(apply(NO_CONTROL, { spareClasses: 9 }).ok).toBe(false);
  });

  it("an empty or non-object request changes nothing", () => {
    expect(apply(NO_CONTROL, {}).ok).toBe(false);
    expect(apply(NO_CONTROL, null).ok).toBe(false);
    expect(apply(NO_CONTROL, "pause").ok).toBe(false);
  });

  it("a refused request does not touch the current control", () => {
    const base = { ...NO_CONTROL, paused: true };
    apply(base, { paused: false, boost: { classes: 99, hours: 1 } });
    expect(base.paused).toBe(true);
  });
});

describe("reading what is stored", () => {
  it("garbage is 'no instructions', never 'paused'", () => {
    for (const bad of [null, [], "x", { version: 2, paused: true }, { version: 1 }, { version: 1, paused: "yes" }]) expect(parseStoredControl(bad).paused).toBe(false);
  });

  it("the example file shared with the scheduler repository reads the same on both sides", () => {
    // EduPrime-Recorder/test/fleet-control.test.ts asserts the scheduler reads this exact text the same way.
    const shared = '{"version":1,"updatedAt":"2026-10-05T08:45:00.000Z","updatedBy":"Mary","paused":true,"pauseNote":"checking the bill","skipDates":["2026-12-24","2026-12-25"],"boost":{"classes":2,"until":"2026-10-05T11:45:00.000Z"},"spareClasses":null,"maxServers":4}';
    const c = parseStoredControl(JSON.parse(shared));
    expect(c).toEqual({ version: 1, updatedAt: "2026-10-05T08:45:00.000Z", updatedBy: "Mary", paused: true, pauseNote: "checking the bill", skipDates: ["2026-12-24", "2026-12-25"], boost: { classes: 2, until: "2026-10-05T11:45:00.000Z" }, spareClasses: null, maxServers: 4 });
  });
});

describe("reading the scheduler's heartbeat", () => {
  it("reads the scheduler's own format, and an older one without a role or log", () => {
    expect(parseSchedulerBeat({ at: "2026-10-05T08:40:00Z", role: "standby", acting: false, holder: "h", servers: 2, recent: [{ at: "2026-10-05T08:00:00Z", text: "started x" }] }))
      .toMatchObject({ role: "standby", acting: false, servers: 2, recent: [{ text: "started x" }] });
    expect(parseSchedulerBeat({ at: "2026-10-05T08:40:00Z", servers: 1 })).toMatchObject({ role: "primary", acting: true, recent: [] });
  });
  it("garbage is null", () => {
    expect(parseSchedulerBeat(null)).toBeNull();
    expect(parseSchedulerBeat({ at: "nope" })).toBeNull();
  });
});

import { describeSchedulerProblem } from "./recorder-control";

describe("naming the cause in an alert", () => {
  const now = new Date("2026-10-05T09:00:00Z");
  const beat = (ageMin: number, over: Record<string, unknown> = {}) => parseSchedulerBeat({ at: new Date(now.getTime() - ageMin * 60_000).toISOString(), ...over });
  const none = { primary: null, standby: null };

  it("says nothing when the scheduler looks fine", () => {
    expect(describeSchedulerProblem({ primary: beat(3), standby: null }, NO_CONTROL, now)).toBe("");
  });
  it("says a silent scheduler is why no server started", () => {
    expect(describeSchedulerProblem({ primary: beat(25), standby: null }, NO_CONTROL, now)).toMatch(/silent for 25 minutes/);
    expect(describeSchedulerProblem(none, NO_CONTROL, now)).toMatch(/never reported/);
  });
  it("a standby that has taken over means the fleet is being managed: no complaint", () => {
    expect(describeSchedulerProblem({ primary: beat(25), standby: beat(2, { role: "standby", acting: true }) }, NO_CONTROL, now)).toBe("");
  });
  it("a pause is named first, with who did it", () => {
    expect(describeSchedulerProblem({ primary: beat(2), standby: null }, { ...NO_CONTROL, paused: true, updatedBy: "Mary" }, now)).toMatch(/paused \(by Mary\)/);
  });
});
