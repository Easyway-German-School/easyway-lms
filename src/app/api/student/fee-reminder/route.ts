import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { studentIdsSilenced } from "@/lib/fee-reminder-settings";

/**
 * Whether Becca's fee pop-up is switched on for this student's school.
 *
 * Deliberately just the switch. The figures on the card come from the same
 * `/api/student/access` payload the lock screen already renders, so the pop-up
 * can never quote a number the lock screen disagrees with — see
 * components/moment/FeeReminderMoment.tsx.
 */
export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id as string },
    select: { id: true },
  });
  if (!student) return NextResponse.json({ enabled: false });

  const silenced = await studentIdsSilenced("becca", [student.id]);
  return NextResponse.json({ enabled: !silenced.has(student.id) }, { headers: { "Cache-Control": "no-store" } });
}
