import { NextResponse } from "next/server";

import { recordIncident } from "@/lib/incidents";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const ROLES = ["tutor", "student", "admin"] as const;

export async function POST(request: Request) {
  const ip = clientIp(request.headers);
  if (!checkRateLimit(`live-report:${ip}`, { windowMs: 10 * 60_000, max: 20 }).ok) {
    return new NextResponse(null, { status: 204 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return new NextResponse(null, { status: 204 });

  const report = body as Record<string, unknown>;
  const role = ROLES.find((value) => value === report.role);
  const attempts = Number(report.attempts);
  if (!role || !Number.isInteger(attempts) || attempts < 1 || attempts > 3) {
    return new NextResponse(null, { status: 204 });
  }

  await recordIncident({
    kind: "health",
    source: "client",
    route: "/live",
    message: `${role} could not connect to the live classroom after direct and relay attempts`,
    severity: role === "tutor" ? "high" : "medium",
    context: {
      role,
      attempts,
      online: report.online !== false,
    },
  });

  return new NextResponse(null, { status: 204 });
}
