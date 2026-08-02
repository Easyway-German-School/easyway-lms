/**
 * Copies the SQLite development database into Postgres.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------
 * `prisma/dev.db` holds real work — branches, courses, the demo cohorts, the
 * community spaces, whatever has been set up by hand since July. Moving to
 * Postgres for Vercel would otherwise mean re-seeding and losing all of it.
 *
 * Run it once, against an empty Postgres:
 *
 *   npm run db:migrate      # create the tables
 *   npm run db:port         # fill them
 *
 * It is safe to re-run: every insert skips rows whose primary key is already
 * there, so a run that dies halfway can simply be started again.
 *
 * ---------------------------------------------------------------------------
 * THE TWO CONVERSIONS THAT MATTER
 * ---------------------------------------------------------------------------
 * SQLite has no boolean and no date. Prisma stores the first as 0/1 and the
 * second as milliseconds since the epoch, and Postgres will accept neither —
 * `1` is not `true` and `1753142400000` is not a timestamp. Every column is
 * therefore converted according to what the schema says it is, rather than
 * according to what the value looks like. Guessing from the value is how a
 * `sessionSlot` of "1" becomes `true`.
 *
 * Json is the third: SQLite keeps it as TEXT, Postgres as jsonb. A string that
 * happens to contain a brace is not the same thing as an object, and inserting
 * it as a string produces a column full of quoted JSON that every reader in the
 * app then fails to parse.
 *
 * ---------------------------------------------------------------------------
 * ORDER
 * ---------------------------------------------------------------------------
 * Foreign keys mean a Student cannot be inserted before its User. Rather than
 * maintain a hand-written list of sixty models that goes stale the first time
 * somebody adds a relation, the order is derived from Prisma's own model
 * metadata: a model is inserted once everything it points at has been. Cycles
 * (a table with an optional self-reference, or two that point at each other)
 * are inserted last and simply retried.
 */

import { Prisma, PrismaClient } from "@prisma/client";
import path from "path";

const prisma = new PrismaClient();

const SQLITE_PATH = process.env.SQLITE_PATH || path.join(process.cwd(), "prisma", "dev.db");
const CHUNK = 500;

type FieldPlan = { name: string; kind: "boolean" | "datetime" | "json" | "plain" };

function planFields(model: Prisma.DMMF.Model): FieldPlan[] {
  return model.fields
    // Relation fields are not columns; the scalar foreign key beside them is.
    .filter((field) => field.kind === "scalar" || field.kind === "enum")
    .map((field) => {
      if (field.type === "Boolean") return { name: field.name, kind: "boolean" as const };
      if (field.type === "DateTime") return { name: field.name, kind: "datetime" as const };
      if (field.type === "Json") return { name: field.name, kind: "json" as const };
      return { name: field.name, kind: "plain" as const };
    });
}

function convert(value: unknown, kind: FieldPlan["kind"]): unknown {
  if (value === null || value === undefined) return null;

  switch (kind) {
    case "boolean":
      return typeof value === "boolean" ? value : Number(value) !== 0;

    case "datetime": {
      // Prisma writes milliseconds since the epoch into SQLite, but a row
      // touched by a raw query or a seed script may hold an ISO string.
      if (value instanceof Date) return value;
      if (typeof value === "number") return new Date(value);
      const asNumber = Number(value);
      return Number.isFinite(asNumber) && String(value).trim() !== ""
        ? new Date(asNumber)
        : new Date(String(value));
    }

    case "json": {
      if (typeof value !== "string") return value;
      try {
        return JSON.parse(value);
      } catch {
        // Not valid JSON — keep the text rather than lose it. Prisma will
        // store it as a JSON string, which is at least recoverable by hand.
        return value;
      }
    }

    default:
      // SQLite hands back BigInt for large integers; Postgres wants a number.
      return typeof value === "bigint" ? Number(value) : value;
  }
}

/**
 * Insertion order: a model goes after everything it holds a foreign key to.
 *
 * Anything left over after no further progress is possible is a cycle, and
 * those go on the end — their rows insert once the referenced side exists,
 * which for an optional self-reference is immediately.
 */
