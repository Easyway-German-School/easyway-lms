/**
 * Creates one community Space per (branch, level) pair, each with a standard
 * set of channels, plus a few starter threads in spaces that have students.
 *
 * SAFETY: additive and idempotent — uses upserts keyed on natural unique
 * constraints, so re-running changes nothing and never deletes.
 *
 *   node scripts/seed-community-spaces.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

/**
 * Deliberately only three. Empty rooms are what kill a young community — a
 * student who opens the hub and sees six dead channels does not come back.
 * Add more (speaking practice, exam prep, visa & life) once these get noisy;
 * scripts/prune-community-channels.mjs is the tool that trimmed the original
 * six down to this set.
 */
const CHANNELS = [
  ["announcements", "Announcements", "Class news from your tutors and the branch office.", "announcement", 0],
  ["general", "General", "Say hallo, share wins, ask anything.", "topic", 1],
  ["grammar", "Homework & help", "Stuck on an exercise, a case or a verb? Post it here.", "topic", 2],
];

const STARTERS = {
  general: [
    ["Willkommen! Introduce yourself here 👋",
     "New to this group? Tell us your name, why you're learning German, and what you're aiming for. We'll keep this thread going all term."],
    ["What actually shows up in the speaking exam?",
     "For anyone who has already sat the exam at this level — what surprised you on the day? Trying to prepare properly rather than just guessing."],
  ],
  grammar: [
    ["Why is it 'mit dem Bus' and not 'mit den Bus'?",
     "I know 'mit' takes Dativ but I keep slipping in conversation. Does anyone have a trick that made it automatic for them?"],
  ],
};

async function main() {
  const branches = await prisma.branch.findMany({ orderBy: { name: "asc" } });
  if (!branches.length) {
    console.log("No branches found — nothing to seed.");
    return;
  }

  let spaces = 0, channels = 0, threads = 0;

  for (const branch of branches) {
    for (const level of LEVELS) {
      const space = await prisma.space.upsert({
        where: { branchId_level: { branchId: branch.id, level } },
        update: {},
        create: {
          branchId: branch.id,
          level,
          name: `${branch.name} · ${level}`,
          description: `Community for ${level} learners at the ${branch.name} branch.`,
        },
      });
      spaces++;

      for (const [slug, name, description, kind, position] of CHANNELS) {
        await prisma.channel.upsert({
          where: { spaceId_slug: { spaceId: space.id, slug } },
          update: {},
          create: { spaceId: space.id, slug, name, description, kind, position },
        });
        channels++;
      }
    }
  }

  // Starter threads only where real students live, so active rooms feel alive
  // and empty ones stay honestly empty.
  const students = await prisma.student.findMany({
    where: { branchId: { not: null } },
    select: { branchId: true, level: true, user: { select: { id: true } } },
  });

  const seen = new Set();
  for (const student of students) {
    const key = `${student.branchId}:${student.level}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const space = await prisma.space.findUnique({
      where: { branchId_level: { branchId: student.branchId, level: student.level } },
      include: { channels: true },
    });
    if (!space) continue;

    for (const channel of space.channels) {
      const starters = STARTERS[channel.slug];
      if (!starters) continue;

      for (const [title, body] of starters) {
        const exists = await prisma.thread.findFirst({ where: { channelId: channel.id, title } });
        if (exists) continue;
        await prisma.thread.create({
          data: {
            channelId: channel.id,
            authorId: student.user.id,
            title,
            body,
            pinned: channel.slug === "general",
            lastActivityAt: new Date(),
          },
        });
        threads++;
      }
    }
  }

  console.log(`Spaces upserted    : ${spaces}`);
  console.log(`Channels upserted  : ${channels}`);
  console.log(`Starter threads    : ${threads}`);
  console.log(`Populated rooms    : ${seen.size} (branch × level combinations with students)`);
}

main()
  .catch((e) => { console.error("Seed failed:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
