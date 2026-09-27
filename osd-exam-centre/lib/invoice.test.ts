import { describe, expect, it } from "vitest";
import { buildInvoice, feeLinesFor, invoiceNumberFor, moduleSummary, paymentReferenceFor, type InvoiceBooking, type InvoiceSession } from "./invoice";
import { pdfSafe, renderInvoicePdf } from "./invoice-pdf";

const session: InvoiceSession = {
  level: "B2",
  feeWholeExam: 210_000,
  modulePrices: [{ module: "written", price: 157_500 }, { module: "oral", price: 52_500 }],
};

// Mirrors the specimen on the school's own invoice template (Dr. Yejide Lamina, B2).
const booking: InvoiceBooking = {
  referenceCode: "EW-OSD-2026-OBB052",
  invoiceNumber: null,
  fullName: "Dr. Yejide Lamina",
  gender: "Female",
  dateOfBirth: new Date("1978-10-25"),
  placeOfBirth: "Lagos",
  nationality: "Nigeria",
  phone: "08039215479",
  email: "yejidelamina@gmail.com",
  modules: ["full"],
  feeTotal: 210_000,
  express: false,
  expressFee: 0,
  registeredAt: new Date("2026-09-25T09:00:00+01:00"),
  createdAt: new Date("2026-09-25T09:00:00+01:00"),
  paymentStatus: "unpaid",
  amountReceived: null,
  paidOn: null,
  transferReference: null,
  verifiedBy: null,
};

describe("invoice numbering", () => {
  it("derives the invoice number from the booking reference, as on the template", () => {
    expect(invoiceNumberFor("EW-OSD-2026-OBB052")).toBe("EW-OSD-INV-2026-OBB052");
  });
  it("builds the bank narration from surname + invoice number", () => {
    expect(paymentReferenceFor("Dr. Yejide Lamina", "EW-OSD-INV-2026-OBB052")).toBe("LAMINA EW-OSD-INV-2026-OBB052");
  });
});

describe("buildInvoice", () => {
  it("reproduces the template specimen field for field", () => {
    const inv = buildInvoice(booking, session, new Date("2026-09-25T12:00:00+01:00"));
    expect(inv.invoiceNumber).toBe("EW-OSD-INV-2026-OBB052");
    expect(inv.issuedOn).toBe("25 September, 2026");
    expect(inv.candidate.find((f) => f.label === "Date of Birth")?.value).toBe("25.10.1978");
    expect(inv.exam.find((f) => f.label === "Registration Date")?.value).toBe("25.09.2026");
    expect(inv.exam.find((f) => f.label === "Modules")?.value).toBe("Written + Oral");
    expect(inv.exam.find((f) => f.label === "Express")?.value).toBe("No Demand");
    expect(inv.feeLines).toEqual([
      { label: "ÖSD Zertifikat B2 — Written Module", amount: 157_500 },
      { label: "ÖSD Zertifikat B2 — Oral Module", amount: 52_500 },
    ]);
    expect(inv.total).toBe(210_000);
    expect(inv.totalInWords).toBe("Two Hundred and Ten Thousand Naira Only");
    expect(inv.paid).toBe(false);
    expect(inv.paymentConfirmation.every((f) => f.value === "")).toBe(true);
  });

  it("does not shift a date of birth across midnight (it is a calendar date, not an instant)", () => {
    const inv = buildInvoice({ ...booking, dateOfBirth: new Date("2000-01-01") }, session);
    expect(inv.candidate.find((f) => f.label === "Date of Birth")?.value).toBe("01.01.2000");
  });

  it("fills the payment-confirmation block once paid", () => {
    const inv = buildInvoice(
      { ...booking, paymentStatus: "paid", amountReceived: 210_000, paidOn: new Date("2026-09-27T10:00:00+01:00"), transferReference: "MP-99812", verifiedBy: "office" },
      session,
    );
    expect(inv.paid).toBe(true);
    expect(inv.paymentConfirmation).toEqual([
      { label: "Amount Received:", value: "210,000" },
      { label: "Date received:", value: "27.09.2026" },
      { label: "Transaction Reference:", value: "MP-99812" },
      { label: "Verified by:", value: "Easyway Examination Department" },
    ]);
  });
});

describe("feeLinesFor", () => {
  it("itemises an express result and keeps it inside the total", () => {
    const lines = feeLinesFor({ ...booking, express: true, expressFee: 192_500, feeTotal: 402_500 }, session);
    expect(lines.at(-1)).toEqual({ label: "Express result service", amount: 192_500 });
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(402_500);
  });

  it("prices a single module", () => {
    const lines = feeLinesFor({ ...booking, modules: ["oral"], feeTotal: 52_500 }, session);
    expect(lines).toEqual([{ label: "ÖSD Zertifikat B2 — Oral Module", amount: 52_500 }]);
  });

  it("never prints a breakdown that contradicts the snapshotted total", () => {
    // Session prices were edited after this candidate booked at 200,000.
    const lines = feeLinesFor({ ...booking, feeTotal: 200_000 }, session);
    expect(lines).toEqual([{ label: "ÖSD Zertifikat B2 — Examination fee", amount: 200_000 }]);
  });

  it("falls back to a whole-exam line when the sitting has no written/oral split", () => {
    const lines = feeLinesFor(booking, { ...session, modulePrices: [] });
    expect(lines).toEqual([{ label: "ÖSD Zertifikat B2 — Whole examination", amount: 210_000 }]);
  });
});

describe("moduleSummary", () => {
  it("reads naturally", () => {
    expect(moduleSummary(["full"])).toBe("Written + Oral");
    expect(moduleSummary(["oral", "written"])).toBe("Written + Oral");
    expect(moduleSummary(["oral"])).toBe("Oral");
  });
});

describe("pdfSafe", () => {
  it("keeps Ö and typographic dashes, keeps Latin-1 accents, strips the Yoruba marks WinAnsi cannot draw (instead of crashing the PDF)", () => {
    expect(pdfSafe("ÖSD Zertifikat — B2")).toBe("ÖSD Zertifikat — B2");
    expect(pdfSafe("Adéọlá Ṣadé")).toBe("Adéolá Sadé");
  });
});

describe("renderInvoicePdf", () => {
  it("produces a real one-page PDF, pending and paid, even with awkward names", async () => {
    const pending = await renderInvoicePdf(buildInvoice({ ...booking, fullName: "Adéọlá Ṣadé Okonkwo-Adebayo" }, session));
    expect(Buffer.from(pending.slice(0, 5)).toString()).toBe("%PDF-");
    expect(pending.length).toBeGreaterThan(5_000);

    const paid = await renderInvoicePdf(
      buildInvoice({ ...booking, paymentStatus: "paid", amountReceived: 210_000, paidOn: new Date(), transferReference: "X", verifiedBy: "office" }, session),
    );
    expect(paid.length).toBeGreaterThan(5_000);
  });
});

describe("paymentReferenceFor length", () => {
  it("caps a very long surname so the invoice number is never pushed out", () => {
    expect(paymentReferenceFor("Ada Okonkwo-Adebayo-Fashola", "EW-OSD-INV-2026-ABCDE")).toBe("OKONKWO-ADEB EW-OSD-INV-2026-ABCDE");
  });
});
