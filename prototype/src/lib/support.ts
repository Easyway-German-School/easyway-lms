import { prisma } from "@/lib/prisma";
import { KIND, notifyInBackground } from "@/lib/notify";
import { MAX_BODY, MAX_SUBJECT, type TicketTopic } from "@/lib/support-copy";

/**
 * The help desk, on the server.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS AT ALL
 * ---------------------------------------------------------------------------
 * Students already had a way to ask for help. It was WhatsApp, and it had three
 * properties the school could not live with: the school could not see it (one
 * staff member's phone held the whole history), it could not be answered by
 * whoever was actually on duty, and nothing was ever counted — nobody could say
 * how many students were stuck on payments last month, because the evidence was
 * in a chat nobody exported.
 *
 * So the ask goes into the portal, lands in the office's own queue, and both
 * ends get told. That is the entire feature. It is not a Zendesk.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE WORTH WRITING DOWN
 * ---------------------------------------------------------------------------
 * Every write here goes through one of these functions, because every write has
 * to do three things atomically-ish: append the message, move `lastMessageAt`,
 * and flip the unread flag for the OTHER side. Doing that by hand at each call
 * site is how one of the three gets forgotten and a ticket sits in the queue
 * with nobody's badge lit.
 */

/**
 * The vocabulary lives in support-copy.ts and is re-exported here, so a server
 * caller can keep writing `from "@/lib/support"` while a client component
 * imports the leaf module and does not pull prisma into the browser bundle.
 */
export {
  TICKET_TOPICS,
  TICKET_TOPIC_LABELS,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  MAX_SUBJECT,
  MAX_BODY,
  isTicketTopic,
  isTicketStatus,
} from "@/lib/support-copy";
export type { TicketTopic, TicketStatus } from "@/lib/support-copy";

/**
 * Open a ticket and tell the office.
 *
 * The first message is written as a message rather than stored on the ticket,
 * so the thread reads the same way from the first line to the last and the UI
 * needs no special case for "the original one".
 */
export async function openTicket(input: {
  userId: string;
  studentId: string | null;
  subject: string;
  topic: TicketTopic;
  body: string;
  fromPath: string | null;
  authorRole: string;
  authorName: string | null;
}) {
  const subject = input.subject.trim().slice(0, MAX_SUBJECT);
  const body = input.body.trim().slice(0, MAX_BODY);

  const ticket = await prisma.supportTicket.create({
    data: {
      userId: input.userId,
      studentId: input.studentId,
      subject,
      topic: input.topic,
      fromPath: input.fromPath,
      status: "open",
      unreadForAdmin: true,
      unreadForUser: false,
      lastMessageAt: new Date(),
      messages: {
        create: {
          authorId: input.userId,
          authorRole: input.authorRole,
          body,
        },
      },
    },
    include: { messages: true },
  });

  /**
   * Routed to `students`, which is the capability the Enquiries screen already
   * sits behind. Sending it to every admin would buzz the accountant about a
   * broken video player; sending it to nobody is how a ticket goes unanswered
   * for a week and the student goes back to WhatsApp.
   */
  notifyInBackground({
    to: { audience: "admin", capability: "students" },
    kind: KIND.supportTicket,
    severity: "warning",
    title: "New help request",
    message: `${input.authorName ?? "A student"}: ${subject}`,
    link: `/admin/enquiries?ticket=${ticket.id}`,
    senderId: input.userId,
  });

  return ticket;
}

/**
 * Add a reply, from either side.
 *
 * `fromAdmin` decides everything that differs: which unread flag lights, which
 * way the status moves, and who gets buzzed. Passing it explicitly rather than
 * re-deriving the author's role means a single source of truth per call.
 */
export async function replyToTicket(input: {
  ticketId: string;
  authorId: string;
  authorRole: string;
  authorName: string | null;
  body: string;
  fromAdmin: boolean;
}) {
  const body = input.body.trim().slice(0, MAX_BODY);
  if (!body) return null;

  const ticket = await prisma.supportTicket.findUnique({
    where: { id: input.ticketId },
    select: { id: true, userId: true, subject: true, status: true },
  });
  if (!ticket) return null;

  await prisma.supportTicketMessage.create({
    data: {
      ticketId: ticket.id,
      authorId: input.authorId,
      authorRole: input.authorRole,
      body,
    },
  });

  await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: {
      lastMessageAt: new Date(),
      unreadForAdmin: !input.fromAdmin,
      unreadForUser: input.fromAdmin,
      /**
       * An answer moves it to "waiting on the student"; a student writing back
       * moves it to "needs an answer". A resolved ticket that gets a new
       * message is REOPENED — a student replying "that did not work" to a
       * closed ticket must not vanish from the queue, which is the single most
       * common way a help desk loses somebody.
       */
      status: input.fromAdmin ? "pending" : "open",
      resolvedAt: null,
    },
  });

  if (input.fromAdmin) {
    notifyInBackground({
      to: { userIds: [ticket.userId] },
      kind: KIND.supportReply,
      severity: "info",
      title: "The office replied to your question",
      message: ticket.subject,
      /**
       * There is no /support page, on purpose. The conversation lives in the
       * panel that floats over the portal, so the link lands the student on
       * their dashboard with that thread already open — see HelpLauncher. A
       * dedicated page would be a second place the same thread renders, and
       * the two would drift.
       */
      link: `/dashboard?help=${ticket.id}`,
      senderId: input.authorId,
      // Worth a phone buzz: the student asked and then went to do something
      // else, and an answer they do not see is the same as no answer.
      push: true,
    });
  } else {
    notifyInBackground({
      to: { audience: "admin", capability: "students" },
      kind: KIND.supportTicket,
      severity: "warning",
      title: "Reply on a help request",
      message: `${input.authorName ?? "A student"}: ${ticket.subject}`,
      link: `/admin/enquiries?ticket=${ticket.id}`,
      senderId: input.authorId,
    });
  }

  return ticket;
}

/** How many tickets are waiting on the office. Drives the sidebar ping. */
export async function openTicketCount(): Promise<number> {
  return prisma.supportTicket.count({ where: { status: { in: ["open"] } } });
}
