import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminRequest } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const bookings = await prisma.examBooking.findMany({
      orderBy: { createdAt: "desc" },
      include: { session: { select: { title: true, level: true, startDate: true, capacity: true } } },
    });
    return NextResponse.json({ bookings });
  } catch (error) {
    console.error("Failed to load bookings:", error);
    return NextResponse.json({ error: "Unable to load bookings", bookings: [] }, { status: 500 });
  }
}
