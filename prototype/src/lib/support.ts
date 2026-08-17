import { prisma } from "@/lib/prisma";
import { KIND, notifyInBackground } from "@/lib/notify";
import { MAX_BODY, MAX_SUBJECT, type TicketTopic } from "@/lib/support-copy";
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
  isTicketTopic,
  isTicketStatus,
} from "@/lib/support-copy";
export type { TicketTopic, TicketStatus } from "@/lib/support-copy";

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
}) {
  const subject = input.subject.trim().slice(0, MAX_SUBJECT);
  const body = input.body.trim().slice(0, MAX_BODY);

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
}) {
  const body = input.body.trim().slice(0, MAX_BODY);
  if (!body) return null;

  const ticket = await prisma.supportTicket.findUnique({
    where: { id: input.ticketId },
    select: { id: true, userId: true, subject: true, status: true, assignedToId: true, topic: true },
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

/** How many tickets are waiting on the office. Drives the sidebar ping. */
export async function openTicketCount(): Promise<number> {
  return prisma.supportTicket.count({ where: { status: { in: ["open"] } } });
}
