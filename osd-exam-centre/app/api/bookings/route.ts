import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createBooking, MODULES } from "@/lib/booking";
import { jsonRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

const schema = z.object({
  sessionId: z.string().min(1),
  fullName: z.string().min(2, "Enter your full name as it appears on your passport."),
  email: z.string().email(),
  phone: z.string().min(7),
  addressLine: z.string().min(3),
  city: z.string().min(1),
  country: z.string().optional(),
  dateOfBirth: z.string().min(1),
  placeOfBirth: z.string().min(1),
  modules: z.array(z.enum([...MODULES, "full"])).min(1),
});

export const POST = jsonRoute(async (req: NextRequest) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid booking details" }, { status: 400 });
  }

  const result = await createBooking(parsed.data);
  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : result.code === "closed" ? 409 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ referenceCode: result.referenceCode, feeTotal: result.feeTotal });
});
