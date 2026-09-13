import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createBooking, isPlausibleDateOfBirth, MODULES } from "@/lib/booking";
import { jsonRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

const schema = z.object({
  sessionId: z.string().min(1),
  fullName: z.string().min(2, "Enter your full name as it appears on your passport."),
  email: z.string().email(),
  phone: z.string().min(7, "Enter a valid phone number.").max(20),
  addressLine: z.string().min(3),
  city: z.string().min(1),
  country: z.string().optional(),
  dateOfBirth: z.string().refine(isPlausibleDateOfBirth, "Enter a valid date of birth."),
  placeOfBirth: z.string().min(1),
  modules: z.array(z.enum([...MODULES, "full"])).min(1),
  consentAccepted: z.literal(true, { message: "You must accept the rules and data-consent notice." }),
  // Honeypot: a real candidate never sees or fills this field (hidden
  // off-screen in the form) — anything filling it is a bot. Deliberately NOT
  // constrained to length 0 here: that would reject it at the schema stage
  // with an honest validation error, defeating the point. The runtime check
  // below is what actually catches it, after everything else has "passed".
  website: z.string().optional(),
});

export const POST = jsonRoute(async (req: NextRequest) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // The honeypot failing validation looks, from the outside, exactly like
    // every other rejection — no distinct response a bot could learn from.
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid booking details" }, { status: 400 });
  }
  if (parsed.data.website) {
    return NextResponse.json({ referenceCode: "EW-OSD-0000-00000", feeTotal: 0 });
  }

  const result = await createBooking(parsed.data);
  if (!result.ok) {
    const status =
      result.code === "not_found" ? 404 :
      result.code === "closed" || result.code === "duplicate" ? 409 :
      result.code === "rate_limited" ? 429 :
      400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ referenceCode: result.referenceCode, feeTotal: result.feeTotal });
});
