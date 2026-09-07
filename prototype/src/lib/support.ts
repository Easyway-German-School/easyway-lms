import { prisma } from "@/lib/prisma";
import { KIND, notifyInBackground } from "@/lib/notify";
import {
  MAX_ATTACHMENTS,
  MAX_BODY,
  MAX_SUBJECT,
  type TicketAttachment,
  type TicketTopic,
} from "@/lib/support-copy";
import { isAssigned, readAssignment } from "@/lib/lecturer-assignment";

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
  MAX_ATTACHMENTS,
  isTicketTopic,
  isTicketStatus,
} from "@/lib/support-copy";
export type { TicketTopic, TicketStatus, TicketAttachment } from "@/lib/support-copy";

/**
 * Keep only what a ticket attachment is allowed to be.
 *
 * The browser uploads each image through lib/upload.ts first, so by the time
 * this list arrives the bytes already sit in storage and this is the guard on
 * the METADATA that gets written next to the message — not on the upload, which
 * /api/media/presign has already refused if it was not an image. Both ends
 * (the student's composer and the office's) send the same shape through the
 * same routes, so both are sanitised here in one place: an `url` that points at
 * our own file route or the configured bucket, an `image/*` type, capped at
 * MAX_ATTACHMENTS. Anything that fails is dropped rather than rejected — a
 * message with one good screenshot and one bad row should still send.
 */
export function sanitizeTicketAttachments(raw: unknown): TicketAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: TicketAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const url = String(record.url ?? "").trim();
    const contentType = String(record.contentType ?? "").trim().toLowerCase();
    const servedByUs =
      url.startsWith("/api/files/") || url.startsWith("/uploads/") || url.startsWith("https://");
    if (!servedByUs || !contentType.startsWith("image/")) continue;
    out.push({
      url,
      contentType,
      name: String(record.name ?? "image").slice(0, 200),
      size: Number.isFinite(Number(record.size)) ? Math.max(0, Math.trunc(Number(record.size))) : 0,
    });
    if (out.length >= MAX_ATTACHMENTS) break;
  }
  return out;
}

/**
 * WHICH TUTOR "my tutor" MEANS, for one student.
 *
 * This is the exact question `studentWhereForLecturer()` in
 * lecturer-assignment.ts answers in the other direction — "which students does
 * THIS tutor see" — run backwards, because nothing in that prisma-free module
 * can query the database to ask "which tutor sees THIS student". Same two
 * routes, same precedence: the office's explicit `Student.tutorId` pairing
 * always wins over a class match, for the identical reason it wins there —
 * a deliberate naming outranks a pattern.
 *
 * Ambiguity is possible (two tutors both assigned to Lagos A1 morning) and
 * deliberately not solved by picking a "best" match — the office would have to
 * name one anyway, so this returns whichever comes first by `createdAt`,
 * which at least answers the same way twice rather than depending on however
 * Postgres happened to order an unsorted scan.
 */
