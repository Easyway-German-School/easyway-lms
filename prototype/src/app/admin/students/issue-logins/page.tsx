"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { ArrowLeftIcon } from "@/components/icons";
import { SpreadsheetError, parseXlsx } from "@/lib/spreadsheet";

/**
 * "Issue logins" — for students the office already enrolled from a phone-only
 * form, who therefore have a placeholder email nobody can type. Paste their
 * phone numbers (or drop the same spreadsheet the office works from), preview
 * who matches, then issue: each matched student gets their phone number as a
 * real login (`234…@student.easywayschoollms.com.ng`) and a fresh temporary
 * password. The passwords show once, here — download the sheet or copy the
 * ready-made WhatsApp message before leaving the page.
 */

type ResultRow = {
  input: string;
  name: string;
  studentCode?: string;
  level?: string;
  session?: string;
  branch?: string;
  loginEmail?: string;
  password?: string;
  status: "ready" | "done" | "not_found" | "shared_phone" | "has_real_email" | "email_clash" | "manual" | "error";
  note: string;
};

type ApiResponse = { commit: boolean; counts: Record<string, number>; results: ResultRow[] };

type InputRow = { phone: string; name?: string };

const LOGIN_URL = "https://easywayschoollms.com.ng/auth/login";

const STATUS_LABEL: Record<ResultRow["status"], string> = {
  ready: "Ready",
  done: "Login issued",
  not_found: "Not found",
  shared_phone: "Shared number",
  has_real_email: "Has real email",
  email_clash: "Login taken",
  manual: "Do by hand",
  error: "Error",
};

const STATUS_TONE: Record<ResultRow["status"], string> = {
  ready: "bg-blue-50 text-blue-700 border-blue-200",
  done: "bg-green-50 text-green-700 border-green-200",
  not_found: "bg-amber-50 text-amber-800 border-amber-200",
  shared_phone: "bg-amber-50 text-amber-800 border-amber-200",
  has_real_email: "bg-amber-50 text-amber-800 border-amber-200",
  email_clash: "bg-amber-50 text-amber-800 border-amber-200",
  manual: "bg-amber-50 text-amber-800 border-amber-200",
  error: "bg-red-50 text-red-700 border-red-200",
};

function messageFor(row: ResultRow): string {
  const firstName = (row.name || "there").split(/\s+/)[0];
  return (
    `Hi ${firstName}, here is your EasyWay School portal login:\n` +
    `Website: ${LOGIN_URL}\n` +
    `Email: ${row.loginEmail}\n` +
    `Password: ${row.password}\n` +
    `Please sign in and change your password under Profile.`
  );
}

/** Accepts pasted lines: "Name, 0803…" / "Name<tab>0803…" / bare "0803…". */
function parsePastedRows(text: string): InputRow[] {
  const out: InputRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\t|,/).map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    // The part with the most digits is the phone; the rest is the name.
    let phoneIdx = 0;
    let best = -1;
    parts.forEach((part, index) => {
      const digits = part.replace(/\D/g, "").length;
      if (digits > best) {
        best = digits;
        phoneIdx = index;
      }
    });
    if (best < 7) continue;
    const name = parts.filter((_, index) => index !== phoneIdx).join(" ");
    out.push({ phone: parts[phoneIdx], name: name || undefined });
  }
  return out;
}

