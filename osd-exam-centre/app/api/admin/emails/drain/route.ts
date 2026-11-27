import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { drainEmailQueue } from "@/lib/journey";
import { jsonRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Admin: force-resend invoices/receipts that may have been dropped by SMTP, then sweep due steps. */
export const POST = jsonRoute(async () => {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await drainEmailQueue();
  return NextResponse.json({ ok: true, ...result });
});
