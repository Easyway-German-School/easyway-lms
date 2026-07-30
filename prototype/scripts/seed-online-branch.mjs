/**
 * Creates the Online branch and stamps `mode` on every existing branch.
 *
 * Idempotent: safe to re-run after a schema push or a fresh clone. Run with
 *   node scripts/seed-online-branch.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ONLINE_BRANCH_NAME = "Online";

async function main() {
  // Everything that already exists is a campus. Done before the online branch
  // is created so a re-run cannot flip Online back to physical.
  const stamped = await prisma.branch.updateMany({
    where: { NOT: { name: { contains: "nline" } } },
    data: { mode: "physical" },
  });
  console.log(`Marked ${stamped.count} branch(es) as physical.`);

  const existing = await prisma.branch.findFirst({
    where: { name: { contains: "nline" } },
  });

  if (existing) {
    const updated = await prisma.branch.update({
      where: { id: existing.id },
      data: { mode: "online", status: "active" },
    });
    console.log(`Online branch already present — refreshed "${updated.name}" (${updated.id}).`);
    return;
  }

  const created = await prisma.branch.create({
    data: {
      name: ONLINE_BRANCH_NAME,
      // Not a city. The location string is shown to students on their profile
      // and in the admin, so it says what it is rather than sitting empty.
      location: "Live online — join from anywhere",
      status: "active",
      mode: "online",
    },
  });

  console.log(`Created the Online branch (${created.id}).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
