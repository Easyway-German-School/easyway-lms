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
 */
function replacer(_key, value) {
  if (typeof value === "bigint") return { __bigint: value.toString() };
  if (value instanceof Date) return { __date: value.toISOString() };
  if (Buffer.isBuffer(value)) return { __bytes: value.toString("base64") };
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
await prisma.$disconnect();

console.log(`\n${tables.length - failures}/${tables.length} tables, ${manifest.totalRows} rows`);
console.log(outDir);

/**
 * A partial snapshot is worse than an obvious failure, because it looks like a
 * backup. Exit non-zero so a caller that chains on success stops here.
 */
if (failures > 0) process.exit(1);
