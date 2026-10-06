import { describe, expect, it } from "vitest";
import { classifySweep, sweepYear, type SweepInput } from "./batch-sweep";

const base: SweepInput = {
  month: "August",
  status: "active",
  hasNextLevel: true,
  label: "August",
  movedUp: false,
  levelNow: "A1",
  onDesk: true,
  endsOn: null,
  signals: { history: false, started: false, registered: false },
};
type Patch = Omit<Partial<SweepInput>, "signals"> & { signals?: Partial<SweepInput["signals"]> };
const make = (patch: Patch): SweepInput => ({ ...base, ...patch, signals: { ...base.signals, ...(patch.signals ?? {}) } });

describe("classifySweep", () => {
  it("ignores learners with no sign of belonging to the batch", () => {
    const v = classifySweep(make({ label: "October", onDesk: false }));
    expect(v.belongs).toBe(false);
  });

  it("calls a learner on the lists 'on_desk'", () => {
    expect(classifySweep(make({})).reason).toBe("on_desk");
  });

  it("recognises a learner who was already moved up through their history, not their label", () => {
    const v = classifySweep(make({ label: "October", movedUp: true, levelNow: "A2", onDesk: false, signals: { history: true } }));
    expect(v.belongs).toBe(true);
    expect(v.reason).toBe("moved_up");
    expect(v.detail).toContain("A2");
  });

  it("finds a learner with NO batch label when their first day or history says August", () => {
    const strong = classifySweep(make({ label: null, onDesk: false, signals: { started: true } }));
    expect(strong.reason).toBe("no_label_strong");
    expect(strong.evidence.join(" ")).toContain("first day was in August");
    expect(classifySweep(make({ label: null, onDesk: false, signals: { history: true } })).reason).toBe("no_label_strong");
  });

  it("keeps a registration-month-only match as a by-hand check, never auto-fixable", () => {
    expect(classifySweep(make({ label: null, onDesk: false, signals: { registered: true } })).reason).toBe("no_label_weak");
  });

  it("flags a label the calendar cannot read", () => {
    const v = classifySweep(make({ label: "Aug", onDesk: false, signals: { started: true } }));
    expect(v.reason).toBe("unreadable_label");
    expect(v.detail).toContain("Aug");
  });

  it("flags a different recorded batch even when the first day was in August", () => {
    const v = classifySweep(make({ label: "September", onDesk: false, signals: { started: true } }));
    expect(v.reason).toBe("other_batch");
  });

  it("explains a learner whose August batch simply has not ended for them", () => {
    const v = classifySweep(make({ onDesk: false, endsOn: "Sat 31 Oct" }));
    expect(v.reason).toBe("still_running");
    expect(v.detail).toContain("31 Oct");
  });

  it("reports inactive learners and the top level before anything else", () => {
    expect(classifySweep(make({ status: "withdrawn" })).reason).toBe("not_active");
    expect(classifySweep(make({ hasNextLevel: false, levelNow: "C2" })).reason).toBe("top_level");
  });
});

describe("sweepYear", () => {
  it("is this year once the month has begun, last year before it", () => {
    expect(sweepYear(7, 2026, 9)).toBe(2026); // August, now October
    expect(sweepYear(10, 2026, 9)).toBe(2025); // November, now October
  });
});
