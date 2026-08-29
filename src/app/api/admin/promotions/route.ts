import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { findPromotionCandidates, promoteStudents, SESSION_MONTHS } from "@/lib/promotion";

export const dynamic = "force-dynamic";

async function requireStudentsAdmin() {
  return requireCapability("students");
}

/** GET — students whose session has ended but who are still on the same level. */
export async function GET(req: NextRequest) {
  const gate = await requireStudentsAdmin();
  if (!gate.ok) return gate.response;

  try {
    const candidates = await findPromotionCandidates({
      branchId: req.nextUrl.searchParams.get("branchId"),
      level: req.nextUrl.searchParams.get("level"),
    });

    return NextResponse.json({ candidates, sessionMonths: SESSION_MONTHS });
  } catch (error) {
    console.error("Promotion candidates GET failed:", error);
    return NextResponse.json({ error: "Unable to build the promotion list" }, { status: 500 });
  }
}

/** POST — move the given students up a level. */
export async function POST(req: NextRequest) {
  const gate = await requireStudentsAdmin();
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    const ids = Array.isArray(body?.studentIds) ? body.studentIds.filter((v: unknown) => typeof v === "string") : [];

    if (ids.length === 0) {
      return NextResponse.json({ error: "Select at least one student" }, { status: 400 });
    }

    const result = await promoteStudents(ids);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Promotion POST failed:", error);
    return NextResponse.json({ error: "Unable to move these students" }, { status: 500 });
  }
}
