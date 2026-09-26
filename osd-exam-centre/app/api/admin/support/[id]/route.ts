import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { resolveSupportMessage } from "@/lib/support";
import { jsonRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

export const PATCH = jsonRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await resolveSupportMessage(id);
  return NextResponse.json({ ok: true });
});
