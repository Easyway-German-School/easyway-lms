import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import QRCode from "qrcode";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAdmin } from "@/lib/admin-roles";
import { beginEnrolment } from "@/lib/mfa";

/**
 * Step one of enrolment: mint a secret and draw the QR code.
 *
 * Two-factor is not switched on here — see beginEnrolment. Calling this again
 * replaces any half-finished secret, which is what somebody who closed the tab
 * and came back needs to happen.
 */
export async function POST() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null;
  const admin = await resolveAdmin(session?.user?.id);
  if (!admin) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const existing = await prisma.user.findUnique({
    where: { id: admin.userId },
    select: { totpEnabledAt: true },
  });

  // Re-running setup on an account that already has it on would silently
  // invalidate the phone that is currently working. Switch it off first.
  if (existing?.totpEnabledAt) {
    return NextResponse.json(
      { error: "Two-factor is already on for this account. Turn it off before setting it up again." },
      { status: 409 },
    );
  }

  const offer = await beginEnrolment(admin.userId, admin.email);

  // Rendered server-side into a data URI so the secret never travels to a
  // third-party QR service — which is a real pattern, and hands the shared
  // secret to somebody else's logs.
  const qr = await QRCode.toDataURL(offer.uri, { errorCorrectionLevel: "M", margin: 1, width: 240 });

  return NextResponse.json({ qr, manualKey: offer.manualKey });
}
