/**
 * Webinar helpers: naming, access, and LiveKit token minting.
 *
 * A webinar's room is a LiveKit room like any class. The token grants differ by
 * role: a host/presenter publishes and is a room admin; an audience member in
 * `webinar` mode subscribes only (muted stage). See src/app/api/live/session
 * for the classroom's version of the same dance.
 */

import { prisma } from "@/lib/prisma";
import type { AdminContext } from "@/lib/admin-roles";

export const WEBINAR_MODES = ["webinar", "meeting"] as const;
export const WEBINAR_AUDIENCES = ["staff", "students", "branch", "public", "mixed"] as const;

export function normalizeMode(v: unknown): string {
  const s = String(v ?? "").toLowerCase();
  return (WEBINAR_MODES as readonly string[]).includes(s) ? s : "webinar";
}
export function normalizeAudience(v: unknown): string {
  const s = String(v ?? "").toLowerCase();
  return (WEBINAR_AUDIENCES as readonly string[]).includes(s) ? s : "staff";
}

/** Stable, unguessable room name for a webinar. */
export function webinarRoomName(webinarId: string): string {
  return `webinar_${webinarId}`;
}

const SLUG_STOP = /[^a-z0-9]+/g;
export async function uniqueLandingSlug(title: string): Promise<string> {
  const base =
    String(title).toLowerCase().normalize("NFKD").replace(SLUG_STOP, "-").replace(/^-+|-+$/g, "").slice(0, 48) ||
    "webinar";
  for (let n = 1; n < 500; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const clash = await prisma.webinar.findFirst({ where: { landingSlug: slug }, select: { id: true } });
    if (!clash) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

type WebinarForAccess = {
  event: { createdById: string | null; workspace: { members: { userId: string; role: string }[] } | null };
};

/** Can this admin change / run this webinar? Same rule as its WorkEvent. */
export function canManageWebinar(w: WebinarForAccess, admin: Pick<AdminContext, "userId" | "branchIds">): boolean {
  if (admin.branchIds === null) return true;
  if (w.event.createdById === admin.userId) return true;
  const m = w.event.workspace?.members.find((x) => x.userId === admin.userId);
  return m?.role === "owner" || m?.role === "editor";
}

export function liveKitReady(): boolean {
  return Boolean(process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET && process.env.LIVEKIT_URL);
}

export type WebinarRole = "host" | "presenter" | "attendee";

/**
 * A LiveKit JWT for one person joining one webinar room.
 *
 * `host`/`presenter` publish and (host only) administer the room; `attendee` in
 * `webinar` mode may only subscribe, but keeps `canUpdateOwnMetadata` so a
 * raised hand survives a reconnect — the exact shape the classroom uses.
 */
export async function mintWebinarToken(opts: {
  roomName: string;
  mode: string;
  identity: string;
  name: string;
  role: WebinarRole;
}): Promise<{ token: string; url: string } | null> {
  if (!liveKitReady()) return null;
  const { AccessToken } = await import("livekit-server-sdk");

  const canPublish = opts.role === "host" || opts.role === "presenter" || opts.mode === "meeting";
  const token = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
    identity: opts.identity,
    name: opts.name,
    ttl: "4h",
    metadata: JSON.stringify({ role: opts.role, kind: "webinar" }),
  });
  token.addGrant({
    roomJoin: true,
    room: opts.roomName,
    canPublish,
    canSubscribe: true,
    canPublishData: true,
    canUpdateOwnMetadata: true,
    roomAdmin: opts.role === "host",
  });
  return { token: await token.toJwt(), url: process.env.LIVEKIT_URL! };
}
