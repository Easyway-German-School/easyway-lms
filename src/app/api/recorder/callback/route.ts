import { NextResponse } from "next/server";
import { finaliseRecording } from "@/lib/class-recorder";
import {
  RECORDER_SIGNATURE_HEADER,
  RECORDER_TIMESTAMP_HEADER,
  callbackToEgress,
  parseRecorderCallback,
  recorderEgressId,
  recorderSecret,
  verifyRecorderRequest,
} from "@/lib/recorder";

export const dynamic = "force-dynamic";

/**
 * The self-hosted recorder tells us a class recording is finished (or failed).
 *
 * This is the recorder's equivalent of `/api/webhooks/livekit`'s `egress_ended`,
 * and deliberately reuses everything behind it: the result is dressed as an
 * egress result and handed to `finaliseRecording`, which verifies the file is
 * really in the bucket, discards too-short takes, makes the thumbnail, writes
 * the Watch-shelf entry and notifies the cohort. One finalising path, two
 * recorders.
 *
 * PUBLIC BY NECESSITY, AUTHENTICATED BY SIGNATURE. Like the LiveKit webhook this
 * carries no user session. Without a valid HMAC from the shared secret it does
 * nothing, so nobody can plant a fake "recording ready" row. The raw body is
 * what was signed, so it is read as text before any parsing.
 *
 * Idempotent: the recorder retries on any non-2xx, and `finaliseRecording` is
 * itself idempotent on the egress id ("already"), so a repeat is harmless.
 */
export async function POST(request: Request) {
  const secret = recorderSecret();
  if (!secret) return NextResponse.json({ error: "Recorder not configured" }, { status: 503 });

  const body = await request.text();
  const verdict = verifyRecorderRequest({
    secret,
    timestamp: request.headers.get(RECORDER_TIMESTAMP_HEADER),
    signature: request.headers.get(RECORDER_SIGNATURE_HEADER),
    body,
  });
  if (!verdict.ok) {
    console.warn("Recorder callback rejected:", verdict.reason);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const callback = parseRecorderCallback(json);
  if (!callback) return NextResponse.json({ error: "Invalid callback" }, { status: 400 });

  try {
    // No request context on a provider callback, so find the school from the
    // recording row itself — the same approach as the LiveKit webhook.
    const { unguardedPrisma } = await import("@/lib/prisma");
    const { runWithTenant } = await import("@/lib/tenant/context");

    const recording = await unguardedPrisma.classRecording.findUnique({
      where: { egressId: recorderEgressId(callback.jobId) },
      select: { tenantId: true },
    });
    if (!recording?.tenantId) {
      // 200, not 4xx/5xx: a recorder retrying a job we have never heard of would
      // retry forever. It is logged; the reconciler owns anything genuinely lost.
      console.error("Recorder callback for an unknown recording", { jobId: callback.jobId });
      return NextResponse.json({ ok: true, outcome: "unknown" });
    }

    const outcome = await runWithTenant(recording.tenantId, async () => finaliseRecording(callbackToEgress(callback)));
    return NextResponse.json({ ok: true, outcome });
  } catch (error) {
    // 500 so the recorder retries: this is a transient failure on our side.
    console.error("Recorder callback failed:", error);
    return NextResponse.json({ error: "Could not process callback" }, { status: 500 });
  }
}
