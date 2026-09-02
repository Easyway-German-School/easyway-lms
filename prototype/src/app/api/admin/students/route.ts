import bcryptjs from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import {
  AGING_BUCKETS,
  computeStudentFinance,
  focusPreset,
  type StudentFinance,
} from "@/lib/finance/receivables";
import { computeChurnRisk, churnRiskPreset, RECENT_WINDOW_DAYS } from "@/lib/student-risk";
import { setStudentTutor } from "@/lib/tutor-pairing";
import { isOnlineBranch } from "@/lib/online-branch";
import { assignStudentCode } from "@/lib/student-code";
import { generateTempPassword } from "@/lib/student-password";

// The "Reset roster" path soft-deletes every student in the tenant in chunks;
// on Neon that is a few hundred round trips and comfortably outruns the default
// serverless budget.
export const maxDuration = 60;

export async function GET(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId");
  const level = url.searchParams.get("level");
  const batch = url.searchParams.get("batch");
  const classType = url.searchParams.get("classType");
  const sessionSlot = url.searchParams.get("sessionSlot");
  const status = url.searchParams.get("status");
  const paymentStatus = url.searchParams.get("paymentStatus");
  const tutorId = url.searchParams.get("tutorId");
  const search = url.searchParams.get("search") || undefined;
  const page = parseInt(url.searchParams.get("page") || "1", 10) || 1;
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));

  /**
   * DERIVED FILTERS — the other half of a clickable dashboard.
   *
   * "7 students behind on tuition" is not a column in the database. It is a
   * fee table, a deposit rate and a clock, resolved per student, and it used to
   * be resolved only inside the overview route. So the dashboard could state
   * the number and had nowhere to send anybody: the tile linked to an
   * unfiltered payments screen and the reader was left to work out which seven.
   *
   * `focus` names a rule in src/lib/finance/receivables.ts — the same module
   * the overview route counts with — so the count and this list cannot disagree
   * without someone editing the one shared definition. `ids` is the exact-set
   * escape hatch for a tile that already knows precisely who it meant.
   */
  const focus = focusPreset(url.searchParams.get("focus"));
  /**
   * A second, independent preset namespace — churn risk isn't a financial
   * rule, so it doesn't live in FOCUS_PRESETS. The two ids never collide, so
   * this only ever fires when `focus` (finance) came back empty.
   */
  const riskFocus = focus ? null : churnRiskPreset(url.searchParams.get("focus"));
  const agingBucket = url.searchParams.get("agingBucket");
  const idsParam = url.searchParams.get("ids");
  const ids = idsParam
    ? new Set(idsParam.split(",").map((id) => id.trim()).filter(Boolean))
    : null;
  const hasDerivedFilter = Boolean(focus || riskFocus || agingBucket || ids);

  const whereClause: any = {};
  if (branchId) whereClause.branchId = branchId;
  if (level) whereClause.level = level;
  if (batch) whereClause.admission = { path: ["batch"], equals: batch };
  if (classType) whereClause.classType = classType;
  if (sessionSlot) whereClause.sessionSlot = sessionSlot;
  if (status) whereClause.status = status;

  if (gate.session.user.tenantId) {
    // Imported students may not have a branch yet. Their user tenant is still
    // authoritative, so they must remain available for billing and activation.
    whereClause.OR = [
      { branch: { tenantId: gate.session.user.tenantId } },
      { user: { tenantId: gate.session.user.tenantId } },
    ];
  }

  /**
   * BRANCH SCOPING — an admin restricted to specific branches (see
   * admin-roles.ts / AdminBranchAccess in the staff page) cannot see students
   * outside them, whatever branchId they pass in the query string. A request
   * for an out-of-scope branch is not told apart from one for a branch that
   * does not exist — an impossible id, rather than an error — so this cannot
   * be used to probe which branches exist.
   */
  const allowedBranchIds = scopedBranchIds(gate.admin);
  if (allowedBranchIds) {
    if (branchId) {
      if (!allowedBranchIds.includes(branchId)) whereClause.branchId = "__no-branch-access__";
    } else {
      whereClause.branchId = { in: allowedBranchIds };
    }
  }

  if (search) {
    whereClause.AND = whereClause.AND || [];
    whereClause.AND.push({
      OR: [
        { user: { name: { contains: search, mode: "insensitive" } } },
        { user: { email: { contains: search, mode: "insensitive" } } },
      ],
    });
  }

  if (paymentStatus) {
    whereClause.payments = { some: { status: paymentStatus } };
  }
  if (tutorId) {
    whereClause.tutorId = tutorId;
  }

  const now = new Date();
  const riskWindowStart = new Date(now.getTime() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const include = {
    user: true,
    branch: true,
    tutor: { include: { user: true } },
    payments: {
      orderBy: { createdAt: "desc" as const },
    },
    invoices: {
      include: { payments: true },
    },
    // Churn-risk inputs — see lib/student-risk.ts. Kept lightweight: a bounded
    // window for attendance, and only the single most recent row for the two
    // recency signals.
    attendances: {
      where: { date: { gte: riskWindowStart } },
      select: { present: true, status: true },
    },
    videoProgress: {
      orderBy: { updatedAt: "desc" as const },
      take: 1,
      select: { updatedAt: true },
    },
    journeyEvents: {
      orderBy: { occurredAt: "desc" as const },
      take: 1,
      select: { occurredAt: true },
    },
  };

  /**
   * A derived filter cannot be pushed into SQL, so the page has to be cut after
   * the rule has run rather than before. Paginating in the database first would
   * ask for "page 1 of everyone" and then filter it down to whoever on that
   * page happens to be behind — which is not the first page of the behind list,
   * and would report a total that counts students the list does not contain.
   */
  const rawStudents = await prisma.student.findMany({
    where: whereClause,
    include,
    orderBy: { createdAt: "desc" },
    ...(hasDerivedFilter ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
  });

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const withFinance = rawStudents.map((student) => {
    const finance = computeStudentFinance(
      {
        id: student.id,
        level: student.level,
        status: student.status,
        classType: student.classType,
        createdAt: student.createdAt,
        branch: student.branch ? { id: student.branch.id, name: student.branch.name } : null,
        user: student.user,
        payments: student.payments,
      },
      now,
    );
    const risk = computeChurnRisk(
      {
        id: student.id,
        createdAt: student.createdAt,
        notStartedCount: student.notStartedCount,
        recentAttendance: student.attendances,
        lastVideoActivityAt: student.videoProgress[0]?.updatedAt ?? null,
        lastJourneyEventAt: student.journeyEvents[0]?.occurredAt ?? null,
        behindOnTuition: finance.behindOnTuition,
      },
      now,
    );
    return { student, finance, risk, raw: student };
  });

  let matched = withFinance;
  if (focus) {
    matched = matched.filter((entry) =>
      focus.matches(entry.finance, { now, startOfMonth }, {
        id: entry.raw.id,
        level: entry.raw.level,
        status: entry.raw.status,
        classType: entry.raw.classType,
        createdAt: entry.raw.createdAt,
        branch: entry.raw.branch ? { id: entry.raw.branch.id, name: entry.raw.branch.name } : null,
        user: entry.raw.user,
        payments: entry.raw.payments,
      }),
    );
  }
  if (riskFocus) {
    matched = matched.filter((entry) => riskFocus.matches(entry.risk));
  }
  if (agingBucket) {
    matched = matched.filter((entry) => entry.finance.owed > 0 && entry.finance.agingBucket === agingBucket);
  }
  if (ids) {
    matched = matched.filter((entry) => ids.has(entry.student.id));
  }

  const totalCount = hasDerivedFilter
    ? matched.length
    : await prisma.student.count({ where: whereClause });

  const pageRows = hasDerivedFilter
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

  const enriched = pageRows.map(({ student, finance, risk }) => ({
    ...student,
    _finance: canSeeMoney ? finance : stripMoney(finance),
    // Not financial data, so it isn't gated behind the `payments` capability.
    _risk: risk,
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
    agingBucket: agingBucket
      ? AGING_BUCKETS.find((bucket) => bucket.id === agingBucket) ?? null
      : null,
    // Every id the filter matched, not just this page — so the page can
    // highlight consistently as the reader pages through.
    matchedIds: hasDerivedFilter ? matched.map((entry) => entry.student.id) : null,
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
  const sessionSlot = ["morning", "afternoon", "evening"].includes(String(body.sessionSlot))
    ? String(body.sessionSlot)
    : "morning";
  const requestedDeliveryMode = body.deliveryMode === "hybrid" ? "hybrid" : "physical";

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
            pathway: "Language training",
            classType,
            sessionSlot,
            deliveryMode,
            admission: phone ? { phone } : undefined,
          },
        },
      },
    });

    const student = await prisma.student.findUnique({ where: { userId: user.id }, select: { id: true } });
    const studentCode = student
      ? await assignStudentCode(student.id, { level, branch: branchRow, classType })
      : null;

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
  const sessionSlot = ["morning", "afternoon", "evening"].includes(String(body.sessionSlot))
    ? String(body.sessionSlot)
    : undefined;
  const requestedDeliveryMode = body.deliveryMode === "hybrid" || body.deliveryMode === "physical"
    ? body.deliveryMode
    : undefined;
  const newPassword = typeof body.password === "string" ? body.password : "";
  const pathway = typeof body.pathway === "string" && body.pathway.trim() ? body.pathway.trim() : undefined;
  // Only touched when the key is present at all, so an edit that isn't about
  // the phone number (a status change, a tutor swap) never clobbers it.
  const phone = typeof body.phone === "string" ? body.phone.trim() : undefined;

  if (!studentId) {
    return NextResponse.json({ error: "Student ID is required" }, { status: 400 });
  }

  try {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        user: true,
        branch: { select: { tenantId: true } },
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
      // JSON blob field — typed loosely on purpose, same as whereClause above.
      admission?: any;
    };
    if (level) updateStudent.level = level;
    if (pathway) updateStudent.pathway = pathway;
    /**
     * The phone number lives inside the JSON admission blob rather than a
     * column of its own — see the signup route, which writes it the same way.
     * Read-modify-write so editing the phone here never wipes out whatever
     * else the admission form collected (father's phone, city, and so on).
     */
    if (phone !== undefined) {
      const existingAdmission = (student.admission ?? {}) as Record<string, unknown>;
      updateStudent.admission = { ...existingAdmission, phone: phone || undefined };
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
      const targets = await prisma.student.findMany({ where: resetWhere, select: { id: true, userId: true } });
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
        const userIdChunk = slice.map((s) => s.userId);
        await prisma.student.deleteMany({ where: { id: { in: studentIdChunk } } });
        await prisma.user.deleteMany({ where: { id: { in: userIdChunk } } });
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
        user: { select: { tenantId: true } },
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

    for (const student of deletable) {
      await prisma.session.deleteMany({ where: { userId: student.userId } });
      await prisma.student.delete({ where: { id: student.id } });
      await prisma.user.delete({ where: { id: student.userId } });
    }

    return NextResponse.json({ success: true, deleted: deletable.length, skipped });
  } catch (error) {
    return NextResponse.json({ error: "Unable to delete student", detail: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}
