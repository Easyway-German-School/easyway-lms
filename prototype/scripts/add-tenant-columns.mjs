/**
 * Adds `tenantId` (plus an index and the relation Prisma needs on both sides)
 * to every model the tenant registry calls tenant-owned, if it is not already
 * there.
 *
 * Written as a script rather than done by hand because it is nearly fifty
 * identical edits, and fifty hand edits is fifty chances to skip one — which
 * for this particular field means one table with no isolation at all.
 * Re-running it is safe: models that already carry the column are left alone.
 *
 *   node scripts/add-tenant-columns.mjs          # report only
 *   node scripts/add-tenant-columns.mjs --write  # apply
 *
 * Review `git diff prisma/schema.prisma` afterwards. This edits the schema
 * only; it neither generates a client nor touches any database.
 *
 * The model list is READ FROM src/lib/tenant/registry.ts rather than repeated
 * here. It used to be a copy, and the copy had already drifted — three models
 * added to the registry never reached this list, so running it would have
 * produced a schema that looked complete and left three tables unprotected.
 * A second list of the same thing is a second thing to forget.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(here, "..", "prisma", "schema.prisma");
const registryPath = path.join(here, "..", "src", "lib", "tenant", "registry.ts");

/** Pull the array out of the registry's TypeScript without compiling it. */
function readRegistry() {
  const source = readFileSync(registryPath, "utf8");
  const block = /export const TENANT_OWNED_MODELS = \[([\s\S]*?)\] as const;/.exec(source);
  if (!block) {
    console.error(`Could not find TENANT_OWNED_MODELS in ${registryPath}.`);
    process.exit(1);
  }
  // Strip comments first, so a model name mentioned in prose is not mistaken
  // for an entry.
  const body = block[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  return [...body.matchAll(/"([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
}

/**
 * The back-relation field name on Tenant. English enough for the models this
 * schema actually has — Class becomes classes, not classs.
 */
function pluralField(model) {
  const name = model[0].toLowerCase() + model.slice(1);
  if (/(s|x|z|ch|sh)$/.test(name)) return `${name}es`;
  if (/[^aeiou]y$/.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

const TENANT_OWNED = readRegistry();

const write = process.argv.includes("--write");
const source = readFileSync(schemaPath, "utf8");
const eol = source.includes("\r\n") ? "\r\n" : "\n";
const lines = source.split(/\r?\n/);

const added = [];
const skipped = [];
const missing = [];
const out = [];

let i = 0;
while (i < lines.length) {
  const line = lines[i];
  const match = /^model\s+(\w+)\s*\{/.exec(line);

  if (!match || !TENANT_OWNED.includes(match[1])) {
    out.push(line);
    i++;
    continue;
  }

  const modelName = match[1];

  // Collect the whole model body so we can check it before rewriting it.
  const body = [];
  let j = i + 1;
  let depth = 1;
  while (j < lines.length && depth > 0) {
    if (lines[j].includes("{")) depth++;
    if (lines[j].includes("}")) depth--;
    if (depth > 0) body.push(lines[j]);
    j++;
  }

  if (body.some((l) => /^\s*tenantId\s/.test(l))) {
    skipped.push(modelName);
    out.push(line, ...body, lines[j - 1]);
    i = j;
    continue;
  }

  /**
   * Nullable, and onDelete: Cascade.
   *
   * Nullable because the rows already in this database predate tenancy — the
   * school's own rows have no tenant until the backfill assigns them one, and
   * a required column cannot be added to a populated table without a default
   * that would be a lie. The backfill in the manual migration is what makes it
   * effectively non-null; the isolation extension already refuses to query
   * without a tenant, so a null here means "not reachable by any tenant
   * client", which is the correct failure direction.
   *
   * Cascade because deleting a tenant must take its data with it. That is a
   * contractual obligation to a departing customer, not a convenience.
   */
  const insert = [
    "",
    "  /// Tenant that owns this row. See src/lib/tenant/registry.ts.",
    "  tenantId String?",
    "  tenantRef Tenant? @relation(fields: [tenantId], references: [id], onDelete: Cascade)",
    "",
    "  @@index([tenantId])",
  ];

  out.push(line, ...body, ...insert, lines[j - 1]);
  added.push(modelName);
  i = j;
}

for (const name of TENANT_OWNED) {
  if (!added.includes(name) && !skipped.includes(name)) missing.push(name);
}

/**
 * Prisma relations are declared on both models. Without the list field here,
 * every one of the fields added above fails validation with "missing an
 * opposite relation field", and the schema does not compile at all — so this
 * is not tidiness, it is the other half of the same edit.
 */
if (added.length) {
  const start = out.findIndex((l) => /^model\s+Tenant\s*\{/.test(l));
  if (start === -1) {
    console.error("ERROR: no `model Tenant` in the schema. Nothing to relate to.");
    process.exit(1);
  }
  let end = start + 1;
  while (end < out.length && !/^\}/.test(out[end])) end++;

  const existing = out.slice(start, end).join("\n");
  const backRefs = added
    .filter((model) => !new RegExp(`\\b${model}\\[\\]`).test(existing))
    .map((model) => `  ${pluralField(model).padEnd(24)} ${model}[]`);

  out.splice(end, 0, "", "  /// Back-relations for the tenant-owned tables. Generated by", "  /// scripts/add-tenant-columns.mjs; Prisma requires both sides.", ...backRefs);
  console.log(`back-relations added to Tenant: ${backRefs.length}`);
}

console.log(`tenant column added to ${added.length} model(s)`);
if (skipped.length) console.log(`already present in ${skipped.length}: ${skipped.join(", ")}`);
if (missing.length) {
  console.error(`\nERROR: ${missing.length} registry model(s) not found in schema: ${missing.join(", ")}`);
  console.error("The registry and the schema disagree. Fix before applying.");
  process.exit(1);
}

if (!write) {
  console.log("\nreport only — pass --write to apply");
} else {
  writeFileSync(schemaPath, out.join(eol), "utf8");
  console.log(`\nwritten to ${schemaPath}`);
  console.log("next: review `git diff prisma/schema.prisma`, then `npx prisma generate`");
}
