import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { createManualBooking } from "@/lib/booking";
import { jsonRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** The office booking on behalf of a phone/walk-in candidate — see lib/booking.ts createManualBooking. */
export const POST = jsonRoute(async (req: NextRequest) => {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json();

  if (
    !b.sessionId || !b.fullName || !b.email || !b.phone || !b.addressLine || !b.city ||
    !b.dateOfBirth || !b.placeOfBirth || !b.countryOfBirth || !b.nationality ||
    !b.idType || !b.idNumber || !b.idExpiry
  ) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const result = await createManualBooking(
    {
      sessionId: b.sessionId,
      fullName: b.fullName,
      email: b.email,
      phone: b.phone,
      addressLine: b.addressLine,
      city: b.city,
      country: b.country,
      dateOfBirth: b.dateOfBirth,
      placeOfBirth: b.placeOfBirth,
      countryOfBirth: b.countryOfBirth,
      nationality: b.nationality,
      gender: b.gender,
      idType: b.idType,
      idNumber: b.idNumber,
      idExpiry: b.idExpiry,
      isRepeatAttempt: b.isRepeatAttempt,
      specialNeeds: b.specialNeeds,
      modules: Array.isArray(b.modules) && b.modules.length ? b.modules : ["full"],
    },
    "office",
  );

  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : result.code === "duplicate" ? 409 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ referenceCode: result.referenceCode, feeTotal: result.feeTotal });
});
