import { beforeEach, describe, expect, it, vi } from "vitest";
import { decidePlacement, monthsSinceBatchStart } from "./batch-placement";
import type { CohortClassification } from "./cohort-classify";

const NOW = new Date("2026-10-06T10:00:00Z");

const classification = (over: Partial<CohortClassification> = {}): CohortClassification => ({
  status: "unknown",
  confidence: "low",
  evidence: [],
  suggestedStartedAt: null,
  suggestedBatch: null,
  mismatch: null,
  officeConfirmed: false,
  ...over,
});
const decide = (c: CohortClassification, extra: { enrolmentBatchMonth?: string | null; currentIntakeMonth?: string } = {}) =>
  decidePlacement({ classification: c, enrolmentBatchMonth: extra.enrolmentBatchMonth ?? null, currentIntakeMonth: extra.currentIntakeMonth ?? "October", now: NOW });

describe("when the evidence is clear enough to place someone without asking", () => {
  it("the enrolment record for this level names the batch — the strongest evidence", () => {
    expect(decide(classification({ status: "returning", confidence: "high" }), { enrolmentBatchMonth: "september" })).toMatchObject({
      place: true,
      batch: "September",
      basis: "enrolment",
    });
  });

  it("a brand-new student in the current intake gets the current intake month (what signup would have done)", () => {
    expect(decide(classification({ status: "new", confidence: "high" }), { currentIntakeMonth: "October" })).toMatchObject({
      place: true,
      batch: "October",
      basis: "new-intake",
    });
  });

  it("mid-course with hard evidence: the month they started", () => {
    const d = decide(classification({ status: "ongoing", confidence: "high", suggestedBatch: "September" }));
    expect(d).toMatchObject({ place: true, batch: "September", basis: "first-attendance" });
  });
});

describe("when it must NOT guess", () => {
  it("conflicting evidence goes to a person", () => {
    const d = decide(classification({ status: "ongoing", confidence: "high", suggestedBatch: "September", mismatch: "first attended in June" }));
    expect(d).toMatchObject({ place: false, reason: expect.stringMatching(/conflicts/) });
  });

  it("a returning student with no enrolment row is NOT placed from old activity (it may be from a previous level)", () => {
    const d = decide(classification({ status: "returning", confidence: "high", suggestedBatch: "March" }));
    expect(d.place).toBe(false);
  });

  it("an activity start more than 4 months back is stale, not a batch", () => {
    // March is 7 months before 6 Oct 2026.
    expect(decide(classification({ status: "ongoing", confidence: "high", suggestedBatch: "March" }))).toMatchObject({
      place: false,
      reason: expect.stringMatching(/too long ago/),
    });
    // June is 4 months back: still allowed (the boundary).
    expect(decide(classification({ status: "ongoing", confidence: "high", suggestedBatch: "June" })).place).toBe(true);
    expect(decide(classification({ status: "ongoing", confidence: "high", suggestedBatch: "May" })).place).toBe(false);
  });

  it("an 'unknown' or merely 'probably new' student is left for the office, with the reason", () => {
    expect(decide(classification({ status: "unknown", confidence: "low" }))).toMatchObject({ place: false, reason: expect.stringMatching(/person must say/) });
    expect(decide(classification({ status: "new", confidence: "medium" })).place).toBe(false);
    expect(decide(classification({ status: "ongoing", confidence: "medium", suggestedBatch: "September" })).place).toBe(false);
  });

  it("no current intake month set means a new student is not guessed into one", () => {
    expect(decide(classification({ status: "new", confidence: "high" }), { currentIntakeMonth: "Smarch" }).place).toBe(false);
  });
});

describe("how long ago a batch started", () => {
  it("counts back to its most recent occurrence", () => {
    expect(monthsSinceBatchStart("October", NOW)).toBe(0);
    expect(monthsSinceBatchStart("September", NOW)).toBe(1);
    expect(monthsSinceBatchStart("December", NOW)).toBe(10); // last December
    expect(monthsSinceBatchStart("Smarch", NOW)).toBeNull();
  });
});

/* ---------------------------------------------------------------------- */
/* The database half, against a fake table                                  */
/* ---------------------------------------------------------------------- */

