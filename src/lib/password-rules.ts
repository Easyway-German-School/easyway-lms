/**
 * What counts as an acceptable password.
 *
 * Its own module with no imports at all, because both the browser form and the
 * API route need it. The obvious home — password-reset.ts, next to everything
 * else about resetting — pulls in Prisma, bcrypt and node:crypto, and importing
 * that from a client component drags the database client into the browser
 * bundle. One shared rule, no server dependencies, so the two cannot drift
 * into disagreeing about what a valid password is.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 200) return "Password must be shorter than 200 characters.";
  return null;
}
