import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";

export const dynamic = "force-dynamic";

/**
 * Where this school wants to be told things.
 *
 * Scoped by the tenant client, so a school manages its own endpoints and there
 * is no way to write this route that reaches another's.
 */
export async function GET() {
  const gate = await requireCapability("integrations");
  if (!gate.ok) return gate.response;

  const endpoints = await prisma.webhookEndpoint.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      url: true,
      events: true,
      disabledAt: true,
      failureCount: true,
      createdAt: true,
      _count: { select: { deliveries: true } },
    },
  });

  return NextResponse.json({ endpoints });
}

/**
 * The events an endpoint may subscribe to. An explicit list, so a typo is
 * refused rather than producing an endpoint subscribed to nothing that looks
 * subscribed to something.
 */
const EVENTS = [
  "student.enrolled",
  "student.updated",
  "payment.recorded",
  "attendance.recorded",
  "class.scheduled",
  "credit.low",
] as const;

export async function POST(request: NextRequest) {
  const gate = await requireCapability("integrations");
  if (!gate.ok) return gate.response;

  const tenantId = gate.session.user.tenantId;
  if (!tenantId) {
    /**
     * The isolation extension would refuse this anyway — no tenant in context
     * means the insert throws — but a 400 saying what is wrong beats a 500
     * saying a query failed.
     */
    return NextResponse.json(
      { error: "This account is not attached to a school, so it has no webhooks." },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => null);
  const url = String(body?.url ?? "").trim();
  const requested: string[] = Array.isArray(body?.events) ? body.events.map(String) : ["*"];

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "That is not a URL." }, { status: 400 });
  }

  /**
   * HTTPS only, and no private addresses.
   *
   * Plain HTTP would put a school's student data on the wire in clear. The
   * private-address check is the more important one: without it this endpoint
   * is a server-side request forgery tool — a partner could point a webhook at
   * 169.254.169.254 or at an internal service and have our own server fetch it
   * for them, from inside the network, with a signed header attached.
   */
  if (parsed.protocol !== "https:") {
    return NextResponse.json(
      { error: "The URL must be https. Student data does not travel over plain http." },
      { status: 400 },
    );
  }

  const host = parsed.hostname.toLowerCase();
  const isPrivate =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host === "[::1]" ||
    host === "0.0.0.0";

  if (isPrivate) {
    return NextResponse.json(
      { error: "That address is on a private network. Webhooks must point at a public URL." },
      { status: 400 },
    );
  }

  const events = requested.includes("*")
    ? "*"
    : requested.filter((e) => EVENTS.includes(e as (typeof EVENTS)[number])).join(",");

  if (!events) {
    return NextResponse.json(
      { error: "Subscribe to at least one event.", allowed: EVENTS },
      { status: 400 },
    );
  }

  /**
   * The signing secret, shown once. Same reasoning as an API key: storing it
   * retrievably means a support conversation can end with somebody pasting a
   * live secret into a chat window.
   */
  const secret = `whsec_${crypto.randomBytes(24).toString("base64url").replace(/_/g, "-")}`;

  /**
   * `tenantId` is passed explicitly even though the isolation extension would
   * add it anyway.
   *
   * On the older tables the column is nullable — a consequence of adding it to
   * a database that already had rows — so TypeScript never asks for it and the
   * extension quietly supplies it. On the tables created after tenancy existed
   * it is non-null, so the compiler demands it here. That is a feature worth
   * keeping rather than casting away: on a new table, the person writing the
   * insert is made to say whose row it is.
   */
  const endpoint = await prisma.webhookEndpoint.create({
    data: { url, events, secret, tenantId },
    select: { id: true, url: true, events: true, createdAt: true },
  });

  return NextResponse.json(
    {
      endpoint,
      secret,
      warning: "Copy this signing secret now. It is not shown again.",
      howToVerify:
        "Each delivery carries X-Easyway-Timestamp and X-Easyway-Signature. Compute " +
        "HMAC-SHA256 of `${timestamp}.${rawBody}` with this secret and compare against " +
        "the signature after the sha256= prefix. Reject anything older than five minutes.",
    },
    { status: 201 },
  );
}
