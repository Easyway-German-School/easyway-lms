import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ClassNotes } from "@/lib/class-transcription";

/**
 * "Export as PDF" — the one Happy Scribe feature that has nothing to do with
 * AI. `pdf-lib` rather than a headless-Chrome render: no browser to boot on a
 * serverless function, no native binary to fit under Vercel's bundle limit,
 * and a class recap is plain text laid out on a page, not a design that
 * needs a real layout engine.
 *
 * Standard 14 fonts use WinAnsi encoding, which covers ä/ö/ü/ß directly — no
 * embedded font needed for German vocabulary.
 */

const PAGE_SIZE: [number, number] = [595.28, 841.89]; // A4
const MARGIN = 56;
const ACCENT = rgb(1, 0.4, 0); // #FF6600

type Writer = {
  doc: PDFDocument;
  page: PDFPage;
  body: PDFFont;
  bold: PDFFont;
  y: number;
};

function newPage(w: Writer): void {
  w.page = w.doc.addPage(PAGE_SIZE);
  w.y = PAGE_SIZE[1] - MARGIN;
}

function ensureSpace(w: Writer, needed: number): void {
  if (w.y - needed < MARGIN) newPage(w);
}

/** Greedy word wrap against the font's own metrics — no fixed char-count guess. */
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

function paragraph(w: Writer, text: string, opts: { size?: number; bold?: boolean; gapAfter?: number; color?: ReturnType<typeof rgb> } = {}): void {
  const size = opts.size ?? 11;
  const font = opts.bold ? w.bold : w.body;
  const maxWidth = PAGE_SIZE[0] - MARGIN * 2;
  const lines = wrapLines(text, font, size, maxWidth);
  const lineHeight = size * 1.4;
  for (const line of lines) {
    ensureSpace(w, lineHeight);
    w.page.drawText(line, { x: MARGIN, y: w.y, size, font, color: opts.color ?? rgb(0.1, 0.1, 0.1) });
    w.y -= lineHeight;
  }
  w.y -= opts.gapAfter ?? 6;
}

function heading(w: Writer, text: string): void {
  ensureSpace(w, 34);
  w.y -= 6;
  w.page.drawText(text, { x: MARGIN, y: w.y, size: 15, font: w.bold, color: ACCENT });
  w.y -= 22;
}

function bulletList(w: Writer, items: string[]): void {
  const size = 11;
  const maxWidth = PAGE_SIZE[0] - MARGIN * 2 - 16;
  for (const item of items) {
    const lines = wrapLines(item, w.body, size, maxWidth);
    lines.forEach((line, index) => {
      ensureSpace(w, size * 1.4);
      w.page.drawText(index === 0 ? `•  ${line}` : `    ${line}`, {
        x: MARGIN,
        y: w.y,
        size,
        font: w.body,
        color: rgb(0.15, 0.15, 0.15),
      });
      w.y -= size * 1.4;
    });
  }
  w.y -= 8;
}

export type TranscriptPdfInput = {
  title: string;
  level: string | null;
  recordedAt: Date | null;
  notes: ClassNotes | null;
  transcriptText: string | null;
};

export async function buildTranscriptPdf(input: TranscriptPdfInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${input.title} — Class notes`);
  doc.setProducer("EasyWay LMS");

  const body = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w: Writer = { doc, page: doc.addPage(PAGE_SIZE), body, bold, y: 0 };
  w.y = PAGE_SIZE[1] - MARGIN;

  w.page.drawText(input.title, { x: MARGIN, y: w.y, size: 20, font: bold, color: rgb(0.05, 0.05, 0.05) });
  w.y -= 26;

  const meta = [input.level, input.recordedAt ? input.recordedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null]
    .filter(Boolean)
    .join(" · ");
  if (meta) {
    w.page.drawText(meta, { x: MARGIN, y: w.y, size: 11, font: body, color: rgb(0.45, 0.45, 0.45) });
    w.y -= 24;
  }
  w.page.drawLine({
    start: { x: MARGIN, y: w.y },
    end: { x: PAGE_SIZE[0] - MARGIN, y: w.y },
    thickness: 1,
    color: rgb(0.85, 0.85, 0.85),
  });
  w.y -= 24;

  if (input.notes) {
    heading(w, "Summary");
    paragraph(w, input.notes.summary, { gapAfter: 14 });

    if (input.notes.keyPoints.length > 0) {
      heading(w, "Key Points");
      bulletList(w, input.notes.keyPoints);
    }

    if (input.notes.actionItems.length > 0) {
      heading(w, "Action Items");
      bulletList(w, input.notes.actionItems);
    }

    if (input.notes.vocabulary.length > 0) {
      heading(w, "Vocabulary");
      for (const word of input.notes.vocabulary) {
        const line = word.note ? `${word.de} — ${word.en}  (${word.note})` : `${word.de} — ${word.en}`;
        paragraph(w, line, { gapAfter: 2 });
      }
      w.y -= 8;
    }

    if (input.notes.corrections && input.notes.corrections.length > 0) {
      heading(w, "Corrections");
      for (const item of input.notes.corrections) {
        const line = item.note ? `"${item.mistake}" → "${item.correction}"  (${item.note})` : `"${item.mistake}" → "${item.correction}"`;
        paragraph(w, line, { gapAfter: 2 });
      }
      w.y -= 8;
    }

    if (input.notes.progressHighlights && input.notes.progressHighlights.length > 0) {
      heading(w, "Progress Highlights");
      bulletList(w, input.notes.progressHighlights);
    }
  } else {
    paragraph(w, "Notes for this class have not finished generating yet. The full transcript below is already available.", { gapAfter: 14 });
  }

  if (input.transcriptText) {
    heading(w, "Full Transcript");
    paragraph(w, input.transcriptText, { size: 10, color: rgb(0.3, 0.3, 0.3) });
  }

  const pageCount = doc.getPageCount();
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.getPage(i);
    page.drawText(`Page ${i + 1} of ${pageCount} · EasyWay`, {
      x: MARGIN,
      y: 28,
      size: 8,
      font: body,
      color: rgb(0.6, 0.6, 0.6),
    });
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
