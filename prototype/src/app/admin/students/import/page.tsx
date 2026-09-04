"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeftIcon } from "@/components/icons";
import { useMemo, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { SpreadsheetError, parseXlsx, rowsToCsv } from "@/lib/spreadsheet";

type ImportResult = {
  row: number;
  name: string;
  email: string;
  level: string;
  branch: string | null;
  batch: string | null;
  sessionSlot: string;
  amountPaid: number;
  status: "ready" | "created" | "skipped" | "error";
  note: string;
  /** "portharcourt → Port Harcourt" — what the importer read differently. */
  corrections?: string[];
  password?: string;
  studentCode?: string | null;
  emailed?: boolean;
  /** True when this row had no email and one was minted to create the account. */
  placeholderEmail?: boolean;
};

const TEMPLATE_HEADERS = ["name", "email", "phone", "branch", "level", "batch", "session", "type_of_class", "amount_paid"];

const SAMPLE = `name,email,phone,branch,level,batch,session,type_of_class,amount_paid
Chidi Okafor,chidi@example.com,08031234567,Lagos,B1,May,morning,physical,150000
Aisha Bello,,08039876543,,A2,June,weekend,online,108000`;

/**
 * Bringing existing students onto the LMS.
 *
 * Written for launch day, when the school already has people three weeks into
 * B1 who have paid most of their fee. A CSV goes in; everyone is previewed
 * before anything is written; and the generated passwords come back so the
 * office can hand out logins.
 */

/** Minimal CSV parse — enough for quoted fields and commas inside them. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += char;
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows.filter((entry) => entry.some((cell) => cell.trim()));
  if (!header) return [];
  const aliases: Record<string, string> = {
    name: "name",
    names: "name",
    student: "name",
    student_name: "name",
    student_names: "name",
    full_name: "name",
    fullname: "name",
    name_of_student: "name",
    name_of_students: "name",
    email: "email",
    email_address: "email",
    email_id: "email",
    email_address_of_student: "email",
    mail: "email",
    e_mail: "email",
  };
  const keys = header.map((cell) => {
    const normalized = cell.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    return aliases[normalized] ?? normalized;
  });
  return body.map((cells) =>
    Object.fromEntries(keys.map((key, index) => [key, (cells[index] ?? "").trim()])),
  );
}

const STATUS_STYLES: Record<ImportResult["status"], string> = {
  ready: "bg-sky-500/10 text-sky-700",
  created: "bg-emerald-500/10 text-emerald-700",
  skipped: "bg-[var(--surface-alt)]0/10 text-[var(--muted)]",
  error: "bg-rose-500/10 text-rose-700",
};

export default function ImportStudentsPage() {
  const [csv, setCsv] = useState("");
  const [results, setResults] = useState<ImportResult[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [previewed, setPreviewed] = useState(false);
  const [imported, setImported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sendState, setSendState] = useState<"idle" | "sending" | "done">("idle");

  const rows = useMemo(() => parseCsv(csv), [csv]);

  // Email is no longer required to identify a row — a school's own sheet
  // often carries a phone number and nothing else, and the importer mints a
  // placeholder account for those (see the importer's placeholderEmail note).
  // Only a missing NAME column is worth stopping the office over.
  const importHeaderWarning = csv.trim() && rows.length > 0 && rows.every((row) => !row.name)
    ? "We could not confidently identify a student-name column. Rename the header to Name, or use the supported aliases below."
    : "";

  async function run(dryRun: boolean) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/students/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, dryRun }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Import failed");
      setResults(payload.results || []);
      setCounts(payload.counts || {});
      setPreviewed(true);
      if (!dryRun) {
        setImported(true);
        setSendState("idle");
      }
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  /**
   * The CSV importer's version of the "send it now?" prompt.
   *
   * Skips a placeholder-email row — sending its login to
   * `noemail.xxxx@students.placeholder…` reaches nobody, and Brevo has no
   * reason to know that address is expected to bounce.
   */
  async function sendLogins() {
    const toSend = results.filter((r) => r.status === "created" && r.password && !r.placeholderEmail);
    if (toSend.length === 0) return;
    setSendState("sending");
    try {
      const response = await fetch("/api/admin/students/send-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          students: toSend.map((r) => ({ name: r.name, email: r.email, password: r.password, studentCode: r.studentCode })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      const emailedByAddress = new Set(
        (data.results ?? []).filter((r: { email: string; emailed: boolean }) => r.emailed).map((r: { email: string }) => r.email),
      );
      setResults((rows) => rows.map((row) => (emailedByAddress.has(row.email) ? { ...row, emailed: true } : row)));
    } finally {
      setSendState("done");
    }
  }

  function downloadPasswords() {
    const created = results.filter((result) => result.status === "created");
    const body = [
      "name,email,student_code,temporary_password",
      ...created.map((r) => `"${r.name}","${r.email}","${r.studentCode ?? ""}","${r.password ?? ""}"`),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "easyway-imported-logins.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  const readyCount = results.filter((r) => r.status === "ready").length;

  return (
    <AdminShell>
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div>
          <Link href="/admin/students" className="inline-flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
            <ArrowLeftIcon /> Back to students
          </Link>
          <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">Import existing students</h1>
          <p className="mt-2 max-w-3xl text-[var(--muted)]">
            For students who started classes before the portal existed. Include their <strong>branch</strong>, their{" "}
            <strong>batch month</strong> and anything they have <strong>already paid</strong> — without those the
            timetable, the level-end date and the paywall all get it wrong. <strong>Email is optional</strong> — a row
            with only a phone number still creates the account, with a placeholder email you can replace later from
            the student&apos;s own profile page.
          </p>
        </div>

        {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[var(--foreground)]">Paste your CSV</h2>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setCsv(SAMPLE)}
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--foreground)]"
              >
                Fill in an example
              </button>
              <label className="cursor-pointer rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--foreground)]">
                Choose a .xlsx or .csv file
                <input
                  type="file"
                  accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setError("");
                    setPreviewed(false);
                    setImported(false);
                    try {
                      // Excel is what offices actually keep lists in. Reading
                      // it here rather than telling somebody to "save as CSV
                      // first" removes a step that gets skipped, or done wrong
                      // — a Nigerian-locale Excel writes semicolons, and CSV
                      // export eats the leading zero off every phone number.
                      if (/\.xlsx$/i.test(file.name)) {
                        const rows = parseXlsx(await file.arrayBuffer());
                        if (rows.length === 0) {
                          setError("That spreadsheet has no rows under its header.");
                          return;
                        }
                        setCsv(rowsToCsv(rows));
                      } else {
                        setCsv(await file.text());
                      }
                    } catch (readError) {
                      setError(
                        readError instanceof SpreadsheetError
                          ? readError.message
                          : "That file could not be read.",
                      );
                    } finally {
                      // Clearing the input lets the same file be re-picked
                      // after a fix, which otherwise fires no change event.
                      event.target.value = "";
                    }
                  }}
                />
              </label>
            </div>
          </div>

          <p className="mt-2 text-xs text-[var(--muted)]">
            Columns: <code>{TEMPLATE_HEADERS.join(", ")}</code>. The importer also understands common headers such as
            <code> Name of Students</code>, <code>Student Name</code>, <code>Full Name</code>, <code>Type of Class</code> (
            physical / online / hybrid), and <code>Session</code> (morning / afternoon / evening / weekend). Only name is
            required; everything else improves what the account can do, and spelling does not have to be exact — the
            importer reads "portharcourt" as Port Harcourt and "150K" as ₦150,000 and shows you every correction it made.
            An .xlsx file is read from its first sheet and shown below as text, so you can check it before anything is
            written.
          </p>

          <textarea
            value={csv}
            onChange={(event) => {
              setCsv(event.target.value);
              setPreviewed(false);
              setImported(false);
            }}
            placeholder={SAMPLE}
            className="mt-4 min-h-[180px] w-full rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 font-mono text-xs text-[var(--foreground)] placeholder-[var(--muted)]"
          />

          {importHeaderWarning ? <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">{importHeaderWarning}</p> : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={() => run(true)}
              disabled={busy || rows.length === 0}
              className="rounded-lg border border-[var(--border)] px-6 py-2.5 text-sm font-semibold text-[var(--foreground)] disabled:opacity-50"
            >
              {busy ? "Checking…" : `Preview ${rows.length || ""} row${rows.length === 1 ? "" : "s"}`}
            </button>
            <button
              onClick={() => run(false)}
              disabled={busy || !previewed || imported || readyCount === 0}
              className="rounded-lg bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {imported ? "Imported" : `Import ${readyCount} student${readyCount === 1 ? "" : "s"}`}
            </button>
            {/* Nothing is written until the office has seen the preview. */}
            {!previewed && rows.length > 0 ? (
              <span className="text-xs text-[var(--muted)]">Preview first — nothing is saved until you do.</span>
            ) : null}
          </div>
        </div>

        {results.length > 0 ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-[var(--foreground)]">
                {imported ? "Import results" : "Preview"}
              </h2>
              <div className="flex flex-wrap gap-2">
                {Object.entries(counts).map(([status, count]) => (
                  <span
                    key={status}
                    className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[status as ImportResult["status"]] ?? ""}`}
                  >
                    {count} {status}
                  </span>
                ))}
              </div>
            </div>

            {imported && counts.created ? (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                <p className="font-semibold">Download the logins before you leave this page</p>
                <p className="mt-1">
                  Temporary passwords are shown once and never stored in readable form. Students should change theirs on
                  first sign-in.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    onClick={downloadPasswords}
                    className="rounded-full bg-emerald-600 px-5 py-2 text-xs font-semibold text-white"
                  >
                    Download logins CSV
                  </button>
                  <button
                    onClick={() => void sendLogins()}
                    disabled={sendState === "sending"}
                    className="rounded-full border border-emerald-600 px-5 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
                  >
                    {sendState === "sending"
                      ? "Sending…"
                      : sendState === "done"
                        ? "Send login emails again"
                        : "Send everyone their login emails now?"}
                  </button>
                  {sendState === "done" ? (
                    <span className="text-xs text-emerald-800">
                      {results.filter((r) => r.status === "created" && r.emailed).length} of {counts.created ?? 0} emailed.
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--surface-alt)] text-xs uppercase tracking-wide text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Student</th>
                    <th className="px-3 py-2">Branch</th>
                    <th className="px-3 py-2">Level</th>
                    <th className="px-3 py-2">Batch</th>
                    <th className="px-3 py-2">Paid</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((result) => (
                    <tr key={result.row} className="border-t border-[var(--border)]/60">
                      <td className="px-3 py-2 text-[var(--muted)]">{result.row}</td>
                      <td className="px-3 py-2">
                        <p className="font-medium text-[var(--foreground)]">{result.name || "—"}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {result.placeholderEmail ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                              No email — placeholder account
                            </span>
                          ) : (
                            result.email
                          )}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-[var(--muted)]">{result.branch || "—"}</td>
                      <td className="px-3 py-2 text-[var(--muted)]">{result.level}</td>
                      <td className="px-3 py-2 text-[var(--muted)]">{result.batch || "—"}</td>
                      <td className="px-3 py-2 text-[var(--muted)]">
                        {result.amountPaid ? `₦${result.amountPaid.toLocaleString()}` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[result.status]}`}>
                          {result.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--muted)]">
                        {result.note}
                        {/* Every spelling the importer read differently, shown
                            on the row it happened to. A file that says
                            "portharcourt" now imports — but the admin is told
                            it was read as Port Harcourt, because an importer
                            that quietly reinterprets your data is worse than
                            one that rejects it: the rejection you notice. */}
                        {result.corrections?.length ? (
                          <span className="mt-1 flex flex-wrap gap-1">
                            {result.corrections.map((correction) => (
                              <span
                                key={correction}
                                className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
                              >
                                {correction}
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </AdminShell>
  );
}
