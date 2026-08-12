import { NextResponse } from "next/server";
import { WebhookReceiver } from "livekit-server-sdk";
import { finaliseRecording } from "@/lib/class-recorder";

export const dynamic = "force-dynamic";

/**
 * LiveKit tells us when a capture has finished uploading.
 *
 * The file does not exist when the class ends — encoding and upload take a few
 * minutes — so this is how a recording reaches the library promptly. It is not
 * the only way: `reconcileRecordings()` asks LiveKit directly for anything this
 * never delivered, which is what covers development (LiveKit cannot reach a
 * laptop) and a webhook lost to a deploy.
 *
 * The body is verified, not trusted. This endpoint is public by necessity, and
 * an unverified one would let anyone post a fabricated `egress_ended` and plant
 * a row in the video library. `WebhookReceiver` checks the signature against
 * the API secret, which is the same secret LiveKit signed it with.
 */
export async function POST(request: Request) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    return NextResponse.json({ error: "LiveKit not configured" }, { status: 503 });
  }

  try {
    // Must be the raw body — any reparsing changes the bytes the signature
    // was computed over.
    const body = await request.text();
    console.debug && console.debug('LiveKit webhook body length', body.length);
    const authorization = request.headers.get("authorization");
    if (!authorization) {
      return NextResponse.json({ error: "Unsigned" }, { status: 401 });
    }

    const receiver = new WebhookReceiver(apiKey, apiSecret);
    const event = await receiver.receive(body, authorization);

    if (event.event === "egress_ended" && event.egressInfo) {
      console.info('LiveKit egress_ended received', { egressId: event.egressInfo.egressId });
      const info = event.egressInfo;
      
      // The webhook has no request context, so we must find the tenant from the recording.
      // Use unguardedPrisma to find the classRecording without tenant scope.
      const { unguardedPrisma } = await import("@/lib/prisma");
      const { runWithTenant } = await import("@/lib/tenant/context");
      
      const recording =
        (await unguardedPrisma.classRecording.findUnique({ 
          where: { egressId: info.egressId },
          select: { id: true, tenantId: true, objectKey: true }
        })) ??
        (info.fileResults?.[0]?.filename
          ? await unguardedPrisma.classRecording.findFirst({
              where: { objectKey: info.fileResults[0]!.filename },
              select: { id: true, tenantId: true, objectKey: true }
            })
          : null);

      if (!recording?.tenantId) {
        console.error("Could not find tenant for recording", { egressId: info.egressId });
        return NextResponse.json({ ok: true, outcome: "unknown" });
      }

      // Now run finaliseRecording within the tenant context
      const outcome = await runWithTenant(recording.tenantId, async () =>
        finaliseRecording({
          egressId: info.egressId,
          status: info.status,
          error: info.error,
          fileResults: info.fileResults,
        })
      );
      console.info('finaliseRecording outcome', { egressId: info.egressId, outcome });
      return NextResponse.json({ ok: true, outcome });
    }

    // Every other event is acknowledged and ignored. Returning non-200 would
    // make LiveKit retry events we were never going to act on.
    return NextResponse.json({ ok: true, ignored: event.event });
  } catch (error) {
    console.error("LiveKit webhook rejected:", error);
    return NextResponse.json({ error: "Invalid webhook" }, { status: 401 });
  }
}
