import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { createPanthexaBooking } from "@/lib/panthexa-intake";
import { jsonRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Key in a Panthexa registration: creates the booking, the invoice number, and sends Document A with the invoice PDF. */
export const POST = jsonRoute(async (req: NextRequest) => {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json();
  if (!b.sessionId || !b.fullName || !b.email || !b.phone || !b.dateOfBirth || !b.placeOfBirth || !b.nationality) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const result = await createPanthexaBooking({
    sessionId: String(b.sessionId),
    fullName: String(b.fullName),
    email: String(b.email),
    phone: String(b.phone),
    gender: b.gender ? String(b.gender) : undefined,
    dateOfBirth: String(b.dateOfBirth),
    placeOfBirth: String(b.placeOfBirth),
    nationality: String(b.nationality),
    modules: Array.isArray(b.modules) ? b.modules.map(String) : ["full"],
    express: Boolean(b.express),
    registeredOn: b.registeredOn ? String(b.registeredOn) : undefined,
    panthexaReference: b.panthexaReference ? String(b.panthexaReference) : undefined,
    isRepeatAttempt: Boolean(b.isRepeatAttempt),
    specialNeeds: b.specialNeeds ? String(b.specialNeeds) : undefined,
  });

  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : result.code === "duplicate" ? 409 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json(result);
});
