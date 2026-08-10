import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";

export const dynamic = "force-dynamic";

/**
 * THE OFFICE'S QUEUE.
 *
 * Separate from `/api/admin/leads` even though the two share a screen. A lead
 * is a stranger the school is trying to enrol; a ticket is a student it has
 * already enrolled who is stuck. Merging them would put support requests into
 * the conversion numbers, and the funnel is the one report the school actually
 * runs on.
 *
 * `?count=1` is the cheap form the admin sidebar polls for its badge — one
 * indexed count, no rows, no joins. The full list is only fetched by the page
 * that renders it.
 */
export async function GET(req: NextRequest) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  try {
    if (req.nextUrl.searchParams.get("count")) {
      const [open, unread] = await Promise.all([
        prisma.supportTicket.count({ where: { status: "open" } }),
        prisma.supportTicket.count({ where: { unreadForAdmin: true, status: { not: "resolved" } } }),
      ]);
      return NextResponse.json({ open, unread });
    }

    const status = req.nextUrl.searchParams.get("status");
    const search = req.nextUrl.searchParams.get("q")?.trim();

    const tickets = await prisma.supportTicket.findMany({
      where: {
        ...(status && status !== "all" ? { status } : {}),
        ...(search
          ? {
              OR: [
                { subject: { contains: search, mode: "insensitive" as const } },
                { user: { name: { contains: search, mode: "insensitive" as const } } },
                { user: { email: { contains: search, mode: "insensitive" as const } } },
              ],
            }
          : {}),
      },
      orderBy: [
        // Unanswered first, then oldest-waiting first WITHIN that group. A
        // plain "newest first" queue is how the person who has waited longest
        // ends up at the bottom of the screen, which is the one outcome a help
        // desk must never produce.
        { unreadForAdmin: "desc" },
        { lastMessageAt: "desc" },
      ],
      take: 200,
      select: {
        id: true,
        subject: true,
        topic: true,
        status: true,
        fromPath: true,
        unreadForAdmin: true,
        lastMessageAt: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
        student: { select: { id: true, level: true, branch: { select: { name: true } } } },
        assignedTo: { select: { name: true } },
        _count: { select: { messages: true } },
      },
    });

    const grouped = await prisma.supportTicket.groupBy({ by: ["status"], _count: { status: true } });
    const counts = Object.fromEntries(grouped.map((row) => [row.status, row._count.status]));

    return NextResponse.json({
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        subject: ticket.subject,
        topic: ticket.topic,
        status: ticket.status,
        fromPath: ticket.fromPath,
        unread: ticket.unreadForAdmin,
        messageCount: ticket._count.messages,
        askerName: ticket.user.name,
        askerEmail: ticket.user.email,
        studentId: ticket.student?.id ?? null,
        level: ticket.student?.level ?? null,
        branchName: ticket.student?.branch?.name ?? null,
        assignedTo: ticket.assignedTo?.name ?? null,
        lastMessageAt: ticket.lastMessageAt,
        createdAt: ticket.createdAt,
      })),
      counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
    });
  } catch (error) {
    console.error("Admin enquiries GET failed", error);
    return NextResponse.json({ error: "Could not load the help desk" }, { status: 500 });
  }
}
