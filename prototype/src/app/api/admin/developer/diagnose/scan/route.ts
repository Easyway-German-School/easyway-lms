import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { scanDiagnoses } from "@/lib/diagnose-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Scan one bounded page of the signed-in school's students. */
export async function POST(request: Request) {
  const gate = await requireCapability("security");
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as { cursor?: unknown };
  const cursor = body.cursor;
  if (
    cursor !== undefined &&
    cursor !== null &&
    (typeof cursor !== "string" || cursor.length < 1 || cursor.length > 128)
  ) {
    return NextResponse.json({ error: "Invalid scan cursor" }, { status: 400 });
  }

  return NextResponse.json(await scanDiagnoses(typeof cursor === "string" ? cursor : null));
}
