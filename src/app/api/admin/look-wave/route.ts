import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { ageFromDob, dobOfStudent } from "@/lib/age-bands";
import { summariseLookCohorts, type CohortRow } from "@/lib/look-cohorts";
import { prisma } from "@/lib/prisma";
import { USAGE_WINDOW_DAYS, readLookWave } from "@/lib/youth-look-server";
import { LOOK_WAVE_KEY, isInviteAge, parseLookChoice, parseLookWave, type PhoneUsage } from "@/lib/youth-look";

export const dynamic = "force-dynamic";

/**
 * Who gets the new student look, and how many that is — read and changed from
 * the age report. See src/lib/youth-look.ts for the rules.
 *
 * GET also takes the cutoffs to PREVIEW (`?maxAge=&inviteMaxAge=`), so the
 * admin sees "this would put 61 more students on it" before saving anything.
 * Counts only: no names, no birth dates.
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
      ...(params.has("inviteMaxAge") ? { inviteMaxAge: Number(params.get("inviteMaxAge")) } : {}),
      ...(params.has("includeUnknownAge") ? { includeUnknownAge: params.get("includeUnknownAge") === "true" } : {}),
      ...(params.has("invitePhoneShare") ? { invitePhoneShare: Number(params.get("invitePhoneShare")) } : {}),
    });

    const students = await prisma.student.findMany({
      where: { status: "active" },
      select: {
        admission: true,
        uiLook: true,
        lookPromptedAt: true,
        profile: { select: { dateOfBirth: true } },
        user: { select: { id: true } },
      },
    });

    const now = new Date();
    const aged = students.map((s) => ({
      userId: s.user.id,
      age: ageFromDob(dobOfStudent(s.profile, s.admission), now),
      choice: parseLookChoice(s.uiLook),
      prompted: s.lookPromptedAt !== null,
    }));

    // Phone usage only where it can change an answer: ages that could be INVITED
    // under either the saved or the previewed cutoffs.
    const lowest = Math.min(preview.maxAge, saved.maxAge);
    const highest = Math.max(preview.inviteMaxAge, saved.inviteMaxAge);
    const measure = aged.filter((s) => s.age !== null && s.age > lowest && s.age <= highest);
    const usage = new Map<string, PhoneUsage>();
    if (measure.length) {
      const since = new Date(Date.now() - USAGE_WINDOW_DAYS * 86_400_000);
      const rows = await prisma.learnerUsageEvent.groupBy({
        by: ["userId", "deviceKind"],
        where: { userId: { in: measure.map((s) => s.userId) }, occurredAt: { gte: since } },
        _count: { _all: true },
      });
      for (const r of rows) {
        const entry = usage.get(r.userId) ?? { events: 0, mobileEvents: 0 };
        entry.events += r._count._all;
        if (r.deviceKind === "mobile") entry.mobileEvents += r._count._all;
        usage.set(r.userId, entry);
      }
    }

    const cohortRows: CohortRow[] = aged.map((s) => ({
      age: s.age,
      choice: s.choice,
      prompted: s.prompted,
      usage: s.age !== null && isInviteAge(s.age, preview) ? usage.get(s.userId) ?? null : null,
    }));

    return NextResponse.json({
      saved,
      preview,
      counts: summariseLookCohorts(cohortRows, preview),
      windowDays: USAGE_WINDOW_DAYS,
    });
  } catch (error) {
    console.error("Failed to load the look wave:", error);
    return NextResponse.json({ error: "Unable to load the new-look rollout" }, { status: 500 });
  }
}

/** Save new cutoffs. Same gate as the other school-wide settings. */
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
