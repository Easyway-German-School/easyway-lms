"use client";

import { LockIcon } from "@/components/icons";

/**
 * Placeholder for an AI feature that is built but paused rather than shipped.
 * Swap the caller back to the real component when it's ready to go live —
 * nothing here is deleted, just not rendered.
 */
export default function ComingSoonLock({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center rounded-[28px] border border-dashed border-[var(--border)] bg-[var(--surface-alt)] px-6 py-16 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-[var(--surface)] text-[var(--muted)] shadow-sm">
        <LockIcon className="h-6 w-6" />
      </span>
      <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--muted)]">
        Coming soon
      </p>
      <h2 className="mt-2 text-xl font-semibold text-[var(--foreground)]">{title}</h2>
      <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">{description}</p>
    </div>
  );
}
