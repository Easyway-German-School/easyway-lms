import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import {
  buildRosterWhereClause,
  parseRosterFilters,
  ROSTER_INCLUDE,
  scoreAndFilterRoster,
} from "@/lib/student-roster-query";

/**
 * THE ROSTER, DOWNLOADABLE.
 *
 * Before this, the only export on the admin students screen was
 * `downloadAdmission()` — one student's raw JSON. The office could not pull a
 * list at all: no headcount for a funder, no mailing list for a batch
 * reminder, no offline copy of who is enrolled.
 *
 * Deliberately shares its query with the roster GET (`api/admin/students`)
 * through student-roster-query.ts rather than re-filtering — what the office
 * sees filtered on screen is exactly what comes out of "Export", because both
 * ends read one `where` builder and one derived-filter pass.
 *
 * Money columns follow the `payments` capability, same split as the roster
 * and the student dossier — a Secretary can export the roster without
 * exporting the ledger.
 */

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[,"\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function isoDate(value: Date | null | undefined): string {
  return value ? value.toISOString().slice(0, 10) : "";
}

export async function GET(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const filters = parseRosterFilters(url);
  const format = url.searchParams.get("format") === "json" ? "json" : "csv";

  const allowedBranchIds = scopedBranchIds(gate.admin);
  const whereClause = buildRosterWhereClause(filters, {
    tenantId: gate.session.user.tenantId,
    allowedBranchIds,
  });

  const students = await prisma.student.findMany({
    where: whereClause,
    include: ROSTER_INCLUDE,
    orderBy: { createdAt: "desc" },
    // No cap here — an export is meant to be the whole filtered set, not one
    // page of it. The same 500-row ceiling the CSV importer uses elsewhere in
    // this file protects against runaway imports; a read like this one scales
    // with the school, not with anything a request body controls.
  });

  const now = new Date();
  const matched = scoreAndFilterRoster(students, filters, now);
  const canSeeMoney = gate.admin.can("payments");

  const rows = matched.map(({ student, finance, risk, segments }) => {
    const profile = student.profile;
    const admission = (student.admission ?? {}) as Record<string, unknown>;
    const batch = typeof admission.batch === "string" ? admission.batch : "";

    const base: Record<string, string> = {
      "Student code": student.studentCode ?? "",
      Name: student.user?.name ?? "",
      Email: student.user?.email ?? "",
      Status: student.status,
      Level: student.level,
      Batch: batch,
      Session: student.sessionSlot,
      "Class type": student.classType,
      "Delivery mode": student.deliveryMode,
      Branch: student.branch?.name ?? "",
      Tutor: student.tutor?.user?.name ?? "",
      Phone: profile?.phone ?? (typeof admission.phone === "string" ? admission.phone : ""),
      WhatsApp: profile?.whatsapp ?? "",
      City: profile?.city ?? "",
      "State/Region": profile?.stateRegion ?? "",
      Country: profile?.country ?? "",
      "Date of birth": isoDate(profile?.dateOfBirth ?? null),
      Gender: profile?.gender ?? "",
      Nationality: profile?.nationality ?? "",
      "Gov. ID type": profile?.govIdType ?? "",
      "Guardian name": profile?.guardianName ?? "",
      "Guardian phone": profile?.guardianPhone ?? "",
      "Emergency contact": profile?.emergencyName ?? "",
      "Emergency phone": profile?.emergencyPhone ?? "",
      "Heard from": profile?.heardFrom ?? "",
      "Enrolled on": isoDate(student.createdAt),
      "Classes started": isoDate(student.classesStartedAt),
      "Held back": student.heldBackAt ? "yes" : "no",
      // Per-level stints on record — see lib/student-enrolment.ts. 0 means a
      // pre-enrolment-history account not yet touched by the backfill script,
      // not a student with no history.
      Enrolments: String(student._count.enrolments),
      Tags: student.tags.join("; "),
      Segments: segments.join("; "),
    };

    if (canSeeMoney) {
      base["Tuition fee"] = String(finance.tuitionFee);
      base["Paid"] = String(finance.paid);
      base["Outstanding"] = String(finance.owed);
      base["Payment status"] = finance.fullPaid ? "Completed" : finance.depositPaid ? "Partial" : "Pending";
      base["Aging bucket"] = finance.owed > 0 ? finance.agingBucket : "";
    }

    base["Churn risk"] = risk.level;

    return base;
  });

  if (format === "json") {
    return NextResponse.json({ rows, totalCount: rows.length, canSeeMoney });
  }

  if (rows.length === 0) {
    return new NextResponse("No students matched this filter.", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(escapeCsv).join(","),
    ...rows.map((row) => headers.map((key) => escapeCsv(row[key])).join(",")),
  ];

  const csv = lines.join("\r\n");
  const stamp = now.toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="students-${stamp}.csv"`,
    },
  });
}