async function tutorForStudent(studentId: string): Promise<string | null> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      tutorId: true,
      branchId: true,
      level: true,
      sessionSlot: true,
    },
  });
  if (!student) return null;

  if (student.tutorId) {
    const named = await prisma.lecturer.findUnique({
      where: { id: student.tutorId },
      select: { userId: true },
    });
    if (named) return named.userId;
  }

  if (!student.branchId) return null;

  const lecturers = await prisma.lecturer.findMany({
    where: { status: "active" },
    orderBy: { createdAt: "asc" },
    select: {
      userId: true,
      branchId: true,
      level: true,
      sessionSlot: true,
      branchIds: true,
      levels: true,
      sessionSlots: true,
      classTypes: true,
      batches: true,
    },
  });

  for (const lecturer of lecturers) {
    const assignment = readAssignment(lecturer);
    if (!isAssigned(assignment)) continue;
    if (!assignment.branchIds.includes(student.branchId)) continue;
    if (!assignment.levels.includes(student.level)) continue;
    if (
      assignment.sessionSlots.length &&
      student.sessionSlot &&
      !assignment.sessionSlots.includes(student.sessionSlot)
    ) {
      continue;
    }
    return lecturer.userId;
  }

  return null;
}

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
  attachments?: TicketAttachment[];
}) {
  const subject = input.subject.trim().slice(0, MAX_SUBJECT);
  const body = input.body.trim().slice(0, MAX_BODY);
  const attachments = sanitizeTicketAttachments(input.attachments ?? []);

  /**
   * "Ask my tutor" skips the office entirely and goes straight to the one
   * person who actually teaches this student — resolved by tutorForStudent()
   * above, the same class-match-or-named-override rule the roster/attendance/
   * grading views already follow, not from anything the student picked. A
   * student with no resolvable tutor yet falls back to the ordinary office
   * queue rather than vanishing into a routed-to nobody.
   */
  const tutorUserId =
    input.topic === "tutor" && input.studentId ? await tutorForStudent(input.studentId) : null;

  const ticket = await prisma.supportTicket.create({
    data: {
      userId: input.userId,
      studentId: input.studentId,
      subject,
      topic: input.topic,
      fromPath: input.fromPath,
      status: "open",
      assignedToId: tutorUserId,
      unreadForAdmin: true,
      unreadForUser: false,
      lastMessageAt: new Date(),
      messages: {
        create: {
          authorId: input.userId,
          authorRole: input.authorRole,
          body,
          attachments,
        },
      },
    },
    include: { messages: true },
  });

  if (tutorUserId) {
    notifyInBackground({
      to: { userIds: [tutorUserId] },
      kind: KIND.supportTicket,
      severity: "info",
      title: "A student messaged you",
      message: `${input.authorName ?? "A student"}: ${subject}`,
      link: `/lecturer/messages?ticket=${ticket.id}`,
      senderId: input.userId,
      push: true,
    });
    return ticket;
  }

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
 * `fromStaff` decides everything that differs: which unread flag lights,
 * which way the status moves, and who gets buzzed. Passing it explicitly
 * rather than re-deriving the author's role means a single source of truth
 * per call — and "staff" here means whoever is answering, not specifically an
 * admin: the routed-to tutor on an "Ask my tutor" ticket answers through this
 * exact path. What matters is "the asker" versus "everyone else", which is
 * why the caller computes it as `authorId !== ticket.userId` rather than from
 * a role check that a tutor replying to their own routed ticket would fail.
 */
export async function replyToTicket(input: {
  ticketId: string;
  authorId: string;
  authorRole: string;
  authorName: string | null;
  body: string;
  fromStaff: boolean;
  attachments?: TicketAttachment[];
}) {
  const body = input.body.trim().slice(0, MAX_BODY);
  const attachments = sanitizeTicketAttachments(input.attachments ?? []);
  // A picture on its own is a complete reply — "here's the screen it's stuck
  // on" needs no sentence — so an empty body is fine as long as something is
  // attached. Both empty is the only nothing.
  if (!body && attachments.length === 0) return null;

  const ticket = await prisma.supportTicket.findUnique({
    where: { id: input.ticketId },
    select: { id: true, userId: true, subject: true, status: true, assignedToId: true, topic: true, fromPath: true },
  });
  if (!ticket) return null;

  await prisma.supportTicketMessage.create({
    data: {
      ticketId: ticket.id,
      authorId: input.authorId,
      authorRole: input.authorRole,
      body,
      attachments,
    },
  });

  // For the notification line and the marketing-email fallback, a wordless
  // message needs a stand-in the recipient can read.
  const bodyForNotice =
    body || (attachments.length === 1 ? "📷 Sent a photo" : `📷 Sent ${attachments.length} photos`);

  await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: {
      lastMessageAt: new Date(),
      unreadForAdmin: !input.fromStaff,
      unreadForUser: input.fromStaff,
      /**
       * An answer moves it to "waiting on the student"; a student writing back
       * moves it to "needs an answer". A resolved ticket that gets a new
       * message is REOPENED — a student replying "that did not work" to a
       * closed ticket must not vanish from the queue, which is the single most
       * common way a help desk loses somebody.
       */
      status: input.fromStaff ? "pending" : "open",
      resolvedAt: null,
    },
  });

  if (input.fromStaff) {
    /**
     * An enquiry that came in from a marketing page — the Travel Package card
     * on /programs — is often from someone who will not open the portal again
     * for days. The bell and the Help badge assume a student who comes back;
     * this one might not, so the answer also goes to their inbox in full, not
     * as a one-line "you have a reply" they still have to log in to read.
     * Per-person email mutes are still honoured inside notify().
     */
    const fromMarketing = ticket.fromPath === "/programs";

    notifyInBackground({
      to: { userIds: [ticket.userId] },
      kind: ticket.topic === "tutor" ? KIND.lecturerMessage : KIND.supportReply,
      severity: "info",
      title: ticket.topic === "tutor" ? "Your tutor replied" : "The office replied to your question",
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
      // Force the email only for the marketing-origin case; every other reply
      // follows the school's routing settings for this kind (off by default).
      email: fromMarketing || undefined,
      emailBody: fromMarketing
        ? `${input.authorName ?? "The office"} replied to your enquiry "${ticket.subject}":\n\n${bodyForNotice}\n\nYou can reply straight back from your student portal.`
        : undefined,
    });
  } else if (ticket.assignedToId) {
    // Routed straight to whoever is answering — the tutor on an "Ask my
    // tutor" thread, or the admin who already picked this one up. Broadcasting
    // to the whole capability group again once somebody has claimed it just
    // trains the rest of the office to ignore the bell.
    notifyInBackground({
      to: { userIds: [ticket.assignedToId] },
      kind: KIND.supportTicket,
      severity: "info",
      title: "Reply on a help request",
      message: `${input.authorName ?? "A student"}: ${ticket.subject}`,
      link: ticket.topic === "tutor" ? `/lecturer/messages?ticket=${ticket.id}` : `/admin/enquiries?ticket=${ticket.id}`,
      senderId: input.authorId,
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

/**
 * Recompute the ticket's summary state from whatever messages are left.
 *
 * Called after a staff message is edited or removed. The two unread flags,
 * `status` and `lastMessageAt` are all denormalised off "who spoke last and
 * has the other side seen it" — delete the message that set them and they are
 * simply wrong until something recomputes them. This is that something.
 *
 * `unreadForAdmin` is never raised here: the only caller is an admin or tutor
 * acting on the thread they are looking at, so there is nothing for them to be
 * told about.
 */
async function refreshTicketState(ticketId: string): Promise<void> {
  const [ticket, messages] = await Promise.all([
    prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true, userId: true, createdAt: true, status: true, topic: true },
    }),
    prisma.supportTicketMessage.findMany({
      where: { ticketId },
      orderBy: { createdAt: "asc" },
      select: { authorRole: true, createdAt: true },
    }),
  ]);
  if (!ticket) return;

  const last = messages[messages.length - 1];
  // No messages left, or the student had the last word → the office owes a
  // reply and the student has nothing new to read. A staff message still last
  // → leave the student's unread flag alone (there may be an answer they have
  // not opened) and keep it "waiting on the student".
  const officeOwesReply = !last || last.authorRole === "student";

  await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: {
      lastMessageAt: last?.createdAt ?? ticket.createdAt,
      ...(ticket.status === "resolved"
        ? {}
        : { status: officeOwesReply ? "open" : "pending" }),
      ...(officeOwesReply ? { unreadForUser: false } : {}),
    },
  });

  if (officeOwesReply) {
    // Un-ring the bell: any "the office replied" notification still sitting
    // unread on this thread is now about a message that no longer exists.
    // Read ones are left — the student already saw them, and scrubbing bell
    // history they have opened is its own kind of gaslighting.
    await prisma.notification
      .deleteMany({
        where: {
          userId: ticket.userId,
          kind: { in: [KIND.supportReply, KIND.lecturerMessage] },
          link: { contains: `help=${ticket.id}` },
          readAt: null,
        },
      })
      .catch((error) => {
        console.warn("refreshTicketState: could not clear stale notifications", error);
      });
  }
}

