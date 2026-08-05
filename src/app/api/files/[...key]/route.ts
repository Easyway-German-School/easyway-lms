/**
 * Serves an uploaded file out of the object bucket.
 *
 * This route exists so the bucket can stay private. Student photographs and
 * ID/passport scans go through it, and it is the reason those are not simply
 * world-readable at a guessable URL — which is what `public/uploads` amounted
 * to before the move to object storage.
 *
 * The guard is "signed in", not "signed in and entitled to this exact file".
 * That is a deliberate floor rather than a ceiling: a per-file ownership check
 * needs a lookup from key back to the row that owns it, and the rows point at
 * files rather than the other way round. Being signed in already excludes the
 * open internet, which is the threat that mattered. Anything stricter belongs
 * with a `Upload` table, and is worth doing the day the school stores
 * something a fellow student must not see.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getFile, storageConfigured } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ key: string[] }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!storageConfigured()) {
    // In development files are on disk and Next serves them from /uploads
    // directly, so nothing should be asking this route for them.
    return NextResponse.json({ error: "File storage is not configured" }, { status: 404 });
  }

  const { key } = await context.params;
  const objectKey = (key ?? []).join("/");

  // `..` cannot appear in a key we issued, and a request containing one is
  // trying to walk out of the prefix.
  if (!objectKey || objectKey.includes("..")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const upstream = await getFile(objectKey, request.headers.get("range"));
  if (!upstream || !upstream.body) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const headers = new Headers();
  for (const header of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const value = upstream.headers.get(header);
    if (value) headers.set(header, value);
  }
  // Private, because the response depends on the session; immutable, because
  // every key we mint is unique and a stored file is never rewritten.
  headers.set("Cache-Control", "private, max-age=31536000, immutable");

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
