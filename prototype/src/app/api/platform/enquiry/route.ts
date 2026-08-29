import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { EDUPRIME } from "@/lib/platform/brand";

/**
 * A school owner asking to be onboarded onto EduPrime.
 *
 * This is NOT signup. The platform onboards every tenant by hand (see
 * docs/PLATFORM.md — "No self-service signup"), so this route deliberately
 * writes no User, no Tenant, no lead row. A lead row would be worse than
 * nothing: leads are tenant-scoped and feed a *school's* office queue, and a
 * platform enquiry belongs to no school.
 *
 * What it does:
 *   1. Rate-limit by IP, so the public form can't be turned into a firehose.
 *   2. Log the enquiry as one structured line — this is the durable record,
 *      greppable in Vercel's logs, and it is never dropped.
 *   3. If PLATFORM_ENQUIRY_WEBHOOK is set (a Slack / Discord incoming webhook),
 *      post a human-readable summary to it — best effort, failure ignored.
 *
 * It has no tenant context and must not acquire one: every branded-email path
 * writes to the tenant-scoped EmailLog and would throw here.
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

const str = (v: unknown, max = 2000) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

export async function POST(request: NextRequest) {
  const cors = corsHeaders(request);
  try {
    const ip = clientIp(request.headers);
    const limit = checkRateLimit(`platform-enquiry:ip:${ip}`, {
      windowMs: 60 * 60 * 1000,
      max: 12,
    });
    if (!limit.ok) {
      return rateLimitResponse(
        limit,
        "Too many enquiries from this connection. Please try again later.",
        cors,
      );
    }

    const body = await request.json().catch(() => null);
    const name = str(body?.name, 200);
    const email = str(body?.email, 320);
    const school = str(body?.school, 300);

    if (!name || !email || !school || !email.includes("@")) {
      return NextResponse.json(
        { error: "Your name, a valid work email and the school's name are required." },
        { status: 400, headers: cors },
      );
    }

    const enquiry = {
      name,
      email,
      school,
      role: str(body?.role, 200),
      students: str(body?.students, 200),
      message: str(body?.message, 4000),
      ip,
      at: new Date().toISOString(),
    };

    // The durable record. One line, structured, never dropped.
    console.log("[eduprime.enquiry]", JSON.stringify(enquiry));

    const webhook = process.env.PLATFORM_ENQUIRY_WEBHOOK?.trim();
    if (webhook) {
      const text = [
        `*New EduPrime onboarding enquiry*`,
        `*${enquiry.school}* — ${enquiry.name}${enquiry.role ? ` (${enquiry.role})` : ""}`,
        `${enquiry.email}`,
        enquiry.students ? `Students: ${enquiry.students}` : null,
        enquiry.message ? `\n${enquiry.message}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      // Best effort: the enquiry is already logged, so a webhook that is down
      // or misconfigured must not turn into a 500 for the person on the form.
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, content: text }),
      }).catch((err) => console.warn("[eduprime.enquiry] webhook failed:", err));
    }

    return NextResponse.json(
      {
        message: `Thanks — an operator will be in touch. You can also reach us at ${EDUPRIME.contactEmail}.`,
      },
      { status: 201, headers: cors },
    );
  } catch (error) {
    console.error("[eduprime.enquiry] failed:", error);
    return NextResponse.json(
      { error: "Unable to record your enquiry right now. Please try again shortly." },
      { status: 500, headers: cors },
    );
  }
}
