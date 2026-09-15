/**
 * Does any route reimplement the payment gate instead of calling it?
 *
 * `deriveStudentAccess()` (lib/access.ts) is the one function that knows how
 * to answer "can this student act" — the per-level tuition ledger, the Travel
 * Package flat-deposit floor, admin grace, and payment-plan adherence all live
 * inside it. `getStudentAccess()` / `studentHasPortalAccess()`
 * (lib/student-access.ts) are the one place that calls it with every field
 * filled in, matching what `/api/student/access` (the student's own portal
 * gate) and the admin remote view use.
 *
 * Twice now — the admin student dossier (2026-09-14), then `/api/live/session`,
 * `/api/student/videos` and `/api/student/exam-registrations` (2026-09-15) — a
 * route called `deriveStudentAccess()` directly with only some of the fields
 * filled in. Ledger-driven students (promoted, waived, on a payment plan)
 * disagreed with what the ledger actually said, and got a wrong answer: locked
 * out of a room, or a video library, the portal itself said was open. Both
 * times the fix was structural — route through `lib/student-access.ts` instead
 * of `lib/access.ts` directly — and both times nothing caught it before a
 * student did.
 *
 * This script is that catch. It scans every route/lib file OTHER than
 * lib/access.ts and lib/student-access.ts themselves for a direct call to
 * `deriveStudentAccess(`, and fails if it finds one. It also fails if the two
 * source trees' copies of the two files that are allowed to touch
 * `deriveStudentAccess` (access.ts, student-access.ts) have drifted from each
 * other — the duplicate-tree setup (see project-two-source-trees) is exactly
 * how a fix lands in one tree and not the other.
 *
 * Usage: node scripts/check-payment-gate-drift.mjs
 * Exits non-zero (and prints every offending line) on a violation.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", ".."); // .../EASYWAY LMS

/** The only files allowed to define or call deriveStudentAccess directly. */
const ALLOWED_RELATIVE = ["src/lib/access.ts", "src/lib/student-access.ts"];

/** Both source trees this repo ships in parallel — see project-two-source-trees. */
const TREES = ["prototype", "."];

const CALL_PATTERN = /\bderiveStudentAccess\s*\(/;
const IMPORT_PATTERN = /\bimport\s*\{[^}]*\bderiveStudentAccess\b[^}]*\}\s*from\s*["']@\/lib\/access["']/;

let failures = 0;
const fail = (label, detail) => {
  failures += 1;
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
};
const pass = (label) => console.log(`  PASS  ${label}`);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

console.log("\nPayment-gate drift check");
console.log("-------------------------");

for (const tree of TREES) {
  const srcDir = path.join(repoRoot, tree, "src");
  const files = walk(srcDir);
  let offendersInTree = 0;

  for (const file of files) {
    const relFromTree = path.relative(path.join(repoRoot, tree), file).replace(/\\/g, "/");
    if (ALLOWED_RELATIVE.includes(relFromTree)) continue;

    const content = readFileSync(file, "utf8");
    if (IMPORT_PATTERN.test(content) && CALL_PATTERN.test(content)) {
      offendersInTree += 1;
      const displayPath = path.relative(repoRoot, file).replace(/\\/g, "/");
      fail(
        "direct deriveStudentAccess call outside lib/access.ts + lib/student-access.ts",
        `${displayPath} — call getStudentAccess()/studentHasPortalAccess() from lib/student-access.ts instead`,
      );
    }
  }

  if (offendersInTree === 0) pass(`no direct deriveStudentAccess callers outside the allowed files (${tree})`);
}

/* -------------------------------------------------------------------------- */
// The two trees' own copies of the allowed files must not drift from each
// other — a fix applied to one and forgotten in the other is exactly how this
// bug shipped a second time.

for (const rel of ALLOWED_RELATIVE) {
  let a, b;
  try {
    a = readFileSync(path.join(repoRoot, "prototype", rel), "utf8");
  } catch {
    fail("missing file", `prototype/${rel} does not exist`);
    continue;
  }
  try {
    b = readFileSync(path.join(repoRoot, rel), "utf8");
  } catch {
    fail("missing file", `${rel} does not exist at the repo root`);
    continue;
  }
  if (a === b) {
    pass(`prototype/${rel} matches root ${rel}`);
  } else {
    fail(
      "the two source trees have drifted on a payment-gate file",
      `prototype/${rel} and ${rel} are not identical — apply the same fix to both (see project-two-source-trees)`,
    );
  }
}

console.log("");
if (failures > 0) {
  console.log(`${failures} problem${failures === 1 ? "" : "s"} found.\n`);
  process.exit(1);
} else {
  console.log("Clean.\n");
}
