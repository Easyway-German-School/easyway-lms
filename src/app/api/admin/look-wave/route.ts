import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { ageFromDob, dobOfStudent } from "@/lib/age-bands";
import { summariseLookCohorts, type CohortRow } from "@/lib/look-cohorts";
import { prisma } from "@/lib/prisma";
import { readLookWave } from "@/lib/youth-look-server";
import { LOOK_WAVE_KEY, parseLookChoice, parseLookWave } from "@/lib/youth-look";

export const dynamic = "force-dynamic";

/**
 * Who gets the new student look, and how many that is — read and changed from
 * the age report. See src/lib/youth-look.ts for the rules.
 *
 * GET also takes the cutoff to PREVIEW (`?maxAge=`), so the admin sees "this
 * would put 61 more students on it" before saving anything. Counts only: no
 * names, no birth dates.
 */
export async function GET(request: Request) {
  const gate = await requireCapability("reports");
  if (!gate.ok) return gate.response;

  try {
    const saved = await readLookWave(gate.session.user.tenantId ?? null);
    const params = new URL(request.url).searchParams;
    const preview = parseLookWave({
      ...saved,
      ...(params.has("maxAge") ? { maxAge: Number(params.get("maxAge")) } : {}),
      ...(params.has("includeUnknownAge") ? { includeUnknownAge: params.get("includeUnknownAge") === "true" } : {}),
    });

    const students = await prisma.student.findMany({
      where: { status: "active" },
      select: {
        admission: true,
        uiLook: true,
        lookPromptedAt: true,
        profile: { select: { dateOfBirth: true } },
      },
    });

    const now = new Date();
    const cohortRows: CohortRow[] = students.map((s) => ({
      age: ageFromDob(dobOfStudent(s.profile, s.admission), now),
      choice: parseLookChoice(s.uiLook),
      prompted: s.lookPromptedAt !== null,
    }));

    return NextResponse.json({
      saved,
      preview,
      counts: summariseLookCohorts(cohortRows, preview),
    });
  } catch (error) {
    console.error("Failed to load the look wave:", error);
    return NextResponse.json({ error: "Unable to load the new-look rollout" }, { status: 500 });
  }
}

/** Save a new cutoff. Same gate as the other school-wide settings. */
export async function POST(request: Request) {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  const tenantId = gate.session.user.tenantId;
  if (!tenantId) return NextResponse.json({ error: "No school in context" }, { status: 400 });

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const wave = parseLookWave(body);

    await prisma.schoolSetting.upsert({
      where: { tenantId_key: { tenantId, key: LOOK_WAVE_KEY } },
      update: { value: wave },
      create: { tenantId, key: LOOK_WAVE_KEY, value: wave },
    });
    return NextResponse.json({ success: true, wave });
  } catch (error) {
    console.error("Failed to save the look wave:", error);
    return NextResponse.json({ error: "Unable to save the new-look rollout" }, { status: 500 });
  }
}
