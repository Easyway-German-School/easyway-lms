"use client";

/**
 * A tutor's sign-off on the quests src/lib/material-ai.ts generated for their
 * upload. Nothing here reaches a student until "Approve & publish" is
 * pressed — see the `questsReviewedAt` gate in the student-facing API routes.
 * Re-approving after an edit is cheap on purpose: a tutor fixing a typo in an
 * already-approved quest shouldn't have to think about a separate unpublish step.
 */

import { useEffect, useState } from "react";
import { CheckIcon } from "@/components/icons";
import StudyNoteView from "@/components/notes/StudyNoteView";
import type { StudyNote } from "@/lib/material-ai";

type Quest = { title: string; task: string; answer: string; xp: number };
type ReviewData = {
  summary: string | null;
  keyPoints: string[];
  quests: Quest[];
  notes: StudyNote | null;
  reviewedAt: string | null;
};

export default function LecturerQuestReview({ materialId }: { materialId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ReviewData | null>(null);
  const [quests, setQuests] = useState<Quest[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedNote, setSavedNote] = useState("");

  useEffect(() => {
    if (!open || data) return;
    fetch(`/api/lecturer/materials/${materialId}/quests`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Could not load this material's quests."))))
      .then((payload: ReviewData) => {
        setData(payload);
        setQuests(payload.quests);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load this material's quests."));
  }, [open, data, materialId]);

  function updateQuest(index: number, field: keyof Quest, value: string) {
    setQuests((current) =>
      current.map((quest, i) => (i === index ? { ...quest, [field]: field === "xp" ? Number(value) || 0 : value } : quest)),
    );
  }

  async function save(approve: boolean) {
    setSaving(true);
    setError("");
    setSavedNote("");
    try {
      const res = await fetch(`/api/lecturer/materials/${materialId}/quests`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quests, approve }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "Could not save these quests.");
      setData((current) => (current ? { ...current, reviewedAt: payload.reviewedAt } : current));
      setSavedNote(approve ? "Approved — students can now see the quests and the ready-made note." : "Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save these quests.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-bold text-[var(--accent)]"
      >
        {open ? "Hide quests" : "Review quests"}
        {data?.reviewedAt && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
            <CheckIcon className="h-3 w-3" /> Approved
          </span>
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>}
          {!error && !data && <p className="text-xs text-[var(--muted)]">Loading…</p>}

          {data?.summary && (
            <p className="rounded-lg bg-[var(--surface-alt)] px-3 py-2 text-xs leading-4 text-[var(--foreground-soft)]">
              {data.summary}
            </p>
          )}

          {data?.notes && (
            <details className="rounded-lg border border-[var(--border)] p-3">
              <summary className="cursor-pointer text-xs font-bold text-[var(--accent)]">
                Ready-made note preview (students see this once you approve)
              </summary>
              <div className="mt-3 text-xs">
                <StudyNoteView note={data.notes} />
              </div>
            </details>
          )}

          {quests.map((quest, index) => (
            <div key={index} className="rounded-lg border border-[var(--border)] p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                  Quest {index + 1}
                </span>
                <input
                  type="number"
                  min={1}
                  value={quest.xp}
                  onChange={(e) => updateQuest(index, "xp", e.target.value)}
                  className="w-16 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--foreground)]"
                  aria-label="XP"
                />
              </div>
              <input
                type="text"
                value={quest.title}
                onChange={(e) => updateQuest(index, "title", e.target.value)}
                placeholder="Title"
                className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm font-semibold text-[var(--foreground)]"
              />
              <textarea
                value={quest.task}
                onChange={(e) => updateQuest(index, "task", e.target.value)}
                placeholder="Task"
                className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs text-[var(--foreground)]"
                rows={2}
              />
              <textarea
                value={quest.answer}
                onChange={(e) => updateQuest(index, "answer", e.target.value)}
                placeholder="Answer (shown to the student only after they attempt it)"
                className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs text-[var(--foreground)]"
                rows={2}
              />
            </div>
          ))}

          {data && quests.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => save(true)}
                disabled={saving}
                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-105 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Approve & publish"}
              </button>
              <button
                type="button"
                onClick={() => save(false)}
                disabled={saving}
                className="rounded-lg bg-[var(--surface-alt)] px-3 py-1.5 text-xs font-bold text-[var(--foreground)] transition hover:brightness-105 disabled:opacity-60"
              >
                Save without publishing
              </button>
              {savedNote && <span className="text-xs font-semibold text-emerald-600">{savedNote}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
