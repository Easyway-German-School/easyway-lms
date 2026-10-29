"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Mascot from "@/components/Mascot";
import { MailIcon } from "@/components/icons";

const RECIPIENT = "precious.okoro@easywaylanguageschool.com";
const SUBJECT = "Class concern from an Easyway student";
const BODY = [
  "Hello Precious,",
  "",
  "I would like to report a concern about one of my classes.",
  "",
  "My name:",
  "Course or class:",
  "Tutor's name:",
  "Date(s) of the class(es):",
  "What happened? (For example: a missed class without explanation, fewer classes than scheduled, or a concern about how the class is taught.)",
  "",
  "Thank you.",
].join("\n");

const EMAIL_HREF = `mailto:${RECIPIENT}?subject=${encodeURIComponent(SUBJECT)}&body=${encodeURIComponent(BODY)}`;

export default function StudentClassConcernPrompt({
  collapsed,
  onOpen,
}: {
  collapsed: boolean;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <>
      <div className="mt-5 border-t border-[var(--border)] pt-4">
        <p className={`px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--muted)]/70 ${collapsed ? "lg:hidden" : ""}`}>
          Support
        </p>
        <button
          type="button"
          onClick={() => {
            onOpen?.();
            setOpen(true);
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
              onClick={() => setOpen(false)}
              role="presentation"
            >
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="class-concern-title"
                className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)]"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  aria-label="Close class concerns"
                  onClick={() => setOpen(false)}
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
                    If your tutor misses classes without explanation, holds fewer classes than scheduled—including a
                    class scheduled three times a week—or you have concerns about their teaching, please email
                    Precious directly. This goes to the school by email, not through Enquiries, so there is a written
                    record.
                  </p>
                  <p className="mt-3 text-center text-sm font-semibold text-[var(--foreground)]">{RECIPIENT}</p>
                  <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                    The email draft will prompt you for your name, tutor, class dates, and what happened. It will only
                    be sent when you press Send in your email app.
                  </p>
                  <a
                    href={EMAIL_HREF}
                    onClick={() => setOpen(false)}
                    className="mt-5 flex items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110"
                  >
                    <MailIcon className="h-4 w-4" />
                    Email your class concern
                  </a>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
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
