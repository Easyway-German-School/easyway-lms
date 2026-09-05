import { describe as suite, expect, it } from "vitest";

import { buildEnrolmentLetterPdf } from "./enrolment-letter-pdf";

suite("buildEnrolmentLetterPdf", () => {
  it("produces a non-empty PDF with tuition settled", async () => {
    const pdf = await buildEnrolmentLetterPdf({
      studentName: "Ada Lovelace",
      studentCode: "EW/2026/A1/JUL/0007",
      level: "B1",
      pathway: "Travel Package",
      branchName: "Lagos",
      deliveryMode: "hybrid",
      enrolledAt: new Date("2026-01-15"),
      tuitionSettled: true,
      expectedDuration: "8 months",
      referenceNo: "ABCD1234-XYZ",
    });
    expect(pdf).toBeInstanceOf(Buffer);
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("produces a non-empty PDF with tuition outstanding and no optional fields", async () => {
    const pdf = await buildEnrolmentLetterPdf({
      studentName: "Chidi Okafor",
      level: "A1",
      pathway: "Language training",
      enrolledAt: new Date(),
      tuitionSettled: false,
      referenceNo: "REF-0001",
    });
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
