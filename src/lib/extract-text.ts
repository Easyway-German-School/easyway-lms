import mammoth from "mammoth";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

/**
 * Getting readable text out of an uploaded file.
 *
 * Lifted out of /api/ai/upload-content so the background job that summarises
 * materials uses exactly the same extraction the lesson builder does. Two
 * copies would drift, and the symptom would be a material that summarises
 * differently depending on which door it came through.
 */

let pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs") | null = null;
let pdfjsTried = false;

async function loadPdfJs() {
  if (pdfjsTried) return pdfjs;
  pdfjsTried = true;
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (error) {
    console.warn("PDF parser unavailable in this environment:", error);
    pdfjs = null;
  }
  return pdfjs;
}

export const MAX_PDF_PAGES_TO_PARSE = 5;
export const MAX_PARSED_TEXT_LENGTH = 12000;

export async function extractTextFromPDF(
  buffer: Buffer,
  maxPages = MAX_PDF_PAGES_TO_PARSE,
  maxChars = MAX_PARSED_TEXT_LENGTH,
): Promise<string> {
  try {
    const pdfjsModule = await loadPdfJs();
    if (!pdfjsModule) return "";

    const workerPath = path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs");
    const fontDirectory = path.join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts") + path.sep;
    const workerExists = fs.existsSync(workerPath);
    const fontDirExists = fs.existsSync(fontDirectory);

    if (!workerExists || !fontDirExists) {
      console.warn(
        "PDF parser warning:",
        !workerExists ? `worker not found at ${workerPath}` : null,
        !fontDirExists ? `standard fonts not found at ${fontDirectory}` : null,
      );
    }

    if (workerExists) {
      pdfjsModule.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).toString();
    }

    const loadingTask = pdfjsModule.getDocument({
      data: new Uint8Array(buffer),
      standardFontDataUrl: fontDirExists ? pathToFileURL(fontDirectory).toString() : undefined,
    });
    const pdfDocument = await loadingTask.promise;

    const pageTexts: string[] = [];
    const pagesToParse = Math.min(pdfDocument.numPages, maxPages);
    let extractedLength = 0;

    for (let pageNumber = 1; pageNumber <= pagesToParse; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => (typeof item.str === "string" ? item.str : ""))
        .join(" ");

      extractedLength += pageText.length;
      pageTexts.push(pageText);
      if (extractedLength >= maxChars) break;
    }

    await pdfDocument.destroy();
    return pageTexts.join("\n\n").slice(0, maxChars);
  } catch (error) {
    console.error("PDF extraction error:", error);
    throw new Error(
      `Failed to extract text from PDF: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

export async function extractTextFromDOCX(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || "";
  } catch (error) {
    console.error("DOCX extraction error:", error);
    throw new Error("Failed to extract text from DOCX");
  }
}

export function splitTextIntoChunks(text: string, chunkSize: number, maxChunks: number): string[] {
  const chunks: string[] = [];
  let index = 0;
  while (index < text.length && chunks.length < maxChunks) {
    chunks.push(text.slice(index, index + chunkSize));
    index += chunkSize;
  }
  return chunks;
}

/**
 * Text from whatever was uploaded, or "" when the format carries none.
 *
 * A video or an image returns empty rather than throwing: "there is nothing to
 * read here" is a normal outcome for a class recording, not an error, and the
 * caller should carry on and leave it unsummarised.
 */
export async function extractText(buffer: Buffer, fileName: string, fileType: string): Promise<string> {
  const name = fileName.toLowerCase();
  const type = (fileType || "").toLowerCase();

  if (name.endsWith(".pdf") || type.includes("pdf")) {
    return extractTextFromPDF(buffer);
  }
  if (name.endsWith(".docx") || type.includes("wordprocessingml")) {
    return extractTextFromDOCX(buffer);
  }
  if (name.endsWith(".txt") || name.endsWith(".md") || type.startsWith("text/")) {
    return buffer.toString("utf8").slice(0, MAX_PARSED_TEXT_LENGTH);
  }

  return "";
}