export default function IssueLoginsPage() {
  const [rows, setRows] = useState<InputRow[]>([]);
  const [sourceLabel, setSourceLabel] = useState("");
  const [pasted, setPasted] = useState("");
  const [replaceRealEmails, setReplaceRealEmails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "commit">("");
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const issuedRows = useMemo(
    () => (response?.results ?? []).filter((row) => row.status === "done" && row.password),
    [response],
  );

  async function handleFile(file: File) {
    setError(null);
    try {
      const parsed = parseXlsx(await file.arrayBuffer());
      const mapped: InputRow[] = [];
      for (const record of parsed) {
        const phone =
          record.phone_number || record.phone || record.mobile || record.phone_no || record.msisdn || "";
        if (!phone) continue;
        mapped.push({ phone, name: record.name || record.full_name || record.student_name || undefined });
      }
      if (mapped.length === 0) {
        setError("No phone numbers found in that file. Expected a 'phone' or 'phone number' column.");
        return;
      }
      setRows(mapped);
      setSourceLabel(`${file.name} — ${mapped.length} row(s)`);
      setResponse(null);
    } catch (caught) {
      setError(caught instanceof SpreadsheetError ? caught.message : "Could not read that file.");
    }
  }

  function loadPasted() {
    setError(null);
    const parsed = parsePastedRows(pasted);
    if (parsed.length === 0) {
      setError("No usable rows. Put one student per line: name then phone number.");
      return;
    }
    setRows(parsed);
    setSourceLabel(`Pasted — ${parsed.length} row(s)`);
    setResponse(null);
  }

  async function run(commit: boolean) {
    if (rows.length === 0) return;
    if (
      commit &&
      !window.confirm(
        `Issue logins to ${rows.length} student(s)?\n\n` +
          `Each matched student's login email is set to their phone number and a new temporary ` +
          `password is generated. The passwords are shown once, on this screen — download or copy ` +
          `them before you leave.`,
      )
    ) {
      return;
    }
    setBusy(commit ? "commit" : "preview");
    setError(null);
    try {
      const res = await fetch("/api/admin/students/issue-phone-logins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, commit, force: replaceRealEmails }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }
      setResponse(data as ApiResponse);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy("");
    }
  }

  function downloadCsv() {
    if (!response) return;
    const header = ["name", "phone", "login_email", "temporary_password", "student_code", "level", "branch", "status", "note", "message"];
    const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
    const lines = [header.join(",")];
    for (const row of response.results) {
      lines.push(
        [
          row.name,
          row.input,
          row.loginEmail ?? "",
          row.password ?? "",
          row.studentCode ?? "",
          row.level ?? "",
          row.branch ?? "",
          STATUS_LABEL[row.status],
          row.note,
          row.status === "done" ? messageFor(row) : "",
        ]
          .map((cell) => escape(String(cell ?? "")))
          .join(","),
      );
    }
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `september-logins-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500);
    } catch {
      /* clipboard blocked — the CSV still carries every message */
    }
  }

  const previewed = response && !response.commit;
  const committed = response && response.commit;
  const actionable = (response?.results ?? []).filter((row) => row.status === "ready").length;

  return (
    <AdminShell>
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div>
          <Link
            href="/admin/students"
            className="inline-flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <ArrowLeftIcon /> Back to students
          </Link>
          <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">Issue logins</h1>
          <p className="mt-2 max-w-3xl text-[var(--muted)]">
            For students already enrolled from a phone-only form, who have a placeholder email nobody can
            type. Give the phone numbers below; each matched student gets <strong>their phone number as a
            login</strong> (e.g. <code className="text-xs">2348031234567@student.easywayschoollms.com.ng</code>)
            and a fresh temporary password. Passwords are shown once here — <strong>download the sheet</strong>{" "}
            before you leave, then send each student their line by WhatsApp or SMS.
          </p>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <h2 className="text-lg font-bold text-[var(--foreground)]">Upload the spreadsheet</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Any .xlsx with a <strong>phone</strong> column (and ideally a <strong>name</strong> column).
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              className="mt-3 block w-full text-sm text-[var(--muted)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--accent)] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <h2 className="text-lg font-bold text-[var(--foreground)]">…or paste</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">One student per line: name then phone.</p>
            <textarea
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
              rows={4}
              placeholder={"Okonkwo Maryann, 07055451630\nAfonoghara Henry, 08109405949"}
              className="mt-3 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-sm text-[var(--foreground)]"
            />
            <button
              type="button"
              onClick={loadPasted}
              className="mt-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--background)]"
            >
              Load pasted rows
            </button>
          </div>
        </div>

        {rows.length > 0 ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-[var(--foreground)]">{sourceLabel || `${rows.length} row(s)`}</h2>
                <p className="text-sm text-[var(--muted)]">
                  Preview first — nothing is written until you click <strong>Issue logins</strong>.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void run(false)}
                  disabled={busy !== ""}
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--background)] disabled:opacity-50"
                >
                  {busy === "preview" ? "Checking…" : "Preview"}
                </button>
                <button
                  type="button"
                  onClick={() => void run(true)}
                  disabled={busy !== "" || !previewed || actionable === 0}
                  title={!previewed ? "Preview first" : actionable === 0 ? "Nothing ready to issue" : ""}
                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {busy === "commit" ? "Issuing…" : `Issue logins${previewed ? ` (${actionable})` : ""}`}
                </button>
              </div>
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm text-[var(--muted)]">
              <input
                type="checkbox"
                checked={replaceRealEmails}
                onChange={(event) => setReplaceRealEmails(event.target.checked)}
              />
              Also replace real email addresses (for students who signed up themselves) — off by default
            </label>
          </div>
        ) : null}

        {response ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-[var(--foreground)]">
                {committed ? "Logins issued" : "Preview"}
                <span className="ml-2 text-sm font-normal text-[var(--muted)]">
                  {Object.entries(response.counts)
                    .map(([status, count]) => `${count} ${STATUS_LABEL[status as ResultRow["status"]] ?? status}`)
                    .join(" · ")}
                </span>
              </h2>
              {committed ? (
                <button
                  type="button"
                  onClick={downloadCsv}
                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                >
                  Download CSV ({issuedRows.length})
                </button>
              ) : null}
            </div>

            {committed && issuedRows.length > 0 ? (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                These passwords are not stored anywhere you can read them again. Download the CSV or copy the
                messages now.
              </p>
            ) : null}

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[var(--muted)]">
                    <th className="py-2 pr-3">Name</th>
                    <th className="py-2 pr-3">Phone</th>
                    <th className="py-2 pr-3">Login email</th>
                    <th className="py-2 pr-3">Password</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {response.results.map((row, index) => (
                    <tr key={`${row.input}-${index}`} className="border-b border-[var(--border)] align-top">
                      <td className="py-2 pr-3 text-[var(--foreground)]">{row.name || "—"}</td>
                      <td className="py-2 pr-3 text-[var(--muted)]">{row.input}</td>
                      <td className="py-2 pr-3 text-[var(--muted)]">{row.loginEmail ?? "—"}</td>
                      <td className="py-2 pr-3 font-mono text-[var(--foreground)]">{row.password ?? "—"}</td>
                      <td className="py-2 pr-3">
                        <span
                          className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[row.status]}`}
                        >
                          {STATUS_LABEL[row.status]}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-[var(--muted)]">
                        {row.status === "done" ? (
                          <button
                            type="button"
                            onClick={() => copy(messageFor(row), `${row.input}-${index}`)}
                            className="rounded border border-[var(--border)] px-2 py-1 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--background)]"
                          >
                            {copied === `${row.input}-${index}` ? "Copied" : "Copy message"}
                          </button>
                        ) : (
                          row.note
                        )}
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
