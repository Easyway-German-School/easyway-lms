import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TodayCardView, type TodayGroup, type TodayState } from "./TutorTodayCard";

const group = (key: string, label: string, state: TodayGroup["state"], studentCount = 12): TodayGroup => ({
  key,
  label,
  batchRange: "",
  studentCount,
  state,
  note: `note-for-${key}`,
});

const today = (overrides: Partial<TodayState> = {}): TodayState => ({
  assigned: true,
  groups: [group("a1-morning", "A1 · Morning", "now")],
  focusKey: "a1-morning",
  register: { total: 12, marked: 0, takenToday: false },
  live: null,
  ...overrides,
});

const render = (data: TodayState | null) => renderToStaticMarkup(createElement(TodayCardView, { data }));
const liveLinks = (html: string) => [...html.matchAll(/href="(\/live\?group=[^"]+)"/g)].map((match) => match[1]);

describe("TodayCardView", () => {
  it("one class: a single Go live button straight into that class's lobby", () => {
    const html = render(today());
    expect(liveLinks(html)).toEqual(["/live?group=a1-morning"]);
    expect(html).toContain("Go live");
    expect(html).toContain("A1 · Morning");
    expect(html).not.toContain("Not this one?");
  });

  it("several classes: the button opens the auto-picked class, the rest are one click away", () => {
    const html = render(
      today({
        groups: [group("a1-morning", "A1 · Morning", "done"), group("b1-evening", "B1 · Evening", "now")],
        focusKey: "b1-evening",
      }),
    );
    // Focus first (the big button), then the switcher pill for the other class.
    expect(liveLinks(html)).toEqual(["/live?group=b1-evening", "/live?group=a1-morning"]);
    expect(html).toContain("Not this one?");
  });

  it("falls back to the first class when the server names no focus", () => {
    const html = render(today({ focusKey: null }));
    expect(liveLinks(html)[0]).toBe("/live?group=a1-morning");
  });

  it("says whether today's register is done, and links to it when it is not", () => {
    expect(render(today())).toContain('href="/lecturer/attendance"');
    const done = render(today({ register: { total: 12, marked: 12, takenToday: true } }));
    expect(done).toContain("Register taken");
    expect(done).not.toContain('href="/lecturer/attendance"');
  });

  it("steps aside once a room is open — TutorLivePanel owns that view", () => {
    expect(render(today({ live: { id: "s1", title: "A1", joinCode: "123456", startedAt: "" } }))).toBe("");
  });

  it("renders nothing for an unassigned tutor, a tutor with no classes, or before data arrives", () => {
    expect(render(today({ assigned: false }))).toBe("");
    expect(render(today({ groups: [] }))).toBe("");
    expect(render(null)).toBe("");
  });

  it("escapes group keys into the URL", () => {
    const html = render(today({ groups: [group("a1 morning/x", "A1", "now")], focusKey: "a1 morning/x" }));
    expect(liveLinks(html)).toEqual(["/live?group=a1%20morning%2Fx"]);
  });
});
