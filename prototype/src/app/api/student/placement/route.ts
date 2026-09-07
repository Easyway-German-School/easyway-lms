import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { KIND, notify } from "@/lib/notify";
import { isOnlineBranch } from "@/lib/online-branch";

export const dynamic = "force-dynamic";

/**
 * A student placing themselves into a branch.
 *
 * The office adds a branch on the Add-student form and the importer fills it
 * for online rows, but students who came in on a sheet with the column blank
 * land with `branchId = null` — no timetable cohort, no roster, no study group,
 * no fee table. Becca nudges them (see src/lib/branch-nudge.ts) and this is
 * where the answer is written.
 *
 * DELIBERATELY FIRST-TIME ONLY. This sets a branch that was never set; it does
 * not let a student MOVE between branches, because a branch change re-prices
 * tuition and re-scopes their community and roster — an office decision, not a
 * self-service one. A student who already has a branch gets a 409 here and is
 * told to contact the office.
 *
 * For a student who is not at any campus, the branch becomes the Online branch
 * and we still capture where in the world they are — the diaspora is half the
 * reason the Online branch exists, and their timetable is shown in their own
 * timezone.
 */

const NIGERIA = "Nigeria";

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(req: NextRequest) {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true, branchId: true, deliveryMode: true, admission: true, user: { select: { name: true } } },
  });
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }
  if (student.branchId) {
    return NextResponse.json(
      { error: "You already have a branch. To move branches, contact the school office." },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const branchId = str(body.branchId);
  // Campus unless they explicitly said otherwise. `atCampus: false` is the
  // "I study online" path; anything else needs a real branch id.
  const atCampus = body.atCampus !== false;
  const country = str(body.country);
  const state = str(body.state);
  const city = str(body.city);
  const timezone = str(body.timezone);

  const branches = await prisma.branch.findMany({
    where: { status: "active" },
    select: { id: true, name: true, mode: true },
  });

  let chosen: { id: string; name: string; mode: string | null } | undefined;

  if (atCampus) {
    chosen = branches.find((b) => b.id === branchId);
    if (!chosen) {
      return NextResponse.json({ error: "That branch could not be found." }, { status: 400 });
    }
  } else {
    // Not at a campus — place them at the Online branch, and require enough
    // location to know which part of the world their timetable is quoted in.
    if (!country) {
      return NextResponse.json({ error: "Tell us which country you are in." }, { status: 400 });
    }
    if (country === NIGERIA && !state) {
      return NextResponse.json({ error: "Pick your state." }, { status: 400 });
    }
    if (country !== NIGERIA && !city) {
      return NextResponse.json({ error: "Tell us the city or region you are in." }, { status: 400 });
    }
    chosen = branches.find((b) => isOnlineBranch(b));
    if (!chosen) {
      return NextResponse.json(
        { error: "Online study is not set up for your school yet — contact the office." },
        { status: 400 },
      );
    }
  }

  const isOnline = isOnlineBranch(chosen);
  const currentAdmission: Record<string, unknown> =
    typeof student.admission === "object" && student.admission !== null
      ? (student.admission as Record<string, unknown>)
      : {};
  const currentOnline =
    typeof currentAdmission.online === "object" && currentAdmission.online !== null
      ? (currentAdmission.online as Record<string, unknown>)
      : {};

  await prisma.student.update({
    where: { id: student.id },
    data: {
      branchId: chosen.id,
      // A student who says "I study online" is telling us their delivery mode.
      // Never downgrade someone the office set as hybrid.
      deliveryMode: isOnline && student.deliveryMode !== "hybrid" ? "online" : student.deliveryMode,
      admission: {
        ...currentAdmission,
        branch: chosen.name,
        country: country || currentAdmission.country,
        state: state || currentAdmission.state,
        city: city || currentAdmission.city,
        ...(isOnline
          ? { online: { ...currentOnline, ...(timezone ? { timezone } : {}) } }
          : {}),
        placedByStudentAt: new Date().toISOString(),
      },
    },
  });

  const name = student.user?.name ?? "A student";
  const where = atCampus
    ? chosen.name
    : [chosen.name, country === NIGERIA ? state : city, country].filter(Boolean).join(" · ");

  await notify({
    to: { audience: "admin", capability: "students" },
    kind: KIND.general,
    severity: "info",
    title: `${name} set their branch`,
    message: `${name} placed themselves at ${where}. Check their cohort, tutor and fee are right.`,
    link: `/admin/students?search=${encodeURIComponent(name)}`,
    push: false,
  }).catch((error) => console.error("Branch-placement office notice failed", error));

  return NextResponse.json({ ok: true, branch: chosen.name, online: isOnline });
}
