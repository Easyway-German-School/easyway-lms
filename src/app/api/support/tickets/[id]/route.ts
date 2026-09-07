import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { adminCan, capabilitiesForUser } from "@/lib/admin-roles";
import {
  deleteTicketMessage,
  editTicketMessage,
  replyToTicket,
  sanitizeTicketAttachments,
} from "@/lib/support";

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

  /**
   * A tutor gets in two ways: it is their own question (same as a student),
   * or it is a "Ask my tutor" thread routed to them — `assignedToId` is set
   * at creation for exactly that case (see openTicket in support.ts) and never
   * by the tutor themselves, so there is nothing here for a tutor to forge
   * their way into somebody else's thread with.
   */
  const allowed = ticket.userId === userId || ticket.assignedToId === userId;
  return { ticket, isAdmin: false, allowed };
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

    // "Staff" here is whoever is answering, not specifically an admin — the
    // tutor a ticket was routed to is on this side too. `allowed` already
    // proved a non-admin viewer is either the asker or the assignee, so for a
    // non-admin, "not the asker" is enough to mean staff.
    const isStaff = isAdmin || ticket.assignedToId === session.user.id;

    /**
     * OPENING IT IS READING IT.
     *
     * Only the reader's own flag is cleared. Clearing both — the obvious
     * shortcut — would mean the office opening a ticket marks the student's
     * unread reply as read by the student, and the badge that told them an
     * answer had arrived disappears before they ever saw it.
     */
    if (isStaff ? ticket.unreadForAdmin : ticket.unreadForUser) {
      await prisma.supportTicket.update({
        where: { id: ticket.id },
        data: isStaff ? { unreadForAdmin: false } : { unreadForUser: false },
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
      // Whoever is answering needs to know who is asking; the asker already knows.
      asker: isStaff
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
        edited: message.editedAt != null,
        attachments: sanitizeTicketAttachments(message.attachments),
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

    // Same rule as GET: staff is whoever is answering, admin or the tutor a
    // "Ask my tutor" ticket was routed to — not literally `isAdmin`.
    const isStaff = isAdmin || ticket.assignedToId === session.user.id;

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
          unreadForUser: resolving && isStaff,
          unreadForAdmin: !resolving && !isStaff,
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

    /**
     * EDIT / DELETE a message the OFFICE already sent.
     *
     * Staff only, and the library refuses a message the student wrote — this
     * side never rewrites the other side's words. A delete is a real delete,
     * and refreshTicketState() then clears the popup and bell that announced
     * it, so an enquiry answer sent by mistake leaves nothing behind.
     */
    if (action === "edit" || action === "delete") {
      if (!isStaff) return NextResponse.json({ error: "Not your request" }, { status: 403 });

      const messageId = String(body.messageId ?? "");
      if (!messageId) return NextResponse.json({ error: "Which message?" }, { status: 400 });

      const result =
        action === "edit"
          ? await editTicketMessage({
              ticketId: ticket.id,
              messageId,
              body: String(body.body ?? ""),
            })
          : await deleteTicketMessage({ ticketId: ticket.id, messageId });

      if (!result) {
        return NextResponse.json(
          { error: action === "edit" ? "Could not edit that message" : "Could not remove that message" },
          { status: 400 },
        );
      }
      return NextResponse.json({ ok: true });
    }

    const message = String(body.body ?? "").trim();
    const attachments = sanitizeTicketAttachments(body.attachments);
    if (!message && attachments.length === 0) {
      return NextResponse.json({ error: "Write something, or attach an image" }, { status: 400 });
    }

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
      fromStaff: isStaff,
      attachments,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Support thread POST failed", error);
    return NextResponse.json({ error: "Could not send that" }, { status: 500 });
  }
}
