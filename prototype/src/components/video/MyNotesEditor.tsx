"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircleIcon, PencilIcon } from "@/components/icons";

type SaveState = "idle" | "saving" | "saved" | "error";

/** How long after the last keystroke before autosave fires. */
const AUTOSAVE_DELAY_MS = 900;

const SNIPPETS = [
  { label: "Key point", text: "\n• " },
  { label: "Vocab", text: "\nDE:  — EN: " },
  { label: "Homework", text: "\nTo practise: " },
  { label: "Question", text: "\nAsk tutor: " },
];

/**
 * Student's editable class notes — Google Docs / Zoho-ish feel without a
 * heavy WYSIWYG: toolbar snippets, word count, sticky save chip, focus mode.
 */
export default function MyNotesEditor({ materialId }: { materialId: string }) {
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [focusMode, setFocusMode] = useState(false);
  const timerRef = useRef<number | null>(null);
  const latestContent = useRef("");
  const areaRef = useRef<HTMLTextAreaElement>(null);

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

  const insertSnippet = (snippet: string) => {
    const area = areaRef.current;
    if (!area) {
      handleChange(content + snippet);
      return;
    }
    const start = area.selectionStart;
    const end = area.selectionEnd;
    const next = content.slice(0, start) + snippet + content.slice(end);
    handleChange(next);
    requestAnimationFrame(() => {
      const pos = start + snippet.length;
      area.focus();
      area.setSelectionRange(pos, pos);
    });
  };

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

  const words = content.trim() ? content.trim().split(/\s+/).length : 0;

  return (
    <div
      className={`space-y-3 overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-sm ${
        focusMode ? "ring-2 ring-[var(--accent)]/30" : ""
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <PencilIcon className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-bold text-[var(--foreground)]">My notes</h2>
            <p className="text-[11px] text-[var(--muted)]">Autosaves as you type · yours alone</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="tabular-nums text-[var(--muted)]">{words} words</span>
          <button
            type="button"
            onClick={() => setFocusMode((v) => !v)}
            className="rounded-full border border-[var(--border)] px-3 py-1 font-semibold text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            {focusMode ? "Exit focus" : "Focus"}
          </button>
          <span
            className={`inline-flex items-center gap-1 font-semibold ${
              saveState === "saved"
                ? "text-emerald-600"
                : saveState === "error"
                  ? "text-rose-600"
                  : "text-[var(--muted)]"
            }`}
          >
            {saveState === "saving" ? (
              "Saving…"
            ) : saveState === "saved" ? (
              <>
                <CheckCircleIcon className="h-3.5 w-3.5" /> Saved
              </>
            ) : saveState === "error" ? (
              "Could not save"
            ) : (
              ""
            )}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 px-5">
        {SNIPPETS.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => insertSnippet(item.text)}
            className="rounded-full bg-[var(--surface-alt)] px-3 py-1.5 text-[11px] font-bold text-[var(--foreground)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
          >
            + {item.label}
          </button>
        ))}
      </div>

      <div className="px-5 pb-5">
        <textarea
          ref={areaRef}
          value={content}
          onChange={(event) => handleChange(event.target.value)}
          placeholder="Rewrite the class summary in your own words, drop vocab, homework, questions for your tutor…"
          className={`w-full resize-y rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4 text-sm leading-7 text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_18%,transparent)] ${
            focusMode ? "min-h-[420px]" : "min-h-[220px]"
          }`}
        />
      </div>
    </div>
  );
}
