/**
 * Read the source tree and write the backend map the developer console draws.
 *
 *   npm run graph
 *
 * Also runs before every build (`prebuild`), so the map on production is the
 * map of the code that is deployed. It must NEVER break a build: a map that is
 * one deploy stale is a nuisance, a build that fails because the map could not
 * be drawn is an outage. Any failure is logged and the previous file is kept.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { buildGraph } from "../src/lib/backend-graph";

const root = resolve(__dirname, "..");
const out = join(root, "src", "generated", "backend-graph.json");

function walk(dir: string, accept: (file: string) => boolean, into: string[] = []): string[] {
  if (!existsSync(dir)) return into;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, accept, into);
    else if (accept(full)) into.push(full);
  }
  return into;
}

function main() {
  const routeFiles = walk(join(root, "src", "app", "api"), (f) => /[\\/]route\.tsx?$/.test(f));
  const libFiles = walk(join(root, "src", "lib"), (f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f));

  const files = [...routeFiles, ...libFiles].map((file) => ({
    // Repo-relative with forward slashes: this ends up in the UI and in the JSON.
    path: relative(root, file).replace(/\\/g, "/"),
    source: readFileSync(file, "utf8"),
  }));

  const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
  const modelNames = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);

  const graph = buildGraph(files, modelNames);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(graph) + "\n");
  const { routes, libs, models, edges, untouchedModels } = graph.stats;
  console.log(
    `[backend-graph] ${routes} routes, ${libs} libraries, ${models} tables, ${edges} links` +
      ` (${untouchedModels.length} tables never touched directly) -> ${relative(root, out)}`,
  );
}

try {
  main();
} catch (error) {
  console.warn("[backend-graph] skipped, keeping the previous map:", error instanceof Error ? error.message : error);
}
