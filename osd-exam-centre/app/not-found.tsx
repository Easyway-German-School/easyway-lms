import Link from "next/link";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";

export default function NotFound() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-md px-6 py-24 text-center">
        <p className="font-serif-display text-5xl text-[var(--gold)]">404</p>
        <h1 className="mt-3 text-xl font-semibold text-[var(--navy)]">Page not found</h1>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          That page doesn't exist. If you're looking for a booking, check its status instead.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/" className="rounded-sm bg-[var(--navy)] px-5 py-2.5 text-sm font-semibold text-white">Home</Link>
          <Link href="/status" className="rounded-sm border border-[var(--line)] px-5 py-2.5 text-sm font-semibold text-[var(--navy)]">Check my booking</Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
