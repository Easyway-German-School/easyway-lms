/**
 * One CSV writer, so every "Export" button in the admin area produces the same
 * file: UTF-8 with a BOM (Excel on Windows reads diacritics as mojibake without
 * it, and this school's register is full of them), CRLF rows, every field
 * quoted, and a leading apostrophe on anything Excel would treat as a formula.
 *
 * Student names are user input and land unescaped in these files, which is why
 * the formula guard is not optional — a name beginning "=" is a cell Excel will
 * try to evaluate.
 */

/** Quote one field, doubling embedded quotes and defusing a formula lead-in. */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** Header row + body rows → a complete CSV string, BOM included. */
export function buildCsv(headers: string[], rows: Array<Array<unknown>>): string {
  return (
    "﻿" +
    [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")
  );
}

/** Hand the browser a CSV to save. No-op on the server. */
export function downloadCsv(filename: string, content: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Today as YYYY-MM-DD, for filename suffixes. */
export const csvDateStamp = (): string => new Date().toISOString().slice(0, 10);

/** Slugify a label for use in a filename. */
export const csvSlug = (label: string): string =>
  label.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "export";
