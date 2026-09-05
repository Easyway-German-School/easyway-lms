import bcryptjs from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import { AGING_BUCKETS, focusPreset, type StudentFinance } from "@/lib/finance/receivables";
import { churnRiskPreset } from "@/lib/student-risk";
import { setStudentTutor } from "@/lib/tutor-pairing";
import { isOnlineBranch } from "@/lib/online-branch";
import { assignStudentCode } from "@/lib/student-code";
import { generateTempPassword } from "@/lib/student-password";
import { ensureChargeForLevel } from "@/lib/tuition-charges";
import { normalizeProfileInput, mergeProfile, type StudentProfileInput } from "@/lib/student-profile";
import { closeOpenEnrolment, openEnrolment, type EnrolmentOutcome } from "@/lib/student-enrolment";
import {
  buildRosterWhereClause,
  hasDerivedFilter as computeHasDerivedFilter,
  parseRosterFilters,
  ROSTER_INCLUDE,
  scoreAndFilterRoster,
} from "@/lib/student-roster-query";

// The "Reset roster" path soft-deletes every student in the tenant in chunks;
// on Neon that is a few hundred round trips and comfortably outruns the default
// serverless budget.
export const maxDuration = 60;

export async function GET(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const filters = parseRosterFilters(url);
  const page = parseInt(url.searchParams.get("page") || "1", 10) || 1;
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));

  /**
   * BRANCH SCOPING — an admin restricted to specific branches (see
   * admin-roles.ts / AdminBranchAccess in the staff page) cannot see students
   * outside them, whatever branchId they pass in the query string. A request
   * for an out-of-scope branch is not told apart from one for a branch that
   * does not exist — an impossible id, rather than an error — so this cannot
   * be used to probe which branches exist.
   */
  const allowedBranchIds = scopedBranchIds(gate.admin);
  const whereClause = buildRosterWhereClause(filters, {
    tenantId: gate.session.user.tenantId,
    allowedBranchIds,
  });

  const derivedFilter = computeHasDerivedFilter(filters);

  /**
   * A derived filter (focus preset, risk preset, aging bucket, an id set, or a
   * tag/segment) cannot be pushed into SQL, so the page has to be cut after the
   * rule has run rather than before — see student-roster-query.ts.
   */
  const rawStudents = await prisma.student.findMany({
    where: whereClause,
    include: ROSTER_INCLUDE,
    orderBy: { createdAt: "desc" },
    ...(derivedFilter ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
  });

  const now = new Date();
  const matched = scoreAndFilterRoster(rawStudents, filters, now);

  const totalCount = derivedFilter
    ? matched.length
    : await prisma.student.count({ where: whereClause });

  const pageRows = derivedFilter
    ? matched.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)
    : matched;

  /**
   * MONEY FOLLOWS THE `payments` CAPABILITY, not the `students` one.
   *
   * This roster was handing every balance in the school to anyone who could
   * open it, which is the same leak the dashboard's at-risk table was fixed for
   * — a Secretary has `students` and deliberately does not have `payments`. The
   * row survives the strip; only the amounts come off, so the front desk still
   * sees who is behind and for how long, which is what they chase on.
   */
  const canSeeMoney = gate.admin.can("payments");

  const enriched = pageRows.map(({ student, finance, risk, segments }) => ({
    ...student,
    _finance: canSeeMoney ? finance : stripMoney(finance),
    // Not financial data, so it isn't gated behind the `payments` capability.
    _risk: risk,
    // Machine-derived classification — see lib/student-segments.ts. Combine
    // with the stored `tags` column client-side for one filterable list.
    _segments: segments,
    // Kept under its old name so nothing that reads it breaks. It now comes off
    // the tuition fee rather than the sum of raised invoices: most students who
    // owe the school money have no Invoice row at all, so the old figure read
    // ₦0 for exactly the people worth chasing.
    _paymentSummary: canSeeMoney
      ? {
          totalPaid: finance.paid,
          totalInvoiced: finance.tuitionFee,
          balance: finance.owed,
        }
      : null,
  }));

  const focus = focusPreset(filters.focus);
  const riskFocus = focus ? null : churnRiskPreset(filters.focus);

  return NextResponse.json({
    students: enriched,
    totalCount,
    canSeeMoney,
    // The roster uses this to decide whether to offer "Reset roster" — the
    // bulk wipe is super-admin only, and the server enforces that too.
    adminRole: gate.admin.adminRole,
    // Echoed so the page can title and explain itself without keeping its own
    // copy of the wording — one edit to the preset changes both ends. Finance
    // and churn-risk presets share this one slot since a request only ever
    // matches one or the other.
    focus: focus
      ? { id: focus.id, label: focus.label, hint: focus.hint, tone: focus.tone }
      : riskFocus
        ? { id: riskFocus.id, label: riskFocus.label, hint: riskFocus.hint, tone: riskFocus.tone }
        : null,
    agingBucket: filters.agingBucket
      ? AGING_BUCKETS.find((bucket) => bucket.id === filters.agingBucket) ?? null
      : null,
    // Every id the filter matched, not just this page — so the page can
    // highlight consistently as the reader pages through.
    matchedIds: derivedFilter ? matched.map((entry) => entry.student.id) : null,
  });
}

