import { unzipSync, strFromU8 } from "fflate";

/**
 * Reading a student list out of an .xlsx file, in the browser.
 *
 * Offices keep their student lists in Excel, not in CSV. Telling someone to
 * "save as CSV first" is a step that gets skipped, done wrong (semicolons in a
 * Nigerian locale), or silently mangles a phone number with a leading zero —
 * so the importer now takes the file they actually have.
 *
 * WHY NOT SheetJS: the `xlsx` package on npm is the abandoned 0.18.5 build.
 * The maintainers moved distribution to their own CDN and the npm artefact
 * carries known prototype-pollution advisories. This reader handles the one
 * shape we need — a flat sheet with a header row — in about ninety lines, on
 * top of fflate, which is 30KB and maintained.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: date-formatted cells come back as Excel
 * serial numbers rather than dates. The student import template has no date
 * column (name, email, phone, branch, level, batch, session, amount_paid), so
 * adding style parsing would be carrying weight for a case that does not
 * exist. If a date column is ever added, that is the thing to fix here.
 */

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/** Read every <t> under a node, joined — rich text splits a string across runs. */
function textOf(node: Element | null): string {
  if (!node) return "";
  return Array.from(node.getElementsByTagNameNS(NS, "t"))
    .map((el) => el.textContent ?? "")
    .join("");
}

/** "BC12" → 54 (zero-based column index). */
function columnIndex(ref: string): number {
  const letters = ref.replace(/[0-9]/g, "");
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function parseXml(bytes: Uint8Array): Document {
  return new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
}

export class SpreadsheetError extends Error {}

/**
 * Parse the first worksheet into `{ header: value }` rows.
 *
 * Header keys are normalised the same way the CSV path normalises them —
 * lowercased, spaces to underscores — so both file types feed the importer
 * identically and the column documentation stays true for either.
 */
export function parseXlsx(buffer: ArrayBuffer): Record<string, string>[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new SpreadsheetError(
      "That file could not be opened as a spreadsheet. If it is an older .xls, re-save it as .xlsx.",
    );
  }

  // Shared strings: most text in a sheet is stored once here and referenced.
  const sharedStrings: string[] = [];
  const sharedFile = files["xl/sharedStrings.xml"];
  if (sharedFile) {
    const doc = parseXml(sharedFile);
    for (const si of Array.from(doc.getElementsByTagNameNS(NS, "si"))) {
      sharedStrings.push(textOf(si));
    }
  }

  // The first sheet in the workbook's own order, not the first file on disk —
  // sheet1.xml is not reliably the tab the user is looking at.
  const workbook = files["xl/workbook.xml"];
  if (!workbook) throw new SpreadsheetError("That file is not a valid .xlsx workbook.");

  const rels = files["xl/_rels/workbook.xml.rels"];
  const targets = new Map<string, string>();
  if (rels) {
    const doc = new DOMParser().parseFromString(strFromU8(rels), "application/xml");
    for (const rel of Array.from(doc.getElementsByTagName("Relationship"))) {
      targets.set(rel.getAttribute("Id") ?? "", rel.getAttribute("Target") ?? "");
    }
  }

  const workbookDoc = parseXml(workbook);
  const firstSheet = workbookDoc.getElementsByTagNameNS(NS, "sheet")[0];
  const relId =
    firstSheet?.getAttribute("r:id") ??
    firstSheet?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ??
    "";
  const target = targets.get(relId) ?? "worksheets/sheet1.xml";
  const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.?\//, "")}`;

  const sheetFile = files[path] ?? files["xl/worksheets/sheet1.xml"];
  if (!sheetFile) throw new SpreadsheetError("That workbook has no readable sheet.");

  const sheet = parseXml(sheetFile);
  const grid: string[][] = [];

  for (const row of Array.from(sheet.getElementsByTagNameNS(NS, "row"))) {
    const cells: string[] = [];
    for (const cell of Array.from(row.getElementsByTagNameNS(NS, "c"))) {
      // Cells with no value are omitted from the XML entirely, so the column
      // reference is the only thing that keeps values under the right header.
      const index = columnIndex(cell.getAttribute("r") ?? "");
      const type = cell.getAttribute("t");

      let value = "";
      if (type === "inlineStr") {
        value = textOf(cell.getElementsByTagNameNS(NS, "is")[0] ?? null);
      } else {
        const raw = cell.getElementsByTagNameNS(NS, "v")[0]?.textContent ?? "";
        value = type === "s" ? (sharedStrings[Number(raw)] ?? "") : raw;
      }

      while (cells.length < index) cells.push("");
      cells[index] = value.trim();
    }
    grid.push(cells);
  }

  const rows = grid.filter((row) => row.some((cell) => cell !== ""));
  const [header, ...body] = rows;
  if (!header) return [];

  const keys = header.map((cell) => cell.trim().toLowerCase().replace(/\s+/g, "_"));
  return body.map((cells) =>
    Object.fromEntries(keys.map((key, index) => [key, (cells[index] ?? "").trim()])),
  );
}

/** Turn parsed rows back into CSV, so one preview path serves both formats. */
export function rowsToCsv(rows: Record<string, string>[]): string {
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]);
  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return [
    keys.join(","),
    ...rows.map((row) => keys.map((key) => escape(row[key] ?? "")).join(",")),
  ].join("\n");
}
