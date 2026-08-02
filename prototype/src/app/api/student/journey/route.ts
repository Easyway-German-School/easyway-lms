import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { loadJourney } from "@/lib/germany-journey-server";

export const dynamic = "force-dynamic";

/** The whole road, for the student standing on it. */
export async function GET() {
  try {
    const session = (await getServerSession(authOptions as any)) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const journey = await loadJourney(session.user.id);
    if (!journey) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    return NextResponse.json({ journey });
  } catch (error) {
    console.error("Journey load failed", error);
    return NextResponse.json({ error: "Could not load your journey" }, { status: 500 });
  }
}
