import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { CURRENT_INTAKE_KEY, parseCurrentIntake, type CurrentIntake } from "@/lib/intake";

/**
 * The school's current intake month — read and written by /admin/settings.
 *
 * Its own route rather than folded into ../route.ts because that one returns
 * the sessions object at the top level and the settings page consumes that
 * shape directly; a sibling endpoint keeps both simple. See lib/intake.ts.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  try {
    const row = await prisma.schoolSetting.findFirst({
      where: { key: CURRENT_INTAKE_KEY },
    });
    return NextResponse.json(parseCurrentIntake(row?.value));
  } catch (error) {
    console.error("Failed to load current intake:", error);
    return NextResponse.json({ error: "Unable to load the current intake" }, { status: 500 });
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
    const intake: CurrentIntake | null = parseCurrentIntake(body, { strict: true });
    if (!intake) {
      return NextResponse.json(
        { error: "Give a real month and a year within five years of now." },
        { status: 400 },
      );
    }

    await prisma.schoolSetting.upsert({
      where: { tenantId_key: { tenantId, key: CURRENT_INTAKE_KEY } },
      update: { value: intake },
      create: { tenantId, key: CURRENT_INTAKE_KEY, value: intake },
    });

    return NextResponse.json({ success: true, ...intake });
  } catch (error) {
    console.error("Failed to save current intake:", error);
    return NextResponse.json({ error: "Unable to save the current intake" }, { status: 500 });
  }
}
