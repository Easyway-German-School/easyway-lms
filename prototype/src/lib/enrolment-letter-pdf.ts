import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Proof-of-enrolment letter — the document a student hands to a visa office,
 * an embassy, or an employer to confirm they are a real, currently-enrolled
 * student here. Same `pdf-lib` reasoning as receipt-pdf.ts and
 * transcript-pdf.ts: no browser, no native binary, and a letter is plain text
 * on a page.
 *
 * Deliberately NOT a legal attestation or a notarised document — it states
 * facts already on file (enrolment date, level, tuition status) in a format
 * an office reading it recognises, and nothing it cannot back up if asked.
 */

const PAGE_SIZE: [number, number] = [595.28, 841.89]; // A4
const MARGIN = 64;
const ACCENT = rgb(1, 0.4, 0); // #FF6600

function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export type EnrolmentLetterInput = {
  schoolName?: string;
  schoolAddress?: string | null;
  studentName: string;
  studentCode?: string | null;
  level: string;
  pathway: string;
  branchName?: string | null;
  deliveryMode?: string | null;
  enrolledAt: Date;
  /** Whether tuition is fully settled — the letter states this plainly rather than a figure, which dates fast. */
  tuitionSettled: boolean;
  /** e.g. "6 months" — the school's own estimate, when it has one. */
  expectedDuration?: string | null;
  issuedAt?: Date;
  referenceNo: string;
};

export async function buildEnrolmentLetterPdf(input: EnrolmentLetterInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Proof of Enrolment — ${input.studentName}`);
  doc.setProducer("EasyWay LMS");

  const body = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page: PDFPage = doc.addPage(PAGE_SIZE);
  const maxWidth = PAGE_SIZE[0] - MARGIN * 2;
  let y = PAGE_SIZE[1] - MARGIN;

  const schoolName = input.schoolName ?? "Easyway Language School";
  page.drawText(schoolName, { x: MARGIN, y, size: 18, font: bold, color: rgb(0.05, 0.05, 0.05) });
  y -= 20;
  if (input.schoolAddress) {
    page.drawText(input.schoolAddress, { x: MARGIN, y, size: 10, font: body, color: rgb(0.45, 0.45, 0.45) });
    y -= 16;
  }
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_SIZE[0] - MARGIN, y }, thickness: 1, color: rgb(0.85, 0.85, 0.85) });
  y -= 30;

  const issuedAt = input.issuedAt ?? new Date();
  page.drawText(
    issuedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    { x: PAGE_SIZE[0] - MARGIN - 130, y: PAGE_SIZE[1] - MARGIN, size: 10, font: body, color: rgb(0.45, 0.45, 0.45) },
  );

  page.drawText("TO WHOM IT MAY CONCERN", { x: MARGIN, y, size: 13, font: bold, color: ACCENT });
  y -= 30;

  const durationLine = input.expectedDuration
    ? ` The course is expected to run for approximately ${input.expectedDuration}.`
    : "";
  const modeLine = input.deliveryMode
    ? ` Instruction is delivered ${input.deliveryMode === "online" ? "fully online" : input.deliveryMode === "hybrid" ? "in a hybrid (campus and online) format" : "on campus"}${input.branchName ? ` at our ${input.branchName} branch` : ""}.`
    : input.branchName
      ? ` The student attends our ${input.branchName} branch.`
      : "";

  const paragraph = `This letter confirms that ${input.studentName}${
    input.studentCode ? ` (Student ID: ${input.studentCode})` : ""
  } is a currently enrolled student at ${schoolName}, registered on the ${input.pathway} programme at level ${
    input.level
  }, since ${input.enrolledAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.${modeLine}${durationLine}`;

  for (const line of wrapLines(paragraph, body, 11, maxWidth)) {
    page.drawText(line, { x: MARGIN, y, size: 11, font: body, color: rgb(0.1, 0.1, 0.1) });
    y -= 17;
  }
  y -= 12;

  const tuitionParagraph = input.tuitionSettled
    ? "The student's tuition for this level is fully settled as of the date of this letter."
    : "The student is enrolled and attending classes; their tuition account carries an outstanding balance as of the date of this letter, in line with our standard payment terms.";
  for (const line of wrapLines(tuitionParagraph, body, 11, maxWidth)) {
    page.drawText(line, { x: MARGIN, y, size: 11, font: body, color: rgb(0.1, 0.1, 0.1) });
    y -= 17;
  }
  y -= 12;

  const closing = "This letter is issued at the student's request for whatever purpose it may serve, including visa, immigration, or employment verification.";
  for (const line of wrapLines(closing, body, 11, maxWidth)) {
    page.drawText(line, { x: MARGIN, y, size: 11, font: body, color: rgb(0.1, 0.1, 0.1) });
    y -= 17;
  }
  y -= 50;

  page.drawText("Yours faithfully,", { x: MARGIN, y, size: 11, font: body, color: rgb(0.1, 0.1, 0.1) });
  y -= 40;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + 200, y }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
  y -= 14;
  page.drawText("Admissions Office", { x: MARGIN, y, size: 10, font: body, color: rgb(0.45, 0.45, 0.45) });
  page.drawText(schoolName, { x: MARGIN, y: y - 14, size: 10, font: body, color: rgb(0.45, 0.45, 0.45) });

  page.drawText(`Reference: ${input.referenceNo}`, { x: MARGIN, y: 40, size: 8, font: body, color: rgb(0.6, 0.6, 0.6) });
  page.drawText("This letter can be verified by contacting the school directly.", {
    x: MARGIN,
    y: 28,
    size: 8,
    font: body,
    color: rgb(0.6, 0.6, 0.6),
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
