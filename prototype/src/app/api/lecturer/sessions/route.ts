import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMergedSchedule, dayKey, normalizeSlot, TIME_SLOTS } from "@/lib/class-sessions";
import { NextRequest, NextResponse } from "next/server";

/**
 * Lets a tutor (or admin) put real detail on a timetable day: the topic being
 * taught, the clock times, whether it was postponed, and which material to
 * bring. Students read the same rows through /api/schedule, so an edit here
 * shows up on their calendar immediately.
 */

export const dynamic = "force-dynamic";

const STATUSES = ["scheduled", "postponed", "cancelled", "held"];

async function requireStaff() {
  const session = (await getServerSession(authOptions as any)) as any;
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, lecturer: { select: { id: true } } },
  });

  const role = (user?.role ?? "").toLowerCase();
  if (role !== "lecturer" && role !== "admin") {
    return { error: NextResponse.json({ error: "Staff access required" }, { status: 403 }) };
  }

  return { userId: user!.id, role, lecturerId: user?.lecturer?.id ?? null };
}

/** GET — the merged timetable for one branch+level, so the tutor edits in context. */
export async function GET(req: NextRequest) {
  const auth = await requireStaff();
  if (auth.error) return auth.error;

  try {
    const branchId = req.nextUrl.searchParams.get("branchId");
    const level = req.nextUrl.searchParams.get("level") ?? "A1";
    const batch = req.nextUrl.searchParams.get("batch");

    if (!branchId) {
      return NextResponse.json({ error: "branchId is required" }, { status: 400 });
    }

    const schedule = await getMergedSchedule({
      branchId,
      level,
      batch,
      now: new Date(),
      months: 2,
    });

    // Everything the editor needs to populate its dropdowns.
    const [branches, materials] = await Promise.all([
      prisma.branch.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.material.findMany({
        orderBy: { title: "asc" },
        select: { id: true, title: true, fileType: true, course: { select: { level: true } } },
      }),
    ]);

    return NextResponse.json({ ...schedule, branches, materials, timeSlots: TIME_SLOTS });
  } catch (error) {
    console.error("Lecturer sessions GET failed:", error);
    return NextResponse.json({ error: "Unable to load the timetable" }, { status: 500 });
  }
}

/** PUT — create or update the override for a single day. */
export async function PUT(req: NextRequest) {
  const auth = await requireStaff();
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const { branchId, level, date, timeSlot, topic, notes, status, startTime, endTime, materialId, postponedTo } = body;

    if (!branchId || !level || !date) {
      return NextResponse.json({ error: "branchId, level and date are required" }, { status: 400 });
    }
    if (status && !STATUSES.includes(status)) {
      return NextResponse.json({ error: `status must be one of ${STATUSES.join(", ")}` }, { status: 400 });
    }

    const slot = normalizeSlot(timeSlot);
    const day = dayKey(date);

    const data = {
      topic: typeof topic === "string" ? topic.trim() || null : undefined,
      notes: typeof notes === "string" ? notes.trim() || null : undefined,
      status: status ?? undefined,
      startTime: typeof startTime === "string" ? startTime.trim() || null : undefined,
      endTime: typeof endTime === "string" ? endTime.trim() || null : undefined,
      materialId: materialId === null ? null : (typeof materialId === "string" && materialId ? materialId : undefined),
      postponedTo: postponedTo ? new Date(postponedTo) : postponedTo === null ? null : undefined,
      // Record who last touched the day, when we know which lecturer they are.
      lecturerId: auth.lecturerId ?? undefined,
    };

    const saved = await prisma.classSession.upsert({
      where: {
        branchId_level_date_timeSlot: { branchId, level: level.toUpperCase(), date: day, timeSlot: slot },
      },
      update: data,
      create: {
        branchId,
        level: level.toUpperCase(),
        date: day,
        timeSlot: slot,
        ...data,
        // upsert-create needs concrete values, not the `undefined` no-ops above.
        topic: typeof topic === "string" ? topic.trim() || null : null,
        status: status ?? "scheduled",
      },
      include: {
        material: { select: { id: true, title: true, filePath: true, fileType: true } },
        lecturer: { select: { user: { select: { name: true } } } },
      },
    });

    return NextResponse.json({ session: saved });
  } catch (error) {
    console.error("Lecturer sessions PUT failed:", error);
    return NextResponse.json({ error: "Unable to save this class" }, { status: 500 });
  }
}
