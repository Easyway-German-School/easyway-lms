import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * A payment receipt — one page, plain text laid out by hand, same reasoning
 * as src/lib/transcript-pdf.ts: `pdf-lib` needs no browser to boot on a
 * serverless function and no native binary to fit under Vercel's bundle
 * limit, and a receipt has no layout complex enough to need more than that.
 *
 * Deliberately NOT a tax invoice or a legal instrument — it is proof a
 * specific payment was received, for a parent or student's own records.
 */

const PAGE_SIZE: [number, number] = [595.28, 841.89]; // A4
const MARGIN = 56;
const ACCENT = rgb(1, 0.4, 0); // #FF6600

export type ReceiptPdfInput = {
  receiptNo: string;
  schoolName?: string;
  studentName: string;
  studentCode?: string | null;
  amount: number;
  currency?: string;
  method: string;
  description: string;
  paidAt: Date;
  /** Running balance after this payment, if known — omitted when not tracked (e.g. a flat one-off fee). */
  balanceAfter?: number | null;
};

/**
 * "NGN " rather than "₦": the standard-14 fonts pdf-lib embeds use WinAnsi
 * encoding, which has no glyph for U+20A6 and throws rather than drop it.
 * ä/ö/ü/ß are fine (see transcript-pdf.ts) — the Naira sign specifically is
 * not in that set.
 */
function naira(amount: number): string {
  return `NGN ${Math.round(amount).toLocaleString("en-NG")}`;
}

function row(page: PDFPage, y: number, label: string, value: string, body: PDFFont, bold: PDFFont): void {
  page.drawText(label, { x: MARGIN, y, size: 10, font: body, color: rgb(0.45, 0.45, 0.45) });
  page.drawText(value, { x: MARGIN + 160, y, size: 11, font: bold, color: rgb(0.1, 0.1, 0.1) });
}

export async function buildReceiptPdf(input: ReceiptPdfInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Receipt ${input.receiptNo}`);
  doc.setProducer("EasyWay LMS");

  const body = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage(PAGE_SIZE);
  let y = PAGE_SIZE[1] - MARGIN;

  const schoolName = input.schoolName ?? "Easyway Language School";
  page.drawText(schoolName, { x: MARGIN, y, size: 20, font: bold, color: rgb(0.05, 0.05, 0.05) });
  y -= 22;
  page.drawText("Payment Receipt", { x: MARGIN, y, size: 13, font: bold, color: ACCENT });
  y -= 30;

  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_SIZE[0] - MARGIN, y },
    thickness: 1,
    color: rgb(0.85, 0.85, 0.85),
  });
  y -= 34;

  const rowHeight = 26;
  row(page, y, "Receipt No.", input.receiptNo, body, bold); y -= rowHeight;
  row(page, y, "Date", input.paidAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }), body, bold); y -= rowHeight;
  row(page, y, "Received from", input.studentName, body, bold); y -= rowHeight;
  if (input.studentCode) { row(page, y, "Student ID", input.studentCode, body, bold); y -= rowHeight; }
  row(page, y, "Payment method", input.method, body, bold); y -= rowHeight;
  row(page, y, "For", input.description, body, bold); y -= rowHeight;
  y -= 10;

  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_SIZE[0] - MARGIN, y },
    thickness: 1,
    color: rgb(0.85, 0.85, 0.85),
  });
  y -= 40;

  const currency = (input.currency ?? "NGN").toUpperCase();
  const amountText = currency === "NGN" ? naira(input.amount) : `${currency} ${input.amount.toLocaleString()}`;
  page.drawText("Amount received", { x: MARGIN, y, size: 11, font: body, color: rgb(0.45, 0.45, 0.45) });
  y -= 26;
  page.drawText(amountText, { x: MARGIN, y, size: 28, font: bold, color: ACCENT });
  y -= 40;

  if (typeof input.balanceAfter === "number") {
    row(page, y, "Balance after this payment", naira(input.balanceAfter), body, bold);
    y -= rowHeight;
  }

  page.drawText(
    "This receipt confirms the payment above was received. It is not a tax invoice.",
    { x: MARGIN, y: 40, size: 9, font: body, color: rgb(0.55, 0.55, 0.55) },
  );

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
