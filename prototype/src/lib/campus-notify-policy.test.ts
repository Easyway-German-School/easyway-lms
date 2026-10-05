import { describe, expect, it } from "vitest";

import { KIND } from "@/lib/notification-kinds";
import { emailsByDefault } from "@/lib/mail-identity";
import {
  ACTIVE_WINDOW_MS,
  DAILY_PUSH_CAP,
  acceptedCopy,
  challengeCopy,
  inQuietHours,
  lagosDayStart,
  lagosHour,
  linkFor,
  pushVerdict,
  resultCopy,
  tagFor,
  waveCopy,
} from "@/lib/campus-notify-policy";

// 2026-10-06 in Lagos (UTC+1). 12:00 UTC = 13:00 Lagos.
const at = (utcHour: number, minute = 0) => new Date(Date.UTC(2026, 9, 6, utcHour, minute));

describe("Campus notifications are phone-first, never email", () => {
  it("is not in the list of kinds that email by default", () => {
    for (const kind of [KIND.campusWave, KIND.campusChallenge, KIND.campusAccepted, KIND.campusDuelResult]) {
      expect(emailsByDefault(kind), `${kind} must not email`).toBe(false);
    }
  });

  it("leaves the official kinds emailing, so this did not quietly switch off the real ones", () => {
    for (const kind of [KIND.paymentReceived, KIND.resultPublished, KIND.examRegistered, KIND.announcement]) {
      expect(emailsByDefault(kind)).toBe(true);
    }
  });
});

describe("Lagos time", () => {
  it("is one hour ahead of UTC", () => {
    expect(lagosHour(at(12))).toBe(13);
    expect(lagosHour(at(23))).toBe(0);
    expect(lagosHour(at(22, 59))).toBe(23);
  });

  it("starts the Lagos day at 23:00 UTC the evening before", () => {
    expect(lagosDayStart(at(12)).toISOString()).toBe("2026-10-05T23:00:00.000Z");
    expect(lagosDayStart(at(23, 30)).toISOString()).toBe("2026-10-06T23:00:00.000Z");
  });
});

describe("quiet hours", () => {
  it("are earlier for under-18s than for adults", () => {
    // 21:30 Lagos = 20:30 UTC
    expect(inQuietHours("minor", at(20, 30))).toBe(true);
    expect(inQuietHours("adult", at(20, 30))).toBe(false);
    // 22:30 Lagos = 21:30 UTC
    expect(inQuietHours("adult", at(21, 30))).toBe(true);
  });

  it("run through the night and end at 07:00 Lagos", () => {
    expect(inQuietHours("minor", at(2))).toBe(true); // 03:00
    expect(inQuietHours("minor", at(5, 59))).toBe(true); // 06:59
    expect(inQuietHours("minor", at(6))).toBe(false); // 07:00
    expect(inQuietHours("adult", at(12))).toBe(false); // 13:00
  });

  it("treat the unknown band like a minor — the cautious reading", () => {
    expect(inQuietHours("unknown", at(20, 30))).toBe(true);
  });
});

