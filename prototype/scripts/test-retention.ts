/**
 * Proves the retention rules on real rows before anyone trusts them.
 *
 * Creates throwaway recordings, asks what retention *would* do, and deletes
 * them again. Never calls applyRetention with a real cutoff, so it cannot
 * itself delete anything real — the point is to check the reasoning.
 *
 * The policy under test (see src/lib/retention.ts):
 *   - Staff keep every recording forever. `planRetention()` with no cutoff
 *     recommends `keep` for everything, whatever its age.
 *   - `planRetention({ olderThanDays })` models a MANUAL admin purge and only
 *     then recommends `reclaim` — never for a keep-forever recording.
 *   - `studentExpiresAt` in the past means the video is off the student's
 *     shelf (`expiredForStudents`), but that is a read filter, not a delete.
 */
import { PrismaClient } from "@prisma/client";
import { planRetention, RETENTION, studentExpiryFrom, isExpiredForStudents } from "../src/lib/retention";

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
      studentExpiresAt: studentExpiryFrom(recordedAt),
      objectKey: "recordings/test/x.mp4",
      sizeBytes: 1_048_576,
      materialId: material.id,
      keepForever: opts.keepForever ?? false,
    },
  });
  return { material, recording };
}

async function verdictFor(materialId: string, opts?: { olderThanDays?: number }) {
  const plan = await planRetention(opts);
  return plan.verdicts.find((v) => v.materialId === materialId);
}

function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  → ${String(actual ?? "(none)")}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  console.log(`policy: student shelf ${RETENTION.studentWindowDays}d, then kept for staff forever\n`);

  const fresh = await makeRecording({ ageDays: 5 });
  const old = await makeRecording({ ageDays: 200 });
  const kept = await makeRecording({ ageDays: 200, keepForever: true });

  // Default plan: nothing is ever reclaimed, whatever the age.
  check("recent class kept for staff", (await verdictFor(fresh.material.id))?.decision, "keep");
  check("200-day class still kept for staff", (await verdictFor(old.material.id))?.decision, "keep");
  check("keep-forever kept", (await verdictFor(kept.material.id))?.decision, "keep");

  // Student-window read filter.
  check("recent class still on student shelf", (await verdictFor(fresh.material.id))?.expiredForStudents, false);
  check("old class off student shelf", (await verdictFor(old.material.id))?.expiredForStudents, true);
  check("keep-forever stays on student shelf", (await verdictFor(kept.material.id))?.expiredForStudents, false);
  check(
    "isExpiredForStudents helper agrees",
    isExpiredForStudents({ studentExpiresAt: studentExpiryFrom(new Date(Date.now() - 200 * 86_400_000)) }),
    true,
  );

  // Manual purge model: old non-keep recordings become reclaimable, keep-forever never.
  check("manual purge >90d reclaims old", (await verdictFor(old.material.id, { olderThanDays: 90 }))?.decision, "reclaim");
  check(
    "manual purge >90d spares keep-forever",
    (await verdictFor(kept.material.id, { olderThanDays: 90 }))?.decision,
    "keep",
  );
  check(
    "manual purge >90d spares recent",
    (await verdictFor(fresh.material.id, { olderThanDays: 90 }))?.decision,
    "keep",
  );

  const reasons = await planRetention({ olderThanDays: 90 });
  console.log("\nreasons given (with a 90-day manual cutoff):");
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
