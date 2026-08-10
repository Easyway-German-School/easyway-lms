import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { adminCan, capabilitiesForUser } from "@/lib/admin-roles";
import { replyToTicket } from "@/lib/support";

export const dynamic = "force-dynamic";

/**
 * ONE THREAD — read and replied to by both sides through the same route.
 *
 * Shared deliberately. A conversation with two endpoints acquires two subtly
 * different ideas of what a message is, and the divergence always shows up as
 * one side seeing a reply the other cannot. What differs between a student and
 * an admin here is exactly two things — who may open it, and which unread flag
 * clears — and both are decided by `isAdmin` in one place.
 */
async function resolveAccess(userId: string, role: string, ticketId: string) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: {
      user: { select: { id: true, name: true, email: true } },
      student: { select: { id: true, level: true, branch: { select: { name: true } } } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { name: true } } },
      },
    },
  });
  if (!ticket) return { ticket: null, isAdmin: false, allowed: false };

  const isAdmin = role === "admin";
  if (isAdmin) {
    // The same capability the Enquiries screen sits behind. An accountant who
    // types the URL gets the same refusal the sidebar would have given them.
    const admin = await prisma.user.findUnique({
      where: { id: userId },
      select: { adminRole: true, adminCapabilities: true },
    });
    const capabilities = capabilitiesForUser(admin?.adminRole, admin?.adminCapabilities);
    return { ticket, isAdmin: true, allowed: capabilities.includes("students") };
  }

  return { ticket, isAdmin: false, allowed: ticket.userId === userId };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await context.params;
    const role = String(session.user.role ?? "").toLowerCase();
    const { ticket, isAdmin, allowed } = await resolveAccess(session.user.id, role, id);

    if (!ticket) return NextResponse.json({ error: "No such request" }, { status: 404 });
    if (!allowed) return NextResponse.json({ error: "Not your request" }, { status: 403 });

    /**
     * OPENING IT IS READING IT.
     *
     * Only the reader's own flag is cleared. Clearing both — the obvious
     * shortcut — would mean the office opening a ticket marks the student's
     * unread reply as read by the student, and the badge that told them an
     * answer had arrived disappears before they ever saw it.
     */
    if (isAdmin ? ticket.unreadForAdmin : ticket.unreadForUser) {
      await prisma.supportTicket.update({
        where: { id: ticket.id },
        data: isAdmin ? { unreadForAdmin: false } : { unreadForUser: false },
      });
    }

    return NextResponse.json({
      id: ticket.id,
      subject: ticket.subject,
      topic: ticket.topic,
      status: ticket.status,
      fromPath: ticket.fromPath,
      createdAt: ticket.createdAt,
      lastMessageAt: ticket.lastMessageAt,
      // The office needs to know who is asking; the student already knows.
      asker: isAdmin
        ? {
            name: ticket.user.name,
            email: ticket.user.email,
            studentId: ticket.student?.id ?? null,
            level: ticket.student?.level ?? null,
            branchName: ticket.student?.branch?.name ?? null,
          }
        : null,
      messages: ticket.messages.map((message) => ({
        id: message.id,
        body: message.body,
        authorRole: message.authorRole,
        authorName: message.author?.name ?? null,
        mine: message.authorId === session.user.id,
        createdAt: message.createdAt,
      })),
    });
  } catch (error) {
    console.error("Support thread GET failed", error);
    return NextResponse.json({ error: "Could not open that request" }, { status: 500 });
  }
}

/** POST — reply. PATCH-shaped status changes ride along on the same body. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await context.params;
    const role = String(session.user.role ?? "").toLowerCase();
    const { ticket, isAdmin, allowed } = await resolveAccess(session.user.id, role, id);

    if (!ticket) return NextResponse.json({ error: "No such request" }, { status: 404 });
    if (!allowed) return NextResponse.json({ error: "Not your request" }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const action = String(body.action ?? "reply");

    if (action === "resolve" || action === "reopen") {
      /**
       * Both sides may close a thread, and that is on purpose: a student whose
       * problem sorted itself out should be able to say so rather than leaving
       * a ticket in the office's queue forever. Reopening is unrestricted for
       * the same reason in reverse.
       */
      const resolving = action === "resolve";
      await prisma.supportTicket.update({
        where: { id: ticket.id },
        data: {
          status: resolving ? "resolved" : "open",
          resolvedAt: resolving ? new Date() : null,
          // Closing a ticket is not an answer, so it does not light anybody's
          // badge — except when the OFFICE closes it, which the student should
          // be told about because it means nobody is working on it any more.
          unreadForUser: resolving && isAdmin,
          unreadForAdmin: !resolving && !isAdmin,
        },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "assign" && isAdmin) {
      await prisma.supportTicket.update({
        where: { id: ticket.id },
        data: { assignedToId: session.user.id },
      });
      return NextResponse.json({ ok: true });
    }

    const message = String(body.body ?? "").trim();
    if (!message) return NextResponse.json({ error: "Write something first" }, { status: 400 });

    // Belt and braces on top of `allowed`: an admin without the capability
    // cannot reach here, and `adminCan` re-states the rule at the write.
    if (isAdmin) {
      const admin = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { adminRole: true },
      });
      if (!adminCan(admin?.adminRole, "students")) {
        return NextResponse.json({ error: "Not your area" }, { status: 403 });
      }
    }

    await replyToTicket({
      ticketId: ticket.id,
      authorId: session.user.id,
      authorRole: isAdmin ? "admin" : role || "student",
      authorName: session.user.name ?? null,
      body: message,
      fromAdmin: isAdmin,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Support thread POST failed", error);
    return NextResponse.json({ error: "Could not send that" }, { status: 500 });
  }
}
