import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminRequest } from "@/lib/admin-auth";
import { jsonRoute } from "@/lib/api-route";
import { admissionChecklist, deriveStatus } from "@/lib/candidate-status";

export const dynamic = "force-dynamic";

export const GET = jsonRoute(async () => {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.examBooking.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      session: { select: { id: true, title: true, level: true, startDate: true, capacity: true } },
      journeyEmails: { select: { step: true, subject: true, sentAt: true }, orderBy: { sentAt: "asc" } },
    },
  });

  // The status and the admission checklist are derived server-side from the
  // booking's facts (lib/candidate-status.ts) so the admin screen can never
  // show a stage the rules wouldn't agree with.
  const bookings = rows.map((b) => ({ ...b, derived: deriveStatus(b), checklist: admissionChecklist(b) }));
  return NextResponse.json({ bookings });
});
