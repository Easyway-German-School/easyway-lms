/**
 * A local, off-provider copy of every row in the database.
 *
 * This exists because the GitHub Actions backup job has never recorded a
 * successful run — `BackupRun` is empty — so at the time of writing the only
 * copy of this school's students, payments and grades is the one Neon holds.
 * Before anything alters the schema, there has to be a second copy somewhere
 * that is not Neon.
 *
 * It is deliberately not pg_dump. pg_dump is the better tool and the CI job
 * should keep using it, but it is not installed on the machine this is run
 * from, and "we could not take a backup because a binary was missing" is not
 * an acceptable reason to skip one.
 *
 * Output is one JSON file per table plus a manifest of row counts, written to
 * a timestamped folder. Restoring is a deliberate, manual act — there is no
 * restore script here on purpose, because a one-command restore against a live
 * database is a foot-gun that eventually goes off.
 *
 *   node scripts/snapshot-db.mjs [outputDir]
 */

import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const prisma = new PrismaClient();

/**
 * BigInt and Date do not survive JSON.stringify — BigInt throws, Date becomes
 * an ISO string that reads back as a string. Both are tagged so a future
 * restore can tell a real string from a serialised value.
 *
 * READS `this[key]`, NOT `value`.
 *
 * JSON.stringify calls `toJSON()` before it calls the replacer, so by the time
 * a Date reaches `value` it is already a plain ISO string and `value instanceof
 * Date` is never true. The first version of this file made exactly that
 * mistake: every timestamp in the backup was written untagged, and a restore
 * would have put strings where the schema wants dates — silently, because a
 * string that looks like a date reads fine in a listing and only fails when
 * something does arithmetic with it. `this` is the object being serialised and
 * still holds the original value, which is why the replacer must not be an
 * arrow function.
 *
 * Buffer has the same problem for the same reason, hence the same treatment.
 */
function replacer(key, value) {
  const raw = this?.[key];
  if (typeof raw === "bigint") return { __bigint: raw.toString() };
  if (raw instanceof Date) return { __date: raw.toISOString() };
  if (Buffer.isBuffer(raw)) return { __bytes: raw.toString("base64") };
  // BigInt never reaches `value` intact either — it throws before the replacer
  // returns — so it is caught above; this covers anything nested oddly.
  if (typeof value === "bigint") return { __bigint: value.toString() };
  return value;
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = resolve(process.argv[2] ?? join("backups", `snapshot-${stamp}`));

const tables = await prisma.$queryRawUnsafe(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    AND table_name NOT LIKE '\\_prisma%'
  ORDER BY table_name
`);

mkdirSync(outDir, { recursive: true });

const manifest = { takenAt: new Date().toISOString(), tables: {}, totalRows: 0 };
let failures = 0;

for (const { table_name: table } of tables) {
  try {
    const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "${table}"`);
    writeFileSync(join(outDir, `${table}.json`), JSON.stringify(rows, replacer, 0));
    manifest.tables[table] = rows.length;
    manifest.totalRows += rows.length;
    console.log(`  ${table.padEnd(28)} ${rows.length}`);
  } catch (error) {
    failures += 1;
    manifest.tables[table] = `ERROR: ${error.message.split("\n")[0]}`;
    console.error(`  ${table.padEnd(28)} FAILED — ${error.message.split("\n")[0]}`);
  }
}

writeFileSync(join(outDir, "_manifest.json"), JSON.stringify(manifest, null, 2));

console.log(`\n${tables.length - failures}/${tables.length} tables, ${manifest.totalRows} rows`);
console.log(outDir);

/**
 * Check in, exactly as the GitHub job does.
 *
 * Without this the app has no way to know a backup happened, and the staleness
 * alarm in /admin/security keeps reporting that none ever has. An alarm that is
 * permanently red is an alarm people learn to ignore, and the morning it is
 * telling the truth is the morning nobody looks.
 *
 * Recorded even on partial failure, as a failure — a run that half-worked must
 * not read as silence.
 */
try {
  await prisma.backupRun.create({
    data: {
      kind: "database",
      status: failures > 0 ? "failed" : "success",
      snapshotId: outDir,
      sizeBytes: BigInt(manifest.totalRows),
      detail: { tables: tables.length, rows: manifest.totalRows, local: true },
      error: failures > 0 ? `${failures} table(s) could not be read` : null,
      startedAt: new Date(manifest.takenAt),
      finishedAt: new Date(),
    },
  });
  console.log("recorded in BackupRun");
} catch (error) {
  console.warn("Could not record the run:", error.message.split("\n")[0]);
}

await prisma.$disconnect();

/**
 * Said plainly rather than buried in a README, because a local copy is not the
 * backup this school needs and the gap should stay uncomfortable.
 */
console.log(
  "\nNOTE: this copy is on this machine only. It survives a Neon incident and " +
    "does not survive this laptop. The off-site job is .github/workflows/backup-database.yml.",
);

/**
 * A partial snapshot is worse than an obvious failure, because it looks like a
 * backup. Exit non-zero so a caller that chains on success stops here.
 */
if (failures > 0) process.exit(1);
