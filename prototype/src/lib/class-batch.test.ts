import { describe, expect, it } from "vitest";
import {
  batchOfAdmission,
  batchSlug,
  batchTitle,
  canonicalBatch,
  compareBatches,
  studentIsInBatch,
  studentMayJoinBatch,
} from "./class-batch";
import { cohortRoomName, roomDisplayName } from "./live-classroom";

describe("reading a batch", () => {
  it("canonicalises whatever case the month was typed in, and rejects what is not a month", () => {
    expect(canonicalBatch("september")).toBe("September");
    expect(canonicalBatch("  OCTOBER ")).toBe("October");
    expect(canonicalBatch("Smarch")).toBe("");
    expect(canonicalBatch(null)).toBe("");
    expect(canonicalBatch(undefined)).toBe("");
    expect(canonicalBatch(9)).toBe("");
  });

  it("reads the batch off an admission blob, tolerating junk", () => {
    expect(batchOfAdmission({ batch: "october", phone: "1" })).toBe("October");
    expect(batchOfAdmission({})).toBe("");
    expect(batchOfAdmission(null)).toBe("");
    expect(batchOfAdmission("september")).toBe("");
  });

  it("names a batch for a label and a URL", () => {
    expect(batchTitle("sept")).toBe("");
    expect(batchTitle("september")).toBe("September batch");
    expect(batchSlug("September")).toBe("september");
    expect(batchSlug("")).toBe("");
  });
});

describe("who belongs to a batch's room", () => {
  const sept = { batch: "September" };
  const oct = { batch: "October" };
  const none = {};

  it("a live class pinned to a batch admits its own students and not the other batch's", () => {
    expect(studentMayJoinBatch("October", oct)).toBe(true);
    expect(studentMayJoinBatch("October", sept)).toBe(false);
    expect(studentMayJoinBatch("September", oct)).toBe(false);
  });

  it("a live class with no batch (older rows, a class in progress at deploy) admits everyone", () => {
    expect(studentMayJoinBatch(null, sept)).toBe(true);
    expect(studentMayJoinBatch("", oct)).toBe(true);
    expect(studentMayJoinBatch(undefined, none)).toBe(true);
  });

  it("a student with no batch on record is let in rather than locked out of their own class", () => {
    expect(studentMayJoinBatch("October", none)).toBe(true);
  });

  it("but membership — pushes, chat — is exact: no benefit of the doubt", () => {
    expect(studentIsInBatch("October", oct)).toBe(true);
    expect(studentIsInBatch("October", sept)).toBe(false);
    expect(studentIsInBatch("October", none)).toBe(false);
    // The batch-less room holds exactly the students with no batch.
    expect(studentIsInBatch("", none)).toBe(true);
    expect(studentIsInBatch("", sept)).toBe(false);
  });
});

describe("compareBatches", () => {
  const sortedAt = (isoDate: string) =>
    ["October", "", "September", "august"]
      .sort((a, b) => compareBatches(a, b, new Date(isoDate)))
      .map((batch) => canonicalBatch(batch));

  it("puts the batch that started first first, and no batch last", () => {
    expect(sortedAt("2026-10-05")).toEqual(["August", "September", "October", ""]);
  });

  it("holds the same order whatever month it is — a future batch is not last year's", () => {
    // In September, October is NEXT month's batch. Reading it as "the most
    // recent October at or before today" would put it before September.
    expect(sortedAt("2026-09-15")).toEqual(["August", "September", "October", ""]);
    expect(sortedAt("2026-01-10")).toEqual(["August", "September", "October", ""]);
    expect(sortedAt("2026-12-31")).toEqual(["August", "September", "October", ""]);
  });
});

describe("rooms carry the batch", () => {
  const cohort = { branchName: "Lagos", level: "A1", sessionSlot: "morning" };

  it("the live room name differs by batch, and keeps the old name with none", () => {
    const sept = cohortRoomName({ ...cohort, batch: "September", lecturerId: "cmtutorA" });
    const oct = cohortRoomName({ ...cohort, batch: "October", lecturerId: "cmtutorA" });
    expect(sept).toBe("ew-lagos-a1-morning-b-september-t-cmtutora");
    expect(oct).toBe("ew-lagos-a1-morning-b-october-t-cmtutora");
    expect(sept).not.toBe(oct);
    expect(cohortRoomName({ ...cohort, lecturerId: "cmtutorA" })).toBe("ew-lagos-a1-morning-t-cmtutora");
    expect(cohortRoomName(cohort)).toBe("ew-lagos-a1-morning");
    // A batch that is not a month adds nothing rather than a junk slug.
    expect(cohortRoomName({ ...cohort, batch: "Smarch" })).toBe("ew-lagos-a1-morning");
  });

  it("the room's title names the batch", () => {
    expect(roomDisplayName({ ...cohort, batch: "october" })).toBe("Lagos · A1 · Morning · October batch");
    expect(roomDisplayName(cohort)).toBe("Lagos · A1 · Morning");
  });
});
