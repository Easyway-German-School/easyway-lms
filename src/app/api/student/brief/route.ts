import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { buildBrief, type BriefPeriod } from "@/lib/student-brief";

const PERIODS = new Set<BriefPeriod>(["daily", "weekly", "monthly"]);

export async function GET(req: NextRequest) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const requested = req.nextUrl.searchParams.get("period") ?? "daily";
  const period: BriefPeriod = PERIODS.has(requested as BriefPeriod) ? (requested as BriefPeriod) : "daily";

  const brief = await buildBrief(session.user.id as string, period);
  if (!brief) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  return NextResponse.json(brief);
}
