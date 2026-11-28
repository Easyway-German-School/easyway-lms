import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { buildBrief, buildMonthDump, type BriefPeriod } from "@/lib/student-brief";

const PERIODS = new Set<BriefPeriod>(["daily", "weekly", "monthly"]);

export async function GET(req: NextRequest) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id as string;
  const dump = req.nextUrl.searchParams.get("dump") === "1";
  if (dump) {
    const monthDump = await buildMonthDump(userId);
    if (!monthDump) return NextResponse.json({ error: "Student not found" }, { status: 404 });
    return NextResponse.json(monthDump);
  }

  const requested = req.nextUrl.searchParams.get("period") ?? "daily";
  const period: BriefPeriod = PERIODS.has(requested as BriefPeriod) ? (requested as BriefPeriod) : "daily";

  const brief = await buildBrief(userId, period);
  if (!brief) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  return NextResponse.json(brief);
}
