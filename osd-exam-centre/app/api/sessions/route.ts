import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { compareSessionsByDisplayOrder } from "@/lib/session-order";

export const dynamic = "force-dynamic";

/** Public: every sitting a candidate can currently book. */
export async function GET() {
  try {
    const now = new Date();
    const disabledLevels = await prisma.examLevelSetting.findMany({
      where: { enabled: false },
      select: { level: true },
    });

    const sessions = await prisma.examSession.findMany({
      where: {
        published: true,
        registrationDeadline: { gt: now },
        level: { notIn: disabledLevels.map((l) => l.level) },
      },
      orderBy: [{ sortOrder: "asc" }, { startDate: "asc" }],
      include: {
        modulePrices: true,
        _count: { select: { bookings: { where: { paymentStatus: "paid" } } } },
      },
    });

    // sortOrder is the office's manual order; the comparator still breaks ties
    // by CEFR level so a fresh install already reads A1 → C2.
    const ordered = [...sessions].sort(compareSessionsByDisplayOrder);

    return NextResponse.json({
      sessions: ordered.map((s) => ({
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
        expressFee: s.expressFee,
        modulePrices: s.modulePrices.map((m) => ({ module: m.module, price: m.price })),
        // Real remaining always backs capacity/seat-numbering checks elsewhere;
        // this is purely what's shown to the public, overridable per sitting.
        remaining: s.displaySeatsRemaining ?? Math.max(0, s.capacity - s._count.bookings),
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
