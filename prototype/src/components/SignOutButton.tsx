"use client";

import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { ExitIcon } from "@/components/icons";

/**
 * The way out of a portal. Sits in the sidebar footer of all three shells.
 *
 * This component existed for months and was imported by nothing, which meant
 * students and admins had no way to end a session short of typing
 * /api/auth/signout into the address bar. That matters more here than it would
 * elsewhere: phones get shared, and a cybercafé machine holds a JWT until it
 * expires on its own.
 */

/**
 * Keys the previous person leaves behind in localStorage.
 *
 * Signing out clears the cookie, but not this — and every one of these is
 * scoped to a student, not to the device. Without the sweep, student B signs in
 * on a shared phone and the dashboard greets them with student A's AI study
 * plan, or the payments page picks up A's half-finished Paystack reference and
 * tries to verify it against B's account.
 *
 * Deliberately an allowlist, not a wipe: the theme choice and the sidebar's
 * collapsed state belong to the DEVICE and should survive the handover.
 */
const PERSONAL_KEYS = [
  "studentPersonalizedPlan",
  "pendingPaystackReference",
  "pendingPaystackAmount",
  "pendingPaystackPathwayName",
  "paystackPaymentSuccess",
];
const PERSONAL_KEY_PREFIXES = ["ew-advance-seen-"];

function clearPersonalState() {
  try {
    for (const key of PERSONAL_KEYS) window.localStorage.removeItem(key);
    // Prefixed keys are enumerated because the level is part of the name.
    // Collect first, then delete — removing while iterating reindexes the list
    // and silently skips every other match.
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && PERSONAL_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) doomed.push(key);
    }
    for (const key of doomed) window.localStorage.removeItem(key);
  } catch {
    // Private-browsing modes can throw on storage access. Losing the sweep is
    // not a reason to lose the sign-out.
  }
}

type Tone = "themed" | "slate";

export default function SignOutButton({
  callbackUrl,
  collapsed = false,
  tone = "themed",
  portalLabel = "this portal",
}: {
  /** Where the sign-in page for THIS portal lives — each one has its own. */
  callbackUrl: string;
  collapsed?: boolean;
  /**
   * "themed" follows the Tag/Nacht/Dämmerung variables — the student portal.
   * "slate" is fixed light, for the admin and lecturer sidebars, which are
   * hardcoded white. Using theme variables there puts pale text on white the
   * moment somebody picks the dark theme.
   */
  tone?: Tone;
  portalLabel?: string;
}) {
  const { data: session } = useSession();
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const who = session?.user?.name || session?.user?.email || null;

  const go = () => {
    if (leaving) return;
    setLeaving(true);
    clearPersonalState();
    signOut({ callbackUrl });
  };

  const themed = tone === "themed";
  const mutedText = themed ? "text-[var(--muted)]" : "text-slate-500";
  const strongText = themed ? "text-[var(--foreground)]" : "text-slate-900";
  const surface = themed ? "bg-[var(--surface)]" : "bg-white";
  const border = themed ? "border-[var(--border)]" : "border-slate-200";
  const hover = themed ? "hover:bg-[var(--surface-alt)]" : "hover:bg-slate-100";

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        title={collapsed ? "Sign out" : ""}
        aria-label="Sign out"
        className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm transition-all duration-200 ${hover} ${
          collapsed ? "lg:justify-center lg:px-0" : ""
        }`}
      >
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${border} ${surface} shadow-sm transition group-hover:border-rose-300 group-hover:bg-rose-50 group-hover:text-rose-600`}
        >
          <ExitIcon className="h-4 w-4" />
        </span>
        {/* Collapsed hides the label on desktop only — the mobile drawer is
            always full width, so the icon must keep its word there. */}
        <span className={`min-w-0 flex-1 ${collapsed ? "lg:hidden" : ""}`}>
          <span className={`block font-medium ${strongText}`}>Sign out</span>
          {who && <span className={`block truncate text-xs ${mutedText}`}>{who}</span>}
        </span>
      </button>

      {/* Confirm, because this button lives one row below the last nav entry and
          a mis-tap during a live class costs a student the room. */}
      {confirming && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="signout-title"
            className={`w-full max-w-sm rounded-3xl border ${border} ${surface} p-6 shadow-2xl`}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
              <ExitIcon className="h-5 w-5" />
            </div>
            <h2 id="signout-title" className={`mt-4 text-lg font-bold ${strongText}`}>
              Sign out?
            </h2>
            <p className={`mt-1 text-sm ${mutedText}`}>
              You will be signed out of {portalLabel} on this device
              {who ? ` as ${who}` : ""}. You can sign back in any time.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={leaving}
                className={`flex-1 rounded-xl border ${border} px-4 py-2.5 text-sm font-semibold ${strongText} transition ${hover} disabled:opacity-50`}
              >
                Stay signed in
              </button>
              <button
                type="button"
                onClick={go}
                disabled={leaving}
                className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
              >
                {leaving ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
