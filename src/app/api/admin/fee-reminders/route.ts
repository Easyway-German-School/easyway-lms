import { NextRequest, NextResponse } from "next/server";
import { prisma, unguardedPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/prisma-guard";
import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import {
  CHASE_CATEGORIES,
  FINANCE_STUDENT_SELECT,
  chaseCategoryOf,
  computeAll,
  summariseReceivables,
  type ChaseCategory,
} from "@/lib/finance/receivables";
import { buildRosterWhereClause } from "@/lib/student-roster-query";
import {
  FEE_REMINDER_CHANNELS,
  readFeeReminderSettings,
  writeFeeReminderSettings,
} from "@/lib/fee-reminder-settings";
import { recentChaseSends } from "@/lib/fee-chase-send";
import { isEmailConfigured } from "@/lib/mailer";

export const dynamic = "force-dynamic";

/**
 * The Reminders tab's data: the three switches, the chase list counted by the
 * SAME rule the roster filter and the call sheet use, and the recent sends.
 *
 * Gated on `payments`, like every other screen that shows what a student owes.
 */

export async function GET() {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const tenantId = gate.session.user.tenantId ?? null;
  const fence = buildRosterWhereClause({}, { tenantId, allowedBranchIds: scopedBranchIds(gate.admin) });

  const now = new Date();
  const students = await prisma.student.findMany({ where: fence, select: FINANCE_STUDENT_SELECT });
  const rows = computeAll(students, now);
  const summary = summariseReceivables(rows);

  // How many of each group are learners waiting on a future intake — they have
  // their own reminders (Upcoming intake), so the mass send leaves them out by default.
  const awaiting = CHASE_CATEGORIES.reduce(
    (acc, category) => ({
      ...acc,
      [category]: rows.filter((row) => chaseCategoryOf(row) === category && row.awaitingBatch).length,
    }),
    {} as Record<ChaseCategory, number>,
  );

  const [settings, recent] = await Promise.all([readFeeReminderSettings(tenantId), recentChaseSends()]);

  return NextResponse.json({
    settings,
    chase: summary.chase,
    chaseAll: summary.chaseAll,
    onHold: rows.filter((row) => row.status === "active" && row.lockActive).length,
    awaiting,
    recent,
    emailConfigured: isEmailConfigured(),
  });
}

export async function PATCH(request: NextRequest) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const tenantId = gate.session.user.tenantId;
  if (!tenantId) return NextResponse.json({ error: "No school in context" }, { status: 400 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const patch: Partial<Record<(typeof FEE_REMINDER_CHANNELS)[number], boolean>> = {};
  for (const channel of FEE_REMINDER_CHANNELS) {
    if (typeof body?.[channel] === "boolean") patch[channel] = body[channel] as boolean;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }

  const before = await readFeeReminderSettings(tenantId);
  const settings = await writeFeeReminderSettings(tenantId, patch, {
    name: (gate.session.user.name as string | null | undefined) ?? null,
  });

  const changed = FEE_REMINDER_CHANNELS.filter((channel) => before[channel] !== settings[channel]);
  if (changed.length > 0) {
    await writeAudit(unguardedPrisma, {
      action: "feeReminderSwitch",
      model: "SchoolSetting",
      recordId: tenantId,
      severity: "notice",
      summary: changed.map((channel) => `${channel} reminders ${settings[channel] ? "switched ON" : "switched OFF"}`).join(", "),
      before: Object.fromEntries(FEE_REMINDER_CHANNELS.map((c) => [c, before[c]])),
      after: Object.fromEntries(FEE_REMINDER_CHANNELS.map((c) => [c, settings[c]])),
    });
  }

  return NextResponse.json({ settings });
}
