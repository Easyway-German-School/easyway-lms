/**
 * Does any API route carry a stored file's bytes through a Vercel function?
 *
 * WHY THIS EXISTS (September 2026): Vercel bills every byte a function sends
 * back as "Fast Origin Transfer". This app kept its files in a private bucket
 * and streamed them to the browser through `/api/files` so the bucket could
 * stay private. That was fine for photos and disastrous for class recordings:
 * one day (Sep 10) moved ~970 GB and cost ~$55; the month's overage was ~$116
 * and the account was flagged overdue. The fix was to check the session once
 * and then redirect the browser to a short-lived signed bucket URL, so the
 * bytes never touch a function. See project-vercel-egress-bill.
 *
 * WHAT IT CHECKS: any route under src/app that reads a file out of the bucket
 * with `getFile(` or returns an upstream response body
 * (`new Response(upstream.body …)`) must carry an `egress-reviewed:` comment
 * saying why that is safe — normally "small and private", or "redirects to a
 * signed URL and this is only the fallback". A route with no such comment fails
 * the build, so the next person who adds a download route has to stop and
 * answer the question that cost us a bill.
 *
 * WHAT IT DELIBERATELY DOES NOT CHECK: server-side reads for processing
 * (transcription, AI extraction) — those never leave the function, so they are
 * not billed as transfer — and small generated PDFs.
 *
 * Run: `npm run check:egress`. Also part of `npm run ci` and the CI workflow.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src", "app");
const MARKER = /egress-reviewed:/;

/** Patterns that mean "this route is sending stored bytes back to the client". */
const STREAMING_PATTERNS = [
  { re: /\bgetFile\s*\(/, why: "reads a file out of the bucket with getFile()" },
  { re: /new\s+(?:Next)?Response\(\s*(?:upstream|source|object|file|stored|res|response)\.body\b/, why: "returns an upstream response body" },
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\./.test(name)) yield full;
  }
}

export function findViolations(root = ROOT) {
  const violations = [];
  for (const file of walk(root)) {
    const text = readFileSync(file, "utf8");
    if (MARKER.test(text)) continue;
    for (const { re, why } of STREAMING_PATTERNS) {
      if (re.test(text)) violations.push({ file: relative(join(root, "..", ".."), file).split(sep).join("/"), why });
    }
  }
  return violations;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1].replace(/\//g, sep)) {
  const violations = findViolations();
  if (violations.length === 0) {
    console.log("check:egress OK — no unreviewed route streams stored files through a function.");
  } else {
    console.error("\ncheck:egress FAILED\n");
    for (const v of violations) console.error(`  ${v.file}\n    ${v.why}`);
    console.error(
      "\nA route that sends stored file bytes back through a Vercel function is billed as Fast Origin Transfer.\n" +
        "That is what turned class-recording replays into a ~$116 overage in Sept 2026.\n\n" +
        "Fix: check the session, then redirect the browser to a signed bucket URL —\n" +
        "  see redirectTtlSeconds() / signedGetUrl() in src/lib/storage.ts and src/app/api/files/[...key]/route.ts.\n" +
        "If the file is genuinely small and private, add a comment containing\n" +
        "  egress-reviewed: <why this is safe>\n" +
        "to the route and re-run.\n",
    );
    process.exit(1);
  }
}
