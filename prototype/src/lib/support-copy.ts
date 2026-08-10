/**
 * The help desk's vocabulary, on its own with no imports.
 *
 * Split out of support.ts for the same reason notification-kinds.ts was split
 * out of notify.ts: the server module imports prisma, and the moment a client
 * component needs one string from it — the list of topics for a dropdown — the
 * whole database client is dragged into the browser bundle. A leaf module with
 * no imports can be read from either side.
 */

export const TICKET_TOPICS = ["classes", "payment", "account", "technical", "other"] as const;
export type TicketTopic = (typeof TICKET_TOPICS)[number];

/**
 * Worded as a student would say it, not as the office would file it.
 * "Something is broken" gets used; "Technical issue" gets skipped in favour of
 * "Other", and then nobody can route the queue.
 */
export const TICKET_TOPIC_LABELS: Record<TicketTopic, string> = {
  classes: "My classes",
  payment: "Payments and fees",
  account: "My account",
  technical: "Something is broken",
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

export function isTicketTopic(value: unknown): value is TicketTopic {
  return typeof value === "string" && (TICKET_TOPICS as readonly string[]).includes(value);
}

export function isTicketStatus(value: unknown): value is TicketStatus {
  return typeof value === "string" && (TICKET_STATUSES as readonly string[]).includes(value);
}
