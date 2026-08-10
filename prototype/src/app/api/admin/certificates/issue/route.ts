import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { issueCertificateForStudent } from "@/lib/certificates";
import { KIND, notify } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * Issue certificates to an audience: one student, a level, a branch, or everyone.
 *
 * Certificates could only ever be minted one at a time, by the student
 * themselves, by opening their own certificates page. So the end of a term
 * meant telling forty people to go and look — and the ones who never did simply
 * had no certificate, with the office unable to tell which was which.
 *
 * TWO-STEP BY DESIGN. A POST with `preview: true` counts and lists who would be
 * affected and writes nothing; issuing requires a second call with the same
 * audience and `confirm: true`. Minting a numbered, publicly verifiable
 * document for every student in a school is not something to do on a mis-click,
 * and the serial counter it advances cannot be wound back.
 */

type Audience = {
  scope: "student" | "level" | "branch" | "all";
  studentId?: string | null;
  level?: string | null;
  branchId?: string | null;
  /** Skip students who already hold a certificate for the level they are on. */
  onlyMissing?: boolean;
};

function readAudience(body: Record<string, unknown>): Audience | null {
  const scope = String(body.scope ?? "");
  if (!["student", "level", "branch", "all"].includes(scope)) return null;
  return {
    scope: scope as Audience["scope"],
    studentId: typeof body.studentId === "string" ? body.studentId : null,
    level: typeof body.level === "string" ? body.level.toUpperCase() : null,
    branchId: typeof body.branchId === "string" ? body.branchId : null,
    onlyMissing: body.onlyMissing !== false,
  };
}

export async function POST(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const audience = readAudience(body);
  if (!audience) {
    return NextResponse.json({ error: "scope must be student, level, branch or all" }, { status: 400 });
  }

  const where: Record<string, unknown> = {};
  if (audience.scope === "student") {
    if (!audience.studentId) {
      return NextResponse.json({ error: "studentId is required for a single student" }, { status: 400 });
    }
    where.id = audience.studentId;
  }
  if (audience.scope === "level") {
    if (!audience.level) {
      return NextResponse.json({ error: "level is required" }, { status: 400 });
    }
    where.level = audience.level;
  }
  if (audience.scope === "branch") {
    if (!audience.branchId) {
      return NextResponse.json({ error: "branchId is required" }, { status: 400 });
    }
    where.branchId = audience.branchId;
    // A branch send is almost always "this branch, this level" — the office
    // graduates a cohort, not a building. Level stays optional so the whole
    // branch is still reachable in one go.
    if (audience.level) where.level = audience.level;
  }

  const students = await prisma.student.findMany({
    where,
    select: {
      id: true,
      level: true,
      user: { select: { name: true, email: true } },
      branch: { select: { name: true } },
      certificates: { select: { id: true, level: true, revokedAt: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const candidates = students.filter((student) => {
    if (!audience.onlyMissing) return true;
    return !student.certificates.some(
      (certificate) => certificate.level === student.level.toUpperCase() && !certificate.revokedAt,
    );
  });

  /**
   * PREVIEW IS THE DEFAULT.
   *
   * `confirm` has to be sent explicitly. A client that forgets it gets a count
   * and nothing is written, which is the safe way round for an operation that
   * mints public documents and advances a serial counter.
   */
  if (body.confirm !== true) {
    return NextResponse.json({
      preview: true,
      matched: students.length,
      willIssue: candidates.length,
      alreadyHave: students.length - candidates.length,
      sample: candidates.slice(0, 25).map((student) => ({
        id: student.id,
        name: student.user?.name ?? "Unnamed",
        email: student.user?.email ?? "",
        level: student.level,
        branch: student.branch?.name ?? "Unassigned",
      })),
    });
  }

  const issued: Array<{ id: string; name: string; certificateId: string; created: boolean }> = [];
  const skipped: Array<{ id: string; name: string; reason: string }> = [];

  for (const student of candidates) {
    // Sequential rather than Promise.all: `makeSerial` counts existing rows to
    // pick the next number, so issuing forty in parallel would hand several
    // students the same serial — and the serial is printed on the document and
    // unique in the database, so the duplicates would fail at write time after
    // some had already succeeded.
    const result = await issueCertificateForStudent(student.id);
    if (result.issued) {
      issued.push({
        id: student.id,
        name: student.user?.name ?? "Unnamed",
        certificateId: result.certificateId,
        created: result.created,
      });

      // Only tell them about a document that did not exist a moment ago.
      // Re-running a bulk issue is safe and idempotent, and it must not send a
      // second congratulations to everybody who was already done.
      if (result.created) {
        await notify({
          to: { studentIds: [student.id] },
          kind: KIND.certificateIssued,
          title: "Your certificate is ready",
          message: `Your ${student.level} certificate has been issued.`,
          emailBody: `Your ${student.level} certificate has been issued. Open it from the Certificates page to view, print or share it — it carries a serial and a verification link an employer or consulate can check.`,
          link: "/certificates",
          // Re-running a bulk issue is safe and idempotent; this stops the
          // second run congratulating anybody twice even if a row was somehow
          // recreated.
          dedupeKey: `certificate.issued:${result.certificateId}`,
          senderId: gate.admin.userId,
        }).catch(() => {
          // A notification failure must not abort the run — the certificate is
          // the thing that matters and it is already written.
        });
      }
    } else {
      skipped.push({ id: student.id, name: student.user?.name ?? "Unnamed", reason: result.reason });
    }
  }

  return NextResponse.json({
    preview: false,
    matched: students.length,
    issued: issued.length,
    created: issued.filter((entry) => entry.created).length,
    skipped,
  });
}
