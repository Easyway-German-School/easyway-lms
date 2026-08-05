import { NextResponse } from "next/server";

/**
 * The door on routes that exist for development and must never answer a
 * stranger in production.
 *
 * Endpoints like these are written in the first week, when the database holds
 * six fake students and the only person who can reach it is the person who
 * wrote it. They then ship, because nothing ever reminds anybody they are
 * there — they are not on a page, not in a menu, and not in the way. The two
 * this currently guards were doing real harm:
 *
 *   /api/test-signin  answered, to anyone at all, whether a given password
 *                     matched the admin account. That is not a debug route,
 *                     it is a password oracle: an attacker can sit on it and
 *                     test guesses all day with no lockout and no log.
 *
 *   /api/seed         wrote courses, modules and lessons into the database on
 *                     an unauthenticated GET — and a GET is what a crawler,
 *                     a link preview or a browser prefetch will follow
 *                     without anybody clicking anything.
 *
 * Guarded rather than deleted so the local workflow they were written for
 * still works. In production they are simply not there.
 */
export function assertDevOnly(): NextResponse | null {
  if (process.env.NODE_ENV !== "production") return null;

  /**
   * One deliberate escape hatch, off unless somebody sets it.
   *
   * Seeding a freshly deployed staging environment is a real need. It is
   * spelled out as its own variable rather than reusing an existing secret so
   * that turning it on is a visible, auditable decision in the Vercel
   * dashboard, and so that leaving it on is obvious to the next person who
   * reads the environment.
   */
  if (process.env.ALLOW_DEV_ROUTES === "true") return null;

  // 404 rather than 403: there is no reason to confirm the route exists.
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
