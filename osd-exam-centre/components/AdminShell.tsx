"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { BrandLockup } from "@/components/SiteChrome";

const NAV = [
  { href: "/admin", label: "Candidates" },
  { href: "/admin/sessions", label: "Sittings" },
  { href: "/admin/support", label: "Help requests" },
] as const;

/**
 * One shared sidebar for every /admin/* page (except /admin/login, which has
 * no session yet to show a sidebar for). Replaces each page repeating its own
 * "← Bookings" / "Sittings" / "Sign out" links in its own header — one place
 * to navigate the back office, so nothing feels scattered across pages.
 */
export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
  }

  return (
    <div className="min-h-screen bg-[var(--paper)] md:flex">
      <aside className="shrink-0 border-b border-[var(--line)] bg-white md:w-56 md:border-b-0 md:border-r md:border-[var(--line)]">
        <div className="px-4 py-4">
          <BrandLockup compact />
        </div>
        <nav className="flex items-center gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:items-stretch md:overflow-visible md:pb-4">
          {NAV.map((item) => {
            const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`shrink-0 rounded-sm px-3 py-2 text-sm font-semibold transition ${
                  active ? "bg-[var(--navy)] text-white" : "text-[var(--ink-soft)] hover:bg-[var(--paper)]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <button
            onClick={logout}
            className="ml-auto shrink-0 rounded-sm border border-[var(--line)] px-3 py-2 text-sm font-semibold text-[var(--ink-soft)] hover:border-[var(--red)] hover:text-[var(--red)] md:ml-0 md:mt-2 md:text-left"
          >
            Sign out
          </button>
        </nav>
      </aside>
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}
