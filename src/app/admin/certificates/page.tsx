"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useState } from "react";
import AdminShell from "@/components/AdminShell";
import CertificateDocument from "@/components/CertificateDocument";
import {
  CERTIFICATE_TOKENS,
  DEFAULT_CERTIFICATE_TEMPLATE,
  type CertificateTemplate,
} from "@/lib/certificate-template";
import type { CertificateView } from "@/lib/certificates";

/**
 * The certificate desk.
 *
 * Two jobs on one screen, deliberately: what the document says, and who gets
 * one. They belong together because the second is the reason anybody opens the
 * first — an office proofreads the wording precisely when it is about to send
 * forty of them, and a preview on a different page would be read once and then
 * trusted.
 *
 * The preview is the REAL <CertificateDocument />, not a mock-up. Every edit
 * re-renders the same component the student prints, so what is approved here is
 * what goes out.
 */

type Branch = { id: string; name: string };

type PreviewResult = {
  preview: true;
  matched: number;
  willIssue: number;
  alreadyHave: number;
  sample: Array<{ id: string; name: string; email: string; level: string; branch: string }>;
};

type IssueResult = {
  preview: false;
  matched: number;
  issued: number;
  created: number;
  skipped: Array<{ id: string; name: string; reason: string }>;
};

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

/** A believable stand-in so the preview shows a full document, never a blank form. */
const SAMPLE_CERTIFICATE: CertificateView = {
  id: "preview",
  kind: "completion",
  title: "Certificate of Participation",
  level: "A1",
  award: "participation",
  awardLabel: "Participation",
  citation: "",
  serial: "EW/CERT/2026/A1/0007",
  verifyCode: "PREVIEW7",
  averageScore: 78,
  passed: true,
  studentName: "Elabor Anita Edose",
  studentCode: "EW-A1-0007",
  branchName: "Lagos",
  tutorName: "Frau Müller",
  issuedAt: new Date().toISOString(),
  courseStart: new Date(2026, 6, 19).toISOString(),
  courseEnd: new Date(2026, 8, 22).toISOString(),
  revoked: false,
  provisional: false,
  outstanding: 0,
};

function Field({
  label,
  value,
  onChange,
  hint,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  hint?: string;
  multiline?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={2}
          className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
        />
      )}
      {hint && <span className="mt-1 block text-[11px] text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[var(--accent)]"
      />
      <span className="text-sm font-semibold">{label}</span>
    </label>
  );
}

