/**
 * Consolidates every space down to three channels.
 *
 * Six near-empty channels per space made the hub feel like a ghost town —
 * 108 channels held 12 threads between them. Communities grow by starting
 * narrow, so we keep Announcements / General / Homework & help and let extra
 * channels be earned once these get noisy.
 *
 * Content-safe: threads in a retired channel are MOVED to that space's
 * #general first, so deleting the channel never cascades away a post.
 *
 *   node scripts/prune-community-channels.mjs          (dry run — shows the plan)
 *   node scripts/prune-community-channels.mjs --apply  (makes the changes)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

// slug -> desired shape. Anything not listed here is retired.
const KEEP = new Map([
  ["announcements", { name: "Announcements", description: "Class news from your tutors and the branch office.", kind: "announcement", position: 0 }],
  ["general", { name: "General", description: "Say hallo, share wins, ask anything.", kind: "topic", position: 1 }],
  ["grammar", { name: "Homework & help", description: "Stuck on an exercise, a case or a verb? Post it here.", kind: "topic", position: 2 }],
]);

async function main() {
  const spaces = await prisma.space.findMany({
    include: { channels: { include: { _count: { select: { threads: true } } } } },
    orderBy: [{ level: "asc" }],
  });

  let created = 0, updated = 0, moved = 0, removed = 0, keptForContent = 0;

  for (const space of spaces) {
    // 1. Make sure every keeper exists and looks right.
    for (const [slug, shape] of KEEP) {
      const existing = space.channels.find((c) => c.slug === slug);
      if (!existing) {
        if (APPLY) await prisma.channel.create({ data: { spaceId: space.id, slug, ...shape } });
        created++;
      } else if (
        existing.name !== shape.name ||
        existing.description !== shape.description ||
        existing.kind !== shape.kind ||
        existing.position !== shape.position
      ) {
        if (APPLY) await prisma.channel.update({ where: { id: existing.id }, data: shape });
        updated++;
      }
    }

    // 2. Retire the rest, rehoming their threads into #general.
    const general = space.channels.find((c) => c.slug === "general");
    const retiring = space.channels.filter((c) => !KEEP.has(c.slug));

    for (const channel of retiring) {
      if (channel._count.threads > 0) {
        if (!general) {
          // No #general to rehome into — leave the channel alone rather than
          // risk cascading its threads away.
          keptForContent++;
          console.log(`  ! ${space.name} · #${channel.slug}: ${channel._count.threads} thread(s) but no #general — skipped`);
          continue;
        }
        if (APPLY) {
          await prisma.thread.updateMany({ where: { channelId: channel.id }, data: { channelId: general.id } });
        }
        moved += channel._count.threads;
      }
      if (APPLY) await prisma.channel.delete({ where: { id: channel.id } });
      removed++;
    }
  }

  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN — nothing written"}`);
  console.log(`Spaces scanned      : ${spaces.length}`);
  console.log(`Channels created    : ${created}`);
  console.log(`Channels updated    : ${updated}`);
  console.log(`Threads rehomed     : ${moved}`);
  console.log(`Channels retired    : ${removed}`);
  if (keptForContent) console.log(`Channels left alone : ${keptForContent} (had threads, no #general)`);
  if (!APPLY) console.log(`\nRe-run with --apply to make these changes.`);
}

main()
  .catch((e) => { console.error("Prune failed:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
