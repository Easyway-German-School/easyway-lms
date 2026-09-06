import { ymd } from "@/components/schedule/grid";

/**
 * The day a session's dot belongs on — where it *actually* happens, which is
 * not the same as the day it was originally timetabled for.
 *
 * A postponed class keeps its original `date` (that's its identity — the row is
 * unique on branch+level+date+slot) and carries `postponedTo` forward. Every
 * calendar was keying its dots by `date`, so a class moved from the 3rd to the
 * 11th stayed drawn on the 3rd. This is the one function that decides "which
 * cell", and both the grid and the day rail read it.
 */

type SessionLike = {
  /** Group sessions carry `date`; private sessions carry `scheduledAt`. */
  date?: string | null;
  scheduledAt?: string | null;
  status?: string | null;
  postponedTo?: string | null;
};

/** The `yyyy-mm-dd` the session should be drawn on. */
export function effectiveDayKey(session: SessionLike): string {
  if (session.status === "postponed" && session.postponedTo) {
    return ymd(new Date(session.postponedTo));
  }
  const raw = session.date ?? session.scheduledAt;
  return raw ? ymd(new Date(raw)) : "";
}

/** The day it was originally timetabled for — null unless it has been moved. */
export function originDayKey(session: SessionLike): string | null {
  if (session.status === "postponed" && session.postponedTo) {
    const raw = session.date ?? session.scheduledAt;
    return raw ? ymd(new Date(raw)) : null;
  }
  return null;
}

/** True when this session has been moved off its original day. */
export function isMoved(session: SessionLike): boolean {
  return session.status === "postponed" && Boolean(session.postponedTo);
}
