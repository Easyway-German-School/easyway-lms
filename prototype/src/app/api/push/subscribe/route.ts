import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isPushConfigured, vapidPublicKey } from "@/lib/push";

/** GET — what the browser needs before it can subscribe. */
export async function GET() {
  return NextResponse.json({
    configured: isPushConfigured(),
    publicKey: vapidPublicKey(),
  });
}

/** POST — store (or refresh) this device's push endpoint. */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { endpoint, keys, userAgent } = await request.json();
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
    }

    const userId = session.user.id as string;

    // Endpoints are unique per device. Re-subscribing on a shared machine must
    // move the row to the current user rather than create a duplicate, or the
    // previous user keeps receiving this device's notifications.
    await prisma.pushSubscription.upsert({
      where: { endpoint: String(endpoint) },
      update: { userId, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent ?? null },
      create: {
        userId,
        endpoint: String(endpoint),
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: userAgent ?? null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Push subscribe error:", error);
    return NextResponse.json({ error: "Unable to save subscription" }, { status: 500 });
  }
}

/** DELETE — the member turned notifications off on this device. */
export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { endpoint } = await request.json();
    if (!endpoint) {
      return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
    }

    await prisma.pushSubscription.deleteMany({
      where: { endpoint: String(endpoint), userId: session.user.id as string },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Push unsubscribe error:", error);
    return NextResponse.json({ error: "Unable to remove subscription" }, { status: 500 });
  }
}
