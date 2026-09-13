import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminRequest } from "@/lib/admin-auth";
import { MODULES } from "@/lib/booking";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const sessions = await prisma.examSession.findMany({
      orderBy: { startDate: "desc" },
      include: { modulePrices: true, _count: { select: { bookings: true } } },
    });
    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("Failed to load sessions:", error);
    return NextResponse.json({ error: "Unable to load sittings", sessions: [] }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json();

  if (!b.level || !b.title || !b.venueName || !b.startDate || !b.registrationDeadline || !b.capacity || !b.feeWholeExam) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const modulePrices = MODULES
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
      feeWholeExam: Number(b.feeWholeExam),
      published: Boolean(b.published),
      modulePrices: { create: modulePrices },
    },
  });

  return NextResponse.json({ session });
}

/**
 * Edits an existing sitting — including just the publish toggle, which used
 * to be this route's only job. Fixing a typo'd fee or date after candidates
 * have already booked doesn't change their feeTotal (that was snapshotted
 * at booking time in ExamBooking.feeTotal on purpose — a school raising its
 * price mid-registration must never silently reprice someone who already
 * booked at the old one).
 */
export async function PATCH(req: NextRequest) {
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
  if (b.capacity) data.capacity = Number(b.capacity);
  if (b.feeWholeExam) data.feeWholeExam = Number(b.feeWholeExam);

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
      const modulePrices = MODULES.filter((m) => b.modulePrices[m]).map((m) => ({ sessionId, module: m, price: Number(b.modulePrices[m]) }));
      if (modulePrices.length) await tx.examModulePrice.createMany({ data: modulePrices });
    }

    return updated;
  });

  return NextResponse.json({ session });
}
