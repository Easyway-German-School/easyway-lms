import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminRequest } from "@/lib/admin-auth";
import { toCsv } from "@/lib/csv";
import { jsonRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

const COLUMNS = [
  "seatNumber", "referenceCode", "fullName", "email", "phone",
  "dateOfBirth", "placeOfBirth", "countryOfBirth", "nationality", "gender",
  "idType", "idNumber", "idExpiry",
  "addressLine", "city", "country",
  "modules", "isRepeatAttempt", "specialNeeds", "documentStatus",
];

/** The exam-day candidate list — confirmed (paid + seated) bookings only, one row per candidate, sorted by seat. */
export const GET = jsonRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const session = await prisma.examSession.findUnique({ where: { id } });
  if (!session) return NextResponse.json({ error: "Sitting not found" }, { status: 404 });

  const bookings = await prisma.examBooking.findMany({
    where: { sessionId: id, seatNumber: { not: null } },
    orderBy: { seatNumber: "asc" },
  });

  const csv = toCsv(
    bookings.map((b) => ({
      seatNumber: b.seatNumber,
      referenceCode: b.referenceCode,
      fullName: b.fullName,
      email: b.email,
      phone: b.phone,
      dateOfBirth: b.dateOfBirth.toISOString().slice(0, 10),
      placeOfBirth: b.placeOfBirth,
      countryOfBirth: b.countryOfBirth,
      nationality: b.nationality,
      gender: b.gender,
      idType: b.idType,
      idNumber: b.idNumber,
      idExpiry: b.idExpiry ? b.idExpiry.toISOString().slice(0, 10) : "",
      addressLine: b.addressLine,
      city: b.city,
      country: b.country,
      modules: b.modules.join(" "),
      isRepeatAttempt: b.isRepeatAttempt ? "yes" : "no",
      specialNeeds: b.specialNeeds,
      documentStatus: b.documentStatus,
    })),
    COLUMNS,
  );

  const filename = `${session.title.replace(/[^a-z0-9]+/gi, "-")}-roster.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
