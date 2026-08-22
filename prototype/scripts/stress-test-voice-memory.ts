import { prisma } from "@/lib/prisma";
import { runUnscoped } from "@/lib/tenant/context";

type VoiceAttempt = {
  targetPhrase?: unknown;
  score?: unknown;
  wordAccuracy?: unknown;
  missingWords?: unknown;
  extraWords?: unknown;
  nextPractice?: unknown;
  acousticFeatures?: unknown;
};

async function main() {
return runUnscoped("read-only audit of voice memory across every tenant", async () => {
const students = await prisma.student.findMany({
  select: { id: true, user: { select: { email: true } }, personalizedPlan: { select: { plan: true } } },
});

let memories = 0;
let attempts = 0;
let invalid = 0;
let withAcoustics = 0;
let targetContinuityFailures = 0;
const failures: string[] = [];

for (const student of students) {
  let plan: { voiceCoach?: { targetPhrase?: unknown; memory?: unknown } } = {};
  try { plan = student.personalizedPlan?.plan ? JSON.parse(student.personalizedPlan.plan) : {}; } catch { failures.push(`${student.user.email}: invalid plan JSON`); continue; }
  const coach = plan.voiceCoach;
  const history = Array.isArray(coach?.memory) ? coach.memory as VoiceAttempt[] : [];
  if (!history.length) continue;
  memories += 1;
  attempts += history.length;
  for (const [index, attempt] of history.entries()) {
    const valid = typeof attempt.targetPhrase === "string" && typeof attempt.score === "number" && typeof attempt.wordAccuracy === "number" && Array.isArray(attempt.missingWords) && Array.isArray(attempt.extraWords) && typeof attempt.nextPractice === "string";
    if (!valid) { invalid += 1; failures.push(`${student.user.email}: attempt ${index + 1} has an incomplete memory record`); }
    if (attempt.acousticFeatures && typeof attempt.acousticFeatures === "object") withAcoustics += 1;
  }
  const last = history[history.length - 1];
  if (typeof coach?.targetPhrase !== "string" || coach.targetPhrase !== last.targetPhrase && coach.targetPhrase !== last.nextPractice) {
    targetContinuityFailures += 1;
    failures.push(`${student.user.email}: saved target does not continue from the latest recommendation`);
  }
}

console.log(JSON.stringify({
  studentCount: students.length,
  studentsWithVoiceMemory: memories,
  totalAttempts: attempts,
  invalidAttempts: invalid,
  attemptsWithAcousticEvidence: withAcoustics,
  targetContinuityFailures,
  pass: invalid === 0 && targetContinuityFailures === 0,
  failures: failures.slice(0, 25),
}, null, 2));

await prisma.$disconnect();
});
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
