import { describe, expect, it } from "vitest";

import {
  BREAK_MS,
  COIN_RULES,
  FACES_PER_ROOM,
  FOCUS_MS,
  MAX_DAILY_COINS,
  MAX_OPEN_OUTGOING,
  MAX_REQUESTS_PER_HOUR,
  ONLINE_WINDOW_MS,
  bandOf,
  campusDay,
  clock,
  coinRefKey,
  displayName,
  focusPhase,
  isOnline,
  isPresenceRoom,
  requestAllowed,
  summariseCampus,
  type PresencePerson,
} from "@/lib/campus";

describe("bandOf — the safety line", () => {
  it("separates minors from adults at 18", () => {
    expect(bandOf(13)).toBe("minor");
    expect(bandOf(17)).toBe("minor");
    expect(bandOf(18)).toBe("adult");
    expect(bandOf(40)).toBe("adult");
  });

  it("never guesses: an unknown age is its own band, not minor and not adult", () => {
    expect(bandOf(null)).toBe("unknown");
    expect(bandOf(undefined)).toBe("unknown");
    expect(bandOf(Number.NaN)).toBe("unknown");
  });
});

describe("presence", () => {
  const now = new Date("2026-10-06T10:00:00Z").getTime();

  it("counts someone as online within the window and not after it", () => {
    expect(isOnline(now - 60_000, now)).toBe(true);
    expect(isOnline(now - ONLINE_WINDOW_MS, now)).toBe(true);
    expect(isOnline(now - ONLINE_WINDOW_MS - 1, now)).toBe(false);
  });

  it("accepts only real rooms", () => {
    expect(isPresenceRoom("library")).toBe(true);
    expect(isPresenceRoom("lobby")).toBe(true);
    expect(isPresenceRoom("rooftop")).toBe(false);
    expect(isPresenceRoom(7)).toBe(false);
  });

  it("shortens a name to something recognisable but not searchable", () => {
    expect(displayName("Ada Okafor")).toBe("Ada O.");
    expect(displayName("Chidi")).toBe("Chidi");
    expect(displayName("  mary  jane  de la cruz ")).toBe("mary C.");
    expect(displayName("")).toBe("Student");
    expect(displayName(null)).toBe("Student");
  });
});

describe("summariseCampus", () => {
  const person = (i: number, room: PresencePerson["room"]): PresencePerson => ({
    userId: `u${i}`,
    name: `P${i}`,
    avatar: null,
    level: "A1",
    room,
  });

  it("counts people per room and totals who is studying", () => {
    const snap = summariseCampus([person(1, "library"), person(2, "library"), person(3, "arena"), person(4, "lobby")]);
    expect(snap.online).toBe(4);
    expect(snap.studying).toBe(2);
    expect(snap.rooms.library.count).toBe(2);
    expect(snap.rooms.arena.count).toBe(1);
    expect(snap.rooms.cafe.count).toBe(0);
  });

  it("caps the faces drawn and reports the rest as +N", () => {
    const crowd = Array.from({ length: FACES_PER_ROOM + 5 }, (_, i) => person(i, "library"));
    const snap = summariseCampus(crowd);
    expect(snap.rooms.library.count).toBe(FACES_PER_ROOM + 5);
    expect(snap.rooms.library.people).toHaveLength(FACES_PER_ROOM);
    expect(snap.rooms.library.more).toBe(5);
  });

  it("counts the viewer but never draws them in their own room", () => {
    const snap = summariseCampus([person(1, "library"), person(2, "library")], "u1");
    expect(snap.rooms.library.count).toBe(2);
    expect(snap.rooms.library.people.map((p) => p.userId)).toEqual(["u2"]);
  });

  it("is empty-safe", () => {
    expect(summariseCampus([]).online).toBe(0);
  });
});

