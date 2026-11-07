import { notify, KIND } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

const SEND_AFTER = new Date("2026-11-08T00:00:00+01:00");
const DEDUPE_KEY = "hybrid-session-policy:2026-11-08";
const CHUNK_SIZE = 200;

/**
 * Notify students already enrolled as hybrid when the same-session rule takes
 * effect. This is informational only: it never changes their schedule.
 */
export async function sendHybridSessionPolicyNotice(now = new Date()) {
  if (now < SEND_AFTER) return { sent: 0, pending: true };

  const students = await prisma.student.findMany({
    where: {
      deliveryMode: "hybrid",
      deletedAt: null,
      createdAt: { lt: SEND_AFTER },
    },
    select: { id: true },
  });

  let sent = 0;
  for (let offset = 0; offset < students.length; offset += CHUNK_SIZE) {
    const result = await notify({
      to: { studentIds: students.slice(offset, offset + CHUNK_SIZE).map((student) => student.id) },
      kind: KIND.hybridSessionPolicy,
      severity: "info",
      title: "A quick note about hybrid class times",
      message:
        "Hi, it’s Becca. Hybrid is one class shared online and on campus: morning pairs with morning, and evening with evening. Your current timetable stays as it is for now—please keep attending as scheduled. The same-session rule applies to new registrations and future level placements.",
      dedupeKey: DEDUPE_KEY,
      push: false,
      email: false,
      sms: false,
    });
    sent += result.created;
  }

  return { sent, eligible: students.length, pending: false };
}
