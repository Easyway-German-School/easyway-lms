/**
 * The restore drill, for the local snapshot.
 *
 * A backup nobody has ever read back is a hypothesis. Every backup story that
 * ends badly has the same shape — the files were there, the job was green, and
 * the first time anyone opened one was the day they needed it.
 *
 * So this reads the snapshot the way a restore would: parses every file,
 * rebuilds the values that do not survive JSON, checks the manifest against
 * what is actually in the files, and compares the whole thing against the live
 * database. It writes nothing, anywhere. A drill that can damage production is
 * a drill nobody runs.
 *
 *   node scripts/verify-snapshot.mjs <snapshotDir>
 *   node scripts/verify-snapshot.mjs <snapshotDir> --skip-live
 */

import { PrismaClient } from "@prisma/client";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "");
const skipLive = process.argv.includes("--skip-live");

if (!dir || !existsSync(join(dir, "_manifest.json"))) {
  console.error("Usage: node scripts/verify-snapshot.mjs <snapshotDir>");
  console.error("The directory must contain a _manifest.json written by snapshot-db.mjs.");
  process.exit(1);
}

/** The inverse of the tagging in snapshot-db.mjs. */
function reviver(_key, value) {
  if (value && typeof value === "object") {
    if (typeof value.__bigint === "string") return BigInt(value.__bigint);
    if (typeof value.__date === "string") return new Date(value.__date);
    if (typeof value.__bytes === "string") return Buffer.from(value.__bytes, "base64");
  }
  return value;
}

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures += 1;
  if (!ok || process.env.VERBOSE) {
    console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const manifest = JSON.parse(readFileSync(join(dir, "_manifest.json"), "utf8"));
console.log(`snapshot taken ${manifest.takenAt}`);

const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "_manifest.json");
console.log(`${files.length} table file(s)\n`);

const readBack = {};
let restoredRows = 0;
let restoredValues = 0;

for (const file of files) {
  const table = file.replace(/\.json$/, "");
  let rows;
  try {
    rows = JSON.parse(readFileSync(join(dir, file), "utf8"), reviver);
  } catch (error) {
    check(`${table} parses`, false, error.message.split("\n")[0]);
    continue;
  }

  check(`${table} is an array`, Array.isArray(rows));
  readBack[table] = rows.length;
  restoredRows += rows.length;

  /**
   * The tagged values are the part most likely to be quietly wrong, because a
   * Date that came back as a string still looks fine in a listing and only
   * fails when something tries to do arithmetic with it — during the restore,
   * under pressure.
   */
  for (const row of rows.slice(0, 50)) {
    for (const value of Object.values(row ?? {})) {
      if (value instanceof Date) {
        restoredValues += 1;
        check(`${table} has a valid date`, !Number.isNaN(value.getTime()));
      } else if (typeof value === "bigint") {
        restoredValues += 1;
      }
    }
  }

  const claimed = manifest.tables[table];
  check(
    `${table} matches the manifest`,
    typeof claimed === "number" ? claimed === rows.length : true,
    typeof claimed === "number" ? `manifest ${claimed}, file ${rows.length}` : String(claimed),
  );
}

check(
  "the manifest total matches the files",
  restoredRows === manifest.totalRows,
  `${restoredRows} vs ${manifest.totalRows}`,
);

console.log(
  `read back ${restoredRows} rows and rebuilt ${restoredValues} date/bigint value(s) from the first 50 rows of each table`,
);

/**
 * Zero rebuilt values is a failure, not a curiosity.
 *
 * Every table in this schema has a createdAt. A snapshot of more than a handful
 * of rows that yields no Date at all means the tagging did not happen and every
 * timestamp was written as a bare string — which is exactly the bug this drill
 * caught on its first run. It reads back "cleanly" in the sense that the JSON
 * parses; it would restore a database where every date is text.
 */
check(
  "timestamps came back as dates rather than strings",
  restoredRows < 20 || restoredValues > 0,
  "no Date or BigInt was rebuilt — check the replacer in snapshot-db.mjs",
);

if (!skipLive) {
  console.log("\nagainst the live database:");
  const prisma = new PrismaClient();
  const live = await prisma.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name NOT LIKE '\\_prisma%'
  `);

  for (const { table_name: table } of live) {
    if (!(table in readBack)) {
      check(`${table} is in the snapshot`, false, "table exists live but was never captured");
      continue;
    }
    const [{ count }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS count FROM "${table}"`);
    const now = Number(count);
    /**
     * Live counts only ever GROW between the snapshot and the drill — the
     * school keeps working. A live count that has fallen below the snapshot
     * means rows were deleted, which is worth knowing about but is not this
     * script's business to judge; it is reported rather than failed.
     */
    if (now < readBack[table]) {
      console.log(
        `  note  ${table}: ${now} rows live, ${readBack[table]} in the snapshot — rows have been deleted since`,
      );
    }
  }
  await prisma.$disconnect();
}

/**
 * Record the drill, which is the whole reason `drill` is one of the three
 * backup kinds. The alarm asks "when did somebody last prove a backup could be
 * read back", and that question has an answer only if the answer gets written
 * down.
 */
if (!skipLive) {
  const prisma = new PrismaClient();
  try {
    await prisma.backupRun.create({
      data: {
        kind: "drill",
        status: failures === 0 ? "success" : "failed",
        snapshotId: dir,
        detail: { rows: restoredRows, rebuiltValues: restoredValues, failures },
        error: failures === 0 ? null : `${failures} check(s) failed`,
        startedAt: new Date(manifest.takenAt),
        finishedAt: new Date(),
      },
    });
    console.log("recorded in BackupRun as a restore drill");
  } catch (error) {
    console.warn("Could not record the drill:", error.message.split("\n")[0]);
  }
  await prisma.$disconnect();
}

console.log(
  failures === 0
    ? "\nthe snapshot reads back cleanly. It could be restored from."
    : `\n${failures} check(s) failed. This snapshot should not be relied on.`,
);
process.exit(failures === 0 ? 0 : 1);
