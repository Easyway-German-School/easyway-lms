import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { requireAdmin, type AdminContext } from "@/lib/admin-roles";

/**
 * Who can see a channel. Computed from role, not a membership table — the
 * same reasoning as every capability check elsewhere in this app: a list
 * somebody has to remember to update drifts, a rule evaluated fresh every
 * time does not.
 */
export const CHANNEL_AUDIENCES = ["admin", "tutors", "growth", "all_staff"] as const;
export type ChannelAudience = (typeof CHANNEL_AUDIENCES)[number];

export const CHANNEL_AUDIENCE_LABELS: Record<ChannelAudience, string> = {
  admin: "Admin staff",
  tutors: "Tutors",
  growth: "Growth Desk (Sales & Business Development)",
  all_staff: "Everyone — admin staff and tutors",
};

export function normalizeChannelAudience(value: unknown): ChannelAudience | null {
  const v = String(value ?? "");
  return (CHANNEL_AUDIENCES as readonly string[]).includes(v) ? (v as ChannelAudience) : null;
}

export type ChannelViewer =
  | { kind: "lecturer"; userId: string }
  | { kind: "admin"; userId: string; admin: AdminContext };

/**
 * Whether this signed-in staff member — tutor or admin, whichever they are —
 * can open a channel with this audience.
 *
 *   admin      any admin account, any sub-role. Not tutors.
 *   tutors     any tutor, PLUS an admin holding `community` — the oversight
 *              seat the handbook gives HR and the Digital Communications
 *              Officer on the tutors' channel.
 *   growth     an admin holding `growth`. Not tutors.
 *   all_staff  everyone who reached this far — admin or tutor.
 */
export function canAccessChannel(audience: ChannelAudience, viewer: ChannelViewer): boolean {
  if (audience === "all_staff") return true;
  if (viewer.kind === "lecturer") return audience === "tutors";
  if (audience === "admin") return true;
  if (audience === "tutors") return viewer.admin.can("community");
  if (audience === "growth") return viewer.admin.can("growth");
  return false;
}

/**
 * The shared door for every staff-channels route: admits a signed-in tutor
 * OR any signed-in admin, no particular capability required — per-channel
 * visibility is decided afterwards by canAccessChannel. Mirrors
 * requireCapabilityOrLecturer in admin-roles.ts, but that helper always
 * checks one fixed capability against the admin side; this one has none to
 * check yet, because which channels are reachable depends on which channel.
 */
export async function requireStaffOrLecturer(): Promise<
  | { ok: true; viewer: ChannelViewer; session: Session }
  | { ok: false; response: Response }
> {
  const { requireAuthSession } = await import("@/lib/auth");

  const session = await requireAuthSession();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  if (session.user.role?.toLowerCase() === "lecturer") {
    return { ok: true, viewer: { kind: "lecturer", userId: session.user.id }, session };
  }

  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  return { ok: true, viewer: { kind: "admin", userId: gate.admin.userId, admin: gate.admin }, session: gate.session };
}
