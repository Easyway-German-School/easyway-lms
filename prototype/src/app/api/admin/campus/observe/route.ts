import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { campusEnabled, onlineInBand } from "@/lib/campus-server";
import { summariseCampus, type Band } from "@/lib/campus";

export const dynamic = "force-dynamic";

const BANDS: Band[] = ["minor", "adult", "unknown"];

/**
 * WATCH CAMPUS WITHOUT BEING ON IT.
 *
 * Students see only their own age band. The office sees every band, separately
 * — never mixed — and writes no presence row, so nobody on the street learns
 * that staff are looking. Same picture the student app uses (avatars, rooms,
 * headcounts), fetched from the shared snapshot cache.
 */
export async function GET() {
  const gate = await requireCapability("community");
  if (!gate.ok) return gate.response;

  try {
    const tenantId = gate.session.user.tenantId ?? null;
    const enabled = await campusEnabled(tenantId);
    if (!enabled) return NextResponse.json({ enabled: false, bands: {} });

    const bands: Record<Band, ReturnType<typeof summariseCampus> & { people: number }> = {
      minor: { ...summariseCampus([]), people: 0 },
      adult: { ...summariseCampus([]), people: 0 },
      unknown: { ...summariseCampus([]), people: 0 },
    };

    await Promise.all(
      BANDS.map(async (band) => {
        const people = await onlineInBand(tenantId, band);
        bands[band] = { ...summariseCampus(people), people: people.length };
      }),
    );

    return NextResponse.json({ enabled: true, bands });
  } catch (error) {
    console.error("Failed to observe campus:", error);
    return NextResponse.json({ error: "Could not load Campus" }, { status: 500 });
  }
}
