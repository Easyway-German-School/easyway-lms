import { after, NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma, guardedPrisma } from "@/lib/prisma";
import { captureError } from "@/lib/capture-error";
import { KIND, notify } from "@/lib/notify";
import { runWithTenant } from "@/lib/tenant/context";
import { mergeProfile, normalizeProfileInput } from "@/lib/student-profile";
import { ageFromDob } from "@/lib/age-bands";
import {
  assessProfileBackfill,
  backfillPrefill,
  missingBackfillFields,
  BACKFILL_SNOOZE_DAYS,
} from "@/lib/profile-backfill";

export const dynamic = "force-dynamic";

const ROUTE = "/api/student/profile/backfill";

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
 *
 * NEVER A DEAD END. This is a favour we are asking of the student, so a fault
 * on our side must not become their problem: it answers with JSON on every
 * path (never a bare 500 page the client cannot read), keeps what they typed
 * even if one of the two places it lives cannot be written, and reports the
 * fault to the incident register so we fix it instead of them retrying.
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

type LoadedStudent = NonNullable<Awaited<ReturnType<typeof loadStudent>>>;

/**
 * Write the typed profile row. Three shapes it can be in, and every one of them
 * has to end in "saved":
 *   - no row yet                         → create (a racing writer may beat us to it)
 *   - a row the tenant filter can see    → update
 *   - a row the tenant filter CANNOT see → the row's tenant does not match this
 *     request's (an account whose tenant was re-pointed, or one that pre-dates
 *     the tenant columns). `update` then finds nothing and `create` trips the
 *     unique key. The row is keyed by THIS student's own id, taken from their
 *     own session, so it is safe to write it without the tenant filter.
 */
async function writeProfile(student: LoadedStudent, merged: ReturnType<typeof mergeProfile>) {
  const data = merged as Record<string, unknown>;

  let tenantId: string | undefined;
  if (!student.profile) {
    const candidate = student.tenantId ?? student.user?.tenantId ?? null;
    if (candidate) {
      const live = await prisma.tenant.findUnique({ where: { id: candidate }, select: { id: true } });
      tenantId = live?.id;
    }
  }

  const create = () =>
    prisma.studentProfile.create({
      data: { studentId: student.id, ...(tenantId ? { tenantId } : {}), ...data } as never,
    });
  const update = () =>
    prisma.studentProfile.update({ where: { studentId: student.id }, data: data as never });
  const updateUnfiltered = () =>
    guardedPrisma.studentProfile.update({ where: { studentId: student.id }, data: data as never });

  const attempts = student.profile ? [update, create, updateUnfiltered] : [create, update, updateUnfiltered];
  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      await attempt();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function POST(req: NextRequest) {
  try {
    return await handlePost(req);
  } catch (error) {
    await captureError("profile-backfill", error, { routePath: ROUTE, method: "POST" });
    return NextResponse.json(
      { error: "We could not save that just now. Your answers are kept — please try again in a moment." },
      { status: 500 },
    );
  }
}

async function handlePost(req: NextRequest) {
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

  // ── The typed profile fields ──────────────────────────────────────────────
  // normalizeProfileInput parses `dateOfBirth` (ISO from the birth-date input,
  // or a legacy DD/MM/YYYY string) the same way every other writer does.
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

  // A birth date that cannot be a learner (free-typed text from an old import,
  // the year 0026, tomorrow) is dropped rather than stored, because every
  // report reads it as an age. Dropped quietly, not refused: the wizard re-sends
  // whatever it was pre-filled with on every step, and a stale legacy value
  // must never be the reason a student cannot save their other answers. The
  // wizard's own birth-date input validates what the student actually types.
  let dobIso = "";
  if (incoming.dateOfBirth && ageFromDob(incoming.dateOfBirth) !== null) {
    dobIso = incoming.dateOfBirth.toISOString().slice(0, 10);
  } else {
    delete incoming.dateOfBirth;
  }

  // The typed row and the admission blob below both carry these answers. If the
  // typed row cannot be written we still have the blob, so the student is not
  // stopped — but the fault is reported, because a profile row we cannot write
  // is a defect on our side, not something for them to retry their way past.
  if (Object.keys(incoming).length > 0) {
    try {
      await writeProfile(student, mergeProfile(student.profile ?? {}, incoming));
    } catch (error) {
      await captureError("profile-backfill:profile-row", error, { routePath: ROUTE, method: "POST" });
    }
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
  if (dobIso && !str(currentAdmission.dob)) nextAdmission.dob = dobIso;
  if (emergencyName) nextAdmission.emergencyContactName = emergencyName;
  if (emergencyPhone) nextAdmission.emergencyContactInfo = emergencyPhone;
  if (occupation && !str(currentAdmission.profession)) nextAdmission.occupation = occupation;

  // Re-assess against what we just wrote, so "complete" is honest.
  const projectedProfile = {
    ...(student.profile ?? {}),
    ...(whatsapp ? { whatsapp } : {}),
    ...(incoming.dateOfBirth ? { dateOfBirth: incoming.dateOfBirth } : {}),
    ...(city ? { city } : {}),
    ...(stateRegion ? { stateRegion } : {}),
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

  // The office notice is a courtesy to the office, not part of the student's
  // save. It fans out to every admin (recipients, preferences, an email row
  // each) — so it runs AFTER the response is sent and can neither slow the
  // student's "Done" nor fail it.
  if (markedDone) {
    const name = student.user?.name ?? "A student";
    // Pinned to the student's own school explicitly: the request's tenant scope
    // is ambient state, and a callback that outlives the response should not be
    // trusting it to still be there.
    const schoolId = student.tenantId ?? student.user?.tenantId ?? null;
    const sendNotice = () =>
      notify({
        to: { audience: "admin", capability: "students" },
        kind: KIND.general,
        severity: "info",
        title: `${name} filled in their profile details`,
        message: `${name} completed the sign-up details their off-form onboarding had skipped. Their record is now current.`,
        link: `/admin/students?search=${encodeURIComponent(name)}`,
        push: false,
      });
    after(async () => {
      try {
        await (schoolId ? runWithTenant(schoolId, sendNotice) : sendNotice());
      } catch (error) {
        console.error("Profile-backfill office notice failed", error);
      }
    });
  }

  return NextResponse.json({
    ok: true,
    done: markedDone || stillMissing.length === 0,
    missing: stillMissing,
    snoozed: dismiss,
  });
}
