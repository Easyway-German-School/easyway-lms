import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { readSchool, refreshProfiles } from "@/lib/learner-intelligence";

/**
 * The school's behaviour, read.
 *
 * Behind `reports`, the same capability as the rest of the analytics area.
 * That is a deliberate choice and not just consistency: this endpoint returns
 * named students alongside a judgement about them, which is more sensitive
 * than a roster row, not less. It has no business being reachable by anybody
 * who cannot already see the school's reporting.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireCapability("reports");
  if (!gate.ok) return gate.response;
  try {
    return NextResponse.json(await readSchool());
  } catch (error) {
    console.error("Learner intelligence read failed", error);
    return NextResponse.json({ error: "Could not read learner behaviour" }, { status: 500 });
  }
}

/** "Recompute now" — bypasses the six-hour cache for the whole roster. */
export async function POST() {
  const gate = await requireCapability("reports");
  if (!gate.ok) return gate.response;
  try {
    const students = await prisma.student.findMany({
      where: { status: { not: "archived" } },
      select: { userId: true },
    });
    const rebuilt = await refreshProfiles(students.map((student) => student.userId), { force: true });
    return NextResponse.json({ ok: true, rebuilt, ...(await readSchool()) });
  } catch (error) {
    console.error("Learner intelligence recompute failed", error);
    return NextResponse.json({ error: "Could not recompute learner behaviour" }, { status: 500 });
  }
}

// Long-running: model calls / bulk work. Set here (not vercel.json) so it
// travels with the route regardless of where the app is built from.
export const maxDuration = 60;
