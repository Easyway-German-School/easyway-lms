"use client";

/**
 * The other half of a material's "quick quests" teaser — the part that used
 * to not exist. A tutor's upload generates 1-3 short tasks (src/lib/material-ai.ts)
 * and a tutor reviews/edits them (lecturer/materials), but until this panel a
 * student had nowhere to actually open one. Self-marked, flashcard-style: read
 * the task, think of an answer, reveal the real one, say whether you got it.
 * XP shows up on the next gamification fetch — this panel doesn't compute it.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, CrossIcon } from "@/components/icons";

type Quest = { index: number; title: string; task: string; xp: number; correct: boolean | null };

export default function MaterialQuestPanel({
  material,
  onClose,
}: {
  material: { id: string; title: string } | null;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [quests, setQuests] = useState<Quest[] | null>(null);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState(0);
  const [revealedAnswer, setRevealedAnswer] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [marking, setMarking] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!material) return;
    setQuests(null);
    setError("");
    setCursor(0);
    setRevealedAnswer(null);
    fetch(`/api/student/materials/${material.id}/quests`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Could not load these quests."))))
      .then((data) => setQuests(data.quests ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load these quests."));
  }, [material]);

  if (!material || !mounted) return null;

  const quest = quests?.[cursor];
  const done = quests?.filter((q) => q.correct === true).length ?? 0;

  async function reveal() {
    if (!material || !quest) return;
    setRevealing(true);
    try {
      const res = await fetch(`/api/student/materials/${material.id}/quests/${quest.index}/reveal`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not reveal the answer.");
      setRevealedAnswer(data.answer || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reveal the answer.");
    } finally {
      setRevealing(false);
    }
  }

  async function mark(correct: boolean) {
    if (!material || !quest || !quests) return;
    setMarking(true);
    try {
      const res = await fetch(`/api/student/materials/${material.id}/quests/${quest.index}/mark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correct }),
      });
      if (!res.ok) throw new Error("Could not save that.");
      setQuests(quests.map((q) => (q.index === quest.index ? { ...q, correct } : q)));
      setRevealedAnswer(null);
      setCursor((c) => c + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setMarking(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--accent)]">Quick quests</p>
        <h2 className="mt-0.5 text-lg font-black text-[var(--foreground)]">{material.title}</h2>

        {error && (
          <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>
        )}

        {!error && !quests && <p className="mt-4 text-sm text-[var(--muted)]">Loading…</p>}

        {!error && quests && quests.length === 0 && (
          <p className="mt-4 text-sm text-[var(--muted)]">No quests are ready for this material yet.</p>
        )}

        {!error && quests && quests.length > 0 && quest && (
          <div className="mt-4">
            <p className="text-[11px] font-semibold text-[var(--muted)]">
              Quest {cursor + 1} of {quests.length} · +{quest.xp} XP
            </p>
            <h3 className="mt-1 text-base font-bold text-[var(--foreground)]">{quest.title}</h3>
            <p className="mt-1.5 text-sm leading-5 text-[var(--foreground-soft)]">{quest.task}</p>

            {revealedAnswer === null ? (
              <button
                type="button"
                onClick={reveal}
                disabled={revealing}
                className="mt-4 w-full rounded-xl bg-[var(--accent-soft)] px-4 py-2.5 text-sm font-bold text-[var(--accent)] transition hover:brightness-105 disabled:opacity-60"
              >
                {revealing ? "…" : "Show answer"}
              </button>
            ) : (
              <>
                <div className="mt-4 rounded-xl bg-[var(--surface-alt)] p-3 text-sm leading-5 text-[var(--foreground)]">
                  {revealedAnswer || "No reference answer was given for this one — mark it from what you know."}
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => mark(true)}
                    disabled={marking}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-105 disabled:opacity-60"
                  >
                    <CheckIcon className="h-4 w-4" /> Got it
                  </button>
                  <button
                    type="button"
                    onClick={() => mark(false)}
                    disabled={marking}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--surface-alt)] px-4 py-2.5 text-sm font-bold text-[var(--foreground)] transition hover:brightness-105 disabled:opacity-60"
                  >
                    <CrossIcon className="h-4 w-4" /> Not quite
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {!error && quests && quests.length > 0 && !quest && (
          <div className="mt-4 rounded-xl bg-[var(--accent-soft)] p-4 text-center">
            <p className="text-2xl font-black text-[var(--accent)]">{done}/{quests.length} done</p>
            <p className="mt-1 text-sm text-[var(--foreground-soft)]">
              {done === quests.length ? "All of them — nicely done." : "Come back for the rest anytime."}
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-xl px-4 py-2 text-xs font-semibold text-[var(--muted)] underline underline-offset-2 hover:text-[var(--foreground)]"
        >
          Close
        </button>
      </div>
    </div>,
    document.body,
  );
}
