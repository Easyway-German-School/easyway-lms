"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Mascot from "@/components/Mascot";
import { MailIcon } from "@/components/icons";

const RECIPIENT = "precious.okoro@easywaylanguageschool.com";
const REMINDER_MS = 1000 * 60 * 60 * 24 * 3;
const REMINDER_KEY = "easyway-class-concern-reminder";

type ConcernDraft = {
  name: string;
  course: string;
  tutor: string;
  dates: string;
  details: string;
};

const EMPTY_DRAFT: ConcernDraft = {
  name: "",
  course: "",
  tutor: "",
  dates: "",
  details: "",
};

function buildMailHref(draft: ConcernDraft) {
  const subject = draft.name ? `Class concern from ${draft.name}` : "Class concern from an Easyway student";
  const body = [
    "Hello Precious,",
    "",
    "I would like to report a concern about one of my classes.",
    "",
    `My name: ${draft.name}`,
    `Course or class: ${draft.course}`,
    `Tutor's name: ${draft.tutor}`,
    `Date(s) of the class(es): ${draft.dates}`,
    `What happened? ${draft.details || "(For example: a missed class without explanation, fewer classes than scheduled, or a concern about how the class is taught.)"}`,
    "",
    "Thank you.",
  ].join("\n");

  return `mailto:${RECIPIENT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export default function StudentClassConcernPrompt({
  collapsed,
  onOpen,
}: {
  collapsed: boolean;
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ConcernDraft>(EMPTY_DRAFT);

  const closePrompt = useCallback(() => {
    setOpen(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(REMINDER_KEY, String(Date.now()));
    }
  }, []);

  const reminderMessage = useMemo(
    () =>
      "This is a valid class or tutor concern. Please include specific dates, the tutor or class name, and clear facts so the school can follow up properly.",
    [],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const lastReminder = Number(window.localStorage.getItem(REMINDER_KEY) ?? "0");
    const isDue = !lastReminder || Date.now() - lastReminder >= REMINDER_MS;
    if (!isDue) return;

    const timer = window.setTimeout(() => {
      setOpen(true);
    }, 800);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePrompt();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closePrompt, open]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const href = buildMailHref(draft);
    closePrompt();
    window.location.href = href;
  };

  return (
    <>
      <div className="mt-5 border-t border-[var(--border)] pt-4">
        <p className={`px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--muted)]/70 ${collapsed ? "lg:hidden" : ""}`}>
          Support
        </p>
        <button
          type="button"
          onClick={() => {
            onOpen();
            setOpen(true);
            if (typeof window !== "undefined") {
              window.localStorage.setItem(REMINDER_KEY, String(Date.now()));
            }
          }}
          title={collapsed ? "Class concerns" : ""}
          aria-haspopup="dialog"
          className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm text-[var(--foreground-soft)] transition hover:bg-[var(--surface-alt)] hover:text-[var(--foreground)] ${
            collapsed ? "lg:justify-center lg:gap-0 lg:px-0" : ""
          }`}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] text-[var(--accent)] shadow-sm transition group-hover:border-[var(--border-strong)]">
            <MailIcon className="h-5 w-5" />
          </span>
          {!collapsed && <span className="font-medium">Class concerns</span>}
        </button>
      </div>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm"
              onClick={closePrompt}
              role="presentation"
            >
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="class-concern-title"
                className="relative max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-[28px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)]"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  aria-label="Close class concerns"
                  onClick={closePrompt}
                  className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full text-xl text-[var(--muted)] transition hover:bg-[var(--surface-alt)] hover:text-[var(--foreground)]"
                >
                  ×
                </button>

                <div className="bg-[var(--accent-soft)] px-6 pt-5">
                  <Mascot mood="curious" className="mx-auto h-20 w-20" />
                </div>
                <div className="p-6">
                  <p className="text-center text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--accent)]">
                    Becca is listening
                  </p>
                  <h2 id="class-concern-title" className="mt-1.5 text-center text-xl font-bold text-[var(--foreground)]">
                    Concerned about your classes?
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-[var(--foreground-soft)]">
                    If your tutor misses classes without explanation, teaches fewer classes than scheduled, or there are
                    serious concerns about the quality of teaching, please send a clear, factual complaint to Precious.
                    This route is for legitimate class and tutor concerns. It does not go through general Enquiries.
                  </p>
                  <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-center text-sm font-semibold text-[var(--foreground)]">
                    {RECIPIENT}
                  </div>

                  <form onSubmit={handleSubmit} className="mt-4 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block text-xs font-medium uppercase tracking-[0.18em] text-[var(--muted)] sm:col-span-2">
                        Your name
                        <input
                          value={draft.name}
                          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                          className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)]"
                          placeholder="Your full name"
                        />
                      </label>
                      <label className="block text-xs font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
                        Course / class
                        <input
                          value={draft.course}
                          onChange={(event) => setDraft((current) => ({ ...current, course: event.target.value }))}
                          className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)]"
                          placeholder="e.g. A1 German"
                        />
                      </label>
                      <label className="block text-xs font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
                        Tutor name
                        <input
                          value={draft.tutor}
                          onChange={(event) => setDraft((current) => ({ ...current, tutor: event.target.value }))}
                          className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)]"
                          placeholder="Tutor's name"
                        />
                      </label>
                      <label className="block text-xs font-medium uppercase tracking-[0.18em] text-[var(--muted)] sm:col-span-2">
                        Class date(s)
                        <input
                          value={draft.dates}
                          onChange={(event) => setDraft((current) => ({ ...current, dates: event.target.value }))}
                          className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)]"
                          placeholder="e.g. 12 May 2026, 14 May 2026"
                        />
                      </label>
                      <label className="block text-xs font-medium uppercase tracking-[0.18em] text-[var(--muted)] sm:col-span-2">
                        What happened?
                        <textarea
                          value={draft.details}
                          onChange={(event) => setDraft((current) => ({ ...current, details: event.target.value }))}
                          className="mt-1 min-h-[110px] w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)]"
                          placeholder="Please include missed classes, fewer classes than scheduled, or concerns about how the class is being taught."
                        />
                      </label>
                    </div>

                    <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                      {reminderMessage}
                    </p>

                    <button
                      type="submit"
                      className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110"
                    >
                      <MailIcon className="h-4 w-4" />
                      Send complaint by email
                    </button>
                  </form>

                  <button
                    type="button"
                    onClick={closePrompt}
                    className="mt-3 w-full py-2 text-sm font-medium text-[var(--muted)] transition hover:text-[var(--foreground)]"
                  >
                    Maybe later
                  </button>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
