/**
 * Adds `tenantId` (plus an index) to every model the tenant registry calls
 * tenant-owned, if it is not already there.
 *
 * Written as a script rather than done by hand because it is forty-five nearly
 * identical edits, and forty-five hand edits is forty-five chances to skip one
 * — which for this particular field means one table with no isolation at all.
 * Re-running it is safe: models that already carry the column are left alone.
 *
 *   node scripts/add-tenant-columns.mjs          # report only
 *   node scripts/add-tenant-columns.mjs --write  # apply
 *
 * Review `git diff prisma/schema.prisma` afterwards. This edits the schema
 * only; it neither generates a client nor touches any database.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(here, "..", "prisma", "schema.prisma");

// Kept in step with src/lib/tenant/registry.ts. The isolation test asserts the
// two agree, so a model added to one and not the other fails the suite.
const TENANT_OWNED = [
  "Student", "Lecturer", "Branch", "Class", "ClassSession", "PrivateClass",
  "Course", "Module", "Lesson", "Material", "Pathway", "Enrollment", "Progress",
  "Completion", "Grade", "Assignment", "AssignmentTarget", "AssignmentSubmission",
  "Attendance", "Exam", "ExamRegistration", "Certificate", "Invoice", "Payment",
  "Lead", "Notification", "NotificationSetting", "EmailLog", "EmailMessage",
  "EmailSuppression", "PushSubscription", "Space", "Channel", "ChannelRead",
  "Thread", "Comment", "ClassRecording", "VideoProgress", "MissionProgress",
  "PersonalizedPlan", "JourneyEvent", "IntegrationConnector", "AdminAction",
  "AuditLog", "BackupRun",
];

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
   * school's own 977 rows have no tenant until the backfill assigns them one,
   * and a required column cannot be added to a populated table without a
   * default that would be a lie. The backfill in the manual migration is what
   * makes it effectively non-null; the isolation extension already refuses to
   * query without a tenant, so a null here means "not reachable by any tenant
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
