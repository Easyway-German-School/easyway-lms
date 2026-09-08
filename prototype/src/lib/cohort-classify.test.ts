import { describe, expect, it } from "vitest";
import { classifyCohortStatus, type CohortSignals } from "@/lib/cohort-classify";

const INTAKE = { month: "September", year: 2026 };
const NOW = new Date("2026-09-08");

function signals(overrides: Partial<CohortSignals> = {}): CohortSignals {
  return {
    registeredAt: new Date("2026-09-02"),
    storedBatch: null,
    level: "A1",
    classesStartedAt: null,
    levelCompletedFor: null,
    firstAttendanceAt: null,
    attendanceCount: 0,
    firstGradeAt: null,
    firstSubmissionAt: null,
    firstQuestAt: null,
    classworkCount: 0,
    priorEnrolmentsCompleted: 0,
    currentEnrolmentStartedAt: null,
    currentEnrolmentBatchMonth: null,
    journeyStartedAt: null,
    currentIntake: INTAKE,
    now: NOW,
    ...overrides,
  };
}

describe("classifyCohortStatus", () => {
  it("calls a fresh account in the current intake with no classwork NEW", () => {
    const c = classifyCohortStatus(signals());
    expect(c.status).toBe("new");
    expect(c.confidence).toBe("high");
    expect(c.mismatch).toBeNull();
  });

  it("calls a student with attendance ONGOING and anchors the start on the first register row", () => {
    const c = classifyCohortStatus(
      signals({ firstAttendanceAt: new Date("2026-06-12"), attendanceCount: 20 }),
    );
    expect(c.status).toBe("ongoing");
    expect(c.confidence).toBe("high");
    expect(c.suggestedStartedAt).toBe(new Date("2026-06-12").toISOString());
  });

  it("calls a student the office has signed off a level for RETURNING", () => {
    const c = classifyCohortStatus(signals({ level: "A2", levelCompletedFor: "A1" }));
    expect(c.status).toBe("returning");
  });

  it("treats an A2 placement with no classwork as returning, lower confidence", () => {
    const c = classifyCohortStatus(signals({ level: "A2" }));
    expect(c.status).toBe("returning");
    expect(c.confidence).toBe("medium");
  });

  it("flags an ongoing student who sits in no cohort", () => {
    const c = classifyCohortStatus(
      signals({ firstAttendanceAt: new Date("2026-07-01"), attendanceCount: 5, storedBatch: null }),
    );
    expect(c.mismatch).toMatch(/no batch month/i);
  });

  it("flags a stored batch month that starts long after the first activity", () => {
    const c = classifyCohortStatus(
      signals({
        registeredAt: new Date("2026-05-20"),
        firstAttendanceAt: new Date("2026-06-05"),
        attendanceCount: 12,
        storedBatch: "September",
      }),
    );
    expect(c.mismatch).toMatch(/before the September batch/i);
  });

  it("falls back to UNKNOWN for an old account with no signal", () => {
    const c = classifyCohortStatus(
      signals({ registeredAt: new Date("2026-02-01"), storedBatch: null }),
    );
    expect(c.status).toBe("unknown");
    expect(c.confidence).toBe("low");
  });

  it("does not flag a new student whose stored batch is the current one", () => {
    const c = classifyCohortStatus(signals({ storedBatch: "September" }));
    expect(c.status).toBe("new");
    expect(c.mismatch).toBeNull();
  });
});