export default function AdminCertificatesPage() {
  const [template, setTemplate] = useState<CertificateTemplate>(DEFAULT_CERTIFICATE_TEMPLATE);
  const [customised, setCustomised] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [scope, setScope] = useState<"student" | "level" | "branch" | "all">("level");
  const [level, setLevel] = useState("A1");
  const [branchId, setBranchId] = useState("");
  const [studentQuery, setStudentQuery] = useState("");
  const [studentId, setStudentId] = useState("");
  const [studentMatches, setStudentMatches] = useState<Array<{ id: string; name: string; email: string; level: string }>>([]);
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<IssueResult | null>(null);
  const [issuing, setIssuing] = useState(false);

  const set = useCallback(
    <K extends keyof CertificateTemplate>(key: K, value: CertificateTemplate[K]) => {
      setTemplate((current) => ({ ...current, [key]: value }));
      setMessage(null);
    },
    [],
  );

  useEffect(() => {
    (async () => {
      try {
        const [templateRes, branchRes] = await Promise.all([
          fetch("/api/admin/certificates/template", { cache: "no-store" }),
          fetch("/api/admin/branches", { cache: "no-store" }),
        ]);
        if (templateRes.ok) {
          const data = await templateRes.json();
          setTemplate(data.template);
          setCustomised(Boolean(data.customised));
        }
        if (branchRes.ok) {
          const data = await branchRes.json();
          setBranches(data.branches ?? []);
        }
      } catch {
        setError("Could not load the certificate settings");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Student lookup for the single-student scope. Reuses the roster search that
  // already exists rather than adding a second one that could disagree with it.
  useEffect(() => {
    if (scope !== "student" || studentQuery.trim().length < 2) {
      setStudentMatches([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const url = new URL("/api/admin/students", window.location.origin);
        url.searchParams.set("search", studentQuery.trim());
        url.searchParams.set("pageSize", "10");
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setStudentMatches(
          (data.students ?? []).map((student: { id: string; level: string; user: { name?: string; email: string } }) => ({
            id: student.id,
            name: student.user?.name ?? "Unnamed",
            email: student.user?.email ?? "",
            level: student.level,
          })),
        );
      } catch {
        /* a failed lookup just shows no matches */
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scope, studentQuery]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/certificates/template", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template }),
      });
      if (!res.ok) throw new Error("Could not save the template");
      const data = await res.json();
      setTemplate(data.template);
      setCustomised(true);
      setMessage("Saved. Every certificate printed from now on uses this wording.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the template");
    } finally {
      setSaving(false);
    }
  }

  async function resetTemplate() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/certificates/template", { method: "DELETE" });
      if (res.ok) {
        const data = await res.json();
        setTemplate(data.template);
        setCustomised(false);
        setMessage("Reset to the school's printed original.");
      }
    } finally {
      setSaving(false);
    }
  }

  const audience = useMemo(
    () => ({
      scope,
      level: scope === "level" || (scope === "branch" && level) ? level : null,
      branchId: scope === "branch" ? branchId : null,
      studentId: scope === "student" ? studentId : null,
      onlyMissing,
    }),
    [scope, level, branchId, studentId, onlyMissing],
  );

  async function runPreview() {
    setIssuing(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/certificates/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(audience),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not work out who this reaches");
      setPreview(data);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Could not preview");
    } finally {
      setIssuing(false);
    }
  }

  async function confirmIssue() {
    setIssuing(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/certificates/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...audience, confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not issue");
      setResult(data);
      setPreview(null);
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : "Could not issue");
    } finally {
      setIssuing(false);
    }
  }

  // The preview certificate follows the level being issued, so the person
  // proofreading sees the document the cohort in front of them will get.
  const previewCert = useMemo<CertificateView>(
    () => ({ ...SAMPLE_CERTIFICATE, level: scope === "all" ? SAMPLE_CERTIFICATE.level : level }),
    [level, scope],
  );

  return (
    <AdminShell>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Admin</p>
          <h1 className="text-3xl font-black tracking-tight">Certificates</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            What the document says, and who gets one. The preview below is the real certificate — not a mock-up.
          </p>
        </div>

        {error && <div className="rounded-3xl border border-red-300 bg-red-50 p-5 text-sm text-red-700">{error}</div>}
        {message && (
          <div className="rounded-3xl border border-emerald-300 bg-emerald-50 p-5 text-sm text-emerald-800">{message}</div>
        )}

        {/* ---- Live preview ---- */}
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-soft)] p-4 shadow-sm sm:p-6">
          <div className="mx-auto max-w-4xl">
            <CertificateDocument certificate={previewCert} template={template} />
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          {/* ---- Editor ---- */}
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-soft)] p-6 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-sm font-bold uppercase tracking-[0.18em]">Design and wording</h2>
              <span className="text-xs text-[var(--muted)]">
                {customised ? "Customised" : "School default"}
              </span>
            </div>

            {loading ? (
              <p className="mt-5 text-sm text-[var(--muted)]">Loading…</p>
            ) : (
              <div className="mt-5 space-y-4">
                <Field label="School name" value={template.schoolName} onChange={(v) => set("schoolName", v)} />
                <Field label="Address line" value={template.addressLine} onChange={(v) => set("addressLine", v)} />
                <Field
                  label="Registration line"
                  value={template.registrationLine}
                  onChange={(v) => set("registrationLine", v)}
                  hint="Leave blank to hide it."
                />

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="German title" value={template.germanTitle} onChange={(v) => set("germanTitle", v)} />
                  <Field label="English title" value={template.englishTitle} onChange={(v) => set("englishTitle", v)} />
                </div>

                <Field label="Opening line" value={template.certifyLine} onChange={(v) => set("certifyLine", v)} />
                <Field label="Second line" value={template.courseLine} onChange={(v) => set("courseLine", v)} />
                <Field
                  label="Course line"
                  value={template.completionLine}
                  onChange={(v) => set("completionLine", v)}
                  hint="Tokens allowed — see the list below."
                />
                <Field
                  label="Closing sentence"
                  value={template.closingLine}
                  onChange={(v) => set("closingLine", v)}
                  multiline
                />

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Left signatory name"
                    value={template.leftSignatoryName}
                    onChange={(v) => set("leftSignatoryName", v)}
                    hint="Drawn in script unless an image is set."
                  />
                  <Field
                    label="Left signatory title"
                    value={template.leftSignatoryRole}
                    onChange={(v) => set("leftSignatoryRole", v)}
                  />
                  <Field
                    label="Right signatory name"
                    value={template.rightSignatoryName}
                    onChange={(v) => set("rightSignatoryName", v)}
                  />
                  <Field
                    label="Right signatory title"
                    value={template.rightSignatoryRole}
                    onChange={(v) => set("rightSignatoryRole", v)}
                    hint="Clear both fields to remove the block entirely."
                  />
                  <Field
                    label="Left signature image URL"
                    value={template.leftSignatureUrl}
                    onChange={(v) => set("leftSignatureUrl", v)}
                  />
                  <Field
                    label="Right signature image URL"
                    value={template.rightSignatureUrl}
                    onChange={(v) => set("rightSignatureUrl", v)}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Seal top word" value={template.sealTopText} onChange={(v) => set("sealTopText", v)} />
                  <Field
                    label="Seal bottom word"
                    value={template.sealBottomText}
                    onChange={(v) => set("sealBottomText", v)}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                      Accent colour
                    </span>
                    <div className="mt-1.5 flex items-center gap-2">
                      <input
                        type="color"
                        value={template.accentColor}
                        onChange={(event) => set("accentColor", event.target.value)}
                        className="h-9 w-12 cursor-pointer rounded border border-[var(--border)]"
                      />
                      <input
                        value={template.accentColor}
                        onChange={(event) => set("accentColor", event.target.value)}
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                      />
                    </div>
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">Ink colour</span>
                    <div className="mt-1.5 flex items-center gap-2">
                      <input
                        type="color"
                        value={template.inkColor}
                        onChange={(event) => set("inkColor", event.target.value)}
                        className="h-9 w-12 cursor-pointer rounded border border-[var(--border)]"
                      />
                      <input
                        value={template.inkColor}
                        onChange={(event) => set("inkColor", event.target.value)}
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                      />
                    </div>
                  </label>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <Toggle label="German flag bar" checked={template.showFlagBar} onChange={(v) => set("showFlagBar", v)} />
                  <Toggle label="Gold seal" checked={template.showSeal} onChange={(v) => set("showSeal", v)} />
                  <Toggle
                    label="Engraved ground"
                    checked={template.showGuilloche}
                    onChange={(v) => set("showGuilloche", v)}
                  />
                  <Toggle
                    label="Verification line"
                    checked={template.showVerifyBlock}
                    onChange={(v) => set("showVerifyBlock", v)}
                  />
                </div>

                <div className="rounded-2xl bg-[var(--accent)]/5 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                    Tokens you can type into any line
                  </p>
                  <div className="mt-2 grid gap-1 sm:grid-cols-2">
                    {CERTIFICATE_TOKENS.map((entry) => (
                      <p key={entry.token} className="text-xs text-[var(--muted)]">
                        <code className="rounded bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--foreground)]">
                          {entry.token}
                        </code>{" "}
                        {entry.describes}
                      </p>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saving}
                    className="rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                  >
                    {saving ? "Saving…" : "Save template"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void resetTemplate()}
                    disabled={saving || !customised}
                    className="rounded-full border border-[var(--border)] px-6 py-2.5 text-sm font-semibold disabled:opacity-50"
                  >
                    Reset to default
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ---- Issue ---- */}
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-soft)] p-6 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-[0.18em]">Issue certificates</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Students used to have to mint their own by opening their certificates page, so whoever never looked never
              had one. Pick who, check the count, then confirm.
            </p>

            <div className="mt-5 space-y-4">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { id: "student", label: "One student" },
                    { id: "level", label: "A level" },
                    { id: "branch", label: "A branch" },
                    { id: "all", label: "Everyone" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setScope(option.id);
                      setPreview(null);
                      setResult(null);
                    }}
                    className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                      scope === option.id
                        ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-alt)]"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {scope === "student" && (
                <div>
                  <input
                    value={studentQuery}
                    onChange={(event) => {
                      setStudentQuery(event.target.value);
                      setStudentId("");
                    }}
                    placeholder="Search by name or email"
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                  />
                  {studentMatches.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {studentMatches.map((student) => (
                        <button
                          key={student.id}
                          type="button"
                          onClick={() => {
                            setStudentId(student.id);
                            setStudentQuery(student.name);
                            setStudentMatches([]);
                          }}
                          className="block w-full rounded-xl border border-[var(--border)] px-3 py-2 text-left text-sm hover:bg-[var(--accent)]/5"
                        >
                          <span className="font-semibold">{student.name}</span>{" "}
                          <span className="text-xs text-[var(--muted)]">
                            {student.email} · {student.level}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {studentId && <p className="mt-2 text-xs font-semibold text-emerald-700">Student selected.</p>}
                </div>
              )}

              {(scope === "level" || scope === "branch") && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {scope === "branch" && (
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">Branch</span>
                      <select
                        value={branchId}
                        onChange={(event) => setBranchId(event.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                      >
                        <option value="">Select a branch</option>
                        {branches.map((branch) => (
                          <option key={branch.id} value={branch.id}>
                            {branch.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                      Level {scope === "branch" ? "(optional)" : ""}
                    </span>
                    <select
                      value={level}
                      onChange={(event) => setLevel(event.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                    >
                      {scope === "branch" && <option value="">Every level</option>}
                      {LEVELS.map((entry) => (
                        <option key={entry} value={entry}>
                          {entry}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              <Toggle
                label="Skip students who already have one for their level"
                checked={onlyMissing}
                onChange={setOnlyMissing}
              />

              <button
                type="button"
                onClick={() => void runPreview()}
                disabled={issuing || (scope === "student" && !studentId) || (scope === "branch" && !branchId)}
                className="rounded-full border border-[var(--border)] px-6 py-2.5 text-sm font-bold disabled:opacity-50"
              >
                {issuing ? "Checking…" : "Check who this reaches"}
              </button>

              {preview && (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
                  <p className="text-sm font-bold text-amber-900">
                    {preview.willIssue} certificate{preview.willIssue === 1 ? "" : "s"} will be issued
                  </p>
                  <p className="mt-1 text-xs text-amber-800">
                    {preview.matched} student{preview.matched === 1 ? "" : "s"} matched
                    {preview.alreadyHave > 0 ? `, ${preview.alreadyHave} already have one` : ""}. Students who have not
                    finished the course, or who still owe their deposit, are skipped automatically.
                  </p>
                  {preview.sample.length > 0 && (
                    <ul className="mt-3 max-h-40 space-y-0.5 overflow-y-auto text-xs text-amber-900">
                      {preview.sample.map((student) => (
                        <li key={student.id}>
                          {student.name} · {student.level} · {student.branch}
                        </li>
                      ))}
                      {preview.willIssue > preview.sample.length && (
                        <li className="font-semibold">…and {preview.willIssue - preview.sample.length} more</li>
                      )}
                    </ul>
                  )}
                  <button
                    type="button"
                    onClick={() => void confirmIssue()}
                    disabled={issuing || preview.willIssue === 0}
                    className="mt-4 rounded-full bg-amber-600 px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {issuing ? "Issuing…" : `Issue ${preview.willIssue} and notify`}
                  </button>
                </div>
              )}

              {result && (
                <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4">
                  <p className="text-sm font-bold text-emerald-900">
                    {result.created} issued, {result.issued - result.created} already existed
                  </p>
                  {result.skipped.length > 0 && (
                    <>
                      <p className="mt-2 text-xs font-semibold text-emerald-900">
                        {result.skipped.length} skipped:
                      </p>
                      <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-xs text-emerald-800">
                        {result.skipped.map((entry) => (
                          <li key={entry.id}>
                            {entry.name} — {entry.reason}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
