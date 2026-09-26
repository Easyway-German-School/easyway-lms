import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { markSessionCompleted, releaseSessionResults } from "@/lib/lifecycle";
import { jsonRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Whole-sitting actions: the exam happened (Manual §8 status 08), and ÖSD's results arrived (status 10). */
export const POST = jsonRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { action } = await req.json();

  if (action === "complete") return NextResponse.json({ ok: true, completed: await markSessionCompleted(id) });
  if (action === "releaseResults") return NextResponse.json({ ok: true, ...(await releaseSessionResults(id)) });
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
});
