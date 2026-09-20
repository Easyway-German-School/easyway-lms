/**
 * Where a moved class shows up on a STUDENT's calendar.
 *
 * Storage is unchanged: a moved class is the ClassSession row for the day it
 * was timetabled, marked `postponed`, with `postponedTo` pointing at the new
 * day (the row is unique on branch+level+date+slot, so its original date is its
 * identity and the office/tutor tools keep reading it that way).
 *
 * But a student does not care about identity. They read the calendar to learn
 * WHEN to turn up, and rendering the row on its original day put the news in
 * the wrong place: a pink "Postponed" box on the day they no longer need to
 * come, and nothing at all on the day they do. This puts the class where it
 * now runs — as an ordinary class, stamped with `movedFrom` so the calendar can
 * say "Moved from Tuesday 15 September" — and leaves the old day empty.
 *
 * Pure and prisma-free so it is unit-testable. Only the student-facing reads
 * (`resolveScheduleForStudent`) call it; the tutor and admin calendars keep the
 * raw rows, because they edit by original date.
 */

export type MovableSession = {
  date: string;
  weekday: string;
  status: string;
  postponedTo: string | null;
  movedFrom?: string | null;
};

export type MovableMonth<S extends MovableSession> = {
  year: number;
  monthIndex: number;
  sessions: S[];
};

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Stored class days are midnight UTC (see `dayKey` in class-sessions.ts). */
function utcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** A postponed row that names a different day — i.e. a class that has actually moved. */
function hasMoved(session: MovableSession): session is MovableSession & { postponedTo: string } {
  return session.status === "postponed" && Boolean(session.postponedTo) && utcDay(session.postponedTo!) !== utcDay(session.date);
}

export function applyMoves<S extends MovableSession, M extends MovableMonth<S>>(months: M[]): M[] {
  if (months.length === 0) return months;

  const moved: S[] = [];
  for (const month of months) for (const session of month.sessions) if (hasMoved(session)) moved.push(session);
  if (moved.length === 0) return months;

  // A class moved to a month outside the window still has to land somewhere the
  // list views can show it: the nearest end.
  const monthIndexFor = (iso: string): number => {
    const d = new Date(iso);
    const found = months.findIndex((m) => m.year === d.getUTCFullYear() && m.monthIndex === d.getUTCMonth());
    if (found !== -1) return found;
    const first = months[0];
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) < Date.UTC(first.year, first.monthIndex, 1) ? 0 : months.length - 1;
  };

  const arrivals = new Map<number, S[]>();
  for (const session of moved) {
    const target = monthIndexFor(session.postponedTo!);
    const relocated = {
      ...session,
      date: session.postponedTo!,
      weekday: WEEKDAY_SHORT[new Date(session.postponedTo!).getUTCDay()],
      status: "scheduled",
      postponedTo: null,
      movedFrom: session.date,
    } as S;
    arrivals.set(target, [...(arrivals.get(target) ?? []), relocated]);
  }

  return months.map((month, index) => {
    const incoming = arrivals.get(index) ?? [];
    const stay = month.sessions.filter((session) => !hasMoved(session));
    if (incoming.length === 0 && stay.length === month.sessions.length) return month;
    const sessions = [...stay, ...incoming].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return { ...month, sessions };
  });
}
