/**
 * Does any route reimplement the payment gate instead of calling it?
 *
 * `deriveStudentAccess()` (lib/access.ts) is the one function that knows how
 * to answer "can this student act" — the per-level tuition ledger, the Travel
 * Package flat-deposit floor, admin grace, and payment-plan adherence all live
 * inside it. `getStudentAccess()` / `accessFromStudent()` / `studentHasPortalAccess()`
 * (lib/student-access.ts) are the one place that calls it with every field
 * filled in, matching what `/api/student/access` (the student's own portal
 * gate) and the admin remote view use.
 *
 * THIS BUG SHIPPED THREE TIMES BEFORE THIS SCRIPT COVERED IT PROPERLY:
 *   1. 2026-09-14 — the admin dossier called `deriveStudentAccess` directly
 *      with only some fields filled in.
 *   2. 2026-09-15 — `/api/live/session`, `/api/student/videos`,
 *      `/api/student/exam-registrations` did the same. CHECK 1 below was
 *      written after this round and would have caught both 1 and 2.
 *   3. 2026-09-15 (same day, found by manual audit) — `/api/student/materials`,
 *      the enrolment-letter routes, `/api/games`, `/api/live-quiz/join`,
 *      the bulk-email audience filter, the MailerLite sync, and the student
 *      brief's payment nudge all computed their own `paid vs. deposit/fee`
 *      comparison FROM SCRATCH — never importing `deriveStudentAccess` at
 *      all, so CHECK 1 could not see them. CHECK 2 below exists because of
 *      this round, and is the reason "closing this gap" took a second check,
 *      not a bigger version of the first one.
 *
 * CHECK 1 — no direct `deriveStudentAccess` calls outside lib/access.ts and
 * lib/student-access.ts themselves.
 *
 * CHECK 2 — no hand-rolled `paid` vs `deposit`/`fee` comparison anywhere else
 * in the tree, UNLESS the file is on MONEY_MATH_ALLOWLIST below with a reason
 * on record for why that specific comparison is not a student-access gate.
 * This is a blunter net than CHECK 1: it will flag a new legitimate
 * non-gating calculation too. That is by design — a human reads the flag and
 * either fixes it or adds a one-line, reviewed reason to the allowlist. The
 * alternative (a cleverer regex that tries to guess intent) is how a real
 * instance slips through unreviewed, which is exactly what happened here.
 *
 * CHECK 3 — the two source trees' copies of the two canonical files must not
 * drift from each other (see project-two-source-trees).
 *
 * Usage: node scripts/check-payment-gate-drift.mjs
 * Exits non-zero (and prints every offending line) on a violation.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", ".."); // .../EASYWAY LMS

/** The only files allowed to define or call deriveStudentAccess directly. */
const ALLOWED_RELATIVE = ["src/lib/access.ts", "src/lib/student-access.ts"];

/**
 * Files that legitimately compare `paid` against `deposit`/`fee` for a reason
 * OTHER than deciding whether a student can act right now. Every entry here
 * was read line-by-line before being added — do not add one without doing
 * the same. If in doubt, fix the call site instead of allowlisting it.
 */
const MONEY_MATH_ALLOWLIST = {
  "src/lib/access.ts": "defines deriveStudentAccess itself",
  "src/lib/student-access.ts": "calls deriveStudentAccess with every field — the canonical wrapper",
  "src/lib/payment.ts": "defines the pure calculators (derivePaymentStatus, resolvePartialPayment, etc.) — callers, not this file, decide whether ledger-aware figures feed them",
  "src/lib/finance/receivables.ts": "admin cohort/collection reporting, not a student-facing gate — explicitly layers the per-level ledger on top for the figures that matter",
  "src/lib/pay-in-full.ts": "the early-full-payment BONUS OFFER window calculator — a marketing incentive, not an access gate; getting this wrong mis-badges a bonus, it does not lock anyone out",
  "src/lib/travel-package.ts": "detects a pathway change to fire a one-time notification — an event trigger, not a gate",
  "src/app/api/student/tuition-offer/route.ts": "the full-payment bonus offer + a peer '% who paid in full' stat for a checkout nudge — informational, not a gate. Flagged for a follow-up look, not fixed here",
  "src/app/dashboard/page.tsx": "client component displaying fields already computed server-side by /api/student/access — a type shape, not a computation",
  "src/app/api/paystack/initialize/route.ts": "the checkout route itself — already reconciles through the real per-level ledger (loadStudentLedger) for the case that matters (advancing a level); the raw sum is only ever the same-level starting point. Deliberately not touched here — this is live payment-processing code and any change to it needs someone with full checkout context, not a drive-by edit",
};

