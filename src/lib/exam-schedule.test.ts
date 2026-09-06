import { describe, expect, it } from "vitest";

import {
  DEFAULT_REGISTRATION_LEAD_DAYS,
  examCountdown,
  examWhen,
  registrationClosesAt,
  registrationState,
} from "./exam-schedule";

const EXAM = "2026-11-15T08:00:00.000Z"; // 09:00 WAT
const D = (iso: string) => new Date(iso);

describe("registrationClosesAt", () => {
  it("uses the explicit deadline when set", () => {
    expect(registrationClosesAt({ examDate: EXAM, registrationDeadline: "2026-11-01T00:00:00Z" }).toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );
  });
  it("defaults to N days before the sitting", () => {
    const closes = registrationClosesAt({ examDate: EXAM, registrationDeadline: null });
    expect(closes.toISOString()).toBe("2026-11-12T08:00:00.000Z");
    expect((D(EXAM).getTime() - closes.getTime()) / 86_400_000).toBe(DEFAULT_REGISTRATION_LEAD_DAYS);
  });
});

describe("examCountdown", () => {
  it("reads well across the boundaries (school-zone days)", () => {
    expect(examCountdown(EXAM, D("2026-11-10T12:00:00Z")).label).toBe("in 5 days");
    expect(examCountdown(EXAM, D("2026-11-14T12:00:00Z")).label).toBe("tomorrow");
    expect(examCountdown(EXAM, D("2026-11-15T06:00:00Z")).label).toBe("today"); // 07:00 WAT, exam 09:00
    expect(examCountdown(EXAM, D("2026-11-15T10:00:00Z")).started).toBe(true); // 11:00 WAT
    expect(examCountdown(EXAM, D("2026-11-15T10:00:00Z")).label).toBe("started");
  });
});

describe("examWhen", () => {
  it("renders the time in the centre's zone with a label", () => {
    expect(examWhen(EXAM)).toBe("Sun 15 Nov, 09:00 WAT");
  });
});

describe("registrationState", () => {
  const base = { examDate: EXAM, registrationDeadline: null, capacity: 20, published: true };

  it("is open well before the sitting with seats free", () => {
    const s = registrationState(base, 5, D("2026-11-01T00:00:00Z"));
    expect(s).toMatchObject({ isOpen: true, reason: null, seatsLeft: 15 });
  });
  it("closes at the defaulted deadline", () => {
    const s = registrationState(base, 5, D("2026-11-13T00:00:00Z")); // past 12 Nov
    expect(s).toMatchObject({ isOpen: false, reason: "closed" });
  });
  it("is full when every seat is taken", () => {
    const s = registrationState(base, 20, D("2026-11-01T00:00:00Z"));
    expect(s).toMatchObject({ isOpen: false, reason: "full", seatsLeft: 0 });
  });
  it("is past once the sitting has happened", () => {
    const s = registrationState(base, 5, D("2026-11-16T00:00:00Z"));
    expect(s).toMatchObject({ isOpen: false, reason: "past" });
  });
  it("uncapped sittings report null seatsLeft", () => {
    const s = registrationState({ ...base, capacity: null }, 99, D("2026-11-01T00:00:00Z"));
    expect(s.seatsLeft).toBeNull();
    expect(s.isOpen).toBe(true);
  });
});
