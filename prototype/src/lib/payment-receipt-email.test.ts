import { describe, expect, it, vi } from "vitest";

// The HTML builder is pure; stub the DB and the queue the module also imports.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/email-queue", () => ({ queueEmail: vi.fn() }));

import { paymentReceiptEmailHtml, type PaymentReceiptEmail } from "./payment-receipt-email";

const base: PaymentReceiptEmail = {
  receiptNo: "04TSOSVUH6",
  studentName: "Chinkeluba Anita Omayaba",
  studentEmail: "anita@example.com",
  studentCode: "EW/2026/A1/SEP/L399",
  amount: 405000,
  currency: "NGN",
  method: "bank_transfer",
  description: "Part payment for Travel Package",
  paidAt: new Date("2026-09-30"),
  balanceAfter: 580000,
  tuitionFee: 985000,
};

describe("paymentReceiptEmailHtml", () => {
  it("is the receipt itself — amount, words, number, method, balance and progress inline", () => {
    const html = paymentReceiptEmailHtml(base);
    expect(html).toContain("₦405,000.00");
    expect(html).toContain("Four hundred and five thousand Naira only");
    expect(html).toContain("04TSOSVUH6");
    expect(html).toContain("Bank transfer");
    expect(html).toContain("PART PAYMENT");
    expect(html).toContain("Balance remaining");
    expect(html).toContain("₦580,000.00");
    expect(html).toContain("₦405,000.00 of ₦985,000.00 paid so far");
    expect(html).toContain("Dear Chinkeluba,");
  });

  it("says fully paid, with no progress bar, when the balance is cleared", () => {
    const html = paymentReceiptEmailHtml({ ...base, amount: 150000, balanceAfter: 0, description: "Full payment for A1", tuitionFee: 150000 });
    expect(html).toContain("PAID IN FULL");
    expect(html).not.toContain("paid so far");
    expect(html).toContain("fully paid");
  });

  it("omits the balance for a registration fee", () => {
    const html = paymentReceiptEmailHtml({ ...base, amount: 5000, balanceAfter: null, description: "Registration fee for Language training" });
    expect(html).toContain("registration fee has been received");
    expect(html).not.toContain("Balance");
  });

  it("escapes anything a student controls", () => {
    const html = paymentReceiptEmailHtml({ ...base, studentName: "<script>alert(1)</script> Eve", description: "x<img src=y>" });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=y>");
  });
});
