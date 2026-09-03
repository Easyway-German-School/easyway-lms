/**
 * The read-only calendar feed: a signed URL an admin pastes into Google
 * Calendar or Outlook, and the VCALENDAR builder behind it.
 *
 * The token is a stateless HMAC of the user id — no table, no expiry, and
 * revocable only by rotating the secret (acceptable for a read-only feed of a
 * staff calendar). The feed route is deliberately outside the session gate:
 * a calendar client cannot sign in. It re-checks that the user is still an
 * admin who holds the `events` capability on every fetch.
 */

import crypto from "node:crypto";

function secret(): string {
  return process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "work-drive-ics-fallback-secret";
}

export function icsToken(userId: string): string {
  return crypto.createHmac("sha256", secret()).update(`ics:${userId}`).digest("base64url").slice(0, 40);
}

export function verifyIcsToken(userId: string, token: string): boolean {
  const expected = icsToken(userId);
  if (token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

/** Absolute URL for the feed, given the request's origin. */
export function icsFeedUrl(origin: string, userId: string): string {
  const u = new URL("/api/admin/work-drive/events/ics", origin);
  u.searchParams.set("u", userId);
  u.searchParams.set("token", icsToken(userId));
  return u.toString();
}

function fold(line: string): string {
  // RFC 5545: lines over 75 octets are folded with CRLF + space.
  const out: string[] = [];
  let s = line;
  while (s.length > 73) {
    out.push(s.slice(0, 73));
    s = " " + s.slice(73);
  }
  out.push(s);
  return out.join("\r\n");
}

function esc(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export type IcsEvent = {
  id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startAt: Date;
  endAt?: Date | null;
  allDay?: boolean;
};

export function buildCalendar(events: IcsEvent[], name = "Work Drive"): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EasyWay//Work Drive//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    fold(`X-WR-CALNAME:${esc(name)}`),
  ];
  const now = stamp(new Date());
  for (const e of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${e.id}@work-drive.easyway`);
    lines.push(`DTSTAMP:${now}`);
    if (e.allDay) {
      const d = e.startAt.toISOString().slice(0, 10).replace(/-/g, "");
      lines.push(`DTSTART;VALUE=DATE:${d}`);
    } else {
      lines.push(`DTSTART:${stamp(e.startAt)}`);
      lines.push(`DTEND:${stamp(e.endAt ?? new Date(e.startAt.getTime() + 30 * 60000))}`);
    }
    lines.push(fold(`SUMMARY:${esc(e.title)}`));
    if (e.location) lines.push(fold(`LOCATION:${esc(e.location)}`));
    if (e.description) lines.push(fold(`DESCRIPTION:${esc(e.description)}`));
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
