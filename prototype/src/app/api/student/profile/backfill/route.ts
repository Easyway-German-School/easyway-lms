import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { KIND, notify } from "@/lib/notify";
import { mergeProfile, normalizeProfileInput } from "@/lib/student-profile";
import {
  assessProfileBackfill,
  backfillPrefill,
  missingBackfillFields,
  BACKFILL_SNOOZE_DAYS,
} from "@/lib/profile-backfill";

export const dynamic = "force-dynamic";

/**
 * Becca recreating the important parts of the sign-up form for a student the
 * office onboarded by hand. See src/lib/profile-backfill.ts for the six
 * fields, what counts as "already have it", and when this is due at all.
 *
 * GET   — { due, missing, prefill, studentName }: what the wizard should show.
 * POST  — a partial set of answers. Every field is optional; the wizard only
 *         submits the ones the student actually filled. Answers merge into the
 *         typed StudentProfile row (and, for "why German", the admission blob),
 *         exactly where the sign-up form would have put them.
 *         { complete: true }  — they reached the end / tapped Done. If nothing
 *                               is left missing, the account is marked done and
 *                               the office is told.
 *         { dismiss: true }   — "skip for now": snoozes this (and the weekly
 *                               nudge) for a fortnight. Anything they typed is
 *                               still saved.
 *
 * DELIBERATELY not gated to off-form students only for the WRITE — a student
 * filling in their own profile fields is always fine — but the completion
 * mark and the office notice only fire when `assessProfileBackfill` says this
 * student was actually in scope.
 */

async function loadStudent(userId: string) {
  return prisma.student.findUnique({
    where: { userId },
    select: {
      id: true,
      tenantId: true,
      admission: true,
      profile: true,
      user: { select: { name: true, tenantId: true } },
    },
  });
}

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const student = await loadStudent(session.user.id);
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const admission = (student.admission ?? {}) as Record<string, unknown>;
  const assessment = assessProfileBackfill(admission, student.profile);

  return NextResponse.json({
    due: assessment.due,
    applicable: assessment.applicable,
    done: assessment.done,
    snoozed: assessment.snoozed,
    missing: assessment.missing,
    prefill: backfillPrefill(admission, student.profile),
    studentName: student.user?.name ?? "there",
  });
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(req: NextRequest) {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const student = await loadStudent(session.user.id);
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const dismiss = body?.dismiss === true;
  const complete = body?.complete === true;

  const whatsapp = str(body?.whatsapp);
  const dateOfBirth = str(body?.dateOfBirth);
  const city = str(body?.city);
  const stateRegion = str(body?.stateRegion);
  const country = str(body?.country);
  const emergencyName = str(body?.emergencyName);
  const emergencyPhone = str(body?.emergencyPhone);
  const occupation = str(body?.occupation);
  const goal = str(body?.goal);

  const tenantId = student.tenantId ?? student.user?.tenantId ?? null;

  // ── The typed profile fields ──────────────────────────────────────────────
  // normalizeProfileInput parses `dateOfBirth` (ISO from <input type=date>, or
  // a legacy DD/MM/YYYY string) the same way every other writer does.
  const incoming = normalizeProfileInput({
    ...(whatsapp ? { whatsapp } : {}),
    ...(dateOfBirth ? { dateOfBirth } : {}),
    ...(city ? { city } : {}),
    ...(stateRegion ? { stateRegion } : {}),
    ...(country ? { country } : {}),
    ...(emergencyName ? { emergencyName } : {}),
    ...(emergencyPhone ? { emergencyPhone } : {}),
    ...(occupation ? { occupation } : {}),
  });

  if (Object.keys(incoming).length > 0) {
    const merged = mergeProfile(student.profile ?? {}, incoming);
    await prisma.studentProfile.upsert({
      where: { studentId: student.id },
      create: { studentId: student.id, tenantId, ...merged },
      update: merged,
    });
  }

  // ── The admission blob ────────────────────────────────────────────────────
  // "Why German" has no column, so it lives here. City/state/whatsapp/dob are
  // mirrored across too — the same thing the branch-placement route does — so
  // read paths that still look at the blob stay in step with the typed row.
  const currentAdmission: Record<string, unknown> =
    student.admission && typeof student.admission === "object"
      ? (student.admission as Record<string, unknown>)
      : {};

  const nextAdmission: Record<string, unknown> = { ...currentAdmission };
  if (goal) nextAdmission.goal = goal;
  if (whatsapp && !str(currentAdmission.phone)) nextAdmission.phone = whatsapp;
  if (city) nextAdmission.city = city;
  if (stateRegion) nextAdmission.state = stateRegion;
  if (country) nextAdmission.country = country;
  if (dateOfBirth && !str(currentAdmission.dob)) nextAdmission.dob = dateOfBirth;
  if (emergencyName) nextAdmission.emergencyContactName = emergencyName;
  if (emergencyPhone) nextAdmission.emergencyContactInfo = emergencyPhone;
  if (occupation && !str(currentAdmission.profession)) nextAdmission.occupation = occupation;

  // Re-assess against what we just wrote, so "complete" is honest.
  const projectedProfile = {
    ...(student.profile ?? {}),
    ...(whatsapp ? { whatsapp } : {}),
    ...(dateOfBirth ? { dateOfBirth: new Date(dateOfBirth) } : {}),
    ...(city ? { city } : {}),
    ...(emergencyName ? { emergencyName } : {}),
    ...(emergencyPhone ? { emergencyPhone } : {}),
    ...(occupation ? { occupation } : {}),
  };
  const stillMissing = missingBackfillFields(nextAdmission, projectedProfile);

  const wasApplicable = assessProfileBackfill(currentAdmission, student.profile).applicable;
  let markedDone = false;

  if (dismiss) {
    nextAdmission.profileBackfillSnoozedUntil = new Date(
      Date.now() + BACKFILL_SNOOZE_DAYS * 86_400_000,
    ).toISOString();
  } else if (wasApplicable && (stillMissing.length === 0 || complete)) {
    nextAdmission.profileBackfilledAt = new Date().toISOString();
    // A snooze that outlived its purpose would just be noise on the record.
    delete nextAdmission.profileBackfillSnoozedUntil;
    markedDone = true;
  }

  await prisma.student.update({
    where: { id: student.id },
    data: { admission: nextAdmission as object },
  });

  if (markedDone && wasApplicable) {
    const name = student.user?.name ?? "A student";
    await notify({
      to: { audience: "admin", capability: "students" },
      kind: KIND.general,
      severity: "info",
      title: `${name} filled in their profile details`,
      message: `${name} completed the sign-up details their off-form onboarding had skipped. Their record is now current.`,
      link: `/admin/students?search=${encodeURIComponent(name)}`,
      push: false,
    }).catch((error) => console.error("Profile-backfill office notice failed", error));
  }

  return NextResponse.json({
    ok: true,
    done: markedDone || stillMissing.length === 0,
    missing: stillMissing,
    snoozed: dismiss,
  });
}
