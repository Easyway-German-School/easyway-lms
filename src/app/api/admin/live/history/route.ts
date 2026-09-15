import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { listLiveClassHistory } from "@/lib/live-history";

export const dynamic = "force-dynamic";

/**
 * Past live classes — see lib/live-history.ts for what "scheduled" and "late"
 * mean here. Sibling to /api/admin/live, which only ever answers "right now".
 */
export async function GET(request: NextRequest) {
  const gate = await requireCapability("classes");
  if (!gate.ok) return gate.response;

  const params = request.nextUrl.searchParams;
  const branchId = params.get("branchId") || undefined;
  const lecturerId = params.get("lecturerId") || undefined;
  const level = params.get("level") || undefined;
  const sessionSlot = params.get("sessionSlot") || undefined;
  const fromRaw = params.get("from");
  const toRaw = params.get("to");
  const from = fromRaw ? new Date(fromRaw) : null;
  const to = toRaw ? new Date(toRaw) : null;
  const page = Math.max(Number(params.get("page") || "1") || 1, 1);
  const pageSize = 50;

  try {
    const { rows, total } = await listLiveClassHistory({
      branchId,
      lecturerId,
      level,
      sessionSlot,
      from: from && !Number.isNaN(from.getTime()) ? from : null,
      to: to && !Number.isNaN(to.getTime()) ? to : null,
      take: pageSize,
      skip: (page - 1) * pageSize,
    });

    return NextResponse.json({ rows, total, page, pageSize });
  } catch (error) {
    console.error("Failed to load live class history:", error);
    return NextResponse.json({ error: "Could not load live class history" }, { status: 500 });
  }
}