/** The row without the amounts. Fields are dropped, not zeroed — see the note above. */
function stripMoney(finance: StudentFinance) {
  const {
    tuitionFee: _fee,
    requiredDeposit: _deposit,
    paid: _paid,
    owed: _owed,
    owedOnDeposit: _owedDeposit,
    progressPercent: _progress,
    ...rest
  } = finance;
  return rest;
}

export async function POST(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  // A password left blank is not an error here — the office is not always the
  // one who knows what to type, so an admin-created account gets a readable
  // temporary password minted for it, the same as a CSV or paste-many import.
  const password =
    typeof body.password === "string" && body.password.trim() ? body.password.trim() : generateTempPassword();
  const level = typeof body.level === "string" ? body.level : "A1";
  const branchId = typeof body.branchId === "string" ? body.branchId : null;
  const tutorId = typeof body.tutorId === "string" ? body.tutorId : null;
  const status = typeof body.status === "string" ? body.status : "active";
  const classType = body.classType === "private" ? "private" : "group";
  const sessionSlot = ["morning", "afternoon", "evening", "weekend"].includes(String(body.sessionSlot))
    ? String(body.sessionSlot)
    : "morning";
  const requestedDeliveryMode = body.deliveryMode === "hybrid" ? "hybrid" : "physical";
  // The pathway ("what Germany is for") is chosen on signup; before now the
  // manual-add form had no field for it and every admin-added student was
  // silently filed as "Language training".
  const pathway =
    typeof body.pathway === "string" && body.pathway.trim() ? body.pathway.trim() : "Language training";
  // Batch month — the timetable generator and the promotion engine both read
  // this off the admission blob, so a student added without it has no
  // level-end date and never auto-promotes. Stored as a bare month name
  // ("September") to match signup and the roster's Batch filter.
  const batch = typeof body.batch === "string" ? body.batch.trim() : "";
  // Where the student lives — the signup form collects this into the admission
  // blob; the manual-add form now offers it too, chiefly for online students
  // who have no branch to place them.
  const city = typeof body.city === "string" ? body.city.trim() : "";
  const stateRegion = typeof body.state === "string" ? body.state.trim() : "";
  const country = typeof body.country === "string" ? body.country.trim() : "";
  // A profile photo the office set on the student's behalf. Only accept a URL
  // this app could have produced — the office is trusted, but a stray payload
  // should not be able to point an avatar at an arbitrary host.
  const photoUrlRaw = typeof body.photoUrl === "string" ? body.photoUrl.trim() : "";
  const photoUrl =
    photoUrlRaw && /^(\/uploads\/|\/api\/files\/|https:\/\/)/.test(photoUrlRaw) ? photoUrlRaw : "";
  // Money already collected before the student was put on the portal — same
  // idea as the CSV importer's "amount paid" column, so the paywall does not
  // lock someone out of a level they have already paid for.
  const amountPaid = Math.max(0, Math.round(Number(body.amountPaid) || 0));

  if (!name || !email) {
    return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return NextResponse.json({ error: "Email already registered" }, { status: 400 });
  }

  let branchRow: { tenantId: string | null; name: string; mode: string | null } | null = null;
  if (branchId) {
    branchRow = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { tenantId: true, name: true, mode: true },
    });
    if (!branchRow || (gate.session.user.tenantId && branchRow.tenantId !== gate.session.user.tenantId)) {
      return NextResponse.json({ error: "Branch not found" }, { status: 404 });
    }
  }

  /**
   * How this student attends — derived against the branch the same way signup
   * does, not taken on trust. Leaving this unset was the bug: every admin-added
   * student defaulted to "physical" even when placed in the Online branch, which
   * silently hid the Live class tab from them.
   */
  const deliveryMode = isOnlineBranch(branchRow) ? "online" : requestedDeliveryMode;

  const hashedPassword = await bcryptjs.hash(password, 10);

  try {
    const user = await prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        role: "STUDENT",
        tenantId: gate.session.user.tenantId,
        student: {
          create: {
            level,
            branchId,
            status,
            tutorId,
            pathway,
            classType,
            sessionSlot,
            deliveryMode,
            admission:
              phone || batch || city || stateRegion || country || photoUrl
                ? {
                    ...(phone ? { phone } : {}),
                    ...(batch ? { batch } : {}),
                    ...(city ? { city } : {}),
                    ...(stateRegion ? { state: stateRegion } : {}),
                    ...(country ? { country } : {}),
                    ...(photoUrl ? { photoUrl } : {}),
                  }
                : undefined,
            // The typed twin of the admission blob above — see
            // lib/student-profile.ts. Reads the same request body (with the
            // already-sanitized `photoUrl`, not the raw one), so anything this
            // form collects lands in both places at once.
            profile: { create: normalizeProfileInput({ ...body, photoUrl }) },
          },
        },
      },
    });

    const student = await prisma.student.findUnique({ where: { userId: user.id }, select: { id: true } });
    const studentCode = student
      ? await assignStudentCode(student.id, { level, batch, branch: branchRow, classType })
      : null;

    if (student) {
      // Record the up-front payment, if any was entered — mirrors the importer
      // so a mid-course student is not paywalled out of what they have paid for.
      if (amountPaid > 0) {
        await prisma.payment.create({
          data: {
            studentId: student.id,
            amount: amountPaid,
            currency: "NGN",
            status: "completed",
            method: "manual",
            description: "Recorded on manual add — paid before joining the portal",
            ...(gate.session.user.tenantId ? { tenantId: gate.session.user.tenantId } : {}),
          },
        });
      }

      // Open the tuition ledger for the level they start in, the same as signup
      // and the CSV import do. Non-fatal: a student can still be created if this
      // trips, and an admin adjustment can add the charge later.
      let manualAddCharge: { chargeId: string; amount: number } | null = null;
      try {
        manualAddCharge = await ensureChargeForLevel({ studentId: student.id, level, origin: "signup" });
      } catch (chargeError) {
        console.error("Tuition charge creation failed on manual add", chargeError);
      }

      // Enrolment #1 — see lib/student-enrolment.ts. Non-fatal, same as above.
      try {
        await openEnrolment({
          studentId: student.id,
          level,
          branchId,
          tutorId,
          sessionSlot,
          classType,
          deliveryMode,
          batch,
          tenantId: gate.session.user.tenantId,
          tuitionChargeId: manualAddCharge?.chargeId ?? null,
          feeSnapshot: manualAddCharge?.amount ?? null,
        });
      } catch (enrolmentError) {
        console.error("Enrolment history creation failed on manual add", enrolmentError);
      }
    }

    return NextResponse.json(
      {
        user: { id: user.id, email: user.email, name: user.name },
        classType,
        deliveryMode,
        studentCode,
        // Handed back so the admin screen has it even when it typed nothing
        // and this route generated one — the only place it is ever shown.
        password,
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json({ error: "Unable to create student", detail: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const studentId = typeof body.studentId === "string" ? body.studentId : "";
  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
  const level = typeof body.level === "string" ? body.level : undefined;
  const branchId = typeof body.branchId === "string" ? body.branchId : null;
  const tutorId = typeof body.tutorId === "string" ? body.tutorId : null;
  const status = typeof body.status === "string" ? body.status : undefined;
  const classType = body.classType === "private" || body.classType === "group" ? body.classType : undefined;
  const sessionSlot = ["morning", "afternoon", "evening", "weekend"].includes(String(body.sessionSlot))
    ? String(body.sessionSlot)
    : undefined;
  const requestedDeliveryMode = body.deliveryMode === "hybrid" || body.deliveryMode === "physical"
    ? body.deliveryMode
    : undefined;
  const newPassword = typeof body.password === "string" ? body.password : "";
  const pathway = typeof body.pathway === "string" && body.pathway.trim() ? body.pathway.trim() : undefined;
  // Only touched when the key is present at all, so an edit that isn't about
  // the phone number (a status change, a tutor swap) never clobbers it. Batch
  // month follows the same rule — both live inside the admission JSON blob.
  const phone = typeof body.phone === "string" ? body.phone.trim() : undefined;
  const batch = typeof body.batch === "string" ? body.batch.trim() : undefined;
  // Location + photo live in the same admission blob — only touched when their
  // key is present, so an unrelated edit never wipes what signup collected.
  const city = typeof body.city === "string" ? body.city.trim() : undefined;
  const stateRegion = typeof body.state === "string" ? body.state.trim() : undefined;
  const country = typeof body.country === "string" ? body.country.trim() : undefined;
  const photoUrlRaw = typeof body.photoUrl === "string" ? body.photoUrl.trim() : undefined;
  const photoUrl =
    photoUrlRaw === undefined
      ? undefined
      : photoUrlRaw && /^(\/uploads\/|\/api\/files\/|https:\/\/)/.test(photoUrlRaw)
        ? photoUrlRaw
        : "";

  if (!studentId) {
    return NextResponse.json({ error: "Student ID is required" }, { status: 400 });
  }

  try {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        user: true,
        branch: { select: { tenantId: true } },
        profile: true,
      },
    });
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    // Same ownership rule as GET/DELETE — a no-branch student is still ours if
    // their user account or their own row carries the tenant.
    if (!ownedByTenant(student, gate.session.user.tenantId ?? null)) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    if (email && email !== student.user.email) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return NextResponse.json({ error: "Email already registered" }, { status: 400 });
      }
    }

    const updateUser = {} as { name?: string; email?: string; password?: string };
    if (name) updateUser.name = name;
    if (email) updateUser.email = email;

    if (newPassword) {
      if (newPassword.length < 8) {
        return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
      }
      updateUser.password = await bcryptjs.hash(newPassword, 10);
    }

    let branchRow: { tenantId: string | null; name: string; mode: string | null } | null = null;
    if (branchId) {
      branchRow = await prisma.branch.findUnique({
        where: { id: branchId },
        select: { tenantId: true, name: true, mode: true },
      });
      if (!branchRow || (gate.session.user.tenantId && branchRow.tenantId !== gate.session.user.tenantId)) {
        return NextResponse.json({ error: "Branch not found" }, { status: 404 });
      }
    }

    const updateStudent = {} as {
      level?: string;
      branchId?: string | null;
      status?: string;
      classType?: string;
      sessionSlot?: string;
      deliveryMode?: string;
      pathway?: string;
      tags?: string[];
      // JSON blob field — typed loosely on purpose, same as whereClause above.
      admission?: any;
    };
    // Admin-authored classification chips (see lib/student-segments.ts). Only
    // touched when the key is present — same read-if-present rule as the
    // admission fields — so an edit that isn't about tags never clears them.
    if (Array.isArray(body.tags)) {
      updateStudent.tags = body.tags
        .filter((tag: unknown): tag is string => typeof tag === "string" && tag.trim().length > 0)
        .map((tag: string) => tag.trim());
    }
    if (level) updateStudent.level = level;
    if (pathway) updateStudent.pathway = pathway;
    /**
     * The phone number lives inside the JSON admission blob rather than a
     * column of its own — see the signup route, which writes it the same way.
     * Read-modify-write so editing the phone here never wipes out whatever
     * else the admission form collected (father's phone, city, and so on).
     */
    if (
      phone !== undefined ||
      batch !== undefined ||
      city !== undefined ||
      stateRegion !== undefined ||
      country !== undefined ||
      photoUrl !== undefined
    ) {
      const existingAdmission = (student.admission ?? {}) as Record<string, unknown>;
      const nextAdmission = { ...existingAdmission };
      if (phone !== undefined) nextAdmission.phone = phone || undefined;
      if (batch !== undefined) nextAdmission.batch = batch || undefined;
      if (city !== undefined) nextAdmission.city = city || undefined;
      if (stateRegion !== undefined) nextAdmission.state = stateRegion || undefined;
      if (country !== undefined) nextAdmission.country = country || undefined;
      if (photoUrl !== undefined) nextAdmission.photoUrl = photoUrl || undefined;
      updateStudent.admission = nextAdmission;
    }
    if (body.branchId !== undefined) updateStudent.branchId = branchId;
    /**
     * deliveryMode follows the branch — an admin moving a student INTO the
     * Online branch must not leave them stranded on "physical" with no Live
     * class tab. Only recomputed when the branch or an explicit hybrid/physical
     * choice is actually part of this request, so an unrelated edit (name,
     * status) does not quietly reset a campus student who was set to hybrid.
     */
    if (body.branchId !== undefined || requestedDeliveryMode) {
      const effectiveBranch = branchId ? branchRow : null;
      if (isOnlineBranch(effectiveBranch)) {
        updateStudent.deliveryMode = "online";
      } else if (requestedDeliveryMode) {
        updateStudent.deliveryMode = requestedDeliveryMode;
      } else if (body.branchId !== undefined) {
        updateStudent.deliveryMode = "physical";
      }
    }
    if (status) updateStudent.status = status;
    if (classType) updateStudent.classType = classType;
    if (sessionSlot) updateStudent.sessionSlot = sessionSlot;

    await prisma.user.update({ where: { id: student.userId }, data: updateUser });
    await prisma.student.update({ where: { id: studentId }, data: updateStudent });

    /**
     * Enrolment history — see lib/student-enrolment.ts. Two things can end or
     * start a stint here, independently of the "Promotions" flow in
     * promotion.ts, which already handles the normal level-up case:
     *
     *   - the office moves a student to graduated/withdrawn: close the open
     *     enrolment with that outcome.
     *   - the office brings a graduated/withdrawn student back to active: a
     *     genuine re-enrolment, so a fresh `ongoing` row opens — this is what
     *     makes them read as a RETURNING student from here on.
     *   - an ad-hoc level correction from this form (not through Promotions):
     *     closes the old level's row and opens the new one, the same as a
     *     promotion would.
     *
     * "paused" is deliberately not a boundary here — see setHeldBack in
     * germany-journey-server.ts for the reasoning: a pause is a flag on the
     * CURRENT stint, not the end of one.
     */
    const levelChanged = Boolean(level && level !== student.level);
    const enteringTerminal =
      Boolean(status) && status !== student.status && (status === "graduated" || status === "withdrawn");
    const leavingTerminal =
      Boolean(status) &&
      status !== student.status &&
      status === "active" &&
      (student.status === "graduated" || student.status === "withdrawn");

    if (levelChanged || enteringTerminal || leavingTerminal) {
      try {
        if (enteringTerminal) {
          await closeOpenEnrolment(studentId, {
            outcome: (status === "graduated" ? "completed" : "withdrawn") as EnrolmentOutcome,
          });
        } else if (levelChanged) {
          await closeOpenEnrolment(studentId, { outcome: "completed" });
        }

        if (levelChanged || leavingTerminal) {
          const effectiveAdmission = (updateStudent.admission ?? student.admission ?? {}) as Record<string, unknown>;
          await openEnrolment({
            studentId,
            level: level || student.level,
            branchId: body.branchId !== undefined ? branchId : student.branchId,
            tutorId: body.tutorId !== undefined ? tutorId : student.tutorId,
            sessionSlot: sessionSlot || student.sessionSlot,
            classType: classType || student.classType,
            deliveryMode: updateStudent.deliveryMode || student.deliveryMode,
            batch: typeof effectiveAdmission.batch === "string" ? effectiveAdmission.batch : undefined,
            tenantId: gate.session.user.tenantId,
          });
        }
      } catch (enrolmentError) {
        console.error("Enrolment history update failed on admin edit", { studentId, enrolmentError });
      }
    }

    /**
     * The structured profile — see lib/student-profile.ts. Reads BOTH the
     * legacy top-level fields (phone/city/state/country/photoUrl, which the
     * manual-add form has always sent) and an optional `body.profile` object
     * (the Student 360 dossier's edit panel sends the full field set there).
     * Merged against the existing row rather than replaced, so editing one
     * field on the dossier can never blank out the rest.
     */
    const profileIncoming = normalizeProfileInput({
      ...body,
      ...(body.profile && typeof body.profile === "object" ? (body.profile as Record<string, unknown>) : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(city !== undefined ? { city } : {}),
      ...(stateRegion !== undefined ? { stateRegion } : {}),
      ...(country !== undefined ? { country } : {}),
      ...(photoUrl !== undefined ? { photoUrl } : {}),
    });
    if (Object.keys(profileIncoming).length > 0) {
      const merged = mergeProfile(student.profile ?? {}, profileIncoming);
      await prisma.studentProfile.upsert({
        where: { studentId },
        create: { studentId, tenantId: gate.session.user.tenantId, ...merged },
        update: merged,
      });
    }

    /**
     * The tutor moves through the shared pairing helper rather than being one
     * more column in the update above, so that changing a tutor from this form
     * notifies the student and the tutor exactly as it does from the tutor's
     * own screen. It runs after the rest: the notification tells the tutor to
     * go and look at a roster, which should already be right when they do.
     */
    if (body.tutorId !== undefined) {
      const paired = await setStudentTutor({ studentId, lecturerId: tutorId });
      if (!paired.ok) {
        return NextResponse.json({ error: paired.error }, { status: paired.status });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Unable to update student", detail: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}

/**
 * Does this student belong to the acting admin's tenant?
 *
 * A student is owned by the tenant when ANY of their tenant anchors match — the
 * student row's own `tenantId`, their branch's, or their user account's. The
 * three can disagree: imported and SQLite-era students have no branch at all
 * (`branch` is null), so a branch-only check — which this handler used to do —
 * treated every one of them as foreign and 404'd. The GET query already reads
 * them via the `user.tenantId` arm of its OR; delete has to see the same set.
 */
function ownedByTenant(
  student: { tenantId?: string | null; branch?: { tenantId: string | null } | null; user?: { tenantId: string | null } | null },
  tenantId: string | null | undefined,
): boolean {
  if (!tenantId) return true;
  return (
    student.tenantId === tenantId ||
    student.branch?.tenantId === tenantId ||
    student.user?.tenantId === tenantId
  );
}

export async function DELETE(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tenantId = gate.session.user.tenantId ?? null;

  // ---------------------------------------------------------------------------
  // "Reset roster" — soft-delete every student that matches the current view.
  //
  // This is the switchover tool: pilot data out, real students in. It stays
  // super-admin only and needs its own confirmation phrase so it can never be
  // reached by the ordinary row/multi-row delete below. Everything it removes
  // is restorable from the audit trail (see src/lib/prisma-guard.ts).
  // ---------------------------------------------------------------------------
  if (body.scope === "all") {
    if (gate.admin.adminRole !== "super") {
      return NextResponse.json({ error: "Only a super admin can reset the roster" }, { status: 403 });
    }
    if (body.confirmation !== "RESET STUDENTS") {
      return NextResponse.json({ error: "Confirmation phrase RESET STUDENTS is required" }, { status: 400 });
    }

    const filters = (body.filters ?? {}) as Record<string, unknown>;
    const resetWhere: any = {};
    if (typeof filters.branchId === "string" && filters.branchId) resetWhere.branchId = filters.branchId;
    if (typeof filters.level === "string" && filters.level) resetWhere.level = filters.level;
    if (typeof filters.status === "string" && filters.status) resetWhere.status = filters.status;

    // Same tenant fence as GET: match on branch OR user OR the student's own
    // tenant column, so no-branch students are in scope.
    if (tenantId) {
      resetWhere.OR = [
        { tenantId },
        { branch: { tenantId } },
        { user: { tenantId } },
      ];
    }

    // A branch-scoped admin can only clear their own branches, whatever filter
    // they pass — mirrors the GET route.
    const allowedBranchIds = scopedBranchIds(gate.admin);
    if (allowedBranchIds) {
      resetWhere.branchId = resetWhere.branchId
        ? (allowedBranchIds.includes(resetWhere.branchId) ? resetWhere.branchId : "__no-branch-access__")
        : { in: allowedBranchIds };
    }

    try {
      const targets = await prisma.student.findMany({
        where: resetWhere,
        select: { id: true, userId: true, user: { select: { role: true, adminRole: true } } },
      });
      if (targets.length === 0) {
        return NextResponse.json({ success: true, deleted: 0 });
      }

      // Chunks of 150 keep each statement under the guard's 200-row
      // blast-radius cap (src/lib/prisma-guard.ts), so no unscoped-write
      // escape hatch is needed and every chunk still lands a restorable audit
      // row attributed to the real admin.
      //
      // Session rows are deliberately left alone here: once the User is
      // soft-deleted the auth lookup returns null (the guard hides deleted
      // rows), so any live session is already inert — and a `session.deleteMany`
      // over 150 users is the one statement whose row count we cannot bound
      // ahead of the blast-radius check.
      const CHUNK = 150;
      let deleted = 0;
      for (let i = 0; i < targets.length; i += CHUNK) {
        const slice = targets.slice(i, i + CHUNK);
        const studentIdChunk = slice.map((s) => s.id);
        // Only take down the login when it is genuinely a student-only account.
        // A staff member who also carries a Student row keeps their User — the
        // roster row is removed, the ability to sign in is not.
        const userIdChunk = slice
          .filter((s) => s.user && s.user.role === "STUDENT" && s.user.adminRole == null)
          .map((s) => s.userId);
        await prisma.student.deleteMany({ where: { id: { in: studentIdChunk } } });
        if (userIdChunk.length > 0) {
          await prisma.user.deleteMany({ where: { id: { in: userIdChunk } } });
        }
        deleted += slice.length;
      }
      return NextResponse.json({ success: true, deleted });
    } catch (error) {
      return NextResponse.json(
        { error: "Unable to reset the roster", detail: error instanceof Error ? error.message : "Unknown" },
        { status: 500 },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Explicit one-or-many delete by id.
  // ---------------------------------------------------------------------------
  const studentIds: string[] = [];
  if (Array.isArray(body.studentIds)) {
    for (const id of body.studentIds as unknown[]) {
      if (typeof id === "string" && id.trim().length > 0) studentIds.push(id.trim());
    }
  } else if (typeof body.studentId === "string" && body.studentId.trim().length > 0) {
    studentIds.push(body.studentId.trim());
  }
  if (body.confirmation !== "DELETE STUDENTS") {
    return NextResponse.json({ error: "Confirmation phrase DELETE STUDENTS is required" }, { status: 400 });
  }
  if (studentIds.length === 0) {
    return NextResponse.json({ error: "At least one student ID is required" }, { status: 400 });
  }
  if (studentIds.length > 500) {
    return NextResponse.json({ error: "Delete at most 500 students at a time" }, { status: 400 });
  }

  try {
    const found = await prisma.student.findMany({
      where: { id: { in: studentIds } },
      select: {
        id: true,
        userId: true,
        tenantId: true,
        branch: { select: { tenantId: true } },
        user: { select: { tenantId: true, role: true, adminRole: true } },
      },
    });

    // A row that is missing (already deleted) or outside the tenant is skipped,
    // not fatal — one stale id in a 20-row selection used to 404 the whole
    // batch and nothing got removed.
    const deletable = found.filter((student) => ownedByTenant(student, tenantId));
    const deletableIds = new Set(deletable.map((s) => s.id));
    const skipped = studentIds.filter((id) => !deletableIds.has(id));

    if (deletable.length === 0) {
      return NextResponse.json(
        { error: found.length === 0 ? "Student not found" : "None of those students are in your tenant" },
        { status: 404 },
      );
    }

    const staffPreserved: string[] = [];
    for (const student of deletable) {
      // If the row is bound to a staff account — anything that is not a plain
      // student — remove the roster entry only. Deleting the User here is how a
      // super admin cleaning up test students soft-deleted their own login on
      // 2026-09-02. A missing `user` (already soft-deleted) is treated the same
      // conservative way: drop the Student row, leave the account alone.
      const isStudentOnly =
        student.user != null &&
        student.user.role === "STUDENT" &&
        student.user.adminRole == null;

      if (!isStudentOnly) {
        await prisma.student.delete({ where: { id: student.id } });
        staffPreserved.push(student.id);
        continue;
      }

      await prisma.session.deleteMany({ where: { userId: student.userId } });
      await prisma.student.delete({ where: { id: student.id } });
      await prisma.user.delete({ where: { id: student.userId } });
    }

    return NextResponse.json({
      success: true,
      deleted: deletable.length,
      skipped,
      ...(staffPreserved.length > 0 ? { staffPreserved } : {}),
    });
  } catch (error) {
    return NextResponse.json({ error: "Unable to delete student", detail: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}
