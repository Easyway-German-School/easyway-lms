import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { EASYWAY_LOGO_JPG_BASE64, OSD_LOGO_JPG_BASE64 } from "@/lib/brand-assets";
import { OFFICE } from "@/lib/config";
import { formatAmount } from "@/lib/money";
import type { InvoiceModel } from "@/lib/invoice";

/**
 * Draws the examination invoice to match the school's own template
 * (Invoice Template.pdf): letterhead logos, an orange rule, the two-column
 * candidate/exam table, fee breakdown, payment details beside the payment
 * confirmation block, the important-notes footer, and the two-column address
 * footer. Uses the PDF standard fonts (Times for headings, Helvetica for small
 * print — the template's own pairing) so nothing has to be bundled.
 *
 * Standard fonts only encode WinAnsi, and Nigerian names routinely carry
 * characters outside it (Yoruba ẹ, ọ, ṣ). pdf-lib THROWS on those, which would
 * turn "Adéọlá" into a failed booking email — so every string goes through
 * `pdfSafe` first.
 */

const W = 595.28;
const H = 841.89;
const X0 = 58;
const X1 = W - 45;
const MID = 306;

const ORANGE = rgb(0.96, 0.5, 0.13);
const BLUE = rgb(0.16, 0.29, 0.53);
const GRAY_FILL = rgb(0.937, 0.937, 0.937);
const LINE = rgb(0.78, 0.78, 0.78);
const INK = rgb(0.05, 0.05, 0.05);
const MUTED = rgb(0.4, 0.4, 0.4);
const GREEN = rgb(0.1, 0.5, 0.25);

/** Characters WinAnsi (the standard fonts' encoding) can draw — Latin-1 plus a few punctuation marks. */
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

export function pdfSafe(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    const code = ch.codePointAt(0)!;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(ch)) {
      out += ch;
      continue;
    }
    // ẹ → e, ọ → o, ṣ → s: strip the combining mark, keep the base letter.
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    out += [...base].every((c) => c.codePointAt(0)! >= 0x20 && c.codePointAt(0)! <= 0xff) ? base : "?";
  }
  return out;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of pdfSafe(text).split(/\s+/)) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth || !current) current = next;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines;
}

/** Largest size (down to a floor) at which `text` fits `maxWidth` — a long name must shrink, never spill out of its cell. */
function fitSize(text: string, font: PDFFont, size: number, maxWidth: number, min = 6): number {
  let s = size;
  while (s > min && font.widthOfTextAtSize(pdfSafe(text), s) > maxWidth) s -= 0.25;
  return s;
}

