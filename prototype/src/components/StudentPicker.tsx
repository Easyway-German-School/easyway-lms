"use client";

import { useEffect, useState } from "react";
import { compareBatches } from "@/lib/class-batch";

/**
 * Who gets this assignment.
 *
 * The default — nobody ticked — means the whole level, which is what every
 * assignment did before this existed. That is stated on screen rather than
 * left to be inferred: "no selection" reading as "everyone" is the kind of
 * thing that is obvious to whoever built it and to nobody else, and getting
 * it backwards means a test either reaches the whole school or reaches
 * nobody.
 */

type Student = {
  id: string;
  name: string;
  studentCode: string | null;
  sessionSlot: string;
  /** The intake month ("September"), or "" when none is on record. */
  batch?: string;
  branchName: string | null;
};

export default function StudentPicker({
  level,
  branchId,
  sessionSlot,
  selected,
  onChange,
}: {
  level: string;
  branchId?: string | null;
  sessionSlot?: string | null;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!level) return;
    let cancelled = false;
    setLoading(true);

    const params = new URLSearchParams({ level });
    if (branchId) params.set("branchId", branchId);
    if (sessionSlot) params.set("sessionSlot", sessionSlot);

    fetch(`/api/lecturer/assignments/students?${params}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        setStudents(data.students ?? []);
        // Anyone ticked who is not in the new level's list is dropped, so
        // changing the level cannot leave a B1 student attached to an A1 paper.
        const ids = new Set((data.students ?? []).map((s: Student) => s.id));
        onChange(selected.filter((id) => ids.has(id)));
      })
      .catch(() => !cancelled && setStudents([]))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
    // `selected` and `onChange` are deliberately absent: this must re-run when
    // the level changes, not on every tick of a checkbox.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, branchId, sessionSlot]);

  const visible = students.filter((student) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return (
      student.name.toLowerCase().includes(needle) ||
      (student.studentCode ?? "").toLowerCase().includes(needle)
    );
  });

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  // THE BATCHES IN THIS LIST. September and October of one level are two classes:
  // one tap selects (or clears) a whole batch instead of ticking names one by one.
  const batches = [...new Set(students.map((s) => s.batch || "").filter(Boolean))].sort((a, b) => compareBatches(a, b));
  const batchIds = (name: string) => students.filter((s) => s.batch === name).map((s) => s.id);
  const batchFullySelected = (name: string) => batchIds(name).every((id) => selected.includes(id));
  const toggleBatch = (name: string) => {
    const ids = batchIds(name);
    onChange(batchFullySelected(name) ? selected.filter((id) => !ids.includes(id)) : [...new Set([...selected, ...ids])]);
  };

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Who gets this?</p>
          <p className="text-xs text-[var(--muted)]">
            {selected.length === 0
              ? `Everyone in ${level || "this level"} — tick names only to narrow it.`
              : `${selected.length} student${selected.length === 1 ? "" : "s"} selected.`}
          </p>
        </div>

        {selected.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="text-xs font-semibold text-[var(--accent)]">
            Clear — send to everyone
          </button>
        )}
      </div>

      {loading ? (
        <p className="py-3 text-xs text-[var(--muted)]">Loading students…</p>
      ) : students.length === 0 ? (
        <p className="py-3 text-xs text-[var(--muted)]">
          No active students at {level}. It will go to everyone at that level as they join.
        </p>
      ) : (
        <>
          {batches.length > 1 && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-[var(--foreground-soft)]">Pick a whole batch:</span>
              {batches.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggleBatch(name)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${batchFullySelected(name) ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"}`}
                >
                  {name} batch · {batchIds(name).length}
                </button>
              ))}
            </div>
          )}

          {students.length > 8 && (
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name or code…"
              className="mb-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
          )}

          <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
            {visible.map((student) => (
              <label
                key={student.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--surface)]"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(student.id)}
                  onChange={() => toggle(student.id)}
                  className="accent-[var(--accent)]"
                />
                <span className="flex-1 truncate">{student.name}</span>
                <span className="shrink-0 text-[11px] text-[var(--muted)]">
                  {student.batch ? `${student.batch} · ` : ""}{student.studentCode ?? student.sessionSlot}
                </span>
              </label>
            ))}
          </div>

          <div className="mt-2 flex gap-3 border-t border-[var(--border)] pt-2">
            <button type="button" onClick={() => onChange(visible.map((s) => s.id))}
              className="text-xs font-semibold text-[var(--accent)]">
              Select all{query ? " shown" : ""}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
