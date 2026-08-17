import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * A TUTOR'S OWN INBOX — the "Ask my tutor" side of the help desk.
 *
 * `/api/support/tickets` (the plural, no-id route) is "MY OWN HELP REQUESTS" —
 * tickets a lecturer themselves ASKED, same as a student. This is the mirror:
 * tickets a STUDENT routed to this lecturer, which is a different `where`
 * (`assignedToId`, not `userId`) and would otherwise have no list view at all —
 * `/api/support/tickets/[id]` can be opened once the id is known, but nothing
 * told the tutor which ids exist. See openTicket() in lib/support.ts for how a
 * ticket gets `assignedToId` set to a tutor in the first place.
 */
export async function GET() {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const role = String(session.user.role ?? "").toLowerCase();
    if (role !== "lecturer") {
      return NextResponse.json({ error: "Lecturer access required" }, { status: 403 });
    }

    const tickets = await prisma.supportTicket.findMany({
      where: { assignedToId: session.user.id, topic: "tutor" },
      orderBy: { lastMessageAt: "desc" },
      take: 50,
      select: {
        id: true,
        subject: true,
        status: true,
        unreadForAdmin: true,
        lastMessageAt: true,
        createdAt: true,
        user: { select: { name: true } },
        student: { select: { level: true } },
        _count: { select: { messages: true } },
      },
    });

    return NextResponse.json({
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        subject: ticket.subject,
        status: ticket.status,
        // Reused for a lecturer's own view the same way the office reads it —
        // "unread on the answering side" — see resolveAccess() in
        // /api/support/tickets/[id]/route.ts.
        unread: ticket.unreadForAdmin,
        messageCount: ticket._count.messages,
        studentName: ticket.user.name,
        level: ticket.student?.level ?? null,
        lastMessageAt: ticket.lastMessageAt,
        createdAt: ticket.createdAt,
      })),
      unread: tickets.filter((ticket) => ticket.unreadForAdmin).length,
    });
  } catch (error) {
    console.error("Lecturer inbox GET failed", error);
    return NextResponse.json({ error: "Could not load your messages" }, { status: 500 });
  }
}
