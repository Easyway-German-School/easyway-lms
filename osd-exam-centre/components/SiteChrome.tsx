import Link from "next/link";
import NeedHelp from "@/components/NeedHelp";

export function SiteHeader() {
  return (
    <header className="border-b border-[var(--line)] bg-[var(--navy)]">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full border border-[var(--gold)] text-sm font-bold text-[var(--gold)]">
            EW
          </span>
          <span className="font-serif-display text-lg font-semibold text-white">
            Easyway <span className="text-[var(--gold)]">ÖSD</span> Examination Centre
          </span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm font-medium text-white/80 sm:flex">
          <Link href="/book" className="hover:text-white">Book an exam</Link>
          <Link href="/status" className="hover:text-white">Check my booking</Link>
          <a href="https://easywayschoollms.com.ng" className="hover:text-white">EasyWay LMS ↗</a>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--line)] py-10 text-center text-xs text-[var(--ink-soft)]">
      <p>Easyway German Language School — ÖSD-accredited examination centre, Lagos, Nigeria.</p>
      <p className="mt-1">
        Prep classes and student portal at{" "}
        <a href="https://easywayschoollms.com.ng" className="underline">easywayschoollms.com.ng</a>
      </p>
      <p className="mt-2 flex justify-center gap-4">
        <Link href="/terms" className="underline">Terms</Link>
        <Link href="/privacy" className="underline">Privacy</Link>
      </p>
      <div className="mt-4 flex justify-center">
        <NeedHelp />
      </div>
    </footer>
  );
}
