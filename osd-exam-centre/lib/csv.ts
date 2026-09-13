/** Minimal CSV encoding — quotes a field only when it needs it, per RFC 4180. */
export function toCsv(rows: Record<string, string | number | null>[], columns: string[]): string {
  const escape = (value: string | number | null): string => {
    const s = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escape(row[c])).join(","));
  }
  return lines.join("\r\n");
}