describe("requestAllowed", () => {
  const base = { sentLastHour: 0, openOutgoing: 0, fromUserId: "a", toUserId: "b", fromBand: "minor" as const, toBand: "minor" as const };

  it("allows a normal request", () => {
    expect(requestAllowed(base)).toEqual({ ok: true });
  });

  it("refuses a request to yourself", () => {
    expect(requestAllowed({ ...base, toUserId: "a" })).toEqual({ ok: false, reason: "self" });
  });

  it("refuses to cross the age line, in both directions and for the unknown band", () => {
    expect(requestAllowed({ ...base, toBand: "adult" })).toEqual({ ok: false, reason: "band" });
    expect(requestAllowed({ ...base, fromBand: "adult", toBand: "minor" })).toEqual({ ok: false, reason: "band" });
    expect(requestAllowed({ ...base, toBand: "unknown" })).toEqual({ ok: false, reason: "band" });
    expect(requestAllowed({ ...base, fromBand: "unknown", toBand: "unknown" })).toEqual({ ok: true });
  });

  it("refuses an unknown target band", () => {
    expect(requestAllowed({ ...base, toBand: null })).toEqual({ ok: false, reason: "band" });
  });

  it("rate-limits an open call too, which has no target", () => {
    expect(requestAllowed({ ...base, toUserId: null, toBand: null })).toEqual({ ok: true });
    expect(requestAllowed({ ...base, toUserId: null, toBand: null, sentLastHour: MAX_REQUESTS_PER_HOUR })).toEqual({
      ok: false,
      reason: "rate",
    });
  });

  it("limits requests per hour and requests waiting at once", () => {
    expect(requestAllowed({ ...base, sentLastHour: MAX_REQUESTS_PER_HOUR })).toEqual({ ok: false, reason: "rate" });
    expect(requestAllowed({ ...base, openOutgoing: MAX_OPEN_OUTGOING })).toEqual({ ok: false, reason: "open" });
  });
});

describe("coins", () => {
  it("caps every repeatable reward, so no single action can be farmed", () => {
    for (const [reason, rule] of Object.entries(COIN_RULES)) {
      if (!rule.once) expect(rule.perDay, `${reason} needs a daily cap`).toBeGreaterThan(0);
    }
  });

  it("keeps the most a student can earn in a day small and known", () => {
    expect(MAX_DAILY_COINS).toBe(5 + 8 * 5 + 7 * 5 + 3 * 4 + 1 * 5);
    expect(MAX_DAILY_COINS).toBeLessThan(150);
  });

  it("builds a different key for each award in a day and the same key for a repeat", () => {
    expect(coinRefKey("daily", "2026-10-06")).toBe(coinRefKey("daily", "2026-10-06"));
    expect(coinRefKey("duel_play", "2026-10-06", 1)).not.toBe(coinRefKey("duel_play", "2026-10-06", 2));
    expect(coinRefKey("duel_play", "2026-10-06", 1)).not.toBe(coinRefKey("duel_play", "2026-10-07", 1));
  });

  it("keys a duel reward by the duel, so finishing it twice pays once", () => {
    expect(coinRefKey("duel_play", "2026-10-06", 1, "duel-abc")).toBe("duel_play:2026-10-06:duel-abc");
  });

  it("pays a once-ever reward from a single key regardless of the day", () => {
    expect(coinRefKey("avatar", "2026-10-06")).toBe(coinRefKey("avatar", "2027-01-01"));
  });

  it("rolls the campus day over at midnight in Lagos, not UTC", () => {
    expect(campusDay(new Date("2026-10-06T22:59:00Z"))).toBe("2026-10-06");
    expect(campusDay(new Date("2026-10-06T23:00:00Z"))).toBe("2026-10-07");
  });
});

describe("the shared timer", () => {
  it("starts a cycle with 25 minutes of focus", () => {
    const start = Math.floor(Date.now() / (FOCUS_MS + BREAK_MS)) * (FOCUS_MS + BREAK_MS);
    expect(focusPhase(start)).toMatchObject({ phase: "focus", remainingMs: FOCUS_MS });
  });

  it("moves to a 5 minute break, then the next cycle's focus", () => {
    const start = 1_000 * (FOCUS_MS + BREAK_MS);
    expect(focusPhase(start + FOCUS_MS)).toMatchObject({ phase: "break", remainingMs: BREAK_MS });
    expect(focusPhase(start + FOCUS_MS + BREAK_MS)).toMatchObject({ phase: "focus", cycle: 1_001 });
  });

  it("is the same on every phone for the same instant", () => {
    const t = 1_791_200_000_000;
    expect(focusPhase(t)).toEqual(focusPhase(t));
  });

  it("formats a countdown", () => {
    expect(clock(7 * 60_000 + 42_000)).toBe("07:42");
    expect(clock(0)).toBe("00:00");
    expect(clock(-5)).toBe("00:00");
    expect(clock(61_000)).toBe("01:01");
  });
});
