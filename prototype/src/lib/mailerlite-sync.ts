import { prisma } from "@/lib/prisma";
import { receivedPaymentFilter } from "@/lib/payment";
import { accessFromStudent } from "@/lib/student-access";
import { listGroups, upsertSubscriber } from "@/lib/mailerlite";

/**
 * Keeps the MailerLite list in step with the LMS.
 *
 * The school's MailerLite account already has a group taxonomy that mirrors
 * how it thinks about students — "A2 Students 2026", "Paid_A2 Students" — so
 * this maps onto the groups that exist rather than inventing new ones. Groups
 * are matched BY NAME at runtime because the ids are account-specific, and a
 * name that does not exist is skipped rather than created: silently spawning
 * groups in a live marketing account is not this job's business.
 *
 * Writes to a real marketing list, so `dryRun` is the default everywhere.
 */

/** Group names this student belongs in, most specific last. */
function groupNamesFor(level: string, fullPaid: boolean, year: number): string[] {
  const names = [`${level} Students ${year}`];
  if (fullPaid) names.push(`Paid_${level} Students`);
  return names;
}

export type SyncResult = {
  dryRun: boolean;
  considered: number;
  synced: number;
  skippedNoEmail: number;
  failed: number;
  groupsMatched: string[];
  groupsMissing: string[];
  sample: Array<{ email: string; level: string; paid: boolean; groups: string[] }>;
  errors: string[];
};

export async function syncStudentsToMailerLite(options?: {
  dryRun?: boolean;
  year?: number;
}): Promise<SyncResult> {
  const dryRun = options?.dryRun ?? true;
  const year = options?.year ?? new Date().getFullYear();

  const result: SyncResult = {
    dryRun,
    considered: 0,
    synced: 0,
    skippedNoEmail: 0,
    failed: 0,
    groupsMatched: [],
    groupsMissing: [],
    sample: [],
    errors: [],
  };

  const groupList = await listGroups();
  if (!groupList.ok) {
    result.errors.push(groupList.error ?? "Could not read MailerLite groups");
    return result;
  }

  // Case-insensitive lookup: the account mixes "a1" and "A1 Students 2026".
  const byName = new Map(groupList.groups.map((g) => [g.name.toLowerCase(), g.id]));

  const students = await prisma.student.findMany({
    where: { status: "active" },
    select: {
      id: true,
      level: true,
      classType: true,
      pathway: true,
      studentCode: true,
      deliveryMode: true,
      classesStartedAt: true,
      createdAt: true,
      paymentGraceUntil: true,
      admission: true,
      branch: { select: { name: true, mode: true } },
      user: { select: { name: true, email: true } },
      payments: { where: receivedPaymentFilter(), select: { amount: true } },
      tuitionCharges: {
        where: { deletedAt: null },
        select: { id: true, level: true, amount: true, waivedAmount: true, legacyArrears: true, createdAt: true, settledAt: true },
      },
    },
  });

  const matched = new Set<string>();
  const missing = new Set<string>();

  for (const student of students) {
    result.considered++;

    const email = student.user.email?.trim();
    if (!email) {
      result.skippedNoEmail++;
      continue;
    }

    // Same ledger-aware computation the portal itself uses — a raw
    // `totalPaid >= tuitionFee` here tagged a promoted/waived student with
    // the wrong "paid" segment in the external CRM.
    const fullPaid = accessFromStudent(student).outstandingBalance <= 0;

    const wanted = groupNamesFor(student.level, fullPaid, year);
    const ids: string[] = [];
    for (const name of wanted) {
      const id = byName.get(name.toLowerCase());
      if (id) { ids.push(id); matched.add(name); }
      else missing.add(name);
    }

    if (result.sample.length < 10) {
      result.sample.push({ email, level: student.level, paid: fullPaid, groups: wanted });
    }

    if (dryRun) {
      result.synced++;
      continue;
    }

    const res = await upsertSubscriber(
      email,
      {
        name: student.user.name,
        level: student.level,
        branch: student.branch?.name ?? null,
        studentCode: student.studentCode,
        paymentStatus: fullPaid ? "paid" : "outstanding",
      },
      ids,
    );

    if (res.ok) result.synced++;
    else {
      result.failed++;
      if (result.errors.length < 5) result.errors.push(`${email}: ${res.error ?? "unknown error"}`);
    }
  }

  result.groupsMatched = [...matched].sort();
  result.groupsMissing = [...missing].sort();
  return result;
}
