import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { jsonRoute } from "@/lib/api-route";
import { listEmailAttention, resendAttentionEmails } from "@/lib/journey";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = jsonRoute(async () => {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const items = await listEmailAttention();
  return NextResponse.json({ items, count: items.length });
});

export const POST = jsonRoute(async (req: Request) => {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const items = Array.isArray(body.items) ? body.items : null;
  if (!items || items.length === 0) {
    return NextResponse.json({ error: "Pass items: [{ bookingId, step }, …]" }, { status: 400 });
  }
  const cleaned = items
    .map((i: { bookingId?: string; step?: string }) => ({
      bookingId: String(i.bookingId ?? "").trim(),
      step: String(i.step ?? "").trim(),
    }))
    .filter((i: { bookingId: string; step: string }) => i.bookingId && i.step);

  if (cleaned.length === 0) {
    return NextResponse.json({ error: "No valid items to resend." }, { status: 400 });
  }

  const result = await resendAttentionEmails(cleaned);
  return NextResponse.json(result);
});
