import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import {
  GREEN,
  HAIRLINE,
  INK,
  MUTED,
  NAVY,
  ORANGE,
  SCHOOL_CONTACT,
  amountInWords,
  drawMoney,
  embedBrandArt,
  isEasywayBrand,
  moneyWidth,
  roundedRect,
  wrapLines,
} from "@/lib/pdf-brand";

/**
 * A payment receipt — one page, laid out by hand, same reasoning as
 * src/lib/transcript-pdf.ts: `pdf-lib` needs no browser to boot on a
 * serverless function and no native binary to fit under Vercel's bundle
 * limit.
 *
 * Styled after the school's printed receipt book (navy letterhead with the
 * logo, an orange OFFICIAL RECEIPT tab, the amount written out in words, a
 * boxed figure, a signature, a navy "For: <school>" bar) but dressed as a
 * proper e-invoice: a line-item table, a totals block, a PAID mark.
 *
 * Deliberately NOT a tax invoice or a legal instrument — it is proof a
 * specific payment was received, for a parent or student's own records.
 */

const PAGE_SIZE: [number, number] = [595.28, 841.89]; // A4
const MARGIN = 42;

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

/** "paystack" -> "Paystack", "bank_transfer" -> "Bank transfer". */
function methodLabel(method: string): string {
  const spaced = method.replace(/[_-]+/g, " ").trim();
  return spaced ? `${spaced.charAt(0).toUpperCase()}${spaced.slice(1).toLowerCase()}` : "—";
}

