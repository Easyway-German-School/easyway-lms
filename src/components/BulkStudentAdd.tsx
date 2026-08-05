"use client";

import { useMemo, useState } from "react";
import { AlertIcon, CheckCircleIcon, UserPlusIcon, UsersIcon } from "@/components/icons";

/**
 * Enrolling a whole class in one go.
 *
 * There was already a CSV importer, and it is the right tool when the office
 * has a spreadsheet. It is the wrong tool for the far more common job: a tutor
 * hands over a list of fourteen names and emails and somebody has to type them
 * into a one-student-at-a-time form fourteen times.
 *
 * So this takes a paste. One student per line, and every separator an office
 * actually uses is accepted — comma, tab, semicolon, or "Name <email>" the way
 * a mail client writes it. Level, branch and session are chosen once and apply
 * to the lot, because a pasted list is nearly always one class.
 *
 * It posts to the existing /api/admin/students/import, which already knows how
 * to dry-run a preview, skip people who have accounts, mint student codes and
 * hand back the generated passwords. Nothing here duplicates that.
 */

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
const SLOTS = ["morning", "afternoon", "evening"] as const;

type ParsedRow = { line: number; name: string; email: string; raw: string; problem: string | null };

type ResultRow = {
  row: number;
  name: string;
  email: string;
  level: string;
  status: "ready" | "created" | "skipped" | "error";
  note: string;
  password?: string;
  studentCode?: string | null;
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * One line in, one student out.
 *
 * The email is found by looking for the token that contains an "@" rather than
 * by counting columns, so "Ada Obi, ada@x.com" and "ada@x.com Ada Obi" and
 * "Ada Obi <ada@x.com>" all land the same way. Everything else on the line is
 * the name.
 */
export function parseLine(raw: string, line: number): ParsedRow | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const angled = trimmed.match(/^(.*)<\s*([^>]+)\s*>$/);
  if (angled) {
    const name = angled[1].trim().replace(/^["']|["']$/g, "");
    const email = angled[2].trim().toLowerCase();
    return { line, name, email, raw: trimmed, problem: emailProblem(name, email) };
  }

  const parts = trimmed
    .split(/[,;\t]+|\s{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  const pool = parts.length > 1 ? parts : trimmed.split(/\s+/).filter(Boolean);
  const emailIndex = pool.findIndex((part) => part.includes("@"));

  if (emailIndex === -1) {
    return { line, name: trimmed, email: "", raw: trimmed, problem: "No email on this line" };
  }

  const email = pool[emailIndex].replace(/[<>,;]/g, "").toLowerCase();
  const name = pool
    .filter((_, index) => index !== emailIndex)
    .join(" ")
    .trim();

  return { line, name, email, raw: trimmed, problem: emailProblem(name, email) };
}

function emailProblem(name: string, email: string): string | null {
  if (!EMAIL.test(email)) return "That does not look like an email address";
  if (!name) return "No name on this line";
  return null;
}

export default function BulkStudentAdd({
  branches,
  onImported,
}: {
  branches: Array<{ id: string; name: string }>;
  onImported?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [level, setLevel] = useState<string>("A1");
  const [branchId, setBranchId] = useState("");
  const [sessionSlot, setSessionSlot] = useState<string>("morning");
  const [batch, setBatch] = useState("");

  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ResultRow[] | null>(null);
  const [created, setCreated] = useState<ResultRow[] | null>(null);
  const [error, setError] = useState("");

  const parsed = useMemo(() => {
    return text
      .split(/\r?\n/)
      .map((line, index) => parseLine(line, index + 1))
      .filter((row): row is ParsedRow => row !== null);
  }, [text]);

  const valid = parsed.filter((row) => !row.problem);
  const invalid = parsed.filter((row) => row.problem);

  // Duplicates within the paste itself — pasting a list twice is easy to do.
  const duplicates = useMemo(() => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const row of valid) {
      if (seen.has(row.email)) dupes.add(row.email);
      seen.add(row.email);
    }
    return dupes;
  }, [valid]);

  const branchName = branches.find((b) => b.id === branchId)?.name ?? "";

  function buildRows() {
    const seen = new Set<string>();
    return valid
      .filter((row) => {
        if (seen.has(row.email)) return false;
        seen.add(row.email);
        return true;
      })
      .map((row) => ({
        name: row.name,
        email: row.email,
        level,
        branch: branchName,
        session: sessionSlot,
        batch,
      }));
  }

  async function run(dryRun: boolean) {
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/admin/students/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: buildRows(), dryRun }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "That import could not be run.");
        return;
      }

      if (dryRun) {
        setPreview(data.results ?? []);
        setCreated(null);
      } else {
        setCreated(data.results ?? []);
        setPreview(null);
        onImported?.();
      }
    } catch {
      setError("Network problem — nothing was imported.");
    } finally {
      setBusy(false);
    }
  }

  function downloadLogins(rows: ResultRow[]) {
    const made = rows.filter((row) => row.status === "created" && row.password);
    if (made.length === 0) return;
    const csv = [
      "name,email,student_code,password",
      ...made.map((row) =>
        [row.name, row.email, row.studentCode ?? "", row.password ?? ""]
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ].join("\n");

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "easyway-new-logins.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    setText("");
    setPreview(null);
    setCreated(null);
    setError("");
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full border border-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)]/10"
      >
        <UsersIcon className="h-4 w-4" />
        Add many at once
      </button>
    );
  }

  const madeCount = created?.filter((r) => r.status === "created").length ?? 0;
  const skippedCount = created?.filter((r) => r.status === "skipped").length ?? 0;

  return (
    <div className="w-full rounded-[28px] border border-[var(--border)] bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <UsersIcon className="h-5 w-5 text-[var(--accent)]" />
            Add many students at once
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Paste one student per line. Name and email in any order — commas, tabs or
            <span className="font-mono text-xs"> Name &lt;email&gt;</span> all work.
          </p>
        </div>
        <button
          onClick={() => {
            setOpen(false);
            reset();
          }}
          className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-500 transition hover:bg-slate-50"
        >
          Close
        </button>
      </div>

      {created ? (
        <div className="mt-5">
          <div className="flex items-start gap-3 rounded-2xl bg-emerald-500/10 p-4 text-emerald-700">
            <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">
                {madeCount} student{madeCount === 1 ? "" : "s"} enrolled
                {skippedCount > 0 ? `, ${skippedCount} already had an account` : ""}.
              </p>
              <p className="mt-1 text-sm">
                Each new account has a temporary password. Download them now — they are not shown again.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={() => downloadLogins(created)}
              disabled={madeCount === 0}
              className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-[var(--accent)]/20 transition hover:brightness-110 disabled:opacity-40"
            >
              Download logins CSV
            </button>
            <button
              onClick={reset}
              className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              Add another batch
            </button>
          </div>

          <div className="mt-5 max-h-64 overflow-y-auto rounded-2xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Student</th>
                  <th className="px-3 py-2">Student ID</th>
                  <th className="px-3 py-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {created.map((row) => (
                  <tr key={`${row.row}-${row.email}`} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <span className="font-medium text-slate-800">{row.name}</span>
                      <span className="block text-xs text-slate-500">{row.email}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">{row.studentCode ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          row.status === "created"
                            ? "bg-emerald-500/10 text-emerald-600"
                            : row.status === "skipped"
                              ? "bg-amber-500/10 text-amber-600"
                              : "bg-red-500/10 text-red-600"
                        }`}
                      >
                        {row.note}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Level</span>
              <select
                value={level}
                onChange={(event) => setLevel(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
              >
                {LEVELS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Branch</span>
              <select
                value={branchId}
                onChange={(event) => setBranchId(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
              >
                <option value="">No branch</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Session</span>
              <select
                value={sessionSlot}
                onChange={(event) => setSessionSlot(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm capitalize"
              >
                {SLOTS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Batch month
              </span>
              <input
                value={batch}
                onChange={(event) => setBatch(event.target.value)}
                placeholder="e.g. JUL 2026"
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
              />
            </label>
          </div>

          <p className="mt-2 text-xs text-slate-500">
            The batch month is what the timetable and the level-end date are worked out from. Without it these
            students will have neither.
          </p>

          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={8}
            spellCheck={false}
            placeholder={"Ada Obi, ada.obi@example.com\nTunde Bello <tunde@example.com>\nchidi@example.com  Chidi Nwosu"}
            className="mt-4 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-4 font-mono text-sm outline-none transition focus:border-[var(--accent)] focus:bg-white"
          />

          {parsed.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <span className="rounded-full bg-emerald-500/10 px-3 py-1.5 font-semibold text-emerald-600">
                {valid.length - duplicates.size} ready
              </span>
              {duplicates.size > 0 && (
                <span className="rounded-full bg-amber-500/10 px-3 py-1.5 font-semibold text-amber-600">
                  {duplicates.size} duplicate{duplicates.size === 1 ? "" : "s"} in the paste, ignored
                </span>
              )}
              {invalid.length > 0 && (
                <span className="rounded-full bg-red-500/10 px-3 py-1.5 font-semibold text-red-600">
                  {invalid.length} line{invalid.length === 1 ? "" : "s"} need fixing
                </span>
              )}
            </div>
          )}

          {invalid.length > 0 && (
            <ul className="mt-3 space-y-1 rounded-2xl bg-red-500/5 p-4 text-sm text-red-700">
              {invalid.slice(0, 6).map((row) => (
                <li key={row.line}>
                  <span className="font-mono text-xs">line {row.line}</span> — {row.problem}:{" "}
                  <span className="opacity-70">{row.raw.slice(0, 60)}</span>
                </li>
              ))}
              {invalid.length > 6 && <li className="opacity-70">…and {invalid.length - 6} more</li>}
            </ul>
          )}

          {error && (
            <p className="mt-3 flex items-center gap-2 rounded-2xl bg-red-500/10 px-4 py-3 text-sm font-medium text-red-600">
              <AlertIcon className="h-4 w-4" />
              {error}
            </p>
          )}

          {preview && (
            <div className="mt-4 max-h-56 overflow-y-auto rounded-2xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Student</th>
                    <th className="px-3 py-2">What will happen</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row) => (
                    <tr key={`${row.row}-${row.email}`} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <span className="font-medium text-slate-800">{row.name}</span>
                        <span className="block text-xs text-slate-500">{row.email}</span>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={() => run(true)}
              disabled={busy || valid.length === 0}
              className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
            >
              {busy ? "Checking…" : "Preview"}
            </button>
            <button
              onClick={() => run(false)}
              disabled={busy || valid.length === 0}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-[var(--accent)]/20 transition hover:brightness-110 disabled:opacity-40"
            >
              <UserPlusIcon className="h-4 w-4" />
              {busy
                ? "Enrolling…"
                : `Enrol ${valid.length - duplicates.size} student${valid.length - duplicates.size === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
