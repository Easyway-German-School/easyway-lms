"use client";

import { useSession } from "next-auth/react";
import AdminShell from "@/components/AdminShell";
import LecturerShell from "@/components/LecturerShell";
import StudentShell from "@/components/StudentShell";
import { normalizeRole } from "@/lib/portal";

/**
 * The chrome for a page that more than one kind of person uses.
 *
 * `/community` and `/live` sit in the student, tutor AND admin sidebars, but
 * `/community` was hard-wired to `StudentShell`. A tutor who clicked Community
 * got the student sidebar, and from there every link led further into the
 * student portal — they had no way back to their own without the address bar.
 *
 * Rendering nothing until the session resolves would flash the page's chrome
 * from one portal to another, so the unauthenticated/loading case gets a plain
 * wrapper and the real shell appears once the role is known.
 *
 * `public` marks a page that members of the public can reach as well — the
 * exam centre sells sittings to people who have no account. Signed out, they
 * get the bare page rather than a student sidebar full of links that would ask
 * them to sign in.
 */
export default function PortalShell({
  children,
  public: isPublic = false,
}: {
  children: React.ReactNode;
  public?: boolean;
}) {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return <div className="min-h-screen bg-[var(--background)]">{children}</div>;
  }

  if (isPublic && !session?.user) {
    return <div className="min-h-screen bg-[var(--background)]">{children}</div>;
  }

  switch (normalizeRole((session?.user as { role?: string } | undefined)?.role)) {
    case "admin":
      return <AdminShell>{children}</AdminShell>;
    case "lecturer":
      return <LecturerShell>{children}</LecturerShell>;
    default:
      return <StudentShell>{children}</StudentShell>;
  }
}