export async function buildReceiptPdf(input: ReceiptPdfInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Receipt ${input.receiptNo}`);
  doc.setProducer("EasyWay LMS");

  const body = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);
  const art = await embedBrandArt(doc);
  const page = doc.addPage(PAGE_SIZE);
  const [pageW, pageH] = PAGE_SIZE;
  const right = pageW - MARGIN;
  const contentW = pageW - MARGIN * 2;

  const schoolName = input.schoolName ?? "Easyway Language School";
  const easyway = isEasywayBrand(input.schoolName);
  const currency = (input.currency ?? "NGN").toUpperCase();
  const hasBalance = typeof input.balanceAfter === "number";
  const settled = hasBalance && (input.balanceAfter as number) <= 0;
  const partial = hasBalance && !settled;

  // Faint watermark behind everything, centred low like a security print.
  const wm = 330;
  page.drawImage(art.mark, { x: (pageW - wm) / 2, y: 190, width: wm, height: wm, opacity: 0.05 });

  // ---- Letterhead ------------------------------------------------------
  const headTop = pageH - 40;
  const markSize = 64;
  page.drawImage(art.mark, { x: MARGIN, y: headTop - markSize, width: markSize, height: markSize });
  const tx = MARGIN + markSize + 16;
  page.drawText(schoolName.toUpperCase(), { x: tx, y: headTop - 24, size: 22, font: bold, color: NAVY });
  if (easyway) {
    page.drawText(SCHOOL_CONTACT.address, { x: tx, y: headTop - 40, size: 9, font: body, color: INK });
    page.drawText(`Website: ${SCHOOL_CONTACT.website}  ·  Email: ${SCHOOL_CONTACT.email}`, {
      x: tx, y: headTop - 53, size: 9, font: body, color: INK,
    });
    page.drawText(`Tel: ${SCHOOL_CONTACT.phones}`, { x: tx, y: headTop - 66, size: 9, font: bold, color: ORANGE });
  }
  let y = headTop - markSize - 14;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 2.2, color: NAVY });
  page.drawLine({ start: { x: MARGIN, y: y - 4 }, end: { x: right, y: y - 4 }, thickness: 0.6, color: ORANGE });

  // ---- Title tab + receipt number ---------------------------------------
  y -= 46;
  roundedRect(page, MARGIN, y - 6, 232, 34, 17, { fill: ORANGE });
  page.drawText("OFFICIAL RECEIPT", { x: MARGIN + 24, y: y + 4, size: 15, font: bold, color: rgb(1, 1, 1) });

  const noLabel = "No.";
  const noSize = 20;
  const noW = bold.widthOfTextAtSize(input.receiptNo, noSize);
  page.drawText(input.receiptNo, { x: right - noW, y: y + 2, size: noSize, font: bold, color: NAVY });
  page.drawText(noLabel, { x: right - noW - 8 - body.widthOfTextAtSize(noLabel, 11), y: y + 3, size: 11, font: body, color: MUTED });
  const dateText = input.paidAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const dateLabel = `Date: ${dateText}`;
  page.drawText(dateLabel, { x: right - bold.widthOfTextAtSize(dateLabel, 10.5), y: y - 18, size: 10.5, font: bold, color: INK });

  // ---- Received from card ----------------------------------------------
  y -= 34;
  const cardH = 76;
  const cardTop = y;
  roundedRect(page, MARGIN, cardTop - cardH, contentW, cardH, 8, { fill: rgb(0.965, 0.972, 0.99), border: HAIRLINE, borderWidth: 0.8 });
  const colX = [MARGIN + 18, MARGIN + 18 + contentW * 0.5];
  const cell = (cx: number, cy: number, label: string, value: string) => {
    page.drawText(label.toUpperCase(), { x: cx, y: cy, size: 7.5, font: bold, color: MUTED });
    // Shrink-to-fit so a long name never runs into the next column.
    const maxW = contentW * 0.5 - 30;
    let size = 12;
    while (size > 8 && bold.widthOfTextAtSize(value, size) > maxW) size -= 0.5;
    page.drawText(value, { x: cx, y: cy - 15, size, font: bold, color: INK });
  };
  cell(colX[0], cardTop - 20, "Received from", input.studentName);
  cell(colX[1], cardTop - 20, "Student ID", input.studentCode || "—");
  cell(colX[0], cardTop - 52, "Payment method", methodLabel(input.method));
  cell(colX[1], cardTop - 52, "Status", settled ? "Paid in full" : partial ? "Part payment" : "Payment received");
  y = cardTop - cardH - 28;

  // ---- Line-item table ---------------------------------------------------
  const amountColRight = right - 14;
  const methodColX = MARGIN + contentW * 0.56;
  page.drawRectangle({ x: MARGIN, y: y - 8, width: contentW, height: 26, color: NAVY });
  page.drawText("DESCRIPTION", { x: MARGIN + 14, y: y, size: 8.5, font: bold, color: rgb(1, 1, 1) });
  page.drawText("METHOD", { x: methodColX, y: y, size: 8.5, font: bold, color: rgb(1, 1, 1) });
  const amtHead = `AMOUNT (${currency})`;
  page.drawText(amtHead, { x: amountColRight - bold.widthOfTextAtSize(amtHead, 8.5), y: y, size: 8.5, font: bold, color: rgb(1, 1, 1) });

  y -= 30;
  const descLines = wrapLines(input.description, bold, 11.5, methodColX - MARGIN - 28);
  const rowH = Math.max(34, descLines.length * 15 + 16);
  descLines.forEach((line, i) => page.drawText(line, { x: MARGIN + 14, y: y - i * 15, size: 11.5, font: bold, color: INK }));
  page.drawText(methodLabel(input.method), { x: methodColX, y, size: 11, font: body, color: INK });
  const amtW = moneyWidth(input.amount, currency, bold, 11.5);
  drawMoney(page, amountColRight - amtW, y, input.amount, currency, bold, 11.5, INK);
  y -= rowH - 12;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 0.8, color: HAIRLINE });

  // ---- The sum of (in words), the way the paper receipt writes it --------
  y -= 30;
  page.drawText("THE SUM OF", { x: MARGIN, y: y + 12, size: 7.5, font: bold, color: MUTED });
  const words = amountInWords(input.amount, currency);
  const wordLines = wrapLines(words, oblique, 12, contentW * 0.56);
  wordLines.forEach((line, i) => {
    page.drawText(line, { x: MARGIN, y: y - i * 16, size: 12, font: oblique, color: INK });
    page.drawLine({
      start: { x: MARGIN, y: y - i * 16 - 4 }, end: { x: MARGIN + contentW * 0.58, y: y - i * 16 - 4 },
      thickness: 0.6, color: MUTED, dashArray: [1.2, 2.2],
    });
  });

  // ---- Totals block (right) ---------------------------------------------
  const boxW = 218;
  const boxX = right - boxW;
  const boxTop = y + 22;
  const boxH = hasBalance ? 108 : 70;
  roundedRect(page, boxX, boxTop - boxH, boxW, boxH, 8, { fill: rgb(1, 1, 1), border: ORANGE, borderWidth: 1.6 });
  page.drawText("AMOUNT RECEIVED", { x: boxX + 16, y: boxTop - 20, size: 7.5, font: bold, color: MUTED });
  const bigW = moneyWidth(input.amount, currency, bold, 22);
  drawMoney(page, boxX + boxW - 16 - bigW, boxTop - 46, input.amount, currency, bold, 22, ORANGE);
  if (hasBalance) {
    page.drawLine({ start: { x: boxX + 16, y: boxTop - 62 }, end: { x: boxX + boxW - 16, y: boxTop - 62 }, thickness: 0.6, color: HAIRLINE });
    page.drawText(settled ? "BALANCE" : "BALANCE REMAINING", { x: boxX + 16, y: boxTop - 80, size: 7.5, font: bold, color: MUTED });
    const bal = input.balanceAfter as number;
    const balW = moneyWidth(bal, currency, bold, 13);
    drawMoney(page, boxX + boxW - 16 - balW, boxTop - 84, bal, currency, bold, 13, settled ? GREEN : NAVY);
    if (settled) {
      page.drawText("Fully paid — thank you", { x: boxX + 16, y: boxTop - 99, size: 8.5, font: oblique, color: GREEN });
    }
  }

  // ---- PAID / PART PAYMENT mark ------------------------------------------
  const markText = settled ? "PAID" : partial ? "PART PAYMENT" : "RECEIVED";
  const markColor = settled ? GREEN : ORANGE;
  const markSizePt = partial ? 18 : 26;
  const markW = bold.widthOfTextAtSize(markText, markSizePt) + 28;
  const markCx = MARGIN + contentW * 0.27;
  const markCy = boxTop - boxH - 4;
  page.drawSvgPath(
    `M 0 0 H ${markW} V 44 H 0 Z`,
    { x: markCx - markW / 2, y: markCy + 22, borderColor: markColor, borderWidth: 2.4, opacity: 0.55, borderOpacity: 0.55, rotate: degrees(-9) },
  );
  page.drawText(markText, {
    x: markCx - markW / 2 + 14, y: markCy - 4 + (partial ? 4 : 0), size: markSizePt, font: bold, color: markColor, opacity: 0.55, rotate: degrees(-9),
  });

  // ---- Signature -----------------------------------------------------------
  const sigTop = 322;
  if (easyway) {
    const stampW = 132;
    const stampH = (art.stamp.height / art.stamp.width) * stampW;
    page.drawImage(art.stamp, { x: MARGIN - 6, y: sigTop - stampH + 8, width: stampW, height: stampH, opacity: 0.92 });
  }
  page.drawLine({ start: { x: MARGIN, y: 214 }, end: { x: MARGIN + 190, y: 214 }, thickness: 0.8, color: MUTED });
  page.drawText(easyway ? `${SCHOOL_CONTACT.signatory} — ${SCHOOL_CONTACT.signatoryTitle}` : "Authorised signature", {
    x: MARGIN, y: 201, size: 8.5, font: body, color: MUTED,
  });
  page.drawText("Thanks for your patronage", { x: right - bold.widthOfTextAtSize("Thanks for your patronage", 11), y: 214, size: 11, font: bold, color: NAVY });

  // ---- "For:" bar + fine print ---------------------------------------------
  const barW = 292;
  page.drawRectangle({ x: right - barW, y: 160, width: barW, height: 26, color: NAVY });
  const forText = `For: ${schoolName}`;
  page.drawText(forText, { x: right - barW + 14, y: 169, size: 11.5, font: bold, color: rgb(1, 1, 1) });
  page.drawText("This receipt confirms the payment above was received. It is not a tax invoice.", {
    x: MARGIN, y: 44, size: 8, font: body, color: MUTED,
  });
  page.drawLine({ start: { x: MARGIN, y: 34 }, end: { x: right, y: 34 }, thickness: 0.6, color: ORANGE });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
