import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { resolveSettingsTenantId } from "@/lib/intake-server";
import { validateClosedSignupSlots, SIGNUP_CLOSED_SLOTS_KEY } from "@/lib/signup-availability";
import { readClosedSignupSlots, writeClosedSignupSlots } from "@/lib/signup-availability-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  try {
    const tenantId = await resolveSettingsTenantId(gate.session.user.tenantId);
    if (!tenantId) {
      return NextResponse.json({ error: "No school is configured for this account" }, { status: 400 });
    }
    return NextResponse.json({ closedSlots: await readClosedSignupSlots(tenantId) });
  } catch (error) {
    console.error("Failed to load closed signup slots:", error);
    return NextResponse.json({ error: "Unable to load signup availability" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  try {
    const tenantId = await resolveSettingsTenantId(gate.session.user.tenantId);
    if (!tenantId) {
      return NextResponse.json({ error: "No school is configured for this account" }, { status: 400 });
    }
    const body = await request.json().catch(() => null);
    const closedSlots = validateClosedSignupSlots((body as { closedSlots?: unknown } | null)?.closedSlots);
    if (!closedSlots) {
      return NextResponse.json(
        { error: "Provide valid closed slots with a batch, year, level, and session." },
        { status: 400 },
      );
    }
    await writeClosedSignupSlots(tenantId, closedSlots);
    return NextResponse.json({ success: true, closedSlots, settingKey: SIGNUP_CLOSED_SLOTS_KEY });
  } catch (error) {
    console.error("Failed to save closed signup slots:", error);
    return NextResponse.json({ error: "Unable to save signup availability" }, { status: 500 });
  }
}
