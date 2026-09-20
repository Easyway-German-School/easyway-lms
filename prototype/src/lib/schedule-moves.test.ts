import { describe, expect, it } from "vitest";

import { buildNodes, nodeSummary, type Month } from "./class-path";
import { applyMoves, type MovableMonth, type MovableSession } from "./schedule-moves";

type S = MovableSession & { topic?: string };
type M = MovableMonth<S> & { label: string };

const s = (date: string, extra: Partial<S> = {}): S => ({
  date: `${date}T00:00:00.000Z`,
  weekday: "Tue",
  status: "scheduled",
  postponedTo: null,
  ...extra,
});

const sept = (sessions: S[]): M => ({ label: "September 2026", year: 2026, monthIndex: 8, sessions });
const oct = (sessions: S[]): M => ({ label: "October 2026", year: 2026, monthIndex: 9, sessions });

describe("applyMoves", () => {
  it("returns the input untouched when nothing has moved", () => {
    const months = [sept([s("2026-09-15"), s("2026-09-17", { status: "cancelled" })])];
    expect(applyMoves(months)).toBe(months);
  });

  it("puts a moved class on its new day and leaves the old day empty", () => {
    const [month] = applyMoves([
      sept([s("2026-09-15", { status: "postponed", postponedTo: "2026-09-18T00:00:00.000Z", topic: "Dativ" }), s("2026-09-22")]),
    ]);
    expect(month.sessions.map((x) => x.date.slice(0, 10))).toEqual(["2026-09-18", "2026-09-22"]);
    const moved = month.sessions[0];
    expect(moved.status).toBe("scheduled");
    expect(moved.postponedTo).toBeNull();
    expect(moved.weekday).toBe("Fri");
    expect(moved.movedFrom).toBe("2026-09-15T00:00:00.000Z");
    expect(moved.topic).toBe("Dativ");
  });

  it("carries a class across a month boundary", () => {
    const [sep, oc] = applyMoves([
      sept([s("2026-09-29", { status: "postponed", postponedTo: "2026-10-02T00:00:00.000Z" })]),
      oct([s("2026-10-06")]),
    ]);
    expect(sep.sessions).toHaveLength(0);
    expect(oc.sessions.map((x) => x.date.slice(0, 10))).toEqual(["2026-10-02", "2026-10-06"]);
    expect(oc.sessions[0].movedFrom).toBe("2026-09-29T00:00:00.000Z");
  });

  it("parks a class moved past the window in the last month rather than losing it", () => {
    const out = applyMoves([sept([s("2026-09-29", { status: "postponed", postponedTo: "2026-12-01T00:00:00.000Z" })])]);
    expect(out[0].sessions).toHaveLength(1);
    expect(out[0].sessions[0].movedFrom).not.toBeNull();
  });

  it("leaves a postponed class with no new date alone — nothing to relocate to", () => {
    const months = [sept([s("2026-09-15", { status: "postponed" })])];
    expect(applyMoves(months)).toBe(months);
  });

  it("does not treat a class 'moved' onto its own day as moved", () => {
    const months = [sept([s("2026-09-15", { status: "postponed", postponedTo: "2026-09-15T00:00:00.000Z" })])];
    expect(applyMoves(months)).toBe(months);
  });

  it("does not mutate its input", () => {
    const months = [sept([s("2026-09-15", { status: "postponed", postponedTo: "2026-09-18T00:00:00.000Z" })])];
    const snapshot = JSON.stringify(months);
    applyMoves(months);
    expect(JSON.stringify(months)).toBe(snapshot);
  });
});

describe("what a student's calendar shows after a move", () => {
  const session = (date: string, extra: Record<string, unknown> = {}) => ({
    date: `${date}T00:00:00.000Z`,
    weekday: "Tue",
    title: "A1 · Live class",
    defaultFocus: "Guided practice",
    timeSlot: "morning",
    startTime: "09:00",
    endTime: "11:00",
    topic: null,
    notes: null,
    status: "scheduled",
    postponedTo: null,
    lecturerName: null,
    material: null,
    ...extra,
  });
  const raw = [
    {
      label: "September 2026",
      patternLabel: "Tue/Thu",
      year: 2026,
      monthIndex: 8,
      sessions: [
        session("2026-09-15", { status: "postponed", postponedTo: "2026-09-18T00:00:00.000Z" }),
        session("2026-09-22"),
      ],
    },
  ];
  const now = new Date(2026, 8, 10); // 10 Sep, before both

  it("has ONE class in place of the old pink box, on the new day", () => {
    const { nodes } = buildNodes(applyMoves(raw) as unknown as Month[], now);
    expect(nodes.map((n) => n.date.slice(0, 10))).toEqual(["2026-09-18", "2026-09-22"]);
    // Nothing on the 15th any more, and nothing is left in the pink "postponed" state.
    expect(nodes.some((n) => n.state === "postponed")).toBe(false);
    expect(nodes[0].state).toBe("locked");
    expect(nodes[0].isNext).toBe(true);
  });

  it("says where it came from, and only for the class that moved", () => {
    const { nodes } = buildNodes(applyMoves(raw) as unknown as Month[], now);
    expect(nodeSummary(nodes[0]).movedFrom).toBe("Tuesday 15 September");
    expect(nodeSummary(nodes[1]).movedFrom).toBeNull();
  });

  it("without the fix the old day would still be drawn as postponed (the reported bug)", () => {
    const { nodes } = buildNodes(raw as unknown as Month[], now);
    expect(nodes[0].date.slice(0, 10)).toBe("2026-09-15");
    expect(nodes[0].state).toBe("postponed");
  });
});
