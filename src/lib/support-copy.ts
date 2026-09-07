/**
 * The help desk's vocabulary, on its own with no imports.
 *
 * Split out of support.ts for the same reason notification-kinds.ts was split
 * out of notify.ts: the server module imports prisma, and the moment a client
 * component needs one string from it — the list of topics for a dropdown — the
 * whole database client is dragged into the browser bundle. A leaf module with
 * no imports can be read from either side.
 */

export const TICKET_TOPICS = ["classes", "payment", "account", "technical", "tutor", "other"] as const;
export type TicketTopic = (typeof TICKET_TOPICS)[number];

/**
 * Worded as a student would say it, not as the office would file it.
 * "Something is broken" gets used; "Technical issue" gets skipped in favour of
 * "Other", and then nobody can route the queue.
 *
 * "tutor" is the one topic that never reaches the office at all — see
 * `openTicket()` in support.ts. Everything else lands in the admin queue.
 */
export const TICKET_TOPIC_LABELS: Record<TicketTopic, string> = {
  classes: "My classes",
  payment: "Payments and fees",
  account: "My account",
  technical: "Something is broken",
  tutor: "Ask my tutor",
  other: "Something else",
};

export const TICKET_STATUSES = ["open", "pending", "resolved"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/**
 * Named from the OFFICE'S point of view, because this is the admin queue's
 * vocabulary. "Open" means somebody there has to do something; "pending" means
 * the ball is with the student. Getting those the wrong way round is how a
 * queue fills with things nobody is actually waiting on.
 */
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Needs an answer",
  pending: "Waiting on the student",
  resolved: "Resolved",
};

export const MAX_SUBJECT = 140;
export const MAX_BODY = 4000;

/**
 * How many images one message may carry. A handful covers "here are the three
 * screens it goes wrong on"; more than that is a folder, not a message.
 */
export const MAX_ATTACHMENTS = 6;

/**
 * An image attached to a ticket message — a screenshot, a photo of an error or
 * a receipt. Images only; the bytes live in storage by the time this is
 * written (see lib/upload.ts and /api/media/presign) and only the metadata
 * travels with the message. Kept here, in the import-free leaf module, so both
 * the browser composer and the server writer can name the same shape.
 */
export type TicketAttachment = {
  url: string;
  contentType: string;
  name: string;
  size: number;
};

export function isTicketTopic(value: unknown): value is TicketTopic {
  return typeof value === "string" && (TICKET_TOPICS as readonly string[]).includes(value);
}

export function isTicketStatus(value: unknown): value is TicketStatus {
  return typeof value === "string" && (TICKET_STATUSES as readonly string[]).includes(value);
}
