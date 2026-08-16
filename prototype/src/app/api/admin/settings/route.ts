import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import {
  CLASS_SESSIONS_KEY,
  parseSessionSettings,
  type SessionSettings,
} from "@/lib/school-settings";

/**
 * The school's own configuration, read and written by /admin/settings.
 *
 * Persisted in SchoolSetting rather than held in module state. That is not a
 * refinement — a Map on the module lives inside one serverless instance, so on
 * Vercel a save would appear to work, then vanish the moment the next request
 * landed on a different lambda. A settings screen that silently forgets is
 * worse than no settings screen, because the office stops trusting every other
 * number on the site too.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  try {
    const row = await prisma.schoolSetting.findFirst({
      where: { key: CLASS_SESSIONS_KEY },
    });

    return NextResponse.json(parseSessionSettings(row?.value));
  } catch (error) {
    console.error("Failed to load school settings:", error);
    return NextResponse.json({ error: "Unable to load settings" }, { status: 500 });
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

    /**
     * Validated into the known shape rather than stored as sent. This column
     * is JSON, so without this a malformed POST becomes a malformed row, and
     * the thing that breaks is the sign-up form reading it back weeks later.
     */
    const settings: SessionSettings | null = parseSessionSettings(body, { strict: true });
    if (!settings) {
      return NextResponse.json({ error: "Invalid settings format" }, { status: 400 });
    }

    await prisma.schoolSetting.upsert({
      where: { tenantId_key: { tenantId, key: CLASS_SESSIONS_KEY } },
      update: { value: settings },
      create: { tenantId, key: CLASS_SESSIONS_KEY, value: settings },
    });

    return NextResponse.json({ success: true, ...settings });
  } catch (error) {
    console.error("Failed to save school settings:", error);
    return NextResponse.json({ error: "Unable to save settings" }, { status: 500 });
  }
}
