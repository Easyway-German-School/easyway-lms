import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";

/**
 * "Did that email actually go out, and if not, why?"
 *
 * The Logs tab on /admin/emails only ever showed aggregate counts — the
 * per-message status and the provider's rejection reason lived "in the
 * database" where nobody could reach them. That gap is exactly what turned the
 * forgotten-password breakage into a month-long mystery: the send was failing
 * with a reason the queue had already recorded, and there was no way to look.
 *
 * Read-only. Returns the recent EmailMessage (the queue) and EmailLog (every
 * send attempt) rows for one address, newest first, with the fields that
 * actually diagnose a stuck send: status, lastError / errorMessage, attempts,
 * scheduledFor, sentAt, identity.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const gate = await requireCapability("emails");
  if (!gate.ok) return gate.response;

  const to = (request.nextUrl.searchParams.get("to") ?? "").trim().toLowerCase();
  if (!to || !to.includes("@")) {
    return NextResponse.json({ error: "Pass ?to=<email address>" }, { status: 400 });
  }

  const [queue, log] = await Promise.all([
    prisma.emailMessage.findMany({
      where: { to },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        type: true,
        subject: true,
        identity: true,
        status: true,
        attempts: true,
        lastError: true,
        scheduledFor: true,
        sentAt: true,
        createdAt: true,
      },
    }),
    prisma.emailLog.findMany({
      where: { recipientEmail: to },
      orderBy: { sentAt: "desc" },
      take: 20,
      select: {
        id: true,
        type: true,
        subject: true,
        status: true,
        errorMessage: true,
        sentAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    to,
    queue,
    log,
    hint:
      queue.length === 0 && log.length === 0
        ? "Nothing for this address. Either the request never reached queueEmail (check the route), or the address differs from the one on the account."
        : undefined,
  });
}
