import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

/**
 * Public certificate verification. No session — that is the point: an employer
 * or a consulate holding a printed certificate must be able to check it without
 * an account.
 *
 * What it returns is deliberately narrow. Enough to confirm the document is
 * genuine and describes the person named on it, and nothing more: no email, no
 * payment state, no scores beyond the award already printed on the face. A
 * verification endpoint that volunteered a student's balance would be a data
 * leak with a public URL.
 *
 * The PROVISIONAL stamp is intentionally NOT reported here. It is a matter
 * between the school and the student, not something to disclose to a
 * prospective employer.
 */

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const normalised = String(code ?? "").trim().toUpperCase();

  if (!/^[A-Z0-9-]{6,24}$/.test(normalised)) {
    return NextResponse.json({ valid: false, reason: "That is not a valid verification code." }, { status: 400 });
  }

  const certificate = await prisma.certificate.findUnique({
    where: { verifyCode: normalised },
    select: {
      kind: true,
      level: true,
      award: true,
      serial: true,
      studentName: true,
      studentCode: true,
      branchName: true,
      issuedAt: true,
      revokedAt: true,
    },
  });

  if (!certificate) {
    return NextResponse.json({ valid: false, reason: "No certificate matches that code." }, { status: 404 });
  }

  if (certificate.revokedAt) {
    return NextResponse.json({
      valid: false,
      reason: "This certificate has been revoked by the school.",
      serial: certificate.serial,
    });
  }

  return NextResponse.json({
    valid: true,
    serial: certificate.serial,
    studentName: certificate.studentName,
    studentCode: certificate.studentCode,
    level: certificate.level,
    kind: certificate.kind,
    award: certificate.award,
    branchName: certificate.branchName,
    issuedAt: certificate.issuedAt,
  });
}
