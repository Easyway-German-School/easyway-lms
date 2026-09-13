import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Public: every sitting a candidate can currently book. */
export async function GET() {
  try {
    const now = new Date();
    const sessions = await prisma.examSession.findMany({
      where: { published: true, registrationDeadline: { gt: now } },
      orderBy: { startDate: "asc" },
      include: {
        modulePrices: true,
        _count: { select: { bookings: { where: { paymentStatus: "paid" } } } },
      },
    });

    return NextResponse.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        examBody: s.examBody,
        level: s.level,
        title: s.title,
        venueName: s.venueName,
        venueAddress: s.venueAddress,
        startDate: s.startDate,
        endDate: s.endDate,
        registrationDeadline: s.registrationDeadline,
        feeWholeExam: s.feeWholeExam,
        modulePrices: s.modulePrices.map((m) => ({ module: m.module, price: m.price })),
        remaining: Math.max(0, s.capacity - s._count.bookings),
        capacity: s.capacity,
      })),
    });
  } catch (error) {
    // A candidate landing on /book must see "nothing open right now", not a
    // blank crash — the frontend already treats an empty list as "check back
    // soon", so a plain 500 with JSON degrades to that instead of a raw HTML
    // error page that fails `.json()` client-side.
    console.error("Failed to load exam sessions:", error);
    return NextResponse.json({ error: "Unable to load sittings right now", sessions: [] }, { status: 500 });
  }
}
