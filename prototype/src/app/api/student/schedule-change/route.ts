import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * "YOUR CLASS TIME CHANGED."
 *
 * When the office switches a sitting or an attendance mode off on
 * /admin/settings, the students in it are moved to the nearest one that still
 * runs and a `scheduleChange` stamp is written onto their admission record (see
 * /api/admin/settings). This is the single-row question the Becca moment asks
 * so it can greet the student on their next portal page with what actually
 * happened — a bell notification and a portal card go out too, but neither puts
 * it in front of someone the way this does.
 *
 * Returns the stamp as-is; the moment keys "seen" on its `at` timestamp so a
 * second change months later greets them again.
 */
export async function GET() {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const student = await prisma.student.findUnique({
      where: { userId: session.user.id },
      select: { admission: true, level: true },
    });

    const admission =
      student?.admission && typeof student.admission === "object"
        ? (student.admission as Record<string, unknown>)
        : {};
    const raw = admission.scheduleChange;
    if (!raw || typeof raw !== "object") return NextResponse.json({ change: null });

    const change = raw as Record<string, unknown>;
    if (typeof change.at !== "string" || typeof change.to !== "string") {
      return NextResponse.json({ change: null });
    }

    return NextResponse.json({
      change: {
        kind: change.kind === "mode" ? "mode" : "slot",
        level: typeof change.level === "string" ? change.level : student?.level ?? "",
        from: typeof change.from === "string" ? change.from : "",
        to: change.to,
        at: change.at,
      },
    });
  } catch (error) {
    console.error("schedule-change lookup failed:", error);
    return NextResponse.json({ change: null });
  }
}
