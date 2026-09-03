import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { icsFeedUrl } from "@/lib/work-drive/ics";

export const dynamic = "force-dynamic";

/** GET — this admin's personal calendar-feed URL, to paste into Google/Outlook. */
export async function GET(request: NextRequest) {
  const gate = await requireCapability("events");
  if (!gate.ok) return gate.response;

  const origin = new URL(request.url).origin;
  return NextResponse.json({ url: icsFeedUrl(origin, gate.admin.userId) });
}
