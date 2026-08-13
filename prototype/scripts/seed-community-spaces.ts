import { prisma } from "@/lib/prisma";

/**
 * Seed community spaces and channels for each branch + level combination.
 * 
 * This ensures every student can access their community from day one.
 * Run this after branches and students exist: npm run seed:spaces
 */

async function main() {
  console.log("🌱 Seeding community spaces and channels...\n");

  // Get all branches that have students
  const branches = await prisma.branch.findMany({
    select: { id: true, name: true }
  });

  if (branches.length === 0) {
    console.log("⚠️  No branches found. Create branches first.");
    return;
  }

  // Get all unique levels from existing students
  const studentLevels = await prisma.student.findMany({
    where: { level: { not: null } },
    distinct: ["level"],
    select: { level: true }
  });

  const levels = studentLevels
    .map(s => s.level)
    .filter(Boolean) as string[];

  if (levels.length === 0) {
    console.log("⚠️  No student levels found. Enroll students first.");
    return;
  }

  // Get all unique session slots from existing students
  const studentSessions = await prisma.student.findMany({
    where: { sessionSlot: { not: null } },
    distinct: ["sessionSlot"],
    select: { sessionSlot: true }
  });

  const sessionSlots = studentSessions
    .map(s => s.sessionSlot)
    .filter(Boolean) as string[];

  if (sessionSlots.length === 0) {
    console.log("⚠️  No student session slots found. Enroll students first.");
    return;
  }

  console.log(`📍 Found ${branches.length} branches, ${levels.length} levels, and ${sessionSlots.length} sessions:\n`);
  for (const branch of branches) {
    console.log(`  📌 ${branch.name}`);
  }
  console.log(`\n  📚 Levels: ${levels.join(", ")}`);
  console.log(`  🕐 Sessions: ${sessionSlots.join(", ")}\n`);

  let spacesCreated = 0;
  let channelsCreated = 0;
  let skipped = 0;

  // Create or update spaces for each branch × level × session combination
  for (const branch of branches) {
    for (const level of levels) {
      for (const sessionSlot of sessionSlots) {
        try {
          const space = await prisma.space.upsert({
            where: { branchId_level_sessionSlot: { branchId: branch.id, level, sessionSlot } },
            update: {}, // If exists, leave it alone
            create: {
              branchId: branch.id,
              level,
              sessionSlot,
              name: `${branch.name} - Level ${level} (${sessionSlot})`,
              description: `Community space for ${branch.name} learners at level ${level}, ${sessionSlot} session. Discuss lessons, ask questions, and collaborate with peers.`
            }
          });

        // Create default channels for this space
        const defaultChannels = [
          {
            slug: "general",
            name: "General",
            description: "General discussion and announcements",
            kind: "topic" as const,
            position: 0
          },
          {
            slug: "grammar-help",
            name: "Grammar Help",
            description: "Ask and answer grammar questions",
            kind: "topic" as const,
            position: 1
          },
          {
            slug: "vocabulary",
            name: "Vocabulary",
            description: "Share and discuss new words and phrases",
            kind: "topic" as const,
            position: 2
          },
          {
            slug: "announcements",
            name: "Announcements",
            description: "Important updates from tutors and staff",
            kind: "topic" as const,
            position: 3
          },
          {
            slug: "assignments",
            name: "Assignment Support",
            description: "Help with assignments and homework",
            kind: "topic" as const,
            position: 4
          }
        ];

        for (const channelData of defaultChannels) {
          try {
            await prisma.channel.upsert({
              where: { spaceId_slug: { spaceId: space.id, slug: channelData.slug } },
              update: {}, // If exists, leave it alone
              create: {
                spaceId: space.id,
                ...channelData
              }
            });
            channelsCreated++;
          } catch (e) {
            // Channel already exists
            if ((e as any).code === "P2002") {
              skipped++;
            } else {
              throw e;
            }
          }
        }

        spacesCreated++;
        console.log(`✅ ${branch.name} - Level ${level} (${sessionSlot})`);
      } catch (e) {
        // Space already exists
        if ((e as any).code === "P2002") {
          skipped++;
          console.log(`⏭️  ${branch.name} - Level ${level} (${sessionSlot}) (already exists)`);
        } else {
          console.error(`❌ Error creating space for ${branch.name} - Level ${level}:`, e);
        }
      }
    }
  }

  console.log(`\n✨ Complete!`);
  console.log(`  ✅ Spaces: ${spacesCreated} created/updated`);
  console.log(`  ✅ Channels: ${channelsCreated} created`);
  if (skipped > 0) {
    console.log(`  ⏭️  ${skipped} already existed (skipped)`);
  }

  // Verify
  const totalSpaces = await prisma.space.count();
  const totalChannels = await prisma.channel.count();
  console.log(`\n📊 Database now has:`);
  console.log(`  📦 ${totalSpaces} spaces total`);
  console.log(`  📢 ${totalChannels} channels total`);
}

main()
  .then(() => {
    console.log("\n✨ Seeding complete! Students can now access the community.\n");
    process.exit(0);
  })
  .catch(e => {
    console.error("\n❌ Seeding failed:", e);
    process.exit(1);
  });
