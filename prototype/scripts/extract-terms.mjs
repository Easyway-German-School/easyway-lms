/**
 * Transcribes the school's Terms and Conditions .docx into src/lib/terms-content.ts.
 *
 * WHY A SCRIPT RATHER THAN A ONE-OFF PASTE
 *
 * Section 20 reserves the school's right to amend these terms, so this document
 * WILL arrive again. Retyping three hundred paragraphs by hand each time is how
 * a legal text ends up quietly diverging from the one the school actually
 * issued — and the whole point of storing a version string on every acceptance
 * is being able to say which text somebody agreed to. That claim is only worth
 * anything if the text in the app is provably the text in the document.
 *
 *   node scripts/extract-terms.mjs "C:/Users/HP/Downloads/TERMS AND CONDITIONS UPDATED.docx"
 *
 * Then bump TERMS_VERSION / TERMS_VERSION_LABEL in src/lib/terms.ts, so students
 * who accepted the previous wording are visibly on the previous wording rather
 * than silently credited with agreeing to the new one.
 *
 * ---------------------------------------------------------------------------
 * THE ONE EXTRACTION TRAP, WRITTEN DOWN BECAUSE IT IS SILENT
 * ---------------------------------------------------------------------------
 * A Word paragraph is a list of runs, and the naive extraction — concatenate
 * every <w:t> in document order — loses `<w:br/>`, the manual line break. Word
 * puts one wherever the author pressed Shift+Enter, and it frequently lands
 * MID-SENTENCE, between two runs that each hold half of it:
 *
 *   <w:t>...high standard of learning, ensure</w:t>
 *   <w:r><w:br/><w:t>fairness, and create...</w:t></w:r>
 *
 * Drop the break and you get "ensurefairness". Not a crash, not a warning — a
 * legal document with words fused together, in about a dozen places, which
 * reads as carelessness on the one page a student is asked to trust. The fix is
 * to substitute breaks and tabs for a marker BEFORE pulling the text out, so
 * they survive into the concatenation as whitespace and collapse away.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "src", "lib", "terms-content.ts");

const source =
  process.argv[2] ?? "C:/Users/HP/Downloads/TERMS AND CONDITIONS UPDATED.docx";

const zip = await JSZip.loadAsync(await fs.readFile(source));
const xml = await zip.file("word/document.xml").async("string");

const decode = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Last, so an escaped ampersand in the source cannot produce a second
    // round of entity decoding.
    .replace(/&amp;/g, "&");

/** Every paragraph, with whether Word had it in a numbered/bulleted list. */
const paragraphs = [];
for (const match of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g)) {
  const block = match[0];
  // See the module comment: breaks and tabs become whitespace, not nothing.
  const marked = block.replace(/<w:(?:br|tab)\s*\/>/g, "<w:t>\u0000</w:t>");
  const text = decode([...marked.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join(""))
    .replace(/\u0000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text) paragraphs.push({ text, list: block.includes("<w:numPr>") });
}

/**
 * A heading is an unlisted paragraph that opens with the school's own section
 * numbering — "1.", "22A.", "22AB." — and is short enough to be a title rather
 * than a sentence that happens to start with a figure. Verified against the
 * supplied document: this classifies all 100 headings and zero body paragraphs.
 */
const HEADING = /^(\d+[A-Z]*)\.\s*(.+)$/;
const isHeading = (p) => !p.list && p.text.length < 70 && HEADING.test(p.text);

// The first three paragraphs are the school name, the document title, and the
// statement of intent. Only the third is content.
const preamble = paragraphs[2].text;

const sections = [];
for (const paragraph of paragraphs.slice(3)) {
  if (isHeading(paragraph)) {
    const [, number, title] = paragraph.text.match(HEADING);
    sections.push({ number, title: title.trim(), blocks: [] });
    continue;
  }
  sections.at(-1)?.blocks.push({
    kind: paragraph.list ? "bullet" : "text",
    text: paragraph.text,
  });
}

const quote = (s) => JSON.stringify(s);

const file = `/**
 * THE SCHOOL'S TERMS AND CONDITIONS, verbatim.
 *
 * GENERATED FILE — do not edit by hand. Produced by scripts/extract-terms.mjs
 * from the .docx the school issued. Nothing here is paraphrased, condensed or
 * reordered: every sentence is the school's own, in the school's own order,
 * because this is the text a student is asked to agree to and a helpfully
 * shortened version of it is not the thing they agreed to.
 *
 * ${sections.length} sections, ${sections.reduce((n, s) => n + s.blocks.length, 0)} paragraphs.
 *
 * The structure (a numbered section holding paragraph/bullet blocks) exists
 * because two of the three surfaces that render this have to address ONE
 * section rather than dump the lot — the refund wall opens on 23, not on 1.
 * See src/lib/terms.ts for the version string and the section groupings.
 */

export type TermsBlock = {
  /** \`bullet\` was a numbered or bulleted list item in the source document. */
  kind: "text" | "bullet";
  text: string;
};

export type TermsSection = {
  /** The school's own numbering — "1", "22A", "22AB", "30". Used to address a section. */
  number: string;
  title: string;
  blocks: TermsBlock[];
};

/** The statement of intent that opens the document. */
export const TERMS_PREAMBLE = ${quote(preamble)};

export const TERMS_SECTIONS: TermsSection[] = [
${sections
  .map(
    (s) => `  {
    number: ${quote(s.number)},
    title: ${quote(s.title)},
    blocks: [
${s.blocks.map((b) => `      { kind: ${quote(b.kind)}, text: ${quote(b.text)} },`).join("\n")}
    ],
  },`,
  )
  .join("\n")}
];
`;

await fs.writeFile(OUT, file, "utf8");

console.log(
  `terms-content.ts written — ${sections.length} sections, ` +
    `${sections.reduce((n, s) => n + s.blocks.length, 0)} paragraphs\n` +
    `sections: ${sections.map((s) => s.number).join(", ")}`,
);
