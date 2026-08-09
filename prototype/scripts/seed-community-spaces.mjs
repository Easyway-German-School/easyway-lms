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

/**
 * [title, body, [replies]] — the replies matter as much as the threads. A room
 * of unanswered questions reads as abandoned, and a student deciding whether
 * to post their own bad German is watching for whether anyone answers.
 *
 * The grammar and visa material here was carried over from the retired
 * course-based Discussion seed so the writing wasn't lost with the model.
 */
const STARTERS = {
  general: [
    ["Willkommen! Introduce yourself here 👋",
     "New to this group? Tell us your name, why you're learning German, and what you're aiming for. We'll keep this thread going all term.",
     ["Hallo! I'm learning for an Ausbildung place in Cologne next year. Currently losing a fight with separable verbs.",
      "Hi everyone — my goal is the B1 exam by December so I can start my visa process."]],
    ["Tips for the B1 speaking section?",
     "My written German is fine but I freeze in the speaking exam. How did you prepare?",
     ["Record yourself answering a prompt for two minutes, then listen back. Painful but it works.",
      "Practise the connectors — 'einerseits… andererseits', 'meiner Meinung nach'. Examiners listen for structure.",
      "Book a conversation partner from the community. Twenty minutes twice a week made the difference for me."]],
    ["Which documents do I need for the visa appointment?",
     "Has anyone recently been through the student visa process? What did you actually need on the day?",
     ["Bring the blocked account confirmation, your admission letter, insurance proof and passport photos.",
      "Take two printed copies of everything. They kept originals of some documents at my appointment."]],
  ],
  grammar: [
    ["Why is it 'mit dem Bus' and not 'mit den Bus'?",
     "I know 'mit' takes Dativ but I keep slipping in conversation. Does anyone have a trick that made it automatic for them?",
     ["Chant the Dativ prepositions until they're muscle memory: aus, bei, mit, nach, seit, von, zu.",
      "I stopped translating from English mid-sentence. That's usually where the case slips."]],
    ["Wann benutzt man 'der', 'die' oder 'das'?",
     "I keep mixing up noun genders. Is there a reliable rule, or is memorisation the only way?",
     ["There are patterns worth learning: -ung, -heit, -keit, -schaft and -tion are almost always feminine.",
      "Learn every noun together with its article from day one — say 'die Tür', never just 'Tür'.",
      "Colour-coding my vocabulary notes by gender helped me more than any rule list."]],
    ["Akkusativ vs Dativ — how do you keep them straight?",
     "I understand the theory but freeze when speaking. Any practical trick?",
     ["Ask 'wen oder was?' for Akkusativ and 'wem?' for Dativ. Drilling that question fixed it for me.",
      "Dativ is usually the receiver. Once I thought of it that way it mostly clicked."]],
  ],
};

async function main() {
  const branches = await prisma.branch.findMany({ orderBy: { name: "asc" } });
  if (!branches.length) {
    console.log("No branches found — nothing to seed.");
    return;
  }

  let spaces = 0, channels = 0, threads = 0, comments = 0;

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

  // Replies need to come from someone other than the person who asked, so
  // gather everyone who could plausibly answer in a given space.
  const lecturers = await prisma.user.findMany({
    where: { role: "LECTURER" },
    select: { id: true },
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

    const classmates = students
      .filter((s) => s.branchId === student.branchId && s.level === student.level)
      .map((s) => s.user.id);
    const responders = [...new Set([...classmates, ...lecturers.map((l) => l.id)])]
      .filter((id) => id !== student.user.id);

    for (const channel of space.channels) {
      const starters = STARTERS[channel.slug];
      if (!starters) continue;

      for (const [title, body, replies = []] of starters) {
        const exists = await prisma.thread.findFirst({ where: { channelId: channel.id, title } });
        if (exists) continue;

        const thread = await prisma.thread.create({
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

        // Nothing to answer with in a one-person space — leave it unanswered
        // rather than have the asker reply to themselves.
        if (!responders.length) continue;

        for (let i = 0; i < replies.length; i++) {
          await prisma.comment.create({
            data: {
              threadId: thread.id,
              authorId: responders[i % responders.length],
              body: replies[i],
            },
          });
          comments++;
        }
      }
    }
  }

  console.log(`Spaces upserted    : ${spaces}`);
  console.log(`Channels upserted  : ${channels}`);
  console.log(`Starter threads    : ${threads}`);
  console.log(`Starter replies    : ${comments}`);
  console.log(`Populated rooms    : ${seen.size} (branch × level combinations with students)`);
}

main()
  .catch((e) => { console.error("Seed failed:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