/**
 * Correct a message the office already sent — a wrong phone number, a name
 * typo in an enquiry reply. Staff only, and only staff-authored lines: a
 * student's own words are never editable from this side.
 *
 * Returns the ticket id on success, null if the message is not on this ticket,
 * was written by the student, or does not exist.
 */
export async function editTicketMessage(input: {
  ticketId: string;
  messageId: string;
  body: string;
}): Promise<string | null> {
  const body = input.body.trim().slice(0, MAX_BODY);
  if (!body) return null;

  const message = await prisma.supportTicketMessage.findUnique({
    where: { id: input.messageId },
    select: { id: true, ticketId: true, authorRole: true },
  });
  if (!message || message.ticketId !== input.ticketId) return null;
  if (message.authorRole === "student") return null;

  await prisma.supportTicketMessage.update({
    where: { id: message.id },
    data: { body, editedAt: new Date() },
  });
  return input.ticketId;
}

/**
 * Take back a message the office sent by mistake. A real delete, not a soft
 * one — an enquiry answer that should never have gone out reads, afterwards,
 * as though it never did: gone from the thread on both sides, and the "office
 * replied" popup and bell that announced it are cleared with it.
 *
 * Staff-authored lines only, same as edit. Returns the ticket id on success.
 */
export async function deleteTicketMessage(input: {
  ticketId: string;
  messageId: string;
}): Promise<string | null> {
  const message = await prisma.supportTicketMessage.findUnique({
    where: { id: input.messageId },
    select: { id: true, ticketId: true, authorRole: true },
  });
  if (!message || message.ticketId !== input.ticketId) return null;
  if (message.authorRole === "student") return null;

  await prisma.supportTicketMessage.delete({ where: { id: message.id } });
  await refreshTicketState(input.ticketId);
  return input.ticketId;
}

/** How many tickets are waiting on the office. Drives the sidebar ping. */
export async function openTicketCount(): Promise<number> {
  return prisma.supportTicket.count({ where: { status: { in: ["open"] } } });
}
