import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { SESSION_TIMES_KEY, parseSessionTimes, type SessionTimes } from "@/lib/session-times";

/**
 * The clock times quoted per sitting — read and written by /admin/settings.
 * Its own route for the same reason as ../intake/route.ts: a sibling
 * endpoint with its own shape is simpler than folding a second concern into
 * ../route.ts, which already carries the (session x mode) grid's own
 * preview/confirm handshake. A time-string edit has no placement impact on
 * anyone, so it needs none of that.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  try {
    const row = await prisma.schoolSetting.findFirst({ where: { key: SESSION_TIMES_KEY } });
    return NextResponse.json(parseSessionTimes(row?.value));
  } catch (error) {
    console.error("Failed to load session times:", error);
    return NextResponse.json({ error: "Unable to load session times" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  const tenantId = gate.session.user.tenantId;
  if (!tenantId) {
    return NextResponse.json({ error: "No school in context" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const times: SessionTimes | null = parseSessionTimes(body, { strict: true });
    if (!times) {
      return NextResponse.json({ error: "Give a time range for every sitting." }, { status: 400 });
    }

    await prisma.schoolSetting.upsert({
      where: { tenantId_key: { tenantId, key: SESSION_TIMES_KEY } },
      update: { value: times },
      create: { tenantId, key: SESSION_TIMES_KEY, value: times },
    });

    return NextResponse.json({ success: true, ...times });
  } catch (error) {
    console.error("Failed to save session times:", error);
    return NextResponse.json({ error: "Unable to save session times" }, { status: 500 });
  }
}