export async function renderInvoicePdf(model: InvoiceModel): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Examination Invoice ${model.invoiceNumber}`);
  pdf.setAuthor("Easyway German Language School");
  pdf.setSubject(model.paid ? "Payment receipt" : "Examination invoice");
  const page = pdf.addPage([W, H]);

  const times = await pdf.embedFont(StandardFonts.TimesRoman);
  const timesBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const timesBoldItalic = await pdf.embedFont(StandardFonts.TimesRomanBoldItalic);
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // `top` is measured down from the top edge, the way the template is laid out on screen.
  const yAt = (top: number) => H - top;
  const text = (s: string, x: number, top: number, font: PDFFont, size: number, color = INK) =>
    page.drawText(pdfSafe(s), { x, y: yAt(top), font, size, color });
  const textRight = (s: string, xRight: number, top: number, font: PDFFont, size: number, color = INK) => {
    const safe = pdfSafe(s);
    page.drawText(safe, { x: xRight - font.widthOfTextAtSize(safe, size), y: yAt(top), font, size, color });
  };
  const rect = (x: number, top: number, w: number, h: number, fill?: ReturnType<typeof rgb>) =>
    page.drawRectangle({ x, y: yAt(top + h), width: w, height: h, color: fill, borderColor: LINE, borderWidth: 0.5 });

  // --- letterhead ---
  const eyLogo = await pdf.embedJpg(Buffer.from(EASYWAY_LOGO_JPG_BASE64, "base64"));
  const osdLogo = await pdf.embedJpg(Buffer.from(OSD_LOGO_JPG_BASE64, "base64"));
  page.drawImage(eyLogo, { x: X0, y: yAt(32 + 42), width: 146, height: 42 });
  page.drawImage(osdLogo, { x: X1 - 80, y: yAt(30 + 55), width: 80, height: 55 });

  text("EXAMINATION INVOICE", X0, 105, timesBold, 16);
  page.drawLine({ start: { x: X0, y: yAt(111) }, end: { x: X1, y: yAt(111) }, thickness: 1.4, color: ORANGE });

  // --- status / date / invoice no ---
  text("Payment Status: ", X0, 124, helv, 8, MUTED);
  text(model.paid ? "PAID" : "PENDING", X0 + helv.widthOfTextAtSize("Payment Status: ", 8), 124, helvBold, 8, model.paid ? GREEN : MUTED);
  textRight(model.issuedOn, X1, 124, helv, 8, MUTED);
  textRight(`INVOICE NO. ${model.invoiceNumber}`, X1, 137, helvBold, 9, ORANGE);

  // --- candidate | examination ---
  let top = 150;
  const headerH = 24;
  rect(X0, top, MID - X0, headerH);
  rect(MID, top, X1 - MID, headerH);
  text("CANDIDATE INFORMATION", X0 + 8, top + 16, timesBold, 11, BLUE);
  text("EXAMINATION INFORMATION", MID + 8, top + 16, timesBold, 11, BLUE);
  top += headerH;
  const rowH = 41;
  const rows = Math.max(model.candidate.length, model.exam.length);
  for (let i = 0; i < rows; i++) {
    const fill = i % 2 === 0 ? GRAY_FILL : undefined;
    rect(X0, top, MID - X0, rowH, fill);
    rect(MID, top, X1 - MID, rowH, fill);
    const l = model.candidate[i];
    const r = model.exam[i];
    const cellW = MID - X0 - 16;
    if (l) { text(l.label, X0 + 8, top + 17, timesBold, 10.5); text(l.value, X0 + 8, top + 30, times, fitSize(l.value, times, 10, cellW)); }
    if (r) { text(r.label, MID + 8, top + 17, timesBold, 10.5); text(r.value, MID + 8, top + 30, times, fitSize(r.value, times, 10, cellW)); }
    top += rowH;
  }

  // --- fee breakdown ---
  top += 16;
  const feeRowH = 17;
  rect(X0, top, MID - X0, feeRowH);
  rect(MID, top, X1 - MID, feeRowH);
  text("FEE BREAKDOWN", X0 + 8, top + 12, timesBold, 11, BLUE);
  top += feeRowH;
  for (const line of model.feeLines) {
    rect(X0, top, MID - X0, feeRowH, GRAY_FILL);
    rect(MID, top, X1 - MID, feeRowH, GRAY_FILL);
    text(line.label, X0 + 8, top + 12, timesBold, 10.5);
    textRight(formatAmount(line.amount), X1 - 6, top + 12, times, 10.5);
    top += feeRowH;
  }
  rect(X0, top, MID - X0, feeRowH);
  rect(MID, top, X1 - MID, feeRowH);
  text("Total amount due", X0 + 8, top + 12, times, 10.5);
  textRight(formatAmount(model.total), X1 - 6, top + 12, timesBold, 10.5);
  top += feeRowH + 13;
  text("Amount due in words:", X0 + 2, top, timesBoldItalic, 11, ORANGE);
  text(model.totalInWords, X0 + 128, top, timesBoldItalic, 11, ORANGE);

  // --- payment details | payment confirmation ---
  top += 18;
  const payRowH = 15;
  rect(X0, top, MID - X0, payRowH);
  rect(MID, top, X1 - MID, payRowH);
  text("PAYMENT DETAILS", X0 + 8, top + 11, timesBold, 11, BLUE);
  text("PAYMENT CONFIRMATION", MID + 8, top + 11, timesBold, 11, BLUE);
  top += payRowH;
  for (let i = 0; i < 4; i++) {
    const fill = i % 2 === 0 ? GRAY_FILL : undefined;
    rect(X0, top, MID - X0, payRowH, fill);
    rect(MID, top, X1 - MID, payRowH, fill);
    const d = model.paymentDetails[i];
    const c = model.paymentConfirmation[i];
    if (d) {
      text(d.label, X0 + 8, top + 11, timesBold, 10);
      // The bank narration can be long ("ADEBAYO-OKONKWO EW-OSD-INV-2026-XXXXX"); shrink to fit the cell.
      text(d.value, X0 + 88, top + 11, timesBold, fitSize(d.value, timesBold, 10, MID - X0 - 96));
    }
    if (c) {
      text(c.label, MID + 8, top + 11, times, 10);
      text(c.value, MID + 132, top + 11, timesBold, fitSize(c.value, timesBold, 10, X1 - MID - 138), model.paid ? GREEN : INK);
    }
    top += payRowH;
  }

  // --- important notes ---
  top += 26;
  text("IMPORTANT NOTES", X0, top, helvBold, 7);
  top += 10;
  for (const note of model.notes) {
    const lines = wrap(note, helv, 7, X1 - X0 - 12);
    lines.forEach((ln, i) => {
      if (i === 0) text("•", X0 + 2, top, helv, 7);
      text(ln, X0 + 12, top, helv, 7);
      top += 9;
    });
  }

  // --- footer ---
  const footTop = H - 62;
  text(OFFICE.schoolName, X0, footTop, helv, 7.5, ORANGE);
  text(OFFICE.addressLine, X0, footTop + 9, helv, 7.5, INK);
  text(`${OFFICE.email} • ${OFFICE.phone}`, X0, footTop + 18, helv, 7.5, rgb(0.1, 0.3, 0.75));
  text(OFFICE.centreName, 392, footTop, helvBold, 7.5, rgb(0.1, 0.45, 0.8));
  text("Official examination services in Lagos", 392, footTop + 9, helv, 7.5, MUTED);
  text(OFFICE.website, 392, footTop + 18, helv, 7.5, rgb(0.1, 0.3, 0.75));

  return pdf.save();
}

export type { PDFPage };
