import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { getMergedSchedule } from "@/lib/class-sessions";
import { SLOT_DEFAULTS, normalizeSlot } from "@/lib/class-times";

export const dynamic = "force-dynamic";

/**
 * "WHAT WOULD THIS STUDENT'S WEEK LOOK LIKE?"
 *
 * A read-only preview for the student edit forms — so moving someone onto
 * Weekend or the Online branch is a decision made looking at their actual
 * upcoming sessions, not just a label picked from a dropdown. Reuses the same
 * generator the student's own /calendar and /api/admin/schedule read from
 * (`getMergedSchedule`) rather than a second, simplified copy of the rotation
 * logic — so what the office sees here is what the student will actually see.
 */
export async function GET(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId") || null;
  const level = url.searchParams.get("level")?.trim() || "";
  const sessionSlot = normalizeSlot(url.searchParams.get("sessionSlot"));
  const registeredAtRaw = url.searchParams.get("registeredAt");
  const registeredAt = registeredAtRaw ? new Date(registeredAtRaw) : null;
  const batch = url.searchParams.get("batch") || null;

  if (!level) {
    return NextResponse.json({ error: "level is required" }, { status: 400 });
  }

  try {
    const schedule = await getMergedSchedule({
      branchId,
      level,
      batch,
      registeredAt: registeredAt && !Number.isNaN(registeredAt.getTime()) ? registeredAt : null,
      sessionSlot,
      now: new Date(),
      months: 1,
    });

    const now = Date.now();
    const sessions = schedule.months
      .flatMap((month) => month.sessions)
      .filter((session) => new Date(session.date).getTime() >= now)
      .slice(0, 4)
      .map((session) => ({
        date: session.date,
        weekday: session.weekday,
        startTime: session.startTime,
        endTime: session.endTime,
        topic: session.topic ?? session.defaultFocus,
      }));

    return NextResponse.json({
      slotLabel: SLOT_DEFAULTS[sessionSlot].label,
      startTime: SLOT_DEFAULTS[sessionSlot].startTime,
      endTime: SLOT_DEFAULTS[sessionSlot].endTime,
      sessions,
    });
  } catch (error) {
    console.error("Schedule preview failed:", error);
    return NextResponse.json({ error: "Could not build a preview" }, { status: 500 });
  }
}
