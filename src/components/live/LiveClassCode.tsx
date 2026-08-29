"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckIcon, LinkIcon, SendIcon } from "@/components/icons";

/**
 * The tutor's class code, and the three ways to hand it out.
 *
 * Every student in the cohort has already been rung, so this is not the primary
 * route in — it is the fallback for the ones the primary route misses, and in a
 * Nigerian classroom that is not a small number. A phone with no data that day.
 * A student borrowing a friend's laptop. A push notification that never
 * arrived because the browser was never granted permission. Someone whose
 * account is on the wrong sitting. In every one of those cases a tutor can read
 * six characters out loud and the problem is over.
 *
 * The code is per-class, never reused, and dies with the session — see
 * lib/live-presence.ts. It is also NOT a key: presenting it still gets you the
 * same authorization checks as any other way in. That is what makes it safe to
 * say out loud on a video call that is being recorded.
 */
export default function LiveClassCode({ code }: { code: string }) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [origin, setOrigin] = useState("");

  // The absolute URL is only knowable in the browser, and a link built during
  // the server render would say "undefined" in the middle of it.
  useEffect(() => setOrigin(window.location.origin), []);

  const link = origin ? `${origin}/live?code=${code}` : `/live?code=${code}`;

  const copy = useCallback(async (value: string, which: "code" | "link") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard is permission-gated and absent over plain HTTP. The code is
      // rendered in full and selectable, so a failed copy costs nothing.
    }
  }, []);

  const share = useCallback(async () => {
    // The phone's own share sheet, where a tutor's WhatsApp group already is.
    // Not available on desktop Chrome, which is why the copy buttons stay.
    try {
      await navigator.share?.({ title: "Join the class", text: `Class code: ${code}`, url: link });
    } catch {
      /* dismissed, or unsupported */
    }
  }, [code, link]);

  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Your class code</h2>
          <p className="mt-1 max-w-md text-sm text-[var(--muted)]">
            Everyone on your roster has already been buzzed. Read this out for anyone who says they cannot find the class.
          </p>
        </div>

        <button
          onClick={() => copy(code, "code")}
          title="Copy the code"
          className="group flex items-center gap-2 rounded-2xl border-2 border-dashed border-[var(--accent)]/40 bg-[var(--accent-soft)] px-4 py-3 transition hover:border-[var(--accent)]"
        >
          {/* Wide tracking and a tabular face, because this exists to be read
              aloud across a room and typed by somebody who has heard it once. */}
          <span className="font-mono text-2xl font-bold tracking-[0.35em] text-[var(--accent)] sm:text-3xl">
            {code}
          </span>
          {copied === "code" ? (
            <CheckIcon className="h-4 w-4 shrink-0 text-emerald-600" />
          ) : (
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]/70 opacity-0 transition group-hover:opacity-100">
              Copy
            </span>
          )}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => copy(link, "link")}
          className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--foreground-soft)] transition hover:bg-[var(--surface-alt)]"
        >
          {copied === "link" ? <CheckIcon className="h-3.5 w-3.5 text-emerald-600" /> : <LinkIcon className="h-3.5 w-3.5" />}
          {copied === "link" ? "Link copied" : "Copy join link"}
        </button>

        <button
          onClick={share}
          className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--foreground-soft)] transition hover:bg-[var(--surface-alt)]"
        >
          <SendIcon className="h-3.5 w-3.5" />
          Share to WhatsApp
        </button>
      </div>

      <p className="mt-3 text-xs text-[var(--muted)]">
        The code stops working when the class ends, and next week&apos;s class gets a new one.
      </p>
    </div>
  );
}
