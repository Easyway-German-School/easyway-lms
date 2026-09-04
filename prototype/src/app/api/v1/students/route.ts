import type { NextRequest } from "next/server";
import bcryptjs from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/api/auth";
import { apiError, apiOk, apiPage, parseLimit } from "@/lib/api/response";
import { publicStudent, studentSelect } from "@/lib/api/shapes";
import { assignStudentCode } from "@/lib/student-code";
import { createResetToken } from "@/lib/password-reset";

export const dynamic = "force-dynamic";

/**
 * The school's students.
 *
 * Every query here goes through `prisma`, which is tenant-scoped from the
 * context `requireApiKey` set — so there is no `where: { tenantId }` in this
 * file and there must not be. Writing one would suggest the filter is this
 * route's job, and the next route somebody adds would be written without it.
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiKey(request, "students:read");
  if (!gate.ok) return gate.response;

  const params = request.nextUrl.searchParams;
  const limit = parseLimit(params.get("limit"));
  const cursor = params.get("cursor");
  const status = params.get("status");
  const level = params.get("level");
  const branchId = params.get("branchId");
  const studentCode = params.get("studentCode");

  const rows = await prisma.student.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(level ? { level } : {}),
      ...(branchId ? { branchId } : {}),
      ...(studentCode ? { studentCode } : {}),
      deletedAt: null,
    },
    select: studentSelect,
    orderBy: { id: "asc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  return apiPage(rows.map(publicStudent), { limit, cursorOf: (s) => s.id });
}

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const SESSION_SLOTS = ["morning", "afternoon", "evening", "weekend"];
const CLASS_TYPES = ["group", "private"];
const DELIVERY_MODES = ["physical", "hybrid", "online"];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Enrol a student.
 *
 * The internal signup flow does more than this — a photo, branch-tier pricing,
 * a lead close, an office alert — but none of that is required to have a real,
 * usable student record, and a partner running their own admissions has
 * already done the parts that are theirs. So this creates exactly what makes a
 * student: a User, a Student, a student code, in one transaction, tenant-scoped
 * from the key. The account has no password; the response carries a one-time
 * link the partner can hand to the student to set one.
 */
export async function POST(request: NextRequest) {
  const gate = await requireApiKey(request, "students:write");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => null);
  const name = String(body?.name ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();

  if (!name) return apiError("invalid_request", "`name` is required.");
  if (!EMAIL_RE.test(email)) return apiError("invalid_request", "`email` must be a valid email address.");

  const level = String(body?.level ?? "A1").toUpperCase();
  if (!LEVELS.includes(level)) {
    return apiError("invalid_request", `\`level\` must be one of: ${LEVELS.join(", ")}.`);
  }
  const sessionSlot = String(body?.sessionSlot ?? "morning").toLowerCase();
  if (!SESSION_SLOTS.includes(sessionSlot)) {
    return apiError("invalid_request", `\`sessionSlot\` must be one of: ${SESSION_SLOTS.join(", ")}.`);
  }
  const classType = String(body?.classType ?? "group").toLowerCase();
  if (!CLASS_TYPES.includes(classType)) {
    return apiError("invalid_request", `\`classType\` must be one of: ${CLASS_TYPES.join(", ")}.`);
  }
  const deliveryMode = String(body?.deliveryMode ?? "physical").toLowerCase();
  if (!DELIVERY_MODES.includes(deliveryMode)) {
    return apiError("invalid_request", `\`deliveryMode\` must be one of: ${DELIVERY_MODES.join(", ")}.`);
  }
  const pathway = body?.pathway ? String(body.pathway).trim() : undefined;

  // Resolve the branch by id or by name, and only within this tenant — the
  // scoped client makes a foreign branch simply not exist here.
  let branchId: string | null = null;
  if (body?.branchId || body?.branchName) {
    const branch = await prisma.branch.findFirst({
      where: body?.branchId
        ? { id: String(body.branchId) }
        : { name: { equals: String(body.branchName), mode: "insensitive" } },
      select: { id: true, name: true, mode: true },
    });
    if (!branch) {
      return apiError("invalid_request", "No branch matches `branchId` / `branchName` for this school.");
    }
    branchId = branch.id;
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return apiError("invalid_request", `${email} already has an account. Emails are unique across the school.`);
  }

  // A password nobody knows — the student sets a real one through the link
  // below. `passwordClaimed: false` keeps that link the only way in.
  const unusable = await bcryptjs.hash(crypto.randomBytes(24).toString("base64url"), 10);

  const student = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, name, role: "STUDENT", password: unusable, passwordClaimed: false },
      select: { id: true },
    });
    return tx.student.create({
      data: {
        userId: user.id,
        ...(branchId ? { branchId } : {}),
        level,
        sessionSlot,
        classType,
        deliveryMode,
        ...(pathway ? { pathway } : {}),
        status: "active",
      },
      select: studentSelect,
    });
  });

  // Best effort: a missing code is repairable by the backfill script and must
  // never fail an enrolment that otherwise succeeded.
  const code = await assignStudentCode(student.id, {
    level,
    classType,
    ...(branchId ? { branch: { name: student.branch?.name ?? null } } : {}),
  });

  const issued = await createResetToken(email);
  const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
  const setupUrl = issued ? `${base}/auth/reset?token=${issued.token}` : `${base}/auth/forgot`;

  return apiOk(
    {
      ...publicStudent(student),
      studentCode: code ?? student.studentCode,
      setupUrl,
    },
    { status: 201 },
  );
}
