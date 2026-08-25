"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PencilIcon } from "@/components/icons";

type SaveState = "idle" | "saving" | "saved" | "error";

/** How long after the last keystroke before autosave fires. */
const AUTOSAVE_DELAY_MS = 1200;

/**
 * "Just like Zoho" — a student's own editable copy of the class notes.
 * Deliberately a plain textarea, not a rich-text editor: a class recap is
 * paragraphs and lists, not layouts, and a textarea autosaves, resizes and
 * reads back exactly what was typed with none of a WYSIWYG editor's own
 * failure modes (a heavy new dependency, a serialisation format to get
 * wrong). Seeded once from the AI summary on first open — see the API route
 * — then entirely the student's own from that point on.
 */
export default function MyNotesEditor({ materialId }: { materialId: string }) {
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const timerRef = useRef<number | null>(null);
  const latestContent = useRef("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/student/videos/${materialId}/my-notes`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setContent(data.content || "");
        latestContent.current = data.content || "";
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [materialId]);

  const save = useCallback(
    (value: string) => {
      setSaveState("saving");
      fetch(`/api/student/videos/${materialId}/my-notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: value }),
      })
        .then((res) => {
          if (!res.ok) throw new Error("save failed");
          setSaveState("saved");
        })
        .catch(() => setSaveState("error"));
    },
    [materialId],
  );

  const handleChange = (value: string) => {
    setContent(value);
    latestContent.current = value;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => save(latestContent.current), AUTOSAVE_DELAY_MS);
  };

  // Flush on unmount / navigation, same reasoning as the video player's own
  // beforeunload flush: an autosave timer that never fires because the page
  // left first is a lost paragraph, not a lost checkpoint.
  useEffect(() => {
    const flush = () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        save(latestContent.current);
      }
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialId]);

  if (!loaded) return null;

  return (
    <div className="space-y-3 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <PencilIcon className="h-4 w-4 text-[var(--accent)]" />
          <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--accent)]">My notes</h2>
        </div>
        <span className="text-xs text-[var(--muted)]">
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Could not save" : ""}
        </span>
      </div>
      <textarea
        value={content}
        onChange={(event) => handleChange(event.target.value)}
        placeholder="Rewrite the AI summary in your own words, add what you want to remember, or start from scratch — this is yours to edit."
        className="min-h-[180px] w-full resize-y rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4 text-sm leading-6 text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
      />
    </div>
  );
}
