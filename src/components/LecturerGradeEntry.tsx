"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Entering marks for a class.
 *
 * The grading pages that existed all went through an exam sitting, so a tutor
 * could only record a score for a student who had booked one — which almost
 * nobody does. The marks a tutor gives out week to week are classwork,
 * speaking practice and mock papers, and there was no route by which any of
 * them could be recorded at all.
 *
 * This grades the roster the office assigned. The tutor opens it and their
 * students are already listed.
 */

type Row = {
  id: string;
  name: string;
  email: string;
  studentCode: string | null;
  level: string;
  sessionSlot: string;
  score: number | null;
  letter: string | null;
  feedback: string;
  gradedAt: string | null;
};

type Payload = {
  assigned: boolean;
  types: string[];
  type?: string;
  students: Row[];
  message?: string;
};

export default function LecturerGradeEntry() {
  const [data, setData] = useState<Payload | null>(null);
  const [type, setType] = useState("classwork");
  const [draft, setDraft] = useState<Record<string, { score: string; feedback: string }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/lecturer/grades/roster?type=${encodeURIComponent(type)}`, {
        cache: "no-store",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Could not load your class");
      setData(payload);
      // Seed the editable fields from what is already recorded, so a tutor
      // correcting one mark does not have to retype the other twenty.
      setDraft(
        Object.fromEntries(
          (payload.students ?? []).map((student: Row) => [
            student.id,
            { score: student.score === null ? "" : String(student.score), feedback: student.feedback ?? "" },
          ]),
        ),
      );
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load your class");
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    setSaved("");
    setError("");
    try {
      const res = await fetch("/api/lecturer/grades/roster", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type,
          grades: Object.entries(draft).map(([studentId, entry]) => ({
            studentId,
            score: entry.score === "" ? null : Number(entry.score),
            feedback: entry.feedback,
          })),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Could not save these marks");
      setSaved(
        payload.saved === 0
          ? "Nothing to save — enter a score first."
          : `Saved ${payload.saved} mark${payload.saved === 1 ? "" : "s"}. Your students have been notified.`,
      );
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save these marks");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-[var(--muted)]">Loading your class…</p>;

  if (data && !data.assigned) {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
        <p className="font-semibold">You have no class assigned yet</p>
        <p className="mt-1">{data.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          What are you marking?
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
            className="mt-1.5 block rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm font-normal normal-case tracking-normal capitalize text-[var(--foreground)]"
          >
            {(data?.types ?? []).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save marks"}
        </button>

        <p className="text-xs text-[var(--muted)]">
          Leave a score blank for anyone you have not marked — blank is &ldquo;not marked yet&rdquo;, not zero.
        </p>
      </div>

      {error ? <p className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      {saved ? <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800">{saved}</p> : null}

      {(data?.students.length ?? 0) === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--border)] p-5 text-sm text-[var(--muted)]">
          Nobody is registered for your class yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[var(--border)]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--surface-alt)] text-xs uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Level</th>
                <th className="w-28 px-4 py-3">Score / 100</th>
                <th className="w-16 px-4 py-3">Grade</th>
                <th className="px-4 py-3">Feedback</th>
              </tr>
            </thead>
            <tbody>
              {data?.students.map((student) => {
                const entry = draft[student.id] ?? { score: "", feedback: "" };
                return (
                  <tr key={student.id} className="border-t border-[var(--border)]/60">
                    <td className="px-4 py-3">
                      <p className="font-medium text-[var(--foreground)]">{student.name}</p>
                      <p className="text-xs text-[var(--muted)]">{student.studentCode || student.email}</p>
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">{student.level}</td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={entry.score}
                        placeholder="—"
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            [student.id]: { ...entry, score: event.target.value },
                          }))
                        }
                        className="w-20 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm text-[var(--foreground)]"
                      />
                    </td>
                    <td className="px-4 py-3 font-bold text-[var(--foreground)]">
                      {student.letter ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        value={entry.feedback}
                        placeholder="Optional — what to work on"
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            [student.id]: { ...entry, feedback: event.target.value },
                          }))
                        }
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm text-[var(--foreground)]"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