type Row = { id: string; level: string; admission: Record<string, unknown>; createdAt: Date; classesStartedAt: Date | null; levelCompletedFor: string | null; tenantId: string | null; user: { name: string; email: string } };
const db = vi.hoisted(() => ({ students: [] as unknown[], enrolments: [] as unknown[], updates: [] as Array<{ id: string; admission: Record<string, unknown> }>, classify: {} as Record<string, unknown> }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    student: {
      findMany: vi.fn(async () => db.students),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const s = (db.students as Row[]).find((row) => row.id === where.id);
        return s ? { admission: s.admission } : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { admission: Record<string, unknown> } }) => {
        db.updates.push({ id: where.id, admission: data.admission });
        const s = (db.students as Row[]).find((row) => row.id === where.id);
        if (s) s.admission = data.admission;
        return {};
      }),
    },
    studentEnrolment: { findMany: vi.fn(async () => db.enrolments) },
  },
}));
vi.mock("@/lib/intake-server", () => ({ readCurrentIntake: vi.fn(async () => ({ month: "October", year: 2026 })) }));
vi.mock("@/lib/cohort-classify-server", () => ({ classifyRoster: vi.fn(async () => ({ byId: db.classify, tally: {} })) }));

import { placeUnplacedStudents } from "./batch-placement-server";

const student = (id: string, admission: Record<string, unknown> = {}): Row => ({
  id,
  level: "A1",
  admission,
  createdAt: new Date("2026-10-02T00:00:00Z"),
  classesStartedAt: null,
  levelCompletedFor: null,
  tenantId: "t1",
  user: { name: `Student ${id}`, email: `${id}@x.test` },
});

beforeEach(() => {
  db.students = [];
  db.enrolments = [];
  db.updates = [];
  db.classify = {};
});

describe("placing the students who have no batch", () => {
  it("fills the gaps the evidence is clear about, stamps how, and lists the rest with the reason", async () => {
    db.students = [student("fresh"), student("enrolled"), student("mystery")];
    db.enrolments = [{ studentId: "enrolled", batchMonth: "September" }];
    db.classify = {
      fresh: classification({ status: "new", confidence: "high" }),
      enrolled: classification({ status: "ongoing", confidence: "high" }),
      mystery: classification({ status: "unknown", confidence: "low" }),
    };

    const report = await placeUnplacedStudents({ apply: true, now: NOW });

    expect(report.placed.map((p) => [p.id, p.batch]).sort()).toEqual([["enrolled", "September"], ["fresh", "October"]]);
    expect(report.needsPerson).toEqual([expect.objectContaining({ id: "mystery", reason: expect.stringMatching(/person must say/) })]);
    expect(db.updates).toHaveLength(2);
    expect(db.updates.find((u) => u.id === "fresh")?.admission).toMatchObject({ batch: "October", batchPlacedBy: "auto", batchPlacedBasis: "new-intake" });
  });

  it("a PREVIEW writes nothing", async () => {
    db.students = [student("fresh")];
    db.classify = { fresh: classification({ status: "new", confidence: "high" }) };
    const report = await placeUnplacedStudents({ apply: false, now: NOW });
    expect(report.placed).toHaveLength(1);
    expect(report.applied).toBe(false);
    expect(db.updates).toHaveLength(0);
  });

  it("NEVER touches a student who already has a batch", async () => {
    db.students = [student("placed", { batch: "August", phone: "1" }), student("fresh")];
    db.classify = { fresh: classification({ status: "new", confidence: "high" }), placed: classification({ status: "new", confidence: "high" }) };
    const report = await placeUnplacedStudents({ apply: true, now: NOW });
    expect(report.scanned).toBe(1);
    expect(db.updates.map((u) => u.id)).toEqual(["fresh"]);
  });

  it("keeps the rest of the student's record when it writes", async () => {
    db.students = [student("fresh", { phone: "0803", city: "Lagos" })];
    db.classify = { fresh: classification({ status: "new", confidence: "high" }) };
    await placeUnplacedStudents({ apply: true, now: NOW });
    expect(db.updates[0].admission).toMatchObject({ phone: "0803", city: "Lagos", batch: "October" });
  });

  it("a batch written as something that is not a month is left for a person, not overwritten", async () => {
    db.students = [student("typo", { batch: "Jan 2026" })];
    db.classify = { typo: classification({ status: "new", confidence: "high" }) };
    const report = await placeUnplacedStudents({ apply: true, now: NOW });
    expect(report.placed).toHaveLength(0);
    expect(report.needsPerson[0].reason).toMatch(/not a month/);
    expect(db.updates).toHaveLength(0);
  });

  it("running it twice changes nothing the second time", async () => {
    db.students = [student("fresh")];
    db.classify = { fresh: classification({ status: "new", confidence: "high" }) };
    await placeUnplacedStudents({ apply: true, now: NOW });
    const second = await placeUnplacedStudents({ apply: true, now: NOW });
    expect(second.scanned).toBe(0);
    expect(db.updates).toHaveLength(1);
  });
});
