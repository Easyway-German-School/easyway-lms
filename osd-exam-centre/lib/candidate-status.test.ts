import { describe, expect, it } from "vitest";
import { admissionChecklist, candidateJourney, deriveStatus, missingAdmissionFields, type StatusFacts } from "./candidate-status";

const base: StatusFacts = {
  status: "booked",
  paymentStatus: "unpaid",
  documentStatus: "pending",
  passportDataPageUrl: null,
  infoConfirmedAt: null,
  admittedAt: null,
  examCompletedAt: null,
  resultReleasedAt: null,
  certificateReadyAt: null,
  certificateDeliveredAt: null,
  countryOfBirth: null,
  addressLine: null,
  city: null,
  idType: null,
  idNumber: null,
  idExpiry: null,
};

const complete: Partial<StatusFacts> = {
  countryOfBirth: "Nigeria", addressLine: "1 Road", city: "Lagos",
  idType: "International Passport", idNumber: "A123", idExpiry: "2030-01-01",
};

const at = (facts: Partial<StatusFacts>) => deriveStatus({ ...base, ...facts }).key;

describe("deriveStatus — the manual's lifecycle, in order", () => {
  it("walks a candidate from booking to certificate", () => {
    expect(at({})).toBe("payment_pending");
    expect(at({ paymentStatus: "pending_verification" })).toBe("payment_review");
    expect(at({ paymentStatus: "paid" })).toBe("information_required");
    expect(at({ paymentStatus: "paid", ...complete })).toBe("information_required"); // not yet confirmed
    expect(at({ paymentStatus: "paid", ...complete, infoConfirmedAt: "2026-10-01" })).toBe("information_required"); // no ID uploaded
    expect(at({ paymentStatus: "paid", ...complete, infoConfirmedAt: "2026-10-01", passportDataPageUrl: "x" })).toBe("documents_under_review");
    expect(at({ paymentStatus: "paid", ...complete, infoConfirmedAt: "2026-10-01", passportDataPageUrl: "x", documentStatus: "approved" })).toBe("ready_to_admit");
    expect(at({ admittedAt: "2026-10-10", paymentStatus: "paid" })).toBe("admitted");
    expect(at({ admittedAt: "x", examCompletedAt: "2026-10-30" })).toBe("result_pending");
    expect(at({ admittedAt: "x", examCompletedAt: "y", resultReleasedAt: "z" })).toBe("result_released");
    expect(at({ admittedAt: "x", examCompletedAt: "y", resultReleasedAt: "z", certificateReadyAt: "v" })).toBe("certificate_ready");
    expect(at({ admittedAt: "x", examCompletedAt: "y", resultReleasedAt: "z", certificateReadyAt: "v", certificateDeliveredAt: "w" })).toBe("certificate_delivered");
  });

  it("lets a cancellation or no-show override everything else", () => {
    expect(at({ status: "cancelled", paymentStatus: "paid", admittedAt: "x" })).toBe("cancelled");
    expect(at({ status: "no_show", admittedAt: "x" })).toBe("no_show");
  });

  it("does not let payment alone imply admission (Manual §12)", () => {
    expect(at({ paymentStatus: "paid", status: "confirmed" })).not.toBe("admitted");
    expect(at({ paymentStatus: "paid", status: "confirmed" })).not.toBe("ready_to_admit");
  });
});

describe("missingAdmissionFields", () => {
  it("names what is still blank", () => {
    expect(missingAdmissionFields(base)).toEqual([
      "country of birth", "address", "city", "ID document type", "ID number", "ID expiry date",
    ]);
    expect(missingAdmissionFields({ ...base, ...complete })).toEqual([]);
  });
});

describe("admissionChecklist", () => {
  it("is all-done only when every precondition holds", () => {
    expect(admissionChecklist(base).every((c) => c.done)).toBe(false);
    const ready = { ...base, ...complete, paymentStatus: "paid", infoConfirmedAt: "x", documentStatus: "approved" } as StatusFacts;
    expect(admissionChecklist(ready).every((c) => c.done)).toBe(true);
  });
});

describe("candidateJourney", () => {
  const view = (facts: Partial<StatusFacts>) => candidateJourney({ ...base, ...facts });
  const current = (facts: Partial<StatusFacts>) => view(facts).find((s) => s.state === "current")?.key;

  it("always has exactly one current step until everything is done", () => {
    expect(view({}).filter((s) => s.state === "current")).toHaveLength(1);
    expect(current({})).toBe("payment");
    expect(current({ paymentStatus: "paid" })).toBe("details");
    expect(current({ paymentStatus: "paid", ...complete, infoConfirmedAt: "x" })).toBe("id");
    expect(current({ paymentStatus: "paid", ...complete, infoConfirmedAt: "x", documentStatus: "approved" })).toBe("admission");
    expect(current({ paymentStatus: "paid", ...complete, infoConfirmedAt: "x", documentStatus: "approved", admittedAt: "x" })).toBe("exam");
  });

  it("marks the whole road done once the certificate is delivered", () => {
    const done = view({ paymentStatus: "paid", ...complete, infoConfirmedAt: "x", documentStatus: "approved", admittedAt: "x", examCompletedAt: "x", resultReleasedAt: "x", certificateDeliveredAt: "x" });
    expect(done.every((s) => s.state === "done")).toBe(true);
  });

  it("only gives a hint for the step the candidate is on", () => {
    expect(view({}).filter((s) => s.hint)).toHaveLength(1);
  });
});
