import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import {
  SCHEDULE_PATTERN_KEY,
  parseSchedulePatternSettings,
  type SchedulePatternSettings,
} from "@/lib/schedule-pattern";

/**
 * The office's weekday-pattern overrides — read and written by /admin/settings.
 *
 * Its own route rather than folded into ../route.ts for the same reason
 * ../intake/route.ts is: that endpoint's shape is the sessions grid, and this
 * is a separate concern with no student-moving side effects — changing which
 * days a level meets on does not touch anyone already enrolled, it just
 * changes what the calendar generates going forward. See lib/schedule-pattern.ts.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  try {
    const row = await prisma.schoolSetting.findFirst({ where: { key: SCHEDULE_PATTERN_KEY } });
    return NextResponse.json(parseSchedulePatternSettings(row?.value));
  } catch (error) {
    console.error("Failed to load the schedule pattern:", error);
    return NextResponse.json({ error: "Unable to load the weekly pattern" }, { status: 500 });
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
    const settings: SchedulePatternSettings | null = parseSchedulePatternSettings(body, { strict: true });
    if (!settings) {
      return NextResponse.json({ error: "Invalid pattern format" }, { status: 400 });
    }

    await prisma.schoolSetting.upsert({
      where: { tenantId_key: { tenantId, key: SCHEDULE_PATTERN_KEY } },
      update: { value: settings },
      create: { tenantId, key: SCHEDULE_PATTERN_KEY, value: settings },
    });

    return NextResponse.json({ success: true, ...settings });
  } catch (error) {
    console.error("Failed to save the schedule pattern:", error);
    return NextResponse.json({ error: "Unable to save the weekly pattern" }, { status: 500 });
  }
}
