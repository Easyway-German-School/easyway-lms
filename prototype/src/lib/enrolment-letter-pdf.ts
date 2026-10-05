import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  HAIRLINE,
  INK,
  MUTED,
  RED,
  SCHOOL_CONTACT,
  embedBrandArt,
  isEasywayBrand,
  ordinalDate,
  wrapLines,
} from "@/lib/pdf-brand";

/**
 * Proof-of-enrolment letter — the document a student hands to a visa office,
 * an embassy, or an employer to confirm they are a real, currently-enrolled
 * student here. Same `pdf-lib` reasoning as receipt-pdf.ts and
 * transcript-pdf.ts: no browser, no native binary, and a letter is plain text
 * on a page.
 *
 * Laid out after the school's own printed letters: centred letterhead (globe
 * mark + wordmark), serif body, a large faint logo watermark bleeding off the
 * lower right, the red APPROVED stamp and the administrative officer's
 * signature over the sign-off, and the contact line along the foot.
 *
 * Deliberately NOT a legal attestation or a notarised document — it states
 * facts already on file (enrolment date, level, tuition status) in a format
 * an office reading it recognises, and nothing it cannot back up if asked.
 * That is also why there is no line about attendance or progress: nothing on
 * file lets the letter vouch for either.
 */

const PAGE_SIZE: [number, number] = [595.28, 841.89]; // A4
const MARGIN_X = 70;

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
  /**
   * Whether tuition is fully settled. Only a settled account gets a sentence
   * about it — a part-paid student's letter says nothing about the balance,
   * which is the school's business and not a visa office's.
   */
  tuitionSettled: boolean;
  /** e.g. "6 months" — the school's own estimate, when it has one. */
  expectedDuration?: string | null;
  issuedAt?: Date;
  referenceNo: string;
};

/** "Easyway Language School" -> ["EASYWAY", "LANGUAGE SCHOOL"]; any other name -> [NAME, ""]. */
function wordmarkParts(schoolName: string): [string, string] {
  const words = schoolName.trim().toUpperCase().split(/\s+/);
  if (words.length < 2) return [words[0] ?? "", ""];
  return [words[0], words.slice(1).join(" ")];
}

