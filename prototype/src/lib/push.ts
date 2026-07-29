import webpush from "web-push";
import { prisma } from "@/lib/prisma";

/**
 * Web Push (VAPID) delivery.
 *
 * This is the piece that lets the community reach a student on their lock
 * screen, which is the only place it competes with WhatsApp for attention.
 *
 * Keys live in .env.local as VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY — generate
 * them with `node scripts/generate-vapid-keys.mjs`. When they are absent push
 * is simply skipped: the community still works, it just stays silent, so a
 * fresh clone with no keys is never broken by this.
 */

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:info@easywaygerman.com";

let configured = false;
if (PUBLIC_KEY && PRIVATE_KEY) {
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
  configured = true;
}

export function isPushConfigured() {
  return configured;
}

export function vapidPublicKey() {
  return PUBLIC_KEY;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

/**
 * Fire-and-forget delivery to every device belonging to these users.
 * Endpoints the browser has retired (404/410) are pruned as we go, otherwise
 * the subscription table fills up with dead rows over time.
 */
export async function sendPushToUsers(userIds: string[], payload: PushPayload) {
  if (!configured || userIds.length === 0) return { sent: 0, pruned: 0 };

  const subs = await prisma.pushSubscription.findMany({
    where: { userId: { in: userIds } },
  });
  if (subs.length === 0) return { sent: 0, pruned: 0 };

  const body = JSON.stringify(payload);
  let sent = 0;
  const dead: string[] = [];

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        );
        sent++;
      } catch (error: any) {
        const status = error?.statusCode;
        if (status === 404 || status === 410) dead.push(sub.id);
        else console.error("Push send failed:", status, error?.body ?? error?.message);
      }
    }),
  );

  if (dead.length) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: dead } } });
  }

  return { sent, pruned: dead.length };
}

/**
 * Everyone who belongs to a space: the students at that branch and level.
 * Staff are not included — a lecturer teaching six levels should not get a
 * phone buzz for every message in all of them.
 */
export async function spaceMemberIds(spaceId: string, exclude?: string) {
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { branchId: true, level: true },
  });
  if (!space) return [];

  const students = await prisma.student.findMany({
    where: { branchId: space.branchId, level: space.level },
    select: { userId: true },
  });

  return students.map((s) => s.userId).filter((id) => id && id !== exclude) as string[];
}

/**
 * Everyone already involved in a thread — its author plus anyone who replied.
 * Replies notify this narrower set rather than the whole space, so a busy
 * thread does not spam people who never opened it.
 */
export async function threadParticipantIds(threadId: string, exclude?: string) {
  const thread = await prisma.thread.findUnique({
    where: { id: threadId },
    select: { authorId: true, comments: { select: { authorId: true } } },
  });
  if (!thread) return [];

  const ids = new Set<string>([thread.authorId, ...thread.comments.map((c) => c.authorId)]);
  if (exclude) ids.delete(exclude);
  return [...ids];
}
