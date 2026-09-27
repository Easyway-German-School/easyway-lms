import { NextRequest, NextResponse } from "next/server";
import { storeUpload } from "@/lib/storage";
import { resolveOwnedBooking } from "@/lib/booking";
import { jsonRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024; // 8MB — a phone photo of a passport page, not a video

/**
 * "photos" is the passport photograph — images only, never a PDF. The other
 * two folders take either, since a passport data page or a bank slip is
 * sometimes a scanned PDF rather than a photo.
 */
const ALLOWED_TYPES: Record<string, Set<string>> = {
  photos: new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]),
  documents: new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]),
  slips: new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]),
};

/**
 * One shared upload endpoint for the passport photo, the passport data page,
 * and payment slips. Requires the booking it belongs to — `reference` +
 * `email` are checked the same way every other candidate-facing route
 * checks ownership — so this can't be used as an anonymous file drop with
 * no booking behind it, and every upload lands under a real, checkable
 * candidate. The MIME type is validated against a per-folder allowlist
 * (a passport photo can never be a PDF, for instance) rather than accepted
 * as whatever the browser claims it is unchecked.
 */
export const POST = jsonRoute(async (req: NextRequest) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const folder = String(form?.get("folder") || "documents");
  const reference = String(form?.get("reference") || "");
  const email = String(form?.get("email") || "");

  if (!reference || !email) {
    return NextResponse.json({ error: "This upload must be tied to a booking" }, { status: 400 });
  }
  const booking = await resolveOwnedBooking(reference, email);
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  const allowedTypes = ALLOWED_TYPES[folder];
  if (!allowedTypes) {
    return NextResponse.json({ error: "Invalid folder" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!allowedTypes.has(file.type)) {
    return NextResponse.json({ error: `That file type isn't accepted here — use a photo (JPEG/PNG/WEBP/HEIC)${folder !== "photos" ? " or a PDF" : ""}.` }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File is too large (max 8MB)" }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const stored = await storeUpload(buffer, { folder, filename: file.name, contentType: file.type });
  return NextResponse.json({ url: stored.url });
});
