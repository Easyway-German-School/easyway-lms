import { prisma } from "@/lib/prisma";
import { isStaffRole } from "@/lib/community-spaces";

/**
 * The office's authority in the chat, in one place.
 *
 * Two powers, and they are deliberately different in kind. Removing a message
 * already existed and takes something away after the fact. These two act on
 * what happens NEXT: a pin holds one message at the top of a room, and a mute
 * stops one student posting for a while.
 *
 * Both are staff-only, and the check lives here rather than in each route so
 * that adding a third power cannot accidentally ship without one.
 */

/** How long a mute may last. Beyond a week, talk to the student instead. */
export const MUTE_PRESETS = [
  { id: "1h", label: "1 hour", minutes: 60 },
  { id: "24h", label: "24 hours", minutes: 60 * 24 },
  { id: "7d", label: "7 days", minutes: 60 * 24 * 7 },
] as const;

export type MutePresetId = (typeof MUTE_PRESETS)[number]["id"];

export function minutesForPreset(id: string): number | null {
  return MUTE_PRESETS.find((preset) => preset.id === id)?.minutes ?? null;
}

export function canModerate(role: unknown): boolean {
  return isStaffRole(role);
}

export type ActiveMute = {
  mutedUntil: string;
  reason: string | null;
};

/**
 * Is this person currently muted?
 *
 * Compared against the clock on read rather than cleaned up by a job. A lapsed
 * row is simply not a mute any more, so there is no window in which a student
 * stays silenced because a sweep has not run yet — which is exactly the failure
 * a student would experience as the school ignoring them.
 */
export async function activeMuteFor(userId: string, now = new Date()): Promise<ActiveMute | null> {
  const mute = await prisma.communityMute.findUnique({
    where: { userId },
    select: { mutedUntil: true, reason: true },
  });

  if (!mute || mute.mutedUntil <= now) return null;
  return { mutedUntil: mute.mutedUntil.toISOString(), reason: mute.reason };
}

/** Human wording for a refusal, so the student is never silenced without a reason. */
export function muteMessage(mute: ActiveMute): string {
  const until = new Date(mute.mutedUntil).toLocaleString("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return mute.reason
    ? `You cannot post until ${until}. Reason: ${mute.reason}`
    : `You cannot post until ${until}.`;
}
