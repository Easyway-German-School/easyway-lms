"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import Avatar from "@/components/Avatar";
import { CommunityIcon, CrossIcon, FlameIcon, SparklesIcon } from "@/components/icons";
import Mascot from "@/components/Mascot";
import { useMoment } from "@/lib/moment-queue";
import { useLook } from "@/lib/useLook";

/**
 * BECCA, ON THE NEW LOOK — once, and never by force.
 *
 * Two messages, picked by the server (see promptFor in lib/youth-look.ts):
 *
 *   announce  The student is in the first wave and already HAS the new look.
 *             The honest thing is to tell them why their app moved, and to give
 *             them the way back in the same breath.
 *   invite    A 25–34 who lives on their phone. Nothing has changed for them;
 *             this only asks whether they would like it to.
 *
 * Every way out is one tap: the X, the backdrop, Escape, or an honest "no
 * thanks". It is marked as seen the moment it opens, not when it is answered,
 * so closing the tab, swiping it away or ignoring it all count as an answer and
 * it never comes back — an interruption you can dismiss but that returns
 * tomorrow is still a nag. The switch on the profile page is the permanent
 * door; nobody has to remember this popup to change their mind.
 *
 * Queue-managed (rank 64), so it never stacks on the tour or a celebration.
 */

export default function NewLookMoment() {
  const router = useRouter();
  const { prompt, name, setLook, markPromptSeen } = useLook();

  // What Becca is saying is captured the first time the server asks for it and
  // held until the popup closes. Marking it seen clears `prompt` locally (so
  // nothing can re-open it); if the popup followed `prompt` it would vanish the
  // instant it appeared.
  const [shown, setShown] = useState<"announce" | "invite" | null>(null);
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    if (prompt && !shown) setShown(prompt);
  }, [prompt, shown]);

  const { open, close: release } = useMoment("new-look", shown !== null && !finished);
  const close = () => {
    setFinished(true);
    release();
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const seenRef = useRef(false);

  // Seen the moment it is actually on screen — not when it is merely queued,
  // and not only when answered.
  useEffect(() => {
    if (open && !seenRef.current) {
      seenRef.current = true;
      void markPromptSeen();
    }
  }, [open, markPromptSeen]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFinished(true);
        release();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, release]);

  const mode = shown;
  if (!open || finished || !mode || typeof document === "undefined") return null;

  async function choose(look: "youth" | "classic") {
    setBusy(true);
    setError("");
    try {
      await setLook(look);
      close();
    } catch {
      setError("Could not change that just now. You can do it from your profile any time.");
      setBusy(false);
    }
  }

  const first = name ? name.split(/\s+/)[0] : null;
  const announce = mode === "announce";

  const perks = [
    { icon: <CommunityIcon className="h-5 w-5" />, text: "A bottom menu like the apps you already use" },
    { icon: <SparklesIcon className="h-5 w-5" />, text: "Your own cartoon avatar for chats and your profile" },
    { icon: <FlameIcon className="h-5 w-5" />, text: "A study grid that shows your streak" },
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-5 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="The new look"
      onClick={close}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="relative w-full max-w-sm overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)]"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-black/10 text-[var(--foreground-soft)] transition hover:bg-black/20"
        >
          <CrossIcon className="h-4 w-4" />
        </button>

        <div className="flex items-end justify-center gap-3 bg-[var(--accent-soft)] px-6 pt-6">
          <Mascot mood="cheerful" className="h-24 w-24" />
          <Avatar seed={name ?? ""} size={64} className="mb-3" />
        </div>

        <div className="p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--accent)]">
            {first ? `Hey ${first}` : "Hey"}
          </p>
          <h2 className="mt-1.5 text-xl font-extrabold leading-tight text-[var(--foreground)]">
            {announce ? "We gave the app a fresh look" : "Want to try the new look?"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {announce
              ? "Same lessons, same classes, same place for everything — just easier to get around on your phone."
              : "It's built for your phone, and it takes one tap to switch back whenever you like."}
          </p>

          <ul className="mt-4 space-y-2">
            {perks.map((perk) => (
              <li key={perk.text} className="flex items-center gap-3 text-sm font-semibold text-[var(--foreground)]">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--accent-strong)]/12 text-[var(--accent-strong)]">
                  {perk.icon}
                </span>
                {perk.text}
              </li>
            ))}
          </ul>

          {error ? <p className="mt-3 text-sm font-semibold text-[var(--danger)]">{error}</p> : null}

          <div className="mt-5 space-y-2.5">
            {announce ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    router.push("/profile");
                  }}
                  className="w-full rounded-full bg-[var(--accent)] py-3.5 text-base font-extrabold text-white transition active:scale-[0.98]"
                >
                  Make my avatar
                </button>
                <button
                  type="button"
                  onClick={close}
                  className="w-full rounded-full border border-[var(--border-strong)] py-3 text-sm font-bold text-[var(--foreground-soft)] transition active:scale-[0.98]"
                >
                  Looks good
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => choose("classic")}
                  className="w-full py-1.5 text-xs font-semibold text-[var(--muted)] underline-offset-2 hover:underline disabled:opacity-60"
                >
                  {busy ? "Switching…" : "Switch back to the classic look"}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => choose("youth")}
                  className="w-full rounded-full bg-[var(--accent)] py-3.5 text-base font-extrabold text-white transition active:scale-[0.98] disabled:opacity-60"
                >
                  {busy ? "One moment…" : "Try it"}
                </button>
                <button
                  type="button"
                  onClick={close}
                  className="w-full rounded-full border border-[var(--border-strong)] py-3 text-sm font-bold text-[var(--foreground-soft)] transition active:scale-[0.98]"
                >
                  No thanks
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
