import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  clearTicketTyping,
  stampTicketTyping,
  ticketAccess,
  ticketTypers,
  ticketTypingFor,
} from "@/lib/support";

export const dynamic = "force-dynamic";

/**
 * "SOMEBODY IS TYPING" ON THE HELP DESK.
 *
 * Three small calls, all cheap enough to poll every few seconds:
 *
 *   POST { ticketId }                  stamp — "I am typing in this enquiry"
 *   POST { ticketId, typing: false }   clear — box emptied
 *   GET  ?ticketId=                    the open conversation: who is typing, plus
 *                                      `lastMessageAt` / `messageCount` so the
 *                                      client can tell whether to refetch the
 *                                      thread. That is what lets the thread
 *                                      feel live without re-downloading every
 *                                      message every few seconds.
 *   GET                                every enquiry of mine where somebody else
 *                                      is typing — lights up the office queue,
 *                                      the tutor inbox and the student's Help
 *                                      button.
 *
 * Access is the same rule as the thread itself (ticketAccess in lib/support.ts),
 * so a typing dot can never leak that somebody is writing on a ticket you
 * cannot open. The model — stamp, short live window, no expiry job — is written
 * up in lib/typing.ts.
 */

async function loadTicket(ticketId: string) {
  return prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      userId: true,
      assignedToId: true,
      status: true,
      lastMessageAt: true,
      _count: { select: { messages: true } },
    },
  });
}

export async function POST(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const userId = session.user.id as string;
    const role = String(session.user.role ?? "").toLowerCase();
    const { ticketId, typing } = await request.json().catch(() => ({}));
    if (!ticketId) return NextResponse.json({ error: "ticketId is required" }, { status: 400 });

    const ticket = await loadTicket(String(ticketId));
    if (!ticket) return NextResponse.json({ error: "No such request" }, { status: 404 });

    const { allowed } = await ticketAccess(userId, role, ticket);
    if (!allowed) return NextResponse.json({ error: "Not your request" }, { status: 403 });

    if (typing === false || ticket.status === "resolved") {
      await clearTicketTyping(ticket.id, userId);
      return NextResponse.json({ ok: true });
    }

    await stampTicketTyping(ticket.id, userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Support typing POST failed", error);
    return NextResponse.json({ error: "Could not update typing state" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const userId = session.user.id as string;
    const role = String(session.user.role ?? "").toLowerCase();
    const ticketId = new URL(request.url).searchParams.get("ticketId");

    if (ticketId) {
      const ticket = await loadTicket(ticketId);
      if (!ticket) return NextResponse.json({ error: "No such request" }, { status: 404 });

      const { allowed } = await ticketAccess(userId, role, ticket);
      if (!allowed) return NextResponse.json({ error: "Not your request" }, { status: 403 });

      return NextResponse.json({
        typers: await ticketTypers(ticket.id, userId),
        lastMessageAt: ticket.lastMessageAt,
        messageCount: ticket._count.messages,
        status: ticket.status,
      });
    }

    // The all-tickets form. An admin must hold the same capability the queue
    // itself sits behind; anyone else is scoped to their own conversations
    // inside the query, so there is nothing further to check.
    const isAdmin = role === "admin";
    if (isAdmin) {
      const { allowed } = await ticketAccess(userId, role, { userId: "", assignedToId: null });
      if (!allowed) return NextResponse.json({ tickets: {} });
    }

    return NextResponse.json({ tickets: await ticketTypingFor({ userId, isAdmin }) });
  } catch (error) {
    console.error("Support typing GET failed", error);
    // A timer hits this for as long as a tab is open. Empty, not a 500.
    return NextResponse.json({ tickets: {}, typers: [] });
  }
}
