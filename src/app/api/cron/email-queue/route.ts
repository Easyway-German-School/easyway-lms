import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { drainQueue } from "@/lib/email-queue";
import { adminHasCapability } from "@/lib/admin-roles";

/**
 * Drains the outbound email queue.
 *
 * Point a scheduler at this every few minutes with `Authorization: Bearer
 * $CRON_SECRET`. An admin with the emails capability can also trigger it by
 * hand from the delivery dashboard.
 */

export const dynamic = "force-dynamic";

async function authorize(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get("authorization") === `Bearer ${expected}`) return true;

  const session = (await getServerSession(authOptions as any)) as any;
  return Boolean(session?.user?.id && (await adminHasCapability(session.user.id, "emails")));
}

export async function POST(req: NextRequest) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? 50);
    const result = await drainQueue(Number.isFinite(limit) ? limit : 50);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Email queue drain failed:", error);
    return NextResponse.json({ error: "Queue drain failed" }, { status: 500 });
  }
}

// GET is a read-only status check so hitting the URL in a browser sends nothing.
export async function GET(req: NextRequest) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { prisma } = await import("@/lib/prisma");
  const [queued, sending, sent, failed, suppressed] = await Promise.all([
    prisma.emailMessage.count({ where: { status: "queued" } }),
    prisma.emailMessage.count({ where: { status: "sending" } }),
    prisma.emailMessage.count({ where: { status: "sent" } }),
    prisma.emailMessage.count({ where: { status: "failed" } }),
    prisma.emailMessage.count({ where: { status: "suppressed" } }),
  ]);
  return NextResponse.json({ queued, sending, sent, failed, suppressed });
}
