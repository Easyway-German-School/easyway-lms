import { describe, expect, it } from "vitest";
import {
  clockToMinutes,
  pickFocusIndex,
  sittingMeetsOn,
  sittingNote,
  sittingStateAt,
  type SittingState,
} from "@/lib/tutor-today";

// The hours under test, from SLOT_DEFAULTS: morning 10:00–13:00,
// afternoon 13:00–15:00, evening 17:00–19:00, weekend 10:00–14:00.
const WEDNESDAY = 3;
const SATURDAY = 6;
const SUNDAY = 0;

describe("clockToMinutes", () => {
  it("reads a wall clock", () => {
    expect(clockToMinutes("00:00")).toBe(0);
    expect(clockToMinutes("13:45")).toBe(825);
    expect(clockToMinutes("23:59")).toBe(1439);
  });

  it("refuses nonsense rather than reading it as midnight", () => {
    // 0 would make every class look finished — the one wrong answer that is
    // worse than no answer, because the card would hide the register.
    expect(clockToMinutes("")).toBeNull();
    expect(clockToMinutes("9am")).toBeNull();
    expect(clockToMinutes("24:00")).toBeNull();
    expect(clockToMinutes("10:60")).toBeNull();
  });
});

describe("sittingMeetsOn", () => {
  it("meets Mon–Fri for a weekday sitting", () => {
    expect(sittingMeetsOn("morning", WEDNESDAY)).toBe(true);
    expect(sittingMeetsOn("morning", SATURDAY)).toBe(false);
    expect(sittingMeetsOn("morning", SUNDAY)).toBe(false);
  });

  it("meets Saturdays only for the weekend sitting", () => {
    expect(sittingMeetsOn("weekend", SATURDAY)).toBe(true);
    expect(sittingMeetsOn("weekend", WEDNESDAY)).toBe(false);
    expect(sittingMeetsOn("weekend", SUNDAY)).toBe(false);
  });
});

describe("sittingStateAt", () => {
  it("is on during its own hours, and at the opening minute", () => {
    expect(sittingStateAt("morning", "10:00", WEDNESDAY)).toBe("now");
    expect(sittingStateAt("morning", "11:30", WEDNESDAY)).toBe("now");
    expect(sittingStateAt("morning", "12:59", WEDNESDAY)).toBe("now");
  });

  it("is finished from the closing minute, not a minute after", () => {
    // 13:00 is the afternoon sitting's start, so the morning one must already
    // be done or a tutor teaching both sees two classes claiming to be live.
    expect(sittingStateAt("morning", "13:00", WEDNESDAY)).toBe("done");
    expect(sittingStateAt("afternoon", "13:00", WEDNESDAY)).toBe("now");
  });

  it("warns 90 minutes ahead and no earlier", () => {
    expect(sittingStateAt("morning", "08:30", WEDNESDAY)).toBe("soon");
    expect(sittingStateAt("morning", "09:59", WEDNESDAY)).toBe("soon");
    expect(sittingStateAt("morning", "08:29", WEDNESDAY)).toBe("later");
    expect(sittingStateAt("evening", "08:30", WEDNESDAY)).toBe("later");
  });

  it("does not put a weekday class on a Saturday card", () => {
    expect(sittingStateAt("afternoon", "13:30", SATURDAY)).toBe("not-today");
    expect(sittingStateAt("weekend", "13:30", SATURDAY)).toBe("now");
  });

  it("falls back to 'later' on an unreadable clock instead of claiming a state", () => {
    expect(sittingStateAt("morning", "", WEDNESDAY)).toBe("later");
  });

  it("treats an unknown slot as the morning sitting, like the rest of the app", () => {
    // normalizeSlot()'s documented behaviour — worth pinning here because the
    // slot arrives from an admin-set assignment field, not a closed enum.
    expect(sittingStateAt("brunch", "11:00", WEDNESDAY)).toBe("now");
  });
});

describe("pickFocusIndex", () => {
  const pick = (states: SittingState[]) => pickFocusIndex(states);

  it("opens on the class that is on now", () => {
    expect(pick(["done", "now", "soon"])).toBe(1);
  });

  it("prefers the next one when nothing is on", () => {
    expect(pick(["later", "soon", "done"])).toBe(1);
    expect(pick(["not-today", "later"])).toBe(1);
  });

  it("still picks something once the teaching day is over", () => {
    // A tutor opening the portal at 9pm must still be able to take a register
    // or upload a material — the card cannot go blank.
    expect(pick(["done", "done"])).toBe(0);
    expect(pick(["not-today"])).toBe(0);
  });

  it("keeps the assignment's own order on a tie, so the card is stable", () => {
    expect(pick(["now", "now"])).toBe(0);
  });

  it("has nothing to open on an empty assignment", () => {
    expect(pick([])).toBe(-1);
  });
});

describe("sittingNote", () => {
  it("quotes the hours a tutor can check against the timetable", () => {
    expect(sittingNote("now", "morning")).toBe("On now · 10:00 – 13:00");
    expect(sittingNote("soon", "evening")).toBe("Starts soon · 17:00 – 19:00");
    expect(sittingNote("done", "afternoon")).toBe("Finished today · 13:00 – 15:00");
    expect(sittingNote("later", "evening")).toBe("Today · 17:00 – 19:00");
  });

  it("says why a weekend class is not on a weekday", () => {
    expect(sittingNote("not-today", "weekend")).toBe("Saturdays only");
    expect(sittingNote("not-today", "morning")).toBe("Not today");
  });
});
