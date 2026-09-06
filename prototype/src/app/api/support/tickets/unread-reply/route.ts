import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * THE ONE REPLY THE STUDENT IS WAITING ON.
 *
 * The Help launcher already polls `/api/support/tickets` for its unread dot,
 * but that is a list the student has to open the panel to read. This is the
 * cheap single-row question the "office replied" moment asks so it can greet
 * the student on their next page with the actual answer text — a person who
 * sent an enquiry from a marketing page and was told to expect a reply should
 * meet it, not have to go hunting behind a closed button for it.
 *
 * Newest waiting reply only. `unreadForUser` is the authoritative signal that
 * the other side has said something new — a student writing back clears it and
 * lights the office's flag instead — so the last message on such a ticket is
 * always the staff one worth previewing.
 */
export async function GET() {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const ticket = await prisma.supportTicket.findFirst({
      where: { userId: session.user.id, unreadForUser: true },
      orderBy: { lastMessageAt: "desc" },
      select: {
        id: true,
        subject: true,
        topic: true,
        lastMessageAt: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { body: true, author: { select: { name: true } } },
        },
      },
    });

    return NextResponse.json({
      reply: ticket
        ? {
            ticketId: ticket.id,
            subject: ticket.subject,
            topic: ticket.topic,
            from: ticket.messages[0]?.author?.name ?? "The office",
            // Enough to recognise the answer, not the whole thing — the panel
            // it links to has the full thread.
            preview: (ticket.messages[0]?.body ?? "").slice(0, 240),
            at: ticket.lastMessageAt,
          }
        : null,
    });
  } catch (error) {
    console.error("Support unread-reply GET failed", error);
    // A greeting that cannot load is not worth failing a page over.
    return NextResponse.json({ reply: null });
  }
}
