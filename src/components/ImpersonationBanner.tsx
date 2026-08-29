"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { EyeIcon } from "@/components/icons";

/**
 * The one thing that tells an admin they are inside a student's account
 * instead of their own. The student's own device carries none of this — it
 * only ever renders in the browser that holds the act-as session. See
 * src/lib/impersonation.ts for the mechanism this is the visible half of.
 */
export default function ImpersonationBanner() {
  const { data: session } = useSession();
  const [ending, setEnding] = useState(false);
  const impersonatedBy = session?.user?.impersonatedBy;

  if (!impersonatedBy) return null;

  async function endSession() {
    setEnding(true);
    try {
      const res = await fetch("/api/admin/impersonate/end", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      // Hard navigation, and replace() rather than href: the session cookie
      // just changed under this tab, so next-auth's client cache has no way
      // to know that on its own — and a push would leave the student
      // dashboard sitting in this admin's history as something Back can
      // land on later, after the session behind it has already moved on.
      window.location.replace(res.ok && data.redirectTo ? data.redirectTo : "/admin");
    } catch {
      window.location.replace("/admin");
    }
  }

  return (
    <div className="sticky top-0 z-[60] flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm font-semibold text-amber-950">
      <EyeIcon className="h-4 w-4 shrink-0" />
      <span>You are acting as this student. They cannot tell — end this the moment you are done.</span>
      <button
        onClick={endSession}
        disabled={ending}
        className="shrink-0 rounded-lg bg-amber-950 px-3 py-1 text-xs font-bold text-amber-50 transition hover:bg-amber-900 disabled:opacity-60"
      >
        {ending ? "Returning…" : "Return to admin"}
      </button>
    </div>
  );
}
