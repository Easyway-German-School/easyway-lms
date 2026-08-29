import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { drainQueue } from "@/lib/email-queue";
import { adminHasCapability } from "@/lib/admin-roles";
import { maybeUnscoped } from "@/lib/tenant/context";

/**
 * Drains the outbound email queue.
 *
 * Point a scheduler at this every few minutes with `Authorization: Bearer
 * $CRON_SECRET`. An admin with the emails capability can also trigger it by
 * hand from the delivery dashboard.
 */

export const dynamic = "force-dynamic";

/**
 * Which of the two callers this is, because they need different reach.
 *
 * The scheduler drains the queue for every school on the platform. An admin
 * pressing the button keeps their own tenant scope, so they send their own
 * school's mail and nobody else's. Same route, same work, two scopes.
 */
async function authorize(req: NextRequest): Promise<"scheduler" | "admin" | false> {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get("authorization") === `Bearer ${expected}`) {
    return "scheduler";
  }

  const session = await requireAuthSession();
  if (!session) return false;
  return session.user?.id && (await adminHasCapability(session.user.id, "emails"))
    ? "admin"
    : false;
}

export async function POST(req: NextRequest) {
  const caller = await authorize(req);
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? 50);
    const result = await maybeUnscoped(
      caller === "scheduler",
      "scheduled queue drain sends pending mail for every tenant",
      async () => await drainQueue(Number.isFinite(limit) ? limit : 50),
    );
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
