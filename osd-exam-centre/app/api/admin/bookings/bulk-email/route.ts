import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminRequest } from "@/lib/admin-auth";
import { jsonRoute } from "@/lib/api-route";
import { sendCustomEmail, sendJourneyStep } from "@/lib/journey";
import { missingAdmissionFields, type StatusFacts } from "@/lib/candidate-status";
import { JOURNEY_ORDER, type JourneyStep } from "@/lib/journey-emails";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Office-defined groups — plain facts on the booking, not the admin pipeline's own filter tabs (those are about what the OFFICE should do next; these are about what the CANDIDATE hasn't done). */
const CATEGORIES = ["unpaid", "id_missing", "details_incomplete", "everyone_live"] as const;
type Category = (typeof CATEGORIES)[number];

function matches(category: Category, b: StatusFacts): boolean {
  if (category === "unpaid") return b.paymentStatus === "unpaid" || b.paymentStatus === "pending_verification";
  if (category === "id_missing") return !b.passportDataPageUrl;
  if (category === "details_incomplete") return missingAdmissionFields(b).length > 0 || !b.infoConfirmedAt;
  return true; // everyone_live
}

/**
 * One email, sent to every LIVE candidate matching a plain category — "hasn't
 * paid", "hasn't uploaded an ID", "details incomplete", or everyone. Either a
 * fixed journey step (force-resent, so it goes out even if already sent
 * once) or the office's own free-text subject+message, same as the per-
 * candidate custom email.
 */
export const POST = jsonRoute(async (req: NextRequest) => {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const category = String(body.category ?? "") as Category;
  if (!CATEGORIES.includes(category)) return NextResponse.json({ error: "Unknown category" }, { status: 400 });

  const step = body.step ? (String(body.step) as JourneyStep) : null;
  if (step && !JOURNEY_ORDER.includes(step)) return NextResponse.json({ error: "Unknown email" }, { status: 400 });
  const custom = body.custom as { subject?: string; message?: string } | undefined;
  const subjectLine = custom?.subject?.trim();
  const message = custom?.message?.trim();
  if (!step && !(subjectLine && message)) {
    return NextResponse.json({ error: "Pick a journey email, or write a subject and message." }, { status: 400 });
  }

  const bookings = await prisma.examBooking.findMany({
    where: { status: { notIn: ["cancelled", "no_show"] } },
    select: {
      id: true, status: true, paymentStatus: true, passportDataPageUrl: true, documentStatus: true, infoConfirmedAt: true,
      countryOfBirth: true, addressLine: true, city: true, idType: true, idNumber: true, idExpiry: true,
      admittedAt: true, examCompletedAt: true, resultReleasedAt: true, certificateReadyAt: true, certificateDeliveredAt: true,
    },
  });
  const targets = bookings.filter((b) => matches(category, b));

  let sent = 0;
  let failed = 0;
  for (const b of targets) {
    const result = step
      ? await sendJourneyStep(b.id, step, { force: true })
      : await sendCustomEmail(b.id, subjectLine!, message!);
    if (result.ok) sent++;
    else failed++;
  }

  return NextResponse.json({ ok: true, matched: targets.length, sent, failed });
});
