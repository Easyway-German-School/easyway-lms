import { PDFDocument, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { HAIRLINE, INK, MUTED, RED, embedBrandArt, isEasywayBrand, ordinalDate, wrapLines } from "@/lib/pdf-brand";
import { TERMS_PREAMBLE, TERMS_SECTIONS, type TermsSection } from "@/lib/terms-content";

/**
 * The student's own downloadable copy of the Terms and Conditions (which
 * includes the Refund Policy, sections 23–26) — what "Download your legal
 * documents" on /terms and the refund wall hand back.
 *
 * Carries the student's photo and acceptance record so the PDF is personal
 * proof of what THIS student agreed to and when, not just a copy of the
 * public policy page. Same `pdf-lib` reasoning as receipt-pdf.ts and
 * transcript-pdf.ts: no browser, no native binary, and this is plain text on
 * a page. The multi-page flow (newPage/ensureSpace) is transcript-pdf.ts's.
 */

const PAGE_SIZE: [number, number] = [595.28, 841.89]; // A4
const MARGIN = 56;

type Writer = {
  doc: PDFDocument;
  page: PDFPage;
  serif: PDFFont;
  serifBold: PDFFont;
  sans: PDFFont;
  y: number;
};

function newPage(w: Writer): void {
  w.page = w.doc.addPage(PAGE_SIZE);
  w.y = PAGE_SIZE[1] - MARGIN;
}

function ensureSpace(w: Writer, needed: number): void {
  if (w.y - needed < MARGIN) newPage(w);
}

function paragraph(w: Writer, text: string, opts: { size?: number; italic?: boolean } = {}): void {
  const size = opts.size ?? 10.5;
  const maxWidth = PAGE_SIZE[0] - MARGIN * 2;
  const lines = wrapLines(text, w.serif, size, maxWidth);
  for (const line of lines) {
    ensureSpace(w, size * 1.45);
    w.page.drawText(line, { x: MARGIN, y: w.y, size, font: w.serif, color: MUTED });
    w.y -= size * 1.45;
  }
}

function sectionBlock(w: Writer, section: TermsSection): void {
  ensureSpace(w, 32);
  w.y -= 6;
  w.page.drawText(`${section.number}. ${section.title}`, { x: MARGIN, y: w.y, size: 11.5, font: w.serifBold, color: INK });
  w.y -= 17;

  const maxWidth = PAGE_SIZE[0] - MARGIN * 2 - 14;
  for (const block of section.blocks) {
    const lines = wrapLines(block.text, w.serif, 10, maxWidth);
    lines.forEach((line, index) => {
      ensureSpace(w, 14.5);
      const indent = block.kind === "bullet" ? 14 : 0;
      const prefix = block.kind === "bullet" && index === 0 ? "•  " : "";
      w.page.drawText(`${prefix}${line}`, { x: MARGIN + indent, y: w.y, size: 10, font: w.serif, color: MUTED });
      w.y -= 14.5;
    });
  }
  w.y -= 8;
}

export type TermsAcceptanceInfo =
  | { accepted: true; version: string; versionLabel?: string; acceptedAt: Date; context: string }
  | { accepted: false; fallbackNotice: string };

export type TermsCertificatePhoto = { bytes: Buffer; kind: "jpg" | "png" };

export type TermsCertificateInput = {
  schoolName?: string | null;
  studentName: string;
  studentCode?: string | null;
  level?: string | null;
  pathway?: string | null;
  photo?: TermsCertificatePhoto | null;
  acceptance: TermsAcceptanceInfo;
  currentVersionLabel: string;
  issuedAt?: Date;
};

/** "signup" -> "at signup", "refund" -> "on a refund request", "reprompt" -> "in the portal". */
function contextPhrase(context: string): string {
  if (context === "refund") return "on a refund request";
  if (context === "reprompt") return "in the portal";
  return "at signup";
}

export async function buildTermsCertificatePdf(input: TermsCertificateInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Terms and Conditions — ${input.studentName}`);
  doc.setProducer("EasyWay LMS");

  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const art = await embedBrandArt(doc);
  const easyway = isEasywayBrand(input.schoolName);
  const schoolName = input.schoolName ?? "Easyway German Language School";

  const w: Writer = { doc, page: doc.addPage(PAGE_SIZE), serif, serifBold, sans, y: 0 };
  w.y = PAGE_SIZE[1] - MARGIN;
  const pageW = PAGE_SIZE[0];

  // ---- Letterhead ---------------------------------------------------------
  const markH = 40;
  w.page.drawImage(art.mark, { x: MARGIN, y: w.y - markH, width: markH, height: markH });
  w.page.drawText(easyway ? "EASYWAY" : schoolName.toUpperCase(), {
    x: MARGIN + markH + 12,
    y: w.y - 24,
    size: 20,
    font: serifBold,
    color: RED,
  });
  if (easyway) {
    w.page.drawText("GERMAN LANGUAGE SCHOOL", { x: MARGIN + markH + 12, y: w.y - 38, size: 9.5, font: serif, color: INK });
  }
  w.y -= markH + 14;
  w.page.drawLine({ start: { x: MARGIN, y: w.y }, end: { x: pageW - MARGIN, y: w.y }, thickness: 0.8, color: HAIRLINE });
  w.y -= 24;

  // ---- Student photo box, top right of the title block --------------------
  const boxSize = 84;
  const boxX = pageW - MARGIN - boxSize;
  const boxY = w.y - boxSize + 18;
  // A photo that isn't actually a decodable JPEG/PNG (a stored WebP, or a
  // truncated fetch) must not take the whole document down with it — the
  // student still needs their Terms and Refund Policy.
  let photoImage: PDFImage | null = null;
  if (input.photo) {
    try {
      photoImage = input.photo.kind === "png" ? await doc.embedPng(input.photo.bytes) : await doc.embedJpg(input.photo.bytes);
    } catch {
      photoImage = null;
    }
  }
  if (photoImage) {
    w.page.drawImage(photoImage, { x: boxX, y: boxY, width: boxSize, height: boxSize });
  } else {
    w.page.drawText("No photo", { x: boxX + 14, y: boxY + boxSize / 2, size: 8, font: sans, color: MUTED });
  }
  w.page.drawRectangle({ x: boxX, y: boxY, width: boxSize, height: boxSize, borderColor: HAIRLINE, borderWidth: 1 });

  // ---- Title + student info (left of the photo box) ------------------------
  const titleMaxWidth = boxX - MARGIN - 18;
  w.page.drawText("TERMS AND CONDITIONS", { x: MARGIN, y: w.y, size: 15, font: serifBold, color: INK });
  w.y -= 19;
  w.page.drawText("including the Refund Policy — sections 23–26", { x: MARGIN, y: w.y, size: 9.5, font: serif, color: MUTED });
  w.y -= 22;

  const infoLines = [
    input.studentName,
    [input.studentCode, input.level, input.pathway].filter(Boolean).join("  ·  "),
  ].filter(Boolean) as string[];
  for (const line of infoLines) {
    for (const wrapped of wrapLines(line, serifBold, 11, titleMaxWidth)) {
      w.page.drawText(wrapped, { x: MARGIN, y: w.y, size: 11, font: serifBold, color: INK });
      w.y -= 15;
    }
  }
  w.y = Math.min(w.y, boxY) - 18;

  // ---- Acceptance record ----------------------------------------------------
  const acceptanceText = input.acceptance.accepted
    ? `This student accepted version ${input.acceptance.version}${input.acceptance.versionLabel ? ` (${input.acceptance.versionLabel})` : ""} of these Terms and Conditions ${contextPhrase(input.acceptance.context)} on ${ordinalDate(input.acceptance.acceptedAt)}.`
    : input.acceptance.fallbackNotice;
  paragraph(w, acceptanceText, { size: 9.5 });
  w.y -= 6;
  w.page.drawLine({ start: { x: MARGIN, y: w.y }, end: { x: pageW - MARGIN, y: w.y }, thickness: 0.6, color: HAIRLINE });
  w.y -= 20;

  // ---- Preamble + full document ---------------------------------------------
  paragraph(w, TERMS_PREAMBLE, { size: 10.5 });
  w.y -= 10;

  for (const section of TERMS_SECTIONS) sectionBlock(w, section);

  // ---- Footer on every page --------------------------------------------------
  const pageCount = doc.getPageCount();
  const issuedAt = input.issuedAt ?? new Date();
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.getPage(i);
    page.drawText(
      `Page ${i + 1} of ${pageCount}  ·  Downloaded ${ordinalDate(issuedAt)}  ·  Current version ${input.currentVersionLabel}`,
      { x: MARGIN, y: 28, size: 7.5, font: sans, color: MUTED },
    );
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
