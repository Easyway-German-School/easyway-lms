"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TERMS_PREAMBLE, type TermsSection } from "@/lib/terms-content";
import { TERMS_SCHOOL, TERMS_TITLE, TERMS_VERSION_LABEL } from "@/lib/terms";
import { CrossIcon } from "@/components/icons";

/**
 * THE ONE PLACE THE SCHOOL'S TERMS GET SHOWN AS A GATE.
 *
 * Two call sites, one component: the unskippable stop at the end of signup,
 * and the "read this before you ask for a refund" wall on the payments page.
 * Both need the same mechanics — a scrollable document, a checkbox that must
 * be ticked before the primary button unlocks, portalled to `<body>` so it
 * escapes a transformed ancestor (see SignOutButton's note on the same trap).
 * What differs is which sections are shown and whether the student can back
 * out — `closable` controls that, and signup passes neither an `onClose` nor
 * `closable`, so there is no X, no Escape, and no backdrop click. The only
 * way out of that one is the checkbox.
 */
export default function TermsGate({
  open,
  sections,
  onAgree,
  onClose,
  closable = false,
  title = "Please read before you continue",
  intro,
  agreeLabel = "I Agree — Continue",
  checkboxLabel = "I have read and agree to the Terms and Conditions, including the No-Refund Policy in section 23.",
  footnote,
  showPreamble = true,
}: {
  open: boolean;
  sections: TermsSection[];
  onAgree: () => void;
  onClose?: () => void;
  closable?: boolean;
  title?: string;
  intro?: ReactNode;
  agreeLabel?: string;
  checkboxLabel?: string;
  footnote?: ReactNode;
  showPreamble?: boolean;
}) {
  const [checked, setChecked] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  // A fresh look each time the gate reopens — ticking it once must not carry
  // over to the next thing this same gate is asked to guard.
  useEffect(() => {
    if (open) setChecked(false);
  }, [open]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm"
      onClick={closable && onClose ? onClose : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="terms-gate-title"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] p-6">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--accent)]">
              {TERMS_SCHOOL} · {TERMS_TITLE}
            </p>
            <h2 id="terms-gate-title" className="mt-1 text-xl font-black text-[var(--foreground)]">
              {title}
            </h2>
            <p className="mt-1 text-xs text-[var(--muted)]">Version {TERMS_VERSION_LABEL}</p>
          </div>
          {closable && onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-full p-2 text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
              aria-label="Close"
            >
              <CrossIcon className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {intro ? <div className="border-b border-[var(--border)] px-6 py-4 text-sm text-[var(--muted)]">{intro}</div> : null}

        <div className="flex-1 overflow-y-auto px-6 py-5 text-sm">
          {showPreamble ? <p className="italic text-[var(--muted)]">{TERMS_PREAMBLE}</p> : null}
          {sections.map((section) => (
            <div key={section.number} className="mt-5 first:mt-0">
              <h3 className="text-sm font-bold text-[var(--foreground)]">
                {section.number}. {section.title}
              </h3>
              <div className="mt-1.5 space-y-1.5">
                {section.blocks.map((block, index) =>
                  block.kind === "bullet" ? (
                    <p key={index} className="flex gap-2 text-[var(--muted)]">
                      <span aria-hidden="true">•</span>
                      <span>{block.text}</span>
                    </p>
                  ) : (
                    <p key={index} className="text-[var(--muted)]">
                      {block.text}
                    </p>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-[var(--border)] p-6">
          {footnote}
          <label className="flex items-start gap-3 text-sm text-[var(--foreground)]">
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--border)]"
            />
            <span>{checkboxLabel}</span>
          </label>
          <button
            type="button"
            disabled={!checked}
            onClick={onAgree}
            className="mt-4 w-full rounded-xl bg-gradient-to-r from-[#0D7C7E] to-[#FF6600] px-8 py-3.5 text-sm font-bold text-white shadow-lg shadow-[#FF6600]/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            {agreeLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
