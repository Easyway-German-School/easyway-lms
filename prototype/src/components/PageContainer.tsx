"use client";

import { usePathname } from "next/navigation";
import InstallPrompt from "@/components/InstallPrompt";
import ThemeToggle from "@/components/ThemeToggle";

export default function PageContainer({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthRoute = pathname?.startsWith("/auth") ?? false;

  return (
    // `app-canvas` rather than `bg-[var(--background)]` — Tailwind's arbitrary
    // background utility sets background-color, which cannot hold a gradient,
    // so this element used to be transparent and the (hardcoded, dark) body
    // showed through under every theme.
    <main
      className={`app-canvas relative min-h-screen overflow-x-hidden text-[var(--foreground)] transition-colors duration-300 ${
        isAuthRoute ? "theme-light" : ""
      }`}
    >
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="scene-stars" />
        <div className="scene-grid" />
        <div className="scene-aurora left-10 top-16" />
        <div className="scene-aurora right-16 top-24" />
        <div className="scene-halo right-1/3 top-1/2" />
        <div className="scene-scanline" />
      </div>
      <div className="relative opacity-100 transition-opacity duration-200">
        {children}
      </div>
      {!isAuthRoute ? <ThemeToggle /> : null}
      {/* Wraps all three portals, so students, tutors and staff are each
          offered the install from wherever they happen to be. It registers the
          service worker too, which is why it is not itself gated on the route. */}
      <InstallPrompt />
    </main>
  );
}
