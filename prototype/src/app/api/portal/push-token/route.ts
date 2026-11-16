import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { mintPushToken, PUSH_TOKEN_TTL_MS } from "@/lib/push-auth";

export const dynamic = "force-dynamic";

/**
 * Mints a short-lived token the browser hands to the self-hosted push server
 * (see push-server/server.ts) to open its real-time connection — see
 * push-auth.ts for why this exists instead of forwarding the session cookie.
 *
 * Called once per page load / reconnect, NOT polled — this is the one piece
 * of the real-time path that still touches Vercel, and it is cheap and rare
 * by design. NOT wired into any client yet: see PortalUpdates.tsx, which
 * still only polls. This route existing changes nothing until something
 * calls it.
 */
export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const token = mintPushToken(session.user.id as string, secret);
  return NextResponse.json(
    { token, expiresInMs: PUSH_TOKEN_TTL_MS },
    { headers: { "cache-control": "no-store" } },
  );
}
