import { prisma } from "@/lib/prisma";
import { KIND, type Severity } from "@/lib/notification-kinds";

/**
 * What one person has asked not to be sent.
 *
 * THE ONE RULE: a personal preference may only NARROW what the school's
 * routing already allows, never widen it. `planFor()` decides whether a kind
 * emails at all; this decides whether it emails *you*. Getting that order
 * wrong would let a tutor tick a box and re-enable a channel an admin had
 * deliberately switched off school-wide.
 *
 * The other half of the rule is that some things cannot be muted at all — see
 * UNMUTABLE below. A preferences page that lets somebody turn off the message
 * saying their account was compromised is not a preferences page, it is a
 * trapdoor.
 */

/**
 * Kinds that ignore personal preferences entirely.
 *
 * Money and access. If a student mutes `payment.failed` they will not know why
 * their portal locked, and the school's first sign of trouble becomes a phone
 * call to the office. These are rare on purpose: the list earns its exceptions
 * one at a time, and everything not on it is genuinely the reader's choice.
 */
const UNMUTABLE: ReadonlySet<string> = new Set([
  KIND.paymentFailed,
  KIND.paymentReceived,
  KIND.tuitionReminder,
  KIND.gatewayError,
]);

export type MutedChannels = { inApp: boolean; push: boolean; email: boolean };

/** Nothing muted — what a person with no stored row gets. */
const ALLOW_ALL: MutedChannels = { inApp: true, push: true, email: true };

/**
 * Which channels each of these people still accepts for this kind.
 *
 * One query for the whole batch rather than one per recipient: an announcement
 * to two hundred students would otherwise add two hundred round trips to a
 * send that is already fanning out two hundred rows.
 *
 * `critical` overrides a personal mute on the IN-APP channel only. The bell is
 * the school's record that it told you; push and email stay the reader's
 * choice even then, because a critical notice does not justify waking a phone
 * somebody deliberately silenced.
 */
export async function mutedChannelsFor(
  userIds: string[],
  kind: string,
  severity: Severity = "info",
): Promise<Map<string, MutedChannels>> {
  const out = new Map<string, MutedChannels>();
  if (userIds.length === 0) return out;

  if (UNMUTABLE.has(kind)) {
    for (const id of userIds) out.set(id, ALLOW_ALL);
    return out;
  }

  let rows: Array<{ userId: string; inApp: boolean; push: boolean; email: boolean }> = [];
  try {
    rows = await prisma.notificationPreference.findMany({
      where: { userId: { in: userIds }, kind },
      select: { userId: true, inApp: true, push: true, email: true },
    });
  } catch (error) {
    // A preferences table that cannot be read must not stop the school's
    // notifications. Failing open matches how notification-routing.ts handles
    // the same situation: the message is more important than the preference.
    console.warn("notification prefs: falling back to allow-all", error);
    for (const id of userIds) out.set(id, ALLOW_ALL);
    return out;
  }

  const byUser = new Map(rows.map((row) => [row.userId, row]));
  for (const id of userIds) {
    const row = byUser.get(id);
    out.set(
      id,
      row
        ? {
            inApp: row.inApp || severity === "critical",
            push: row.push,
            email: row.email,
          }
        : ALLOW_ALL,
    );
  }
  return out;
}

/**
 * One person's stored preferences, for their settings page.
 *
 * Returns only what they have actually changed. The page fills the rest in
 * from the defaults, so an untouched account sends no rows and the table stays
 * empty until somebody has an opinion.
 */
export async function preferencesFor(userId: string): Promise<Record<string, MutedChannels>> {
  try {
    const rows = await prisma.notificationPreference.findMany({
      where: { userId },
      select: { kind: true, inApp: true, push: true, email: true },
    });
    return Object.fromEntries(
      rows.map((row) => [row.kind, { inApp: row.inApp, push: row.push, email: row.email }]),
    );
  } catch (error) {
    // The table is added by a migration that may not have been deployed yet.
    // An empty result renders the settings page with everything switched on,
    // which is the truth in that state — nothing is muted, because nothing can
    // be. Saving will surface the real error.
    console.warn("notification prefs: table unavailable", error);
    return {};
  }
}

/** Save one kind. Upserts, so saving the same page twice is harmless. */
export async function savePreference(
  userId: string,
  kind: string,
  channels: Partial<MutedChannels>,
): Promise<void> {
  const data = {
    inApp: channels.inApp ?? true,
    push: channels.push ?? true,
    email: channels.email ?? true,
  };
  await prisma.notificationPreference.upsert({
    where: { userId_kind: { userId, kind } },
    create: { userId, kind, ...data },
    update: data,
  });
}

/** Whether a kind is the reader's to silence. The UI greys out the rest. */
export function isMutable(kind: string): boolean {
  return !UNMUTABLE.has(kind);
}
