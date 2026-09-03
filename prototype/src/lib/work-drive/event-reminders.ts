/**
 * "Your meeting starts in an hour" for the staff calendar.
 *
 * Runs from the cron tick. One reminder per attendee per event: the send is
 * gated on EventAttendee.reminderSentAt, so a tick that re-runs, or runs every
 * few minutes, never buzzes anybody twice. Fires when the event's next start is
 * inside the REMINDER_WINDOW and still in the future.
 *
 * Cron has no tenant in context, so the query runs unscoped and the notify()
 * call targets attendees by user id (which carries its own tenant).
 */

import { prisma } from "@/lib/prisma";
import { runUnscoped } from "@/lib/tenant/context";
import { notify, KIND } from "@/lib/notify";
import { parseRule, addStepPublic } from "@/lib/work-drive/events";

/** Remind when the start is within this many minutes and not yet past. */
const REMINDER_WINDOW_MIN = 65;

/** The next start of an event at or after `after`, honouring a simple RRULE. */
function nextStart(event: { startAt: Date; rrule: string | null }, after: Date): Date | null {
  if (event.startAt >= after) return event.startAt;
  const rule = parseRule(event.rrule);
  if (!rule) return null;
  let cur = new Date(event.startAt);
  for (let i = 0; i < 500; i++) {
    if (rule.until && cur > rule.until) return null;
    if (cur >= after) return cur;
    cur = addStepPublic(cur, rule);
  }
  return null;
}

export async function sendDueEventReminders(): Promise<{ checked: number; reminded: number }> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MIN * 60_000);

  const events = await runUnscoped("cron: work-drive event reminders", () =>
    prisma.workEvent.findMany({
      where: {
        deletedAt: null,
        status: { in: ["scheduled", "live"] },
        OR: [{ startAt: { gte: now, lte: windowEnd } }, { rrule: { not: null } }],
      },
      select: {
        id: true,
        title: true,
        startAt: true,
        rrule: true,
        location: true,
        attendees: {
          where: { userId: { not: null }, reminderSentAt: null, response: { notIn: ["declined"] } },
          select: { id: true, userId: true },
        },
      },
    }),
  );

  let reminded = 0;
  for (const e of events) {
    const start = nextStart(e, now);
    if (!start || start > windowEnd) continue;
    const recipients = e.attendees.filter((a) => a.userId) as { id: string; userId: string }[];
    if (recipients.length === 0) continue;

    const mins = Math.max(1, Math.round((start.getTime() - now.getTime()) / 60_000));
    await notify({
      to: { userIds: recipients.map((a) => a.userId) },
      title: `Soon: ${e.title}`,
      message: `Starts in about ${mins} min${mins === 1 ? "" : "s"}${e.location ? ` · ${e.location}` : ""}.`,
      kind: KIND.general,
      link: "/admin/calendar",
      dedupeKey: `work-drive-event:${e.id}:${start.toISOString().slice(0, 13)}`,
    }).catch((err) => console.error("event reminder notify failed", err));

    await runUnscoped("cron: mark event reminders sent", () =>
      prisma.eventAttendee.updateMany({
        where: { id: { in: recipients.map((a) => a.id) } },
        data: { reminderSentAt: new Date() },
      }),
    );
    reminded += recipients.length;
  }

  return { checked: events.length, reminded };
}
