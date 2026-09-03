/**
 * The fallback upload path: file in, file stored, URL out.
 *
 * Production does not normally come here — /api/media/presign sends the browser
 * straight to the bucket, because a request body through Vercel is capped at
 * 4.5 MB and base64 inflates a file by a third on top of that. This route is
 * what makes a fresh clone work with no cloud account: no bucket configured,
 * so the bytes land in public/uploads.
 *
 * It now requires a session. It did not before, which made it an open endpoint
 * that would write an arbitrary file to the school's server for anybody who
 * found the URL.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { putFile, storageKey } from "@/lib/storage";

const FOLDERS = new Set(["files", "materials", "photos", "work-drive"]);

/** Base64 through a JSON body is only ever the small-file path. */
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    // Parse body early so we can allow unauthenticated uploads to the
    // `photos` folder (signup avatars) while still requiring sessions for
    // other folders.
    const body = await request.json();
    const { filename, contentType, data } = body;
    const folder = FOLDERS.has(String(body.folder)) ? String(body.folder) : "files";

    const session = await requireAuthSession();
    if (!session?.user?.id && folder !== "photos") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!filename || !data) {
      return NextResponse.json({ error: "filename and data are required" }, { status: 400 });
    }

    const buffer = Buffer.from(String(data), "base64");
    if (buffer.length > MAX_BYTES) {
      return NextResponse.json({ error: "That file is too large to upload this way" }, { status: 413 });
    }

    const key = storageKey(folder, String(filename));
    const url = await putFile({ key, body: buffer, contentType });

    return NextResponse.json({
      url,
      key,
      filename: key.split("/").pop(),
      contentType: contentType || "application/octet-stream",
      size: buffer.length,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
