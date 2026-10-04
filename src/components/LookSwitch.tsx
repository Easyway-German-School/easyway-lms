"use client";

import { useState } from "react";

import Avatar from "@/components/Avatar";
import { SparklesIcon } from "@/components/icons";
import { useLook } from "@/lib/useLook";

/**
 * The student's say over which look they get.
 *
 * The age wave (lib/youth-look.ts) decides the DEFAULT; this is the override.
 * On the classic look it is an invitation to try the new one, and on the new
 * look it is a quiet way back — a layout is a preference, never a sentence, and
 * either choice sticks until the student changes it.
 */
export default function LookSwitch() {
  const { look, avatar, name, ready, setLook } = useLook();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Never guess before the server has answered: a flash of "Try the new look"
  // for a student who already has it would be a small lie.
  if (!ready) return null;

  async function choose(next: "youth" | "classic") {
    setBusy(true);
    setError("");
    try {
      await setLook(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change the look. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (look === "youth") {
    return (
      <div className="mx-auto mt-4 flex max-w-3xl items-center justify-between gap-3 px-6 sm:px-10">
        <p className="text-xs text-[var(--muted)]">{error || "Prefer the old layout?"}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => choose("classic")}
          className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-xs font-bold text-[var(--foreground-soft)] transition active:scale-95 disabled:opacity-60"
        >
          {busy ? "Switching…" : "Use the classic look"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 flex items-center gap-4 rounded-3xl border border-[var(--accent)]/30 bg-[var(--accent)]/8 p-4">
      <Avatar config={avatar} seed={name ?? ""} size={52} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-extrabold">
          <SparklesIcon className="h-4 w-4 text-[var(--accent)]" /> Try the new look
        </p>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          {error || "A phone-style menu, your own avatar and a study grid. You can switch back any time."}
        </p>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => choose("youth")}
        className="shrink-0 rounded-full bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-white transition active:scale-95 disabled:opacity-60"
      >
        {busy ? "…" : "Try it"}
      </button>
    </div>
  );
}
