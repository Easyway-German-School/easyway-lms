/**
 * Proves the retention safety rules on real rows before anyone trusts them
 * with a term's teaching.
 *
 * Creates throwaway recordings, asks what retention *would* do, and deletes
 * them again. Never calls applyRetention, so it cannot itself delete anything
 * real — the whole point is to check the reasoning, not to exercise the bomb.
 */
import { PrismaClient } from "@prisma/client";
import { planRetention, RETENTION } from "../src/lib/retention";

const prisma = new PrismaClient();
const TAG = "__retention_test__";

async function makeRecording(opts: { ageDays: number; keepForever?: boolean }) {
  const recordedAt = new Date(Date.now() - opts.ageDays * 86_400_000);
  const material = await prisma.material.create({
    data: {
      title: `${TAG} ${opts.ageDays}d${opts.keepForever ? " keep" : ""}`,
      filePath: "https://example.test/x.mp4",
      fileName: "x.mp4",
      fileType: "video/mp4",
      fileSize: 1_048_576,
      kind: "recording",
      level: "A1",
      recordedAt,
    },
  });
  const recording = await prisma.classRecording.create({
    data: {
      egressId: `${TAG}-${opts.ageDays}-${Math.random().toString(36).slice(2, 8)}`,
      roomName: `${TAG}-room`,
      level: "A1",
      status: "completed",
      startedAt: recordedAt,
      objectKey: "recordings/test/x.mp4",
      sizeBytes: 1_048_576,
      materialId: material.id,
      keepForever: opts.keepForever ?? false,
    },
  });
  return { material, recording };
}

async function verdictFor(materialId: string) {
  const plan = await planRetention();
  return plan.verdicts.find((v) => v.materialId === materialId);
}

function check(label: string, actual: string | undefined, expected: string) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  → ${actual ?? "(no verdict)"}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  console.log(`policy: protect ${RETENTION.protectedDays}d, idle window ${RETENTION.idleWindowDays}d\n`);

  const fresh = await makeRecording({ ageDays: 10 });
  const old = await makeRecording({ ageDays: 200 });
  const kept = await makeRecording({ ageDays: 200, keepForever: true });
  const watched = await makeRecording({ ageDays: 200 });

  // A student halfway through the old-but-being-watched one.
  const student = await prisma.student.findFirst({ select: { id: true } });
  if (student) {
    await prisma.videoProgress.create({
      data: {
        studentId: student.id,
        materialId: watched.material.id,
        positionSeconds: 400,
        completed: false,
      },
    });
  }

  check("recent class is protected", (await verdictFor(fresh.material.id))?.decision, "keep");
  check("old unwatched class is reclaimed", (await verdictFor(old.material.id))?.decision, "reclaim");
  check("keep-forever overrides age", (await verdictFor(kept.material.id))?.decision, "keep");
  if (student) {
    check("student part-way through is protected", (await verdictFor(watched.material.id))?.decision, "keep");
  } else {
    console.log("SKIP  student part-way through — no students in this database");
  }

  const reasons = await planRetention();
  console.log("\nreasons given:");
  for (const verdict of reasons.verdicts.filter((v) => v.title.startsWith(TAG))) {
    console.log(`  ${verdict.decision.padEnd(7)} ${verdict.title} — ${verdict.reason}`);
  }
}

main()
  .catch((error) => {
    console.error("FAILED:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Clean up whatever we made, even if an assertion threw.
    const mine = await prisma.classRecording.findMany({
      where: { roomName: `${TAG}-room` },
      select: { id: true, materialId: true },
    });
    await prisma.classRecording.deleteMany({ where: { roomName: `${TAG}-room` } });
    await prisma.material.deleteMany({
      where: { id: { in: mine.map((r) => r.materialId).filter((id): id is string => Boolean(id)) } },
    });
    console.log(`\ncleaned up ${mine.length} test recording(s)`);
    await prisma.$disconnect();
  });
