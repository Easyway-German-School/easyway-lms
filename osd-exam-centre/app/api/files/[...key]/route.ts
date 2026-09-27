import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { readUpload } from "@/lib/storage";
import { jsonRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/**
 * Serves a passport photo / passport data page / bank-transfer slip out of
 * the (private) S3-compatible bucket. Admin-only — these are the same
 * documents `storeUpload` in lib/storage.ts writes, and the whole reason
 * this route exists is that the bucket is deliberately NOT public: a raw
 * bucket URL would make a passport photo fetchable by anyone who ever sees
 * the link, forever. No candidate-facing page links to these (the booking
 * page only shows a checkmark once uploaded), so admin-only is the whole
 * access list this needs.
 */
export const GET = jsonRoute(async (_req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) => {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { key } = await params;
  const file = await readUpload(key.join("/"));
  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(file.buffer), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
    },
  });
});
