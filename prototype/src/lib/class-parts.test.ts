import { describe, expect, it } from "vitest";
import { classDayBounds, heldParts, otherPartsOf, otherPartsSeconds, sameClassDay, type PartRow } from "./class-parts";
import { RETENTION, isTooShortToKeep } from "./retention";

const MIN = 60;
const at = (iso: string) => new Date(iso);

function part(over: Partial<PartRow> & { id: string }): PartRow {
  return {
    roomName: "ew-lagos-a1-morning-t-1", startedAt: at("2026-10-05T09:00:00Z"), status: "completed",
    durationSeconds: 30 * MIN, materialId: null, objectKey: `recordings/${over.id}.mp4`, ...over,
  };
}

describe("which recordings belong to one class", () => {
  it("same room, same UTC day, not itself", () => {
    const self = part({ id: "a" });
    const rows = [
      self,
      part({ id: "b", startedAt: at("2026-10-05T11:30:00Z") }),
      part({ id: "other-room", roomName: "ew-abuja-a1-morning-t-2" }),
      part({ id: "yesterday", startedAt: at("2026-10-04T09:00:00Z") }),
    ];
    expect(otherPartsOf(self, rows).map((r) => r.id)).toEqual(["b"]);
  });

  it("a class never straddles UTC midnight in practice, but the day test is exact", () => {
    expect(sameClassDay(at("2026-10-05T00:00:00Z"), at("2026-10-05T23:59:59Z"))).toBe(true);
    expect(sameClassDay(at("2026-10-05T23:59:59Z"), at("2026-10-06T00:00:00Z"))).toBe(false);
    const { from, to } = classDayBounds(at("2026-10-05T17:42:00Z"));
    expect(from.toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-10-06T00:00:00.000Z");
  });
});

describe("how much of the class was recorded elsewhere", () => {
  it("adds completed and purged parts, ignores failed/active/aborted and missing durations", () => {
    const others = [
      part({ id: "1", durationSeconds: 100 * MIN }),
      part({ id: "2", status: "purged", durationSeconds: 20 * MIN }),
      part({ id: "3", status: "failed", durationSeconds: 999 * MIN }),
      part({ id: "4", status: "active", durationSeconds: null }),
      part({ id: "5", status: "aborted", durationSeconds: 50 * MIN }),
      part({ id: "6", durationSeconds: null }),
    ];
    expect(otherPartsSeconds(others)).toBe(120 * MIN);
  });
});

describe("which held parts can be rescued", () => {
  it("only completed, shelf-less, non-private parts whose file still exists", () => {
    const rows = [
      part({ id: "held" }),
      part({ id: "has-shelf-entry", materialId: "m1" }),
      part({ id: "purged", status: "purged" }),
      part({ id: "private", privateClassId: "p1" }),
      part({ id: "no-file", objectKey: null }),
    ];
    expect(heldParts(rows).map((r) => r.id)).toEqual(["held"]);
  });
});

describe("the keep-or-hold decision judges the whole class", () => {
  const min = RETENTION.minWorthKeepingSeconds;

  it("the old behaviour is unchanged when there are no other parts", () => {
    expect(isTooShortToKeep(min - 1, false)).toBe(true);
    expect(isTooShortToKeep(min, false)).toBe(false);
  });

  it("THE BUG: a 25-minute tail after a crash is the end of a real class, not a false start", () => {
    expect(isTooShortToKeep(25 * MIN, false)).toBe(true); // judged alone: it would be purged
    expect(isTooShortToKeep(25 * MIN, false, 150 * MIN)).toBe(false); // judged with the 150 min before it: kept
  });

  it("two short halves of one real class are kept; two halves of a genuinely short class are not", () => {
    expect(isTooShortToKeep(20 * MIN, false, 25 * MIN)).toBe(false); // 45 min total
    expect(isTooShortToKeep(10 * MIN, false, 15 * MIN)).toBe(true); // 25 min total: still a false start
  });

  it("private lessons are never short, and an unknown duration is never judged", () => {
    expect(isTooShortToKeep(1, true, 0)).toBe(false);
    expect(isTooShortToKeep(null, false, 0)).toBe(false);
  });
});