export async function buildEnrolmentLetterPdf(input: EnrolmentLetterInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Proof of Enrolment — ${input.studentName}`);
  doc.setProducer("EasyWay LMS");

  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const art = await embedBrandArt(doc);
  const page = doc.addPage(PAGE_SIZE);
  const [pageW, pageH] = PAGE_SIZE;
  const maxWidth = pageW - MARGIN_X * 2;

  const schoolName = input.schoolName ?? "Easyway Language School";
  const easyway = isEasywayBrand(input.schoolName);

  // Watermark first so everything else prints over it — the printed letters
  // run the globe off the right-hand edge.
  const markSize = 360;
  page.drawImage(art.mark, { x: pageW - markSize * 0.72, y: 96, width: markSize, height: markSize, opacity: 0.1 });

  // ---- Letterhead -------------------------------------------------------
  const [wordTop, wordBottom] = wordmarkParts(schoolName);
  const topSize = 38;
  const bottomSize = wordBottom ? 19 : 0;
  const textW = Math.max(
    serifBold.widthOfTextAtSize(wordTop, topSize),
    wordBottom ? serif.widthOfTextAtSize(wordBottom, bottomSize) : 0,
  );
  const markH = 62;
  const groupW = markH + 14 + textW;
  const groupX = (pageW - groupW) / 2;
  const headTop = pageH - 52;
  page.drawImage(art.mark, { x: groupX, y: headTop - markH, width: markH, height: markH });
  page.drawText(wordTop, { x: groupX + markH + 14, y: headTop - 36, size: topSize, font: serifBold, color: RED });
  if (wordBottom) {
    page.drawText(wordBottom, { x: groupX + markH + 14, y: headTop - 36 - bottomSize - 4, size: bottomSize, font: serif, color: INK });
  }
  const ruleY = headTop - markH - 16;
  page.drawLine({ start: { x: MARGIN_X, y: ruleY }, end: { x: pageW - MARGIN_X, y: ruleY }, thickness: 0.8, color: HAIRLINE });

  // ---- Date, salutation, subject ---------------------------------------
  const issuedAt = input.issuedAt ?? new Date();
  const dateText = ordinalDate(issuedAt);
  let y = ruleY - 46;
  page.drawText(dateText, {
    x: pageW - MARGIN_X - serif.widthOfTextAtSize(dateText, 12),
    y,
    size: 12,
    font: serif,
    color: INK,
  });
  y -= 36;
  page.drawText("TO WHOM IT MAY CONCERN", { x: MARGIN_X, y, size: 12, font: serifBold, color: INK });
  y -= 34;
  page.drawText("Dear Sir/Madam,", { x: MARGIN_X, y, size: 12, font: serifBold, color: INK });
  y -= 36;

  const subject = `PROOF OF ENROLMENT FOR ${input.studentName.toUpperCase()}`;
  const subjectW = serifBold.widthOfTextAtSize(subject, 12);
  page.drawText(subject, { x: (pageW - subjectW) / 2, y, size: 12, font: serifBold, color: INK });
  page.drawLine({
    start: { x: (pageW - subjectW) / 2, y: y - 3 },
    end: { x: (pageW + subjectW) / 2, y: y - 3 },
    thickness: 0.6,
    color: INK,
  });
  y -= 32;

  // ---- Body ------------------------------------------------------------
  const firstName = input.studentName.trim().split(/\s+/)[0] || "The student";
  const enrolledOn = input.enrolledAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const modeLine = input.deliveryMode
    ? ` Instruction is delivered ${input.deliveryMode === "online" ? "fully online" : input.deliveryMode === "hybrid" ? "in a hybrid (campus and online) format" : "on campus"}${input.branchName ? ` at our ${input.branchName} branch` : ""}.`
    : input.branchName
      ? ` ${firstName} attends our ${input.branchName} branch.`
      : "";
  const durationLine = input.expectedDuration
    ? ` The course is expected to run for approximately ${input.expectedDuration}.`
    : "";
  const settledLine = input.tuitionSettled ? " Tuition for this level has been paid in full." : "";

  const paragraphs = [
    `This is to confirm that ${input.studentName}${input.studentCode ? ` (Student ID: ${input.studentCode})` : ""} is currently enrolled as a student at ${schoolName}. ${firstName} is actively undergoing ${input.level} German language training with us on the ${input.pathway} programme, and has been enrolled since ${enrolledOn}.${modeLine}${durationLine}${settledLine}`,
    "This letter is issued at the student's request for whatever purpose it may serve, including visa, immigration, or employment verification.",
    "Should you require any further clarification or verification, please feel free to contact us.",
    "Thank you for your attention.",
  ];

  const leading = 18;
  for (const paragraph of paragraphs) {
    for (const line of wrapLines(paragraph, serif, 12, maxWidth)) {
      page.drawText(line, { x: MARGIN_X, y, size: 12, font: serif, color: INK });
      y -= leading;
    }
    y -= 12;
  }

  // ---- Sign-off --------------------------------------------------------
  y -= 6;
  page.drawText("Yours sincerely,", { x: MARGIN_X, y, size: 12, font: serif, color: INK });
  const signOffY = y;
  y -= 52;

  if (easyway) {
    page.drawText(SCHOOL_CONTACT.signatory, { x: MARGIN_X, y, size: 12, font: serifBold, color: INK });
    page.drawText(SCHOOL_CONTACT.signatoryTitle, { x: MARGIN_X, y: y - 17, size: 12, font: serif, color: INK });
    page.drawText(schoolName, { x: MARGIN_X, y: y - 34, size: 12, font: serif, color: INK });
    page.drawText(SCHOOL_CONTACT.email, { x: MARGIN_X, y: y - 51, size: 12, font: serif, color: INK });
    page.drawText(`W: ${SCHOOL_CONTACT.website}`, { x: MARGIN_X, y: y - 68, size: 12, font: serif, color: INK });

    // The stamp lands over the name and title, the way a real one does; its
    // pen signature then crosses the name. Drawn last so the ink sits on top.
    const stampW = 142;
    const stampH = (art.stamp.height / art.stamp.width) * stampW;
    page.drawImage(art.stamp, {
      x: MARGIN_X - 18,
      y: signOffY - stampH + 22,
      width: stampW,
      height: stampH,
      opacity: 0.92,
    });
  } else {
    // Another tenant's letter must not carry Easyway's stamp or signatory.
    page.drawLine({ start: { x: MARGIN_X, y }, end: { x: MARGIN_X + 200, y }, thickness: 0.8, color: HAIRLINE });
    page.drawText("Admissions Office", { x: MARGIN_X, y: y - 16, size: 12, font: serifBold, color: INK });
    page.drawText(schoolName, { x: MARGIN_X, y: y - 33, size: 12, font: serif, color: INK });
  }

  // ---- Footer ----------------------------------------------------------
  page.drawText(`Reference: ${input.referenceNo}  ·  This letter can be verified by contacting the school directly.`, {
    x: MARGIN_X,
    y: 62,
    size: 7.5,
    font: sans,
    color: MUTED,
  });
  if (easyway) {
    const contact = `${SCHOOL_CONTACT.email} | ${SCHOOL_CONTACT.phoneShort} | ${SCHOOL_CONTACT.addressShort}`;
    const contactW = sansBold.widthOfTextAtSize(contact, 8.5);
    page.drawLine({ start: { x: MARGIN_X, y: 50 }, end: { x: pageW - MARGIN_X, y: 50 }, thickness: 0.6, color: rgb(0.8, 0.8, 0.84) });
    page.drawText(contact, { x: (pageW - contactW) / 2, y: 36, size: 8.5, font: sansBold, color: INK });
  } else if (input.schoolAddress) {
    const addrW = sans.widthOfTextAtSize(input.schoolAddress, 8.5);
    page.drawText(input.schoolAddress, { x: (pageW - addrW) / 2, y: 36, size: 8.5, font: sans, color: INK });
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
