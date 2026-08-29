import { NextRequest, NextResponse } from "next/server";
import { captureLead } from "@/lib/leads";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";

/**
 * Public enquiry capture, for the registration form on the marketing site.
 *
 * CORS is open because the form is served from a different origin, matching
 * how /api/auth/signup already works. Nothing here reads or returns anyone
 * else's data, so an open POST costs nothing beyond the enquiry itself.
 */

function corsHeaders(request: NextRequest) {
  const origin = request.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin === "*" ? "*" : origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export async function OPTIONS(request: NextRequest) {
  return NextResponse.json({}, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: NextRequest) {
  try {
    /**
     * The comment above says an open POST "costs nothing beyond the enquiry
     * itself". That was true of a single enquiry and false of a hundred
     * thousand: this table is the office's morning work queue, and burying a
     * real prospective student under generated noise costs the school the
     * enrolment. Metered by IP for that reason.
     *
     * Twenty an hour, which no genuine enquirer approaches — the form is
     * filled in once — while still leaving room for a shared office or campus
     * connection to send several.
     */
    const ip = clientIp(request.headers);
    const limit = checkRateLimit(`leads:ip:${ip}`, {
      windowMs: 60 * 60 * 1000,
      max: 20,
    });

    if (!limit.ok) {
      return rateLimitResponse(
        limit,
        "Too many enquiries from this connection. Please try again later.",
        corsHeaders(request),
      );
    }

    const body = await request.json().catch(() => null);

    if (!body || typeof body.name !== "string" || typeof body.email !== "string") {
      return NextResponse.json(
        { error: "Name and email are required" },
        { status: 400, headers: corsHeaders(request) },
      );
    }

    const result = await captureLead({
      name: body.name,
      email: body.email,
      phone: typeof body.phone === "string" ? body.phone : null,
      branchId: typeof body.branchId === "string" ? body.branchId : null,
      interestedLevel: typeof body.level === "string" ? body.level : null,
      sessionSlot: typeof body.sessionSlot === "string" ? body.sessionSlot : null,
      classType: typeof body.classType === "string" ? body.classType : null,
      source: typeof body.source === "string" ? body.source : "website",
      notes: typeof body.notes === "string" ? body.notes : null,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400, headers: corsHeaders(request) });
    }

    return NextResponse.json(
      { message: "Thank you — we will be in touch shortly." },
      { status: 201, headers: corsHeaders(request) },
    );
  } catch (error) {
    console.error("Lead capture failed:", error);
    return NextResponse.json(
      { error: "Unable to record your enquiry right now. Please try again shortly." },
      { status: 500, headers: corsHeaders(request) },
    );
  }
}
