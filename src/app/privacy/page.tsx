"use client";

/**
 * The Privacy Policy, on its own page — what "Privacy Policy" links to from
 * the signup form. There is no separate privacy document: this is the same
 * Terms and Conditions text (terms-content.ts), re-grouped to the sections
 * that actually describe how personal information is handled. See
 * privacySections() in lib/terms.ts for which sections and why. Public and
 * standalone (no shell), same as /terms — an applicant checking this before
 * enrolling has no account to sign into yet.
 */

import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";
import { TERMS_SCHOOL, TERMS_VERSION_LABEL, privacySections } from "@/lib/terms";
import { ChevronLeftIcon } from "@/components/icons";

export default function PrivacyPage() {
  const sections = privacySections();

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
          <h1 className="mt-2 text-3xl font-black">Privacy Policy</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Version {TERMS_VERSION_LABEL}</p>
          <p className="mt-4 text-[var(--muted)]">
            This explains how {TERMS_SCHOOL} collects, uses and protects your personal information. It is
            drawn from, and should be read together with, our{" "}
            <Link href="/terms" className="font-semibold text-[var(--accent)] underline underline-offset-2">
              Terms and Conditions
            </Link>
            .
          </p>
        </div>

        <div className="mt-8 space-y-8 rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
          {sections.map((section) => (
            <div key={section.number} id={`section-${section.number}`}>
              <h2 className="text-base font-bold text-[var(--foreground)]">{section.title}</h2>
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
