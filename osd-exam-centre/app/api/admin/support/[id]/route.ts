import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { replyToSupportMessage, resolveSupportMessage } from "@/lib/support";
import { jsonRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

export const PATCH = jsonRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  if (body.reply && typeof body.reply === "object") {
    const result = await replyToSupportMessage(id, {
      subject: String(body.reply.subject ?? ""),
      body: String(body.reply.body ?? ""),
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  await resolveSupportMessage(id);
  return NextResponse.json({ ok: true });
});
