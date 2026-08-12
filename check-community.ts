import { prisma } from "@/lib/prisma";

async function main() {
  console.log("Checking community spaces...");
  
  const spaces = await prisma.space.findMany({
    include: {
      branch: { select: { id: true, name: true } },
      channels: { select: { id: true, name: true, slug: true } }
    }
  });
  
  console.log(`Found ${spaces.length} spaces:`);
  for (const space of spaces) {
    console.log(`  - ${space.name} (${space.branch.name}, Level: ${space.level})`);
    console.log(`    Channels: ${space.channels.length}`);
    for (const channel of space.channels) {
      console.log(`      - ${channel.name} (${channel.slug})`);
    }
  }
  
  if (spaces.length === 0) {
    console.log("\n⚠️  NO SPACES FOUND! Checking branches...");
    const branches = await prisma.branch.findMany();
    console.log(`Found ${branches.length} branches:`);
    for (const branch of branches) {
      console.log(`  - ${branch.name} (${branch.id})`);
    }
  }
  
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
