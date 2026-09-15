/**
 * Stamps `admission.onboardedVia` on students who predate the marker.
 *
 * The importer and the manual-add form now write this at creation; this fills
 * it in for everyone who was already on the roster. It is what switches on
 * Becca's "finish your profile" prompt for the students the office onboarded
 * off-form — see src/lib/profile-backfill.ts.
 *
 * HOW EACH STUDENT IS CLASSIFIED
 *   import      — admission.importedAt is set (the importer has always written it)
 *   signup      — has a TermsAcceptance with context "signup" (the public form's
 *                 unskippable last step)
 *   manual-add  — everything else: on the roster, never went through the form
 *
 * SAFETY: only ever fills a MISSING onboardedVia. Safe to re-run. Dry run by
 * default — pass --commit to write.
 *
 *   node scripts/backfill-onboarded-via.mjs            # preview
 *   node scripts/backfill-onboarded-via.mjs --commit   # apply
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const COMMIT = process.argv.includes("--commit");

async function main() {
  const students = await prisma.student.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      admission: true,
      user: { select: { name: true, email: true } },
      termsAcceptances: { select: { context: true } },
    },
  });

  const counts = { import: 0, signup: 0, "manual-add": 0, skipped: 0 };
  const plan = [];

  for (const s of students) {
    const admission =
      s.admission && typeof s.admission === "object" ? { ...s.admission } : {};

    if (typeof admission.onboardedVia === "string" && admission.onboardedVia.trim()) {
      counts.skipped++;
      continue;
    }

    let via;
    if (admission.importedAt) {
      via = "import";
    } else if ((s.termsAcceptances ?? []).some((t) => t.context === "signup")) {
      via = "signup";
    } else {
      via = "manual-add";
    }

    counts[via]++;
    plan.push({ id: s.id, via, who: s.user?.name || s.user?.email || s.id, admission });
  }

  console.log(
    `Scanned ${students.length} students.\n` +
      `  already marked : ${counts.skipped}\n` +
      `  → import       : ${counts.import}\n` +
      `  → signup       : ${counts.signup}\n` +
      `  → manual-add   : ${counts["manual-add"]}  (these get Becca's profile prompt)\n`,
  );

  if (!plan.length) {
    console.log("Nothing to write.");
    return;
  }

  if (!COMMIT) {
    console.log("Dry run. Re-run with --commit to apply. Sample:");
    for (const row of plan.slice(0, 15)) console.log(`  ${row.via.padEnd(11)} ${row.who}`);
    if (plan.length > 15) console.log(`  …and ${plan.length - 15} more`);
    return;
  }

  let written = 0;
  for (const row of plan) {
    await prisma.student.update({
      where: { id: row.id },
      data: { admission: { ...row.admission, onboardedVia: row.via } },
    });
    written++;
    if (written % 25 === 0) console.log(`  …${written}/${plan.length}`);
  }
  console.log(`Done — stamped ${written} students.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
