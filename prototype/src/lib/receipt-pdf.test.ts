import { describe as suite, expect, it } from "vitest";

import { buildReceiptPdf } from "./receipt-pdf";

/**
 * Not a pixel-perfect layout test — just the thing most likely to silently
 * break: a bad font metric or a stray non-WinAnsi character (₦ is fine;
 * anything from a name outside the standard 14 fonts is not) throwing
 * instead of producing a valid PDF.
 */
suite("buildReceiptPdf", () => {
  it("produces a non-empty PDF for a normal payment", async () => {
    const pdf = await buildReceiptPdf({
      receiptNo: "RCPT12345",
      studentName: "Ada Lovelace",
      studentCode: "EW/2026/A1/JUL/0007",
      amount: 200000,
      currency: "NGN",
      method: "bank_transfer",
      description: "Travel Package — first payment",
      paidAt: new Date("2026-09-05"),
      balanceAfter: 780000,
    });
    expect(pdf).toBeInstanceOf(Buffer);
    expect(pdf.length).toBeGreaterThan(100);
    // A PDF always starts with this magic header.
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("works with no balanceAfter and no studentCode", async () => {
    const pdf = await buildReceiptPdf({
      receiptNo: "RCPT99999",
      studentName: "Chidi Okafor",
      amount: 5000,
      method: "paystack",
      description: "Registration fee for Language training",
      paidAt: new Date(),
    });
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
