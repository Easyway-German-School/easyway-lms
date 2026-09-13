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

export async function PATCH(req: NextRequest) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { sessionId, published } = await req.json();
  if (!sessionId || typeof published !== "boolean") {
    return NextResponse.json({ error: "sessionId and published are required" }, { status: 400 });
  }
  const session = await prisma.examSession.update({ where: { id: sessionId }, data: { published } });
  return NextResponse.json({ session });
}
