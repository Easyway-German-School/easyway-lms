"use client";

/**
 * The Terms and Conditions, on their own page — what "Read Terms and
 * Conditions" links to from the signup gate, the portal sidebar and Profile.
 * Public and standalone (no shell): a rejected applicant or a parent checking
 * the policy before enrolling their child has no account to sign into yet.
 */

import Link from "next/link";
import { useState } from "react";
import BrandLogo from "@/components/BrandLogo";
import { TERMS_PREAMBLE, TERMS_SECTIONS } from "@/lib/terms-content";
import { TERMS_SCHOOL, TERMS_TITLE, TERMS_VERSION_LABEL } from "@/lib/terms";
import { ChevronLeftIcon, DownloadIcon } from "@/components/icons";

/**
 * "Download your legal documents" — a personal PDF copy of this same
 * document (refund policy included, sections 23–26), carrying the signed-in
 * student's own photo and acceptance record. Anyone can read the page; only
 * a signed-in student can pull the personalised PDF, so a 401 here just
 * means "log in first" rather than a broken download.
 */
function DownloadTermsButton() {
  const [state, setState] = useState<"idle" | "loading" | "needsLogin" | "error">("idle");

  async function download() {
    setState("loading");
    try {
      const response = await fetch("/api/student/terms/pdf", { cache: "no-store" });
      if (response.status === 401) {
        setState("needsLogin");
        return;
      }
      if (!response.ok) throw new Error("download failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "Terms-and-Conditions.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={download}
        disabled={state === "loading"}
        className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-bold text-[var(--foreground)] transition hover:bg-[var(--surface-alt)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <DownloadIcon className="h-4 w-4" />
        {state === "loading" ? "Preparing your PDF…" : "Download your copy (PDF)"}
      </button>
      {state === "needsLogin" ? (
        <p className="mt-2 text-xs text-[var(--muted)]">
          <Link href="/auth/signin" className="font-semibold underline underline-offset-2">
            Log in
          </Link>{" "}
          to download a personalised copy with your name, photo and the date you accepted it.
        </p>
      ) : null}
      {state === "error" ? <p className="mt-2 text-xs text-red-600">Could not prepare the PDF. Please try again.</p> : null}
    </div>
  );
}

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[var(--background)] px-6 py-10 text-[var(--foreground)] sm:px-10">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between">
          <BrandLogo className="h-8 w-auto" />
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--muted)] hover:text-[var(--foreground)]">
            <ChevronLeftIcon className="h-4 w-4" /> Back
          </Link>
        </div>

        <div className="mt-8">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--accent)]">{TERMS_SCHOOL}</p>
          <h1 className="mt-2 text-3xl font-black">{TERMS_TITLE}</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Version {TERMS_VERSION_LABEL}</p>
          <p className="mt-4 italic text-[var(--muted)]">{TERMS_PREAMBLE}</p>
          <DownloadTermsButton />
        </div>

        <div className="mt-8 space-y-8 rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
          {TERMS_SECTIONS.map((section) => (
            <div key={section.number} id={`section-${section.number}`}>
              <h2 className="text-base font-bold text-[var(--foreground)]">
                {section.number}. {section.title}
              </h2>
              <div className="mt-2 space-y-2 text-sm">
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
      </div>
    </main>
  );
}
