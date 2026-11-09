import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { notifyTravelPackagePrepReady } from "@/lib/travel-package-prep-notice";

export const dynamic = "force-dynamic";

/** "Becca: announce the Prep guide" button on /admin/travel-package. */
export async function POST() {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  try {
    const result = await notifyTravelPackagePrepReady();
    return NextResponse.json(result);
  } catch (error) {
    console.error("travel-package prep-notify failed", error);
    return NextResponse.json({ error: "Could not send that" }, { status: 500 });
  }
}
