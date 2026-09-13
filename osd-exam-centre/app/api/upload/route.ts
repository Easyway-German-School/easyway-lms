import { NextRequest, NextResponse } from "next/server";
import { storeUpload } from "@/lib/storage";

export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024; // 8MB — a phone photo of a passport page, not a video
const ALLOWED_FOLDERS = new Set(["photos", "documents", "slips"]);

/** One shared upload endpoint for the passport photo, the passport data page, and payment slips. */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const folder = String(form?.get("folder") || "documents");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!ALLOWED_FOLDERS.has(folder)) {
    return NextResponse.json({ error: "Invalid folder" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File is too large (max 8MB)" }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const stored = await storeUpload(buffer, { folder, filename: file.name, contentType: file.type || "application/octet-stream" });
  return NextResponse.json({ url: stored.url });
}
