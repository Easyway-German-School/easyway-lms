import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminRequest } from "@/lib/admin-auth";
import { MODULES } from "@/lib/booking";

// Written/Oral are how ÖSD is sold here (the school's invoice); the four skills stay for older sittings.
const PRICEABLE_MODULES = ["written", "oral", ...MODULES] as const;

function cleanTime(value: unknown): string | null {
  return typeof value === "string" && /^\d{1,2}:\d{2}$/.test(value) ? value : null;
}
import { jsonRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

export const GET = jsonRoute(async () => {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sessions = await prisma.examSession.findMany({
    orderBy: { startDate: "desc" },
    include: { modulePrices: true, _count: { select: { bookings: true } } },
  });
  return NextResponse.json({ sessions });
});

export const POST = jsonRoute(async (req: NextRequest) => {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json();

  if (!b.level || !b.title || !b.venueName || !b.startDate || !b.registrationDeadline || !b.capacity || !b.feeWholeExam) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const modulePrices = PRICEABLE_MODULES
    .filter((m) => b.modulePrices?.[m])
    .map((m) => ({ module: m, price: Number(b.modulePrices[m]) }));

  const session = await prisma.examSession.create({
    data: {
      examBody: b.examBody || "ÖSD",
      level: String(b.level),
      title: String(b.title),
      venueName: String(b.venueName),
      venueAddress: String(b.venueAddress || ""),
      startDate: new Date(b.startDate),
      endDate: new Date(b.endDate || b.startDate),
      registrationDeadline: new Date(b.registrationDeadline),
      capacity: Number(b.capacity),
      examFormat: b.examFormat === "computer" ? "computer" : "paper",
      feeWholeExam: Number(b.feeWholeExam),
      expressFee: Number(b.expressFee) > 0 ? Number(b.expressFee) : 0,
      startTime: cleanTime(b.startTime),
      arrivalMinutesBefore: Number(b.arrivalMinutesBefore) > 0 ? Number(b.arrivalMinutesBefore) : 60,
      published: Boolean(b.published),
      modulePrices: { create: modulePrices },
    },
  });

  return NextResponse.json({ session });
});

/**
 * Edits an existing sitting — including just the publish toggle, which used
 * to be this route's only job. Fixing a typo'd fee or date after candidates
 * have already booked doesn't change their feeTotal (that was snapshotted
 * at booking time in ExamBooking.feeTotal on purpose — a school raising its
 * price mid-registration must never silently reprice someone who already
 * booked at the old one).
 */
export const PATCH = jsonRoute(async (req: NextRequest) => {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json();
  const { sessionId } = b;
  if (!sessionId) return NextResponse.json({ error: "sessionId is required" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (typeof b.published === "boolean") data.published = b.published;
  if (b.title) data.title = String(b.title);
  if (b.venueName) data.venueName = String(b.venueName);
  if (b.venueAddress !== undefined) data.venueAddress = String(b.venueAddress);
  if (b.level) data.level = String(b.level);
  if (b.startDate) data.startDate = new Date(b.startDate);
  if (b.endDate) data.endDate = new Date(b.endDate);
  if (b.registrationDeadline) data.registrationDeadline = new Date(b.registrationDeadline);
  if (b.feeWholeExam) data.feeWholeExam = Number(b.feeWholeExam);
  if (b.expressFee !== undefined) data.expressFee = Number(b.expressFee) > 0 ? Number(b.expressFee) : 0;
  if (b.startTime !== undefined) data.startTime = cleanTime(b.startTime);
  if (b.arrivalMinutesBefore) data.arrivalMinutesBefore = Number(b.arrivalMinutesBefore);
  if (b.examFormat === "paper" || b.examFormat === "computer") data.examFormat = b.examFormat;

  // Capacity needs its own check, not just a blind assignment: dropping it
  // below the number of seats already confirmed would silently make
  // seatNumberForIndex() (lib/seat-numbering.ts) hand out a seat number
  // past the new "capacity" on the next confirmation, or worse, make an
  // already-seated candidate's seat look like it shouldn't exist.
  if (b.capacity) {
    const newCapacity = Number(b.capacity);
    const taken = await prisma.examBooking.count({ where: { sessionId, seatNumber: { not: null } } });
    if (newCapacity < taken) {
      return NextResponse.json(
        { error: `Can't lower capacity to ${newCapacity} — ${taken} seats are already confirmed for this sitting.` },
        { status: 400 },
      );
    }
    data.capacity = newCapacity;
  }

  if (Object.keys(data).length === 0 && !b.modulePrices) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const session = await prisma.$transaction(async (tx) => {
    const updated = Object.keys(data).length
      ? await tx.examSession.update({ where: { id: sessionId }, data })
      : await tx.examSession.findUniqueOrThrow({ where: { id: sessionId } });

    if (b.modulePrices) {
      // Replace wholesale rather than diff — simpler, and this only ever
      // runs from the admin edit form submitting its whole current state.
      await tx.examModulePrice.deleteMany({ where: { sessionId } });
      const modulePrices = PRICEABLE_MODULES.filter((m) => b.modulePrices[m]).map((m) => ({ sessionId, module: m, price: Number(b.modulePrices[m]) }));
      if (modulePrices.length) await tx.examModulePrice.createMany({ data: modulePrices });
    }

    return updated;
  });

  return NextResponse.json({ session });
});
