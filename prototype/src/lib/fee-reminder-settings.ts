import { prisma } from "@/lib/prisma";

/**
 * THE THREE FEE-REMINDER SWITCHES.
 *
 * A student who owes money can be reminded three ways, each run by a different
 * piece of code, and until now none of them could be turned off without a
 * deploy:
 *
 *   emails         fee-reminders.ts — the 7 / 14 / 30-day email to a part-payer,
 *                  and the "access paused" email.
 *   notifications  payment-warnings.ts — the bell and phone-push warnings: 14 /
 *                  30 / 45 days for a student who never cleared the deposit,
 *                  and 10 / 3 / 0 days before a part-payer's access pauses.
 *   becca          the pop-ups — Becca's daily card on the dashboard, and the
 *                  "your seat is waiting" card a locked student sees.
 *
 * Each is ON unless the school has switched it off, so a school that has never
 * opened the screen behaves exactly as before. One row per school in
 * SchoolSetting; a channel is off only when the value says `false` in so many
 * words — a malformed row never silences reminders by accident.
 *
 * THESE SWITCHES GOVERN THE AUTOMATIC REMINDERS ONLY. The office pressing "Send
 * reminder now" on the Reminders tab, or "Send reminder" on one student's file,
 * is an explicit act and goes out whatever the switches say — pausing the
 * schedule must not stop somebody sending a message they meant to send.
 */

export const FEE_REMINDERS_KEY = "fees.reminders";

export const FEE_REMINDER_CHANNELS = ["emails", "notifications", "becca"] as const;
export type FeeReminderChannel = (typeof FEE_REMINDER_CHANNELS)[number];

export type FeeReminderSettings = Record<FeeReminderChannel, boolean> & {
  /** When any switch was last flipped, and by whom — so a paused reminder is never a mystery. */
  updatedAt: string | null;
  updatedByName: string | null;
};

export const DEFAULT_FEE_REMINDERS: FeeReminderSettings = {
  emails: true,
  notifications: true,
  becca: true,
  updatedAt: null,
  updatedByName: null,
};

/** Lenient on read: absent or wrong-typed means "on". Only a literal `false` switches a channel off. */
export function parseFeeReminderSettings(value: unknown): FeeReminderSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_FEE_REMINDERS };
  const raw = value as Record<string, unknown>;
  return {
    emails: raw.emails !== false,
    notifications: raw.notifications !== false,
    becca: raw.becca !== false,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    updatedByName: typeof raw.updatedByName === "string" ? raw.updatedByName : null,
  };
}

/** This school's switches. Needs request scope (the school is the caller's). */
export async function readFeeReminderSettings(tenantId: string | null | undefined): Promise<FeeReminderSettings> {
  if (!tenantId) return { ...DEFAULT_FEE_REMINDERS };
  try {
    const row = await prisma.schoolSetting.findUnique({
      where: { tenantId_key: { tenantId, key: FEE_REMINDERS_KEY } },
      select: { value: true },
    });
    return parseFeeReminderSettings(row?.value);
  } catch (error) {
    // A settings read that fails must not switch a reminder off — nor on
    // silently in the other direction; the caller keeps its own default (on).
    console.warn("fee-reminder-settings: read failed, treating as on", error);
    return { ...DEFAULT_FEE_REMINDERS };
  }
}

export async function writeFeeReminderSettings(
  tenantId: string,
  patch: Partial<Record<FeeReminderChannel, boolean>>,
  by: { name: string | null },
): Promise<FeeReminderSettings> {
  const current = await readFeeReminderSettings(tenantId);
  const next: FeeReminderSettings = {
    ...current,
    ...(typeof patch.emails === "boolean" ? { emails: patch.emails } : {}),
    ...(typeof patch.notifications === "boolean" ? { notifications: patch.notifications } : {}),
    ...(typeof patch.becca === "boolean" ? { becca: patch.becca } : {}),
    updatedAt: new Date().toISOString(),
    updatedByName: by.name,
  };
  await prisma.schoolSetting.upsert({
    where: { tenantId_key: { tenantId, key: FEE_REMINDERS_KEY } },
    update: { value: next as unknown as object },
    create: { tenantId, key: FEE_REMINDERS_KEY, value: next as unknown as object },
  });
  return next;
}

/**
 * For the scheduled jobs, which sweep every school at once with no request
 * scope: the schools that have switched this channel OFF. A school with no row
 * is not in the set — it never opened the screen, so it is on.
 */
export async function tenantsWithChannelOff(channel: FeeReminderChannel): Promise<Set<string>> {
  const off = new Set<string>();
  try {
    const rows = await prisma.schoolSetting.findMany({
      where: { key: FEE_REMINDERS_KEY },
      select: { tenantId: true, value: true },
    });
    for (const row of rows) {
      if (!parseFeeReminderSettings(row.value)[channel]) off.add(row.tenantId);
    }
  } catch (error) {
    console.warn("fee-reminder-settings: could not read switches, treating all as on", error);
  }
  return off;
}

/**
 * Of these students, the ones whose school has this channel switched OFF.
 *
 * The scheduled jobs call this once per run with the ids they are about to
 * message and skip whoever comes back. The common case — nobody has switched
 * anything off — costs one small query and returns before touching the students.
 */
export async function studentIdsSilenced(
  channel: FeeReminderChannel,
  studentIds: string[],
): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set();
  const off = await tenantsWithChannelOff(channel);
  if (off.size === 0) return new Set();

  const rows = await prisma.student.findMany({
    where: { id: { in: studentIds } },
    select: { id: true, tenantId: true, user: { select: { tenantId: true } } },
  });
  return new Set(
    rows
      .filter((row) => {
        const tenantId = row.tenantId ?? row.user?.tenantId ?? null;
        return tenantId !== null && off.has(tenantId);
      })
      .map((row) => row.id),
  );
}
