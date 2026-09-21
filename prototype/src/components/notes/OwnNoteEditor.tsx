"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import BrandLoader from "@/components/BrandLoader";
import { ArrowLeftIcon, TrashIcon } from "@/components/icons";

type SaveState = "idle" | "saving" | "saved" | "error";

/** How long after the last keystroke before autosave fires. */
const AUTOSAVE_DELAY_MS = 900;

/**
 * A page of the student's own notebook — the screen behind the "+" on My Notes.
 *
 * Same plain-textarea-with-autosave approach as the notepad under a recording
 * (components/video/MyNotesEditor.tsx), for the same reasons: a note is
 * paragraphs and lists, and a textarea saves, resizes and reads back exactly
 * what was typed. The difference is that this one is not attached to anything —
 * it has its own title, and it can be deleted.
 *
 * Nothing here has a Save button. A student who types a paragraph and taps back
 * must find it there, so the pending edit is flushed on unmount and on
 * `pagehide` with `keepalive`, which lets the request outlive the page.
 */
export default function OwnNoteEditor({ noteId }: { noteId: string }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const latest = useRef({ title: "", content: "" });
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);
  const deleted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/student/my-notes/${noteId}`, { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 404) throw new Error("missing");
        return res.json();
      })
      .then((data: { title?: string; content?: string }) => {
        if (cancelled) return;
        setTitle(data.title ?? "");
        setContent(data.content ?? "");
        latest.current = { title: data.title ?? "", content: data.content ?? "" };
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setMissing(true);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  const save = useCallback(
    (options: { keepalive?: boolean } = {}) => {
      if (!dirty.current || deleted.current) return;
      dirty.current = false;
      setSaveState("saving");
      fetch(`/api/student/my-notes/${noteId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(latest.current),
        keepalive: options.keepalive,
      })
        .then((res) => {
          if (!res.ok) throw new Error("save failed");
          setSaveState("saved");
        })
        .catch(() => {
          // Leave the edit marked unsaved so the next keystroke (or leaving) tries again.
          dirty.current = true;
          setSaveState("error");
        });
    },
    [noteId],
  );

  const change = (next: { title?: string; content?: string }) => {
    latest.current = { ...latest.current, ...next };
    if (next.title !== undefined) setTitle(next.title);
    if (next.content !== undefined) setContent(next.content);
    dirty.current = true;
    setSaveState("idle");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => save(), AUTOSAVE_DELAY_MS);
  };

  // Leaving is not a reason to lose the last paragraph.
  useEffect(() => {
    const flush = () => {
      if (timer.current) window.clearTimeout(timer.current);
      save({ keepalive: true });
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [save]);

  const remove = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/student/my-notes/${noteId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      deleted.current = true;
      router.push("/notes");
    } catch {
      setDeleting(false);
      setSaveState("error");
    }
  };

  if (!loaded) return <BrandLoader size="lg" title="Notiz wird geladen…" message="Opening your note." />;

  if (missing) {
    return (
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center">
        <p className="text-base font-semibold">This note isn&rsquo;t here any more</p>
        <p className="mt-2 text-sm text-[var(--muted)]">It may have been deleted.</p>
        <Link
          href="/notes"
          className="mt-5 inline-flex rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white"
        >
          Back to My Notes
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/notes"
          className="inline-flex items-center gap-2 text-sm font-medium text-[var(--muted)] transition hover:text-[var(--foreground)]"
        >
          <ArrowLeftIcon /> My Notes
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--muted)]" aria-live="polite">
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? "Saved"
                : saveState === "error"
                  ? "Could not save — check your connection"
                  : ""}
          </span>
          {confirmDelete ? (
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={remove}
                disabled={deleting}
                className="rounded-full bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              >
                {deleting ? "Deleting…" : "Delete note"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-full px-3 py-1.5 text-xs font-semibold text-[var(--muted)]"
              >
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete this note"
              className="grid h-9 w-9 place-items-center rounded-full border border-[var(--border)] text-[var(--muted)] transition hover:border-red-500/50 hover:text-red-500"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
        <input
          value={title}
          onChange={(event) => change({ title: event.target.value })}
          maxLength={120}
          placeholder="Title"
          aria-label="Note title"
          className="w-full bg-transparent text-xl font-bold text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]/60"
        />
        <textarea
          value={content}
          onChange={(event) => change({ content: event.target.value })}
          maxLength={20000}
          placeholder="Write anything you want to remember — a rule, some new words, a list for the test."
          aria-label="Note text"
          autoFocus={!content && !title}
          className="min-h-[55vh] w-full resize-y rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4 text-sm leading-6 text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
        />
      </div>
    </div>
  );
}
