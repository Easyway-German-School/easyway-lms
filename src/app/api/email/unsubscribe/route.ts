import { NextRequest, NextResponse } from "next/server";
import { verifyUnsubscribeToken, suppress } from "@/lib/email-queue";
import { setTenantScope } from "@/lib/tenant/context";
import { resolveTenantId } from "@/lib/tenant/resolve";

/**
 * One-click unsubscribe from the footer of bulk mail.
 *
 * Deliberately requires no sign-in — someone who no longer wants email should
 * not have to log in to stop it, and providers score senders on how easy this
 * is. The signed token is what stops one person unsubscribing another.
 */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { email, token } = await req.json();
    if (!email || !token) {
      return NextResponse.json({ error: "email and token are required" }, { status: 400 });
    }

    if (!verifyUnsubscribeToken(String(email), String(token))) {
      return NextResponse.json({ error: "This unsubscribe link is not valid." }, { status: 403 });
    }

    /**
     * No session here by design (see the doc-comment above), so nothing has put
     * a tenant in context — and `suppress()` writes `EmailSuppression` and
     * `EmailMessage`, both tenant-owned, which the isolation layer refuses
     * unscoped. Resolve the school from the hostname, exactly as the signup and
     * password-reset routes do. The signed token has already proven this is the
     * right person for this address.
     */
    setTenantScope(await resolveTenantId(req));

    await suppress(String(email), "unsubscribed", "Unsubscribed via email footer");
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Unsubscribe failed:", error);
    return NextResponse.json({ error: "Unable to process that request" }, { status: 500 });
  }
}
