import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { authorizeChannel } from "@/lib/community-spaces";
import { markChannelRead } from "@/lib/community-unread";

/** POST /api/community/read — clear the unread badge on a channel. */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { channelId } = await request.json();
    if (!channelId) {
      return NextResponse.json({ error: "channelId is required" }, { status: 400 });
    }

    const viewer = { userId: session.user.id as string, role: (session.user as any).role };

    // Same gate as everywhere else: you may only mark a channel you can read.
    const channel = await authorizeChannel(viewer, String(channelId));
    if (!channel) {
      return NextResponse.json({ error: "Channel not found in your community" }, { status: 403 });
    }

    const lastReadAt = await markChannelRead(viewer.userId, channel.id);
    return NextResponse.json({ ok: true, lastReadAt });
  } catch (error) {
    console.error("Mark channel read error:", error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({
      error: "Unable to update read state",
      details: process.env.NODE_ENV === "development" ? errorMsg : undefined
    }, { status: 500 });
  }
}
