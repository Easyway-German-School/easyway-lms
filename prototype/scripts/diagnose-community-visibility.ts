/**
 * One-off diagnostic: why didn't a picture posted in a student's General room
 * show up for classmates or the tutor? Read-only — makes no writes.
 *
 * npx tsx --tsconfig tsconfig.json --env-file=.env.local scripts/diagnose-community-visibility.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Recent messages with an attachment (last 3 days) ===");
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const recent = await prisma.message.findMany({
    where: { attachmentUrl: { not: null }, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: {
      author: { select: { id: true, name: true, email: true, role: true } },
      channel: {
        select: {
          slug: true,
          space: { select: { id: true, branchId: true, level: true, sessionSlot: true, name: true } },
        },
      },
    },
  });

  if (recent.length === 0) {
    console.log("No messages with an attachment found in the last 3 days.");
  }
  for (const m of recent) {
    console.log(
      `- ${m.createdAt.toISOString()} | author=${m.author.email ?? m.author.name} (${m.author.role}) | channel=${m.channel.slug} | space=${m.channel.space.name} [${m.channel.space.branchId}/${m.channel.space.level}/${m.channel.space.sessionSlot}] | url=${m.attachmentUrl}`,
    );
  }

  console.log("\n=== Online-branch A2 students: branchId/level/sessionSlot ===");
  const onlineA2 = await prisma.student.findMany({
    where: { level: "A2", branch: { mode: "online" } },
    select: {
      userId: true,
      user: { select: { email: true, name: true } },
      branchId: true,
      level: true,
      sessionSlot: true,
      branch: { select: { name: true, mode: true } },
    },
  });
  for (const s of onlineA2) {
    console.log(
      `- ${s.user.email ?? s.user.name} | branch=${s.branch?.name} (${s.branchId}) | level=${s.level} | sessionSlot=${s.sessionSlot ?? "NULL"}`,
    );
  }

  console.log("\n=== Spaces for Online branch, level A2 (all session slots) ===");
  const spaces = await prisma.space.findMany({
    where: { level: "A2", branch: { mode: "online" } },
    select: { id: true, name: true, branchId: true, level: true, sessionSlot: true, _count: { select: { channels: true } } },
  });
  for (const sp of spaces) {
    console.log(`- ${sp.name} [${sp.branchId}/${sp.level}/${sp.sessionSlot}] channels=${sp._count.channels}`);
  }

  console.log("\n=== All lecturers (legacy + full assignment) ===");
  const lecturers = await prisma.lecturer.findMany({
    select: {
      id: true,
      user: { select: { email: true, name: true, role: true } },
      branchId: true,
      level: true,
      sessionSlot: true,
      branchIds: true,
      levels: true,
      sessionSlots: true,
      classTypes: true,
      batches: true,
    },
  });
  for (const l of lecturers) {
    const levels = JSON.stringify(l.levels ?? null);
    if (!(levels.includes("A2") || levels.includes("B1") || (l.level === "A2" || l.level === "B1"))) continue;
    console.log(
      `- ${l.user.email ?? l.user.name} | legacy=${l.branchId}/${l.level}/${l.sessionSlot} | branchIds=${JSON.stringify(l.branchIds)} | levels=${JSON.stringify(l.levels)} | sessionSlots=${JSON.stringify(l.sessionSlots)} | classTypes=${JSON.stringify(l.classTypes)}`,
    );
  }
}

main()
  .catch((e) => {
    console.error("Fatal error:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
