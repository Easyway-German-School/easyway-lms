import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";

/**
 * The first lines of every Campus route: a signed-in person who is not an admin
 * viewing the portal as a student. An impersonating admin is refused outright —
 * Campus shows students to each other, and "an admin pressed a button as Ada" is
 * exactly the kind of thing that must never create a wave, a duel or a coin.
 */
export async function campusSession(): Promise<
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }
> {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return { ok: false, response: NextResponse.json({ error: "Sign in first" }, { status: 401 }) };
  }
  if (session.user.impersonatedBy) {
    return {
      ok: false,
      response: NextResponse.json({ error: "You are viewing as this student, so Campus is read-only." }, { status: 403 }),
    };
  }
  return { ok: true, userId: session.user.id as string };
}
