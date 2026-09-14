import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { getOrCreateDmChannel } from "@/lib/community-spaces";

/**
 * POST /api/community/dms — open (or return) the office's private thread with
 * one student.
 *
 * Admin-only, and deliberately the only way a DM channel ever comes into
 * existence: a student cannot start one, and neither can a tutor. Idempotent
 * — the second admin to message the same student is handed the same thread
 * the first one opened, never a second copy of it.
 */
export async function POST(req: NextRequest) {
  const gate = await requireCapability("community");
  if (!gate.ok) return gate.response;

  try {
    const { studentId } = await req.json().catch(() => ({}));
    if (!studentId) return NextResponse.json({ error: "studentId is required" }, { status: 400 });

    const channel = await getOrCreateDmChannel(String(studentId));
    if (!channel) return NextResponse.json({ error: "That student could not be found" }, { status: 404 });

    return NextResponse.json({ channelId: channel.id });
  } catch (error) {
    console.error("Error opening community DM:", error);
    return NextResponse.json({ error: "Could not open that conversation" }, { status: 500 });
  }
}
