/**
 * Read-only. Asks the feature's OWN rosterFor who would be offered turns in
 * each cohort, so the answer is exactly who createMatch would ping - not an
 * approximation of it.
 */
import { prisma } from "@/lib/prisma";
import { runUnscoped } from "@/lib/tenant/context";
import { rosterFor } from "@/lib/satzkette-server";

const isFixture = (email: string | null) =>
  /@(easyway\.test|ew\.test|example\.com|test\.com)$/i.test(email ?? "");

async function main() {
  const spaces = await prisma.space.findMany({
    select: { id: true, name: true },
  });

  const safe: Array<{ id: string; name: string; members: number }> = [];

  for (const space of spaces) {
    const roster = await rosterFor(null, space.id);
    if (roster.length === 0) {
      console.log(`EMPTY  ${space.name}`);
      continue;
    }

    const users = await prisma.user.findMany({
      where: { id: { in: roster.map((r) => r.userId) } },
      select: { email: true },
    });
    const real = users.filter((u) => !isFixture(u.email));

    if (real.length === 0) {
      console.log(`SAFE   ${space.name.padEnd(28)} roster=${roster.length} (all fixtures)`);
      safe.push({ id: space.id, name: space.name, members: roster.length });
    } else {
      console.log(`REAL   ${space.name.padEnd(28)} roster=${roster.length} real=${real.length}`);
    }
  }

  console.log("\nSafe cohorts:", safe.length);
  for (const s of safe) console.log(`  ${s.id}  ${s.name}  (${s.members})`);
}

runUnscoped("audit: which cohorts are safe to demo in, across all tenants", main)
  .catch((err) => {
    console.error("FAILED:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
