import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clientIp } from "@/lib/rate-limit";
import { KIND, notifyInBackground } from "@/lib/notify";
import { TERMS_CONTEXT, TERMS_VERSION } from "@/lib/terms";

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const requests = await prisma.refundRequest.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    requests: requests.map((request) => ({
      id: request.id,
      status: request.status,
      courseOrPackage: request.courseOrPackage,
      reason: request.reason,
      requestedAmount: request.requestedAmount,
      decisionAmount: request.decisionAmount,
      decisionNote: request.decisionNote,
      createdAt: request.createdAt.toISOString(),
      decidedAt: request.decidedAt?.toISOString() ?? null,
      paidAt: request.paidAt?.toISOString() ?? null,
    })),
  });
}

/**
 * Submitting a refund request always re-acknowledges the policy first — see
 * TERMS_CONTEXT.refund in src/lib/terms.ts. That acknowledgement is written
 * as its own TermsAcceptance row (the audit trail this whole feature exists
 * for) AND denormalised onto the request itself, so the request still answers
 * "what did they agree to, and when" after the document has moved on.
 */
export async function POST(request: NextRequest) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true, branchId: true, level: true },
  });
  if (!student) return NextResponse.json({ error: "Student profile not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const {
    acknowledgedTerms,
    fullName,
    phone,
    courseOrPackage,
    paymentReference,
    reason,
    supportingDocs,
    requestedAmount,
  } = (body || {}) as Record<string, unknown>;

  if (acknowledgedTerms !== true) {
    return NextResponse.json(
      { error: "Please review and acknowledge the refund policy before submitting a request." },
      { status: 400 },
    );
  }

  const normalizedFullName = typeof fullName === "string" ? fullName.trim() : "";
  const normalizedPhone = typeof phone === "string" ? phone.trim() : "";
  const normalizedCourse = typeof courseOrPackage === "string" ? courseOrPackage.trim() : "";
  const normalizedReference = typeof paymentReference === "string" ? paymentReference.trim() : "";
  const normalizedReason = typeof reason === "string" ? reason.trim() : "";
  const normalizedAmount =
    typeof requestedAmount === "number" && Number.isFinite(requestedAmount) && requestedAmount > 0
      ? Math.round(requestedAmount)
      : null;
  const normalizedDocs = Array.isArray(supportingDocs)
    ? supportingDocs.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : undefined;

  if (!normalizedFullName || !normalizedPhone || !normalizedCourse || !normalizedReference || !normalizedReason) {
    return NextResponse.json(
      { error: "Full name, phone, course/package, payment reference and a reason are all required." },
      { status: 400 },
    );
  }

  const acknowledgement = await prisma.termsAcceptance.create({
    data: {
      userId: session.user.id,
      studentId: student.id,
      context: TERMS_CONTEXT.refund,
      version: TERMS_VERSION,
      ip: clientIp(request.headers),
      userAgent: request.headers.get("user-agent") || undefined,
    },
  });

  const created = await prisma.refundRequest.create({
    data: {
      userId: session.user.id,
      studentId: student.id,
      fullName: normalizedFullName,
      phone: normalizedPhone,
      courseOrPackage: normalizedCourse,
      paymentReference: normalizedReference,
      reason: normalizedReason,
      supportingDocs: normalizedDocs && normalizedDocs.length ? normalizedDocs : undefined,
      requestedAmount: normalizedAmount,
      acceptedTermsVersion: acknowledgement.version,
      acceptedTermsAt: acknowledgement.createdAt,
    },
  });

  notifyInBackground({
    to: { audience: "admin", capability: "payments" },
    kind: KIND.refundRequested,
    severity: "warning",
    title: "New refund request",
    message: `${normalizedFullName} requested a refund for ${normalizedCourse}.`,
    link: "/admin/legal",
  });

  return NextResponse.json({ request: { id: created.id, status: created.status } }, { status: 201 });
}
