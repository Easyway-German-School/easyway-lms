import { NextResponse } from "next/server";
import { defaultTenantId } from "@/lib/price-book-server";
import { loadRecordingForecast } from "@/lib/recording-forecast-server";
import {
  RECORDER_SIGNATURE_HEADER,
  RECORDER_TIMESTAMP_HEADER,
  recorderSecret,
  verifyRecorderRequest,
} from "@/lib/recorder";

export const dynamic = "force-dynamic";

/**
 * "How many classes will be live over the next N hours?" — asked by the recorder fleet manager so it can
 * switch servers on and off to follow the REAL timetable (moves, cancellations, closed days, extra classes,
 * private lessons) instead of a fixed guess. Read-only.
 *
 * Public by necessity, authenticated by signature, like the recording callback: the manager signs
 * `timestamp.query` with the shared secret, so the query itself cannot be altered and an old request cannot be
 * replayed. It reveals only counts and times, never names or students.
 */
export async function GET(request: Request) {
  const secret = recorderSecret();
  if (!secret) return NextResponse.json({ error: "Recorder not configured" }, { status: 503 });

  const url = new URL(request.url);
  const verdict = verifyRecorderRequest({
    secret,
    timestamp: request.headers.get(RECORDER_TIMESTAMP_HEADER),
    signature: request.headers.get(RECORDER_SIGNATURE_HEADER),
    body: url.search.replace(/^\?/, ""),
  });
  if (!verdict.ok) {
    console.warn("Recorder forecast request rejected:", verdict.reason);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hours = Number(url.searchParams.get("hours") ?? 48);
  if (!Number.isFinite(hours) || hours < 1 || hours > 168) return NextResponse.json({ error: "hours must be 1-168" }, { status: 400 });

  try {
    const tenantId = await defaultTenantId();
    if (!tenantId) return NextResponse.json({ error: "No school found" }, { status: 404 });
    const { runWithTenant } = await import("@/lib/tenant/context");
    const forecast = await runWithTenant(tenantId, () => loadRecordingForecast({ tenantId, hours }));
    return NextResponse.json(forecast, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Recording forecast failed:", error);
    return NextResponse.json({ error: "Could not build the forecast" }, { status: 500 });
  }
}
