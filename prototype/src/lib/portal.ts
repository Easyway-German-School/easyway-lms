/**
 * Which portal does a person belong to, and where does each portal start?
 *
 * This exists because the answer used to be written out by hand at every
 * redirect and every "back to dashboard" link, and the copies drifted. A tutor
 * opening the gradebook and pressing back twice ended up in the student portal:
 * gradebook linked to `/lecturer` (the original demo page), which linked to
 * `/dashboard`. Every one of those links was individually plausible and the
 * chain was nonsense.
 *
 * So: one function decides the home of a role, one decides where an
 * unauthenticated person signs in, and nothing hardcodes a portal root again.
 */

export type PortalRole = "admin" | "lecturer" | "student" | "parent";

/**
 * Roles arrive in three different shapes depending on where you are: the
 * Prisma enum ("LECTURER"), the NextAuth session ("lecturer"), and the live
 * session payload, which calls a lecturer a "tutor". Fold all of them here
 * rather than making every caller remember which one it is holding.
 */
export function normalizeRole(raw: unknown): PortalRole {
  const role = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (role === "admin") return "admin";
  if (role === "lecturer" || role === "tutor") return "lecturer";
  if (role === "parent") return "parent";
  return "student";
}

/** The landing page of a role's own portal. */
export function homePathForRole(raw: unknown): string {
  switch (normalizeRole(raw)) {
    case "admin":
      return "/admin";
    case "lecturer":
      return "/lecturer/dashboard";
    case "parent":
      return "/parent/dashboard";
    default:
      return "/dashboard";
  }
}

/**
 * Where to send somebody who is not signed in, or whose session does not have
 * the role a page requires.
 *
 * Staff have their own sign-in forms; dropping a tutor on the student form
 * means their password is rejected for reasons nobody can see.
 */
export function signInPathForRole(raw: unknown): string {
  switch (normalizeRole(raw)) {
    case "admin":
      return "/auth/admin";
    case "lecturer":
      return "/auth/lecturer/signin";
    case "parent":
      return "/auth/parent/signin";
    default:
      return "/auth/signin";
  }
}

/**
 * Which portal a path belongs to. Shared pages (`/live`, `/community`) have no
 * portal of their own — they render inside whichever shell the viewer's role
 * calls for, so they deliberately answer "student" only as a fallback.
 */
export function portalOfPath(path: string): PortalRole {
  if (path.startsWith("/admin")) return "admin";
  if (path.startsWith("/lecturer")) return "lecturer";
  return "student";
}