const CALL_PATTERN = /\bderiveStudentAccess\s*\(/;
const IMPORT_PATTERN = /\bimport\s*\{[^}]*\bderiveStudentAccess\b[^}]*\}\s*from\s*["']@\/lib\/access["']/;
const MONEY_MATH_PATTERN =
  /\b\w*[Pp]aid\w*\s*(>=|<=|<|>)\s*\w*([Dd]eposit|[Ff]ee)\w*\b|\b\w*([Dd]eposit|[Ff]ee)\w*\s*(>=|<=|<|>)\s*\w*[Pp]aid\w*\b/;

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

/**
 * Strips comments before pattern-matching, so an explanation of a PAST bug
 * (which necessarily quotes the broken expression) does not trip the same
 * check that catches the expression when it is live code. Naive on purpose —
 * good enough for this codebase's style (no `//` inside string literals that
 * also contain the word "paid" next to "fee"/"deposit"), not a full
 * tokenizer. A missed edge case here means a rare false negative, not a false
 * positive, which is the safer direction for a check that runs on every PR.
 */
function stripComments(content) {
  const noBlockComments = content.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlockComments
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

console.log("\nPayment-gate drift check");
console.log("-------------------------");

for (const tree of ["prototype", "."]) {
  const srcDir = path.join(repoRoot, tree, "src");
  const files = walk(srcDir);
  let directCallOffenders = 0;
  let moneyMathOffenders = 0;

  for (const file of files) {
    const relFromTree = path.relative(path.join(repoRoot, tree), file).replace(/\\/g, "/");
    const rawContent = readFileSync(file, "utf8");

    // CHECK 1
    if (!ALLOWED_RELATIVE.includes(relFromTree)) {
      if (IMPORT_PATTERN.test(rawContent) && CALL_PATTERN.test(rawContent)) {
        directCallOffenders += 1;
        const displayPath = path.relative(repoRoot, file).replace(/\\/g, "/");
        fail(
          "direct deriveStudentAccess call outside lib/access.ts + lib/student-access.ts",
          `${displayPath} — call getStudentAccess()/accessFromStudent() from lib/student-access.ts instead`,
        );
      }
    }

    // CHECK 2
    if (!(relFromTree in MONEY_MATH_ALLOWLIST)) {
      const content = stripComments(rawContent);
      const lines = content.split("\n");
      const hits = [];
      for (let i = 0; i < lines.length; i++) {
        if (MONEY_MATH_PATTERN.test(lines[i])) hits.push(i + 1);
      }
      if (hits.length > 0) {
        moneyMathOffenders += 1;
        const displayPath = path.relative(repoRoot, file).replace(/\\/g, "/");
        fail(
          "hand-rolled paid-vs-deposit/fee comparison outside the canonical gate",
          `${displayPath}:${hits.join(",")} — route through getStudentAccess()/accessFromStudent(), or if this genuinely is not a student-access decision, add it to MONEY_MATH_ALLOWLIST in this script with a one-line reason`,
        );
      }
    }
  }

  if (directCallOffenders === 0) pass(`no direct deriveStudentAccess callers outside the allowed files (${tree})`);
  if (moneyMathOffenders === 0) pass(`no unreviewed paid-vs-deposit/fee comparisons (${tree})`);
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
