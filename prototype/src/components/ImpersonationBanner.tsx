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
  const { data: session, update } = useSession();
  const [ending, setEnding] = useState(false);
  const impersonatedBy = session?.user?.impersonatedBy;

  if (!impersonatedBy) return null;

  async function endSession() {
    setEnding(true);
    try {
      const res = await fetch("/api/admin/impersonate/end", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      // The cookie changes on the server, but SessionProvider may still hold
      // the student's role in memory. Refresh it before entering an admin
      // route, or AdminShell can mistake the handoff for a real student and
      // send the admin to the student sign-in page.
      if (res.ok) await update();
      // Replace rather than push: the student dashboard must not remain in
      // this admin's history after the session has moved back.
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
