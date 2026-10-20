import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(scriptDirectory, "../src/lib/developer-history.ts");
const repository = "Easyway-German-School/easyway-lms";

function fetchAll(endpoint) {
  const output = execFileSync("gh", ["api", "--paginate", "--slurp", endpoint], {
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
  });
  const pages = JSON.parse(output);
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error(`GitHub returned an unexpected response for ${endpoint}`);
  }
  return pages.flat();
}

function scrub(text) {
  return String(text ?? "")
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, "[db-url]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "******")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[jwt]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[number]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[token]");
}

const pullRequests = fetchAll(`repos/${repository}/pulls?state=all&per_page=100`)
  .map((row) => ({
    number: row.number,
    title: scrub(row.title).slice(0, 240),
    body: scrub(row.body).slice(0, 3000),
    url: row.html_url,
    state: row.state,
    createdAt: row.created_at,
    mergedAt: row.merged_at,
  }))
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

const issues = fetchAll(`repos/${repository}/issues?state=all&per_page=100`)
  .filter((row) => !row.pull_request)
  .map((row) => ({
    number: row.number,
    title: scrub(row.title).slice(0, 240),
    body: scrub(row.body).slice(0, 3000),
    url: row.html_url,
    state: row.state,
    createdAt: row.created_at,
  }))
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

const commits = fetchAll(`repos/${repository}/commits?per_page=100`)
  .map((row) => {
    const [title, ...body] = String(row.commit.message ?? "").split(/\r?\n/);
    return {
      sha: row.sha,
      title: scrub(title).slice(0, 240),
      body: scrub(body.join("\n").trim()).slice(0, 1200),
      url: row.html_url,
      date: row.commit.author?.date ?? row.commit.committer?.date ?? "",
    };
  })
  .sort((a, b) => b.date.localeCompare(a.date));

const snapshot = {
  generatedAt: new Date().toISOString(),
  repository,
  issues,
  pullRequests,
  commits,
};

const snapshotType = `type DeveloperHistorySnapshot = {
  generatedAt: string;
  repository: string;
  issues: Array<{ number: number; title: string; body: string; url: string; state: string; createdAt: string }>;
  pullRequests: Array<{ number: number; title: string; body: string; url: string; state: string; createdAt: string; mergedAt: string | null }>;
  commits: Array<{ sha: string; title: string; body: string; url: string; date: string }>;
};`;
const compressedSnapshot = gzipSync(Buffer.from(JSON.stringify(snapshot)), { level: 9 }).toString("base64");
const generatedModule = `import { gunzipSync } from "node:zlib";\n${snapshotType}\nconst compressed: string = ${JSON.stringify(compressedSnapshot)};\nconst history = JSON.parse(gunzipSync(Buffer.from(compressed, "base64")).toString("utf8")) as DeveloperHistorySnapshot;\nexport default history;\n`;
writeFileSync(outputPath, generatedModule, "utf8");
console.log(
  `Saved ${issues.length} issues, ${pullRequests.length} pull requests and ${commits.length} commits to ${outputPath}`,
);
