import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The Wortduell answer deck must never reach a browser.
 *
 * Every word in lib/duel-deck.ts comes with its article, and the duel's whole
 * promise is that the article of a word you have not answered yet is only on
 * the server. A client component that imports the deck (or lib/duel.ts, which
 * imports it) would ship every answer in the page's JavaScript — a student could
 * read them straight out of the network tab and win every duel.
 *
 * Server code (API routes, lib/campus-server.ts) may import them freely.
 */

const SRC = join(__dirname, "..");
const FORBIDDEN = /from\s+["']@\/lib\/(duel|duel-deck)["']/;
const TYPE_ONLY = /import\s+type\s/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}

describe("the duel answer deck stays on the server", () => {
  const files = [...walk(join(SRC, "app")), ...walk(join(SRC, "components")), ...walk(join(SRC, "lib"))];

  it("is not imported by any 'use client' file", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (!/^\s*["']use client["']/.test(text)) continue;
      for (const line of text.split(/\r?\n/)) {
        if (FORBIDDEN.test(line) && !TYPE_ONLY.test(line)) offenders.push(`${file}: ${line.trim()}`);
      }
    }
    expect(offenders, `Client files importing the answer deck:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("is only imported by server-side modules", () => {
    const importers = files
      .filter((file) => FORBIDDEN.test(readFileSync(file, "utf8")))
      .map((file) => file.replace(SRC, "").replace(/\\/g, "/"));
    // The deck's own consumers: the duel rules and the Campus server code.
    for (const importer of importers) {
      expect(importer).toMatch(/^\/(lib\/(duel|campus-server)\.ts|app\/api\/)/);
    }
  });
});
