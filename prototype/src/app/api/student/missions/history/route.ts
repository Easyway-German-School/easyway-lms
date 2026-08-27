import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { missionHistoryFor } from "@/lib/mission-history-server";

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const history = await missionHistoryFor(session.user.id as string);
  return NextResponse.json(history);
}
