"use client";

import { usePathname } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";

export default function PageContainer({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthRoute = pathname?.startsWith("/auth") ?? false;

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[var(--background)] text-[var(--foreground)] transition-colors duration-300">
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
    </main>
  );
}