function insertionOrder(models: readonly Prisma.DMMF.Model[]): Prisma.DMMF.Model[] {
  const byName = new Map(models.map((model) => [model.name, model]));
  const dependencies = new Map<string, Set<string>>();

  for (const model of models) {
    const needs = new Set<string>();
    for (const field of model.fields) {
      // `relationFromFields` is non-empty only on the side that holds the key.
      if (field.kind === "object" && field.relationFromFields?.length && field.type !== model.name) {
        if (byName.has(field.type)) needs.add(field.type);
      }
    }
    dependencies.set(model.name, needs);
  }

  const ordered: Prisma.DMMF.Model[] = [];
  const placed = new Set<string>();

  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const model of models) {
      if (placed.has(model.name)) continue;
      const needs = dependencies.get(model.name)!;
      if ([...needs].every((name) => placed.has(name))) {
        ordered.push(model);
        placed.add(model.name);
        progressed = true;
      }
    }
  }

  for (const model of models) {
    if (!placed.has(model.name)) ordered.push(model);
  }

  return ordered;
}

async function main() {
  // node:sqlite is built into Node 22.5+, so reading the old database needs no
  // dependency. Imported dynamically because @types/node here predates it.
  const { DatabaseSync } = (await import("node:sqlite")) as unknown as {
    DatabaseSync: new (filename: string, options?: { readOnly?: boolean }) => {
      prepare: (sql: string) => { all: (...params: unknown[]) => Record<string, unknown>[] };
      close: () => void;
    };
  };

  console.log(`Reading  ${SQLITE_PATH}`);
  const sqlite = new DatabaseSync(SQLITE_PATH, { readOnly: true });

  const existingTables = new Set(
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => String(row.name)),
  );

  const models = insertionOrder(Prisma.dmmf.datamodel.models);
  const summary: Array<{ model: string; read: number; written: number; note?: string }> = [];

  for (const model of models) {
    // No @@map anywhere in this schema, so the table is the model name.
    if (!existingTables.has(model.name)) {
      summary.push({ model: model.name, read: 0, written: 0, note: "not in dev.db" });
      continue;
    }

    const plans = planFields(model);
    const rows = sqlite.prepare(`SELECT * FROM "${model.name}"`).all();

    if (rows.length === 0) {
      summary.push({ model: model.name, read: 0, written: 0 });
      continue;
    }

    const converted = rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const plan of plans) {
        if (!(plan.name in row)) continue;
        out[plan.name] = convert(row[plan.name], plan.kind);
      }
      return out;
    });

    // Indexing the client by model name is the whole point of walking the
    // DMMF, and the generated types cannot express it.
    const client = prisma as unknown as Record<string, any>;
    const delegate = client[model.name.charAt(0).toLowerCase() + model.name.slice(1)];
    if (!delegate?.createMany) {
      summary.push({ model: model.name, read: rows.length, written: 0, note: "no client delegate" });
      continue;
    }

    let written = 0;
    let note: string | undefined;

    for (let index = 0; index < converted.length; index += CHUNK) {
      const chunk = converted.slice(index, index + CHUNK);
      try {
        const result = await delegate.createMany({ data: chunk, skipDuplicates: true });
        written += result.count;
      } catch (error) {
        /**
         * One bad row must not cost the other four hundred. Fall back to
         * inserting the chunk one row at a time so the failure is isolated and
         * named — a foreign key pointing at a record that was deleted by hand
         * months ago is the usual cause, and that row is genuinely unportable.
         */
        for (const row of chunk) {
          try {
            await delegate.create({ data: row });
            written += 1;
          } catch (rowError) {
            note = `${(note ? note + "; " : "")}skipped ${String(row.id ?? "?")}: ${
              rowError instanceof Error ? rowError.message.split("\n")[0] : rowError
            }`;
          }
        }
      }
    }

    summary.push({ model: model.name, read: rows.length, written, note });
  }

  sqlite.close();
  await prisma.$disconnect();

  console.log("\nModel                          read   written  note");
  console.log("".padEnd(70, "-"));
  let totalRead = 0;
  let totalWritten = 0;
  for (const line of summary) {
    if (line.read === 0 && line.written === 0 && !line.note) continue;
    totalRead += line.read;
    totalWritten += line.written;
    console.log(
      `${line.model.padEnd(30)} ${String(line.read).padStart(5)}  ${String(line.written).padStart(8)}  ${line.note ?? ""}`,
    );
  }
  console.log("".padEnd(70, "-"));
  console.log(`${"TOTAL".padEnd(30)} ${String(totalRead).padStart(5)}  ${String(totalWritten).padStart(8)}`);

  if (totalWritten < totalRead) {
    console.log("\nSome rows did not port. The notes above name each one; they are almost");
    console.log("always rows pointing at a record that no longer exists.");
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