describe("pushVerdict", () => {
  const base = { kind: KIND.campusWave, band: "adult" as const, now: at(12), sentToday: 0, lastSeenAt: null };

  it("buzzes at a sensible hour for someone who is not on the app", () => {
    expect(pushVerdict(base)).toEqual({ push: true });
  });

  it("does not buzz someone who was just on Campus — the badge already says it", () => {
    const now = at(12);
    expect(pushVerdict({ ...base, lastSeenAt: new Date(now.getTime() - 30_000) })).toEqual({ push: false, reason: "active" });
    expect(pushVerdict({ ...base, lastSeenAt: new Date(now.getTime() - ACTIVE_WINDOW_MS - 1) })).toEqual({ push: true });
  });

  it("stays silent in quiet hours", () => {
    expect(pushVerdict({ ...base, now: at(2) })).toEqual({ push: false, reason: "quiet" });
  });

  it("stops at the daily ceiling, lower for minors than adults", () => {
    expect(pushVerdict({ ...base, band: "minor", sentToday: DAILY_PUSH_CAP.minor })).toEqual({ push: false, reason: "cap" });
    expect(pushVerdict({ ...base, band: "adult", sentToday: DAILY_PUSH_CAP.minor })).toEqual({ push: true });
    expect(pushVerdict({ ...base, band: "adult", sentToday: DAILY_PUSH_CAP.adult })).toEqual({ push: false, reason: "cap" });
  });

  it("lets a challenge — which has a clock on it — use twice the ceiling", () => {
    const cap = DAILY_PUSH_CAP.minor;
    expect(pushVerdict({ ...base, kind: KIND.campusChallenge, band: "minor", sentToday: cap })).toEqual({ push: true });
    expect(pushVerdict({ ...base, kind: KIND.campusChallenge, band: "minor", sentToday: cap * 2 })).toEqual({ push: false, reason: "cap" });
  });

  it("never lets time-sensitivity override quiet hours", () => {
    expect(pushVerdict({ ...base, kind: KIND.campusChallenge, now: at(2) })).toEqual({ push: false, reason: "quiet" });
  });
});

describe("the words", () => {
  it("names the person and varies the second line between events", () => {
    const lines = new Set(Array.from({ length: 30 }, (_, i) => waveCopy("Ada O.", `req-${i}`).message));
    expect(lines.size).toBeGreaterThan(1);
    expect(waveCopy("Ada O.", "x").title).toBe("Ada O. waved at you");
    expect(challengeCopy("Chidi A.", "x").title).toBe("Chidi A. challenged you");
    expect(acceptedCopy("Bola S.", "x").title).toBe("Bola S. took your challenge");
  });

  it("says the same thing for the same event, every time", () => {
    expect(waveCopy("Ada O.", "req-1")).toEqual(waveCopy("Ada O.", "req-1"));
  });

  it("writes a result from the reader's side, with coins only when there are some", () => {
    const won = resultCopy({ name: "Ada O.", outcome: "won", myPoints: 1168, theirPoints: 572, coins: 15, seed: "d" });
    expect(won.title).toBe("You beat Ada O.");
    expect(won.message).toContain("1168 – 572");
    expect(won.message).toContain("+15 coins");

    const lost = resultCopy({ name: "Ada O.", outcome: "lost", myPoints: 572, theirPoints: 1168, coins: 0, seed: "d" });
    expect(lost.message).not.toContain("coins");
    expect(lost.title).toContain("Ada O.");

    expect(resultCopy({ name: "Ada O.", outcome: "draw", myPoints: 800, theirPoints: 800, coins: 8, seed: "d" }).title).toBe("You drew with Ada O.");
  });

  it("never includes anything but a display name, a score and a count", () => {
    const text = JSON.stringify([waveCopy("Ada O.", "a"), challengeCopy("Ada O.", "a"), resultCopy({ name: "Ada O.", outcome: "won", myPoints: 1, theirPoints: 0, coins: 1, seed: "a" })]);
    expect(text).not.toMatch(/@|http|\.com/);
  });
});

describe("where a tap lands, and what replaces what", () => {
  it("opens the right screen", () => {
    expect(linkFor(KIND.campusWave)).toBe("/campus");
    expect(linkFor(KIND.campusChallenge)).toBe("/campus/arena");
    expect(linkFor(KIND.campusAccepted, "d1")).toBe("/campus/duel/d1");
    expect(linkFor(KIND.campusDuelResult, "d1")).toBe("/campus/duel/d1");
    expect(linkFor(KIND.campusDuelResult)).toBe("/campus/arena");
  });

  it("gives each duel its own lock-screen thread", () => {
    expect(tagFor(KIND.campusAccepted, "d1")).not.toBe(tagFor(KIND.campusAccepted, "d2"));
    expect(tagFor(KIND.campusAccepted, "d1")).toBe(tagFor(KIND.campusAccepted, "d1"));
  });
});
