import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { sourcePerformanceSummary, repPerformanceSummary } from "@/lib/growth/intelligence";

export const dynamic = "force-dynamic";

/**
 * GET — what the Growth Desk's adaptive scoring has actually learned so
 * far. See src/lib/growth/intelligence.ts for the math; this just exposes
 * it so nobody has to take "the algorithm" on faith.
 */
export async function GET() {
  const gate = await requireCapability("growth");
  if (!gate.ok) return gate.response;

  const [sources, reps] = await Promise.all([sourcePerformanceSummary(), repPerformanceSummary()]);

  return NextResponse.json({ sources, reps });
}
