import { NextRequest, NextResponse } from "next/server";
import { parseUploadedContent, summarizeText } from "@/lib/ai";
import { requireAiStaff } from "@/lib/ai-guard";
import mammoth from "mammoth";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

let pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs") | null = null;

async function loadPdfJs() {
  if (pdfjs) return pdfjs;
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (error) {
    console.warn("PDF parser unavailable in this environment:", error);
    pdfjs = null;
  }
  return pdfjs;
}

const MAX_UPLOAD_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
const MAX_PDF_PAGES_TO_PARSE = 5;
const MAX_DEEP_PDF_PAGES_TO_PARSE = 30;
const MAX_PARSED_TEXT_LENGTH = 12000;
const MAX_DEEP_PARSED_TEXT_LENGTH = 48000;
const MAX_SUMMARY_CHUNK_CHARS = 3800;
const MAX_SUMMARY_CHUNKS = 6;
const MAX_RESPONSE_PREVIEW_LENGTH = 500;

/**
 * POST /api/ai/upload-content
 * 
 * Accepts:
 * - multipart/form-data with file (PDF, DOCX, TXT, images)
 * - OR application/json with pastedContent (text)
 * 
 * Returns:
 * {
 *   success: boolean,
 *   parsed: {
 *     title: string,
 *     objectives: string[],
 *     grammarFocus: string[],
 *     vocabulary: string[],
 *     quizQuestions: Array<{question, options, answer}>,
 *     keyTopics: string[],
 *     suggestedLevel: string,
 *     rawText: string
 *   }
 * }
 */

async function extractTextFromPDF(buffer: Buffer, maxPages = MAX_PDF_PAGES_TO_PARSE, maxChars = MAX_PARSED_TEXT_LENGTH): Promise<string> {
  try {
    const pdfjsModule = await loadPdfJs();

    if (!pdfjsModule) {
      return "";
    }

    const workerPath = path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs");
    const fontDirectory = path.join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts") + path.sep;
    const workerExists = fs.existsSync(workerPath);
    const fontDirExists = fs.existsSync(fontDirectory);

    if (!workerExists || !fontDirExists) {
      console.warn(
        "PDF parser warning:",
        !workerExists ? `worker not found at ${workerPath}` : null,
        !fontDirExists ? `standard fonts not found at ${fontDirectory}` : null
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

      if (extractedLength >= maxChars) {
        break;
      }
    }

    await pdfDocument.destroy();
    return pageTexts.join("\n\n").slice(0, maxChars);
  } catch (error) {
    console.error("PDF extraction error:", error);
    throw new Error(`Failed to extract text from PDF: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

function splitTextIntoChunks(text: string, chunkSize: number, maxChunks: number) {
  const chunks: string[] = [];
  let index = 0;
  while (index < text.length && chunks.length < maxChunks) {
    chunks.push(text.slice(index, index + chunkSize));
    index += chunkSize;
  }
  return chunks;
}

async function extractTextFromDOCX(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || "";
  } catch (error) {
    console.error("DOCX extraction error:", error);
    throw new Error("Failed to extract text from DOCX");
  }
}

export async function POST(request: NextRequest) {
  // The worst of the five: it took FILE UPLOADS from anonymous callers and ran
  // whole documents through the model. Staff only.
  const gate = await requireAiStaff();
  if (!gate.ok) return gate.response;

  try {
    const contentType = request.headers.get("content-type") || "";
    let extractedText = "";
    let fileName = "uploaded-content";

    // Handle form data (file upload)
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const rawMode = formData.get("mode");
      const mode = rawMode && typeof rawMode === "string" ? rawMode : "fast";
      const useDeepMode = mode === "deep";
      const file = formData.get("file") as File;

      if (!file) {
        return NextResponse.json(
          { success: false, error: "No file provided" },
          { status: 400 }
        );
      }

      fileName = file.name;
      const fileType = file.type;

      if (file.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
        return NextResponse.json(
          {
            success: false,
            error: `File too large. Upload a file smaller than ${MAX_UPLOAD_FILE_SIZE_BYTES / 1024 / 1024}MB.`,
          },
          { status: 413 }
        );
      }

      try {
        // Handle text files
        if (fileType === "text/plain" || fileName.endsWith(".txt")) {
          extractedText = await file.text();
        }
        // Handle PDF
        else if (fileType === "application/pdf" || fileName.endsWith(".pdf")) {
          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          extractedText = await extractTextFromPDF(
            buffer,
            useDeepMode ? MAX_DEEP_PDF_PAGES_TO_PARSE : MAX_PDF_PAGES_TO_PARSE,
            useDeepMode ? MAX_DEEP_PARSED_TEXT_LENGTH : MAX_PARSED_TEXT_LENGTH
          );
          if (useDeepMode && extractedText.length > MAX_PARSED_TEXT_LENGTH) {
            const chunks = splitTextIntoChunks(extractedText, MAX_SUMMARY_CHUNK_CHARS, MAX_SUMMARY_CHUNKS);
            const summaries: string[] = [];
            for (const chunk of chunks) {
              summaries.push(await summarizeText(chunk));
            }
            extractedText = summaries.join("\n\n").slice(0, MAX_PARSED_TEXT_LENGTH);
          }
        }
        // Handle DOCX
        else if (
          fileType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
          fileName.endsWith(".docx")
        ) {
          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          extractedText = await extractTextFromDOCX(buffer);
        }
        else {
          return NextResponse.json(
            { success: false, error: `Unsupported file type: ${fileType}. Use TXT, PDF, or DOCX.` },
            { status: 400 }
          );
        }
      } catch (fileError) {
        console.error("File processing error:", fileError);
        return NextResponse.json(
          { success: false, error: `Failed to process ${fileName}: ${fileError instanceof Error ? fileError.message : "Unknown error"}` },
          { status: 400 }
        );
      }
    }
    // Handle JSON with pasted content
    else if (contentType.includes("application/json")) {
      const body = await request.json();
      const mode = body.mode && typeof body.mode === "string" ? body.mode : "fast";
      const useDeepMode = mode === "deep";
      extractedText = body.content || "";
      fileName = body.title || "pasted-content";

      if (!extractedText.trim()) {
        return NextResponse.json(
          { success: false, error: "No content provided" },
          { status: 400 }
        );
      }

      if (useDeepMode && extractedText.length > MAX_SUMMARY_CHUNK_CHARS) {
        const chunks = splitTextIntoChunks(extractedText, MAX_SUMMARY_CHUNK_CHARS, MAX_SUMMARY_CHUNKS);
        const summaries: string[] = [];
        for (const chunk of chunks) {
          summaries.push(await summarizeText(chunk));
        }
        extractedText = summaries.join("\n\n").slice(0, MAX_PARSED_TEXT_LENGTH);
      }
    }
    else {
      return NextResponse.json(
        { success: false, error: "Content-Type must be multipart/form-data or application/json" },
        { status: 400 }
      );
    }

    // Trim the extracted text to avoid excessive AI processing time on large uploads.
    extractedText = extractedText.slice(0, MAX_PARSED_TEXT_LENGTH);

    // Validate content length
    if (extractedText.length < 100) {
      return NextResponse.json(
        { success: false, error: "Content too short. Provide at least 100 characters." },
        { status: 400 }
      );
    }

    // Parse the content using AI
    const parsed = await parseUploadedContent(extractedText);

    return NextResponse.json({
      success: true,
      parsed: {
        ...parsed,
        rawText: extractedText.slice(0, 500), // Return first 500 chars for preview
        fileName,
      },
    });
  } catch (error) {
    console.error("Content upload error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to process content" },
      { status: 500 }
    );
  }
}
