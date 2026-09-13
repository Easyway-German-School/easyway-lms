/**
 * Minimal CSV encoding — quotes a field only when it needs it, per RFC 4180.
 *
 * Also defuses formula/CSV injection (CWE-1236): every field here ultimately
 * comes from a candidate (a booking's name, address, city...), and this file
 * is opened by office staff in Excel/Sheets, which both treat a cell
 * starting with =, +, -, or @ as a formula — so a candidate whose "name" is
 * `=HYPERLINK("http://evil","click")` or a DDE payload would have it
 * execute for whoever opens the roster, not just print as text. Prefixing
 * such a value with a leading `'` is the standard mitigation (OWASP): every
 * spreadsheet app treats a leading apostrophe as "force text", so the cell
 * displays as typed instead of evaluating.
 */
export function toCsv(rows: Record<string, string | number | null>[], columns: string[]): string {
  const escape = (value: string | number | null): string => {
    let s = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escape(row[c])).join(","));
  }
  return lines.join("\r\n");
}
