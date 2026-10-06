import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { placeUnplacedStudents } from "@/lib/batch-placement-server";

export const dynamic = "force-dynamic";

/**
 * "Place the students who have no batch" — the same job the daily cron runs, on demand.
 *
 * `{ apply: false }` (the default) is a PREVIEW: it says who would be placed in which
 * batch, and who is left for a person, and writes nothing. `{ apply: true }` does it.
 * Either way it only fills an empty batch; it never changes one that exists.
 */
export async function POST(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as { apply?: unknown };
  const apply = body.apply === true;

  try {
    const report = await placeUnplacedStudents({ apply, tenantId: gate.session.user.tenantId ?? null });
    if (apply) {
      console.info("Batch placement run by an admin", { placed: report.placed.length, left: report.needsPerson.length });
    }
    return NextResponse.json(report);
  } catch (error) {
    console.error("Batch placement failed", error);
    return NextResponse.json({ error: "Could not place students. Nothing was changed." }, { status: 500 });
  }
}
