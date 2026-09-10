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
 *
 * ---------------------------------------------------------------------------
 * RECORDINGS TAKE A DIFFERENT PATH
 * ---------------------------------------------------------------------------
 * A photo is a few kilobytes; a class recording is hundreds of megabytes and
 * the player pulls it down in dozens of Range requests while it plays and
 * scrubs. Proxying every one of those chunks through this function means each
 * chunk pays for a serverless invocation, a session lookup, and a Nigeria →
 * Vercel → Frankfurt-bucket → Vercel → Nigeria round trip. That is why
 * playback dragged.
 *
 * So for a recording *video* we still do the "are you signed in" check once,
 * then hand the player a short-lived signed URL straight to the bucket and get
 * out of the byte path. The player talks to the bucket directly from then on,
 * with native Range support and no per-chunk function call. The signed URL is
 * good for six hours — longer than any class, so a continuous watch never has
 * the link expire under it — and the redirect itself is cached briefly so a
 * player that re-resolves does not re-sign every seek.
 *
 * The trade this makes: within that six-hour window the URL works without a
 * session and the browser may cache the file, where the old proxy sent
 * `no-store`. Recordings carry no personal documents, and a seamless replay is
 * worth more to the school than making a lesson video mildly harder to save.
 *
 * Two things stay on the proxy on purpose:
 *   - Recording poster images (`…-thumb.jpg`): tiny, and the offline shelf
 *     `fetch()`es them with `credentials: include`, which a cross-origin
 *     redirect to the bucket would fail on CORS.
 *   - Any request carrying `?proxy=1`: that is the offline download stream,
 *     which reads the body directly for a progress bar and hits the same CORS
 *     wall. It keeps the old streamed path.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { getFile, signedGetUrl, storageConfigured, RECORDING_PREFIX } from "@/lib/storage";

export const dynamic = "force-dynamic";

const RECORDING_URL_TTL_SECONDS = 6 * 60 * 60;
const STREAMABLE_VIDEO = /\.(mp4|webm|mov|m4v)$/i;

export async function GET(request: NextRequest, context: { params: Promise<{ key: string[] }> }) {
  const session = await requireAuthSession();
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

  // Recording videos: check auth once, then redirect the player straight to the
  // bucket instead of streaming the bytes back through this function. Posters
  // and the `?proxy=1` offline download stream stay on the proxy (see header).
  const isRecordingVideo =
    objectKey.startsWith(RECORDING_PREFIX) &&
    STREAMABLE_VIDEO.test(objectKey) &&
    request.nextUrl.searchParams.get("proxy") !== "1";
  if (isRecordingVideo) {
    const signed = await signedGetUrl(objectKey, RECORDING_URL_TTL_SECONDS);
    if (signed) {
      const redirect = NextResponse.redirect(signed, 302);
      // Let the browser hold the resolved target for a few minutes so a player
      // that re-requests this route mid-playback is not re-signed every seek.
      // Well inside the six-hour life of the URL it points at.
      redirect.headers.set("Cache-Control", "private, max-age=300");
      return redirect;
    }
    // No signed URL available (misconfigured bucket): fall through to proxying,
    // which is slow but at least plays.
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
  if (objectKey.startsWith(RECORDING_PREFIX) && STREAMABLE_VIDEO.test(objectKey)) {
    // A recording video reaches here only on the signed-URL fallback, or as the
    // `?proxy=1` offline download. Keep it out of the browser's persistent
    // cache — `no-store` still lets this request's own Range chunks flow during
    // active playback, it just stops them being kept.
    headers.set("Cache-Control", "private, no-store");
  } else {
    // Everything else this route serves (photos, documents) is a stored,
    // never-rewritten file behind a unique key — safe, and worth caching hard.
    headers.set("Cache-Control", "private, max-age=31536000, immutable");
  }

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
