import Link from "next/link";
import NeedHelp from "@/components/NeedHelp";

/**
 * `overlay` floats transparently over a photo hero (landing page, page
 * banners); `solid` is the plain navy bar used where there is no photo
 * (terms, privacy).
 */
export function SiteHeader({ variant = "solid" }: { variant?: "solid" | "overlay" }) {
  const overlay = variant === "overlay";
  return (
    <header
      className={
        overlay
          ? "absolute inset-x-0 top-0 z-30"
          : "border-b border-white/10 bg-[var(--navy)]"
      }
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--gold-bright)] bg-[var(--navy)]/40 text-sm font-bold text-[var(--gold-bright)] backdrop-blur">
            EW
          </span>
          <span className="font-serif-display truncate text-lg font-semibold leading-none text-white">
            Easyway <span className="text-[var(--gold-bright)]">ÖSD</span>
            <span className="hidden sm:inline"> Examination Centre</span>
          </span>
        </Link>
        <nav className="flex shrink-0 items-center gap-1 text-sm font-medium text-white/85 sm:gap-2">
          <Link href="/status" className="rounded-full px-3 py-2 transition hover:bg-white/10 hover:text-white max-[430px]:hidden">
            <span className="sm:hidden">My booking</span>
            <span className="hidden sm:inline">Check my booking</span>
          </Link>
          <a
            href="https://easywayschoollms.com.ng"
            className="hidden rounded-full px-3 py-2 transition hover:bg-white/10 hover:text-white md:inline"
          >
            Easyway LMS ↗
          </a>
          <Link
            href="/book"
            className="rounded-full bg-[var(--gold-bright)] px-4 py-2 font-semibold text-[var(--navy-deep)] shadow-lg shadow-black/20 transition hover:brightness-110"
          >
            Book<span className="hidden sm:inline"> an exam</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden bg-gradient-to-b from-[var(--navy)] to-[var(--navy-deep)] text-white/75">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--gold-bright)]/60 to-transparent" />
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-full border border-[var(--gold-bright)] text-sm font-bold text-[var(--gold-bright)]">
              EW
            </span>
            <span className="font-serif-display text-lg font-semibold text-white">
              Easyway <span className="text-[var(--gold-bright)]">ÖSD</span> Examination Centre
            </span>
          </div>
          <p className="mt-4 max-w-sm text-sm leading-relaxed">
            Easyway German Language School — ÖSD-accredited examination centre, Lagos, Nigeria.
            Your certificate, recognised across Germany, Austria and Switzerland.
          </p>
          <div className="mt-5">
            <NeedHelp tone="dark" />
          </div>
        </div>

        <nav aria-label="Candidates">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--gold-bright)]">Candidates</p>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li><Link href="/book" className="transition hover:text-white">Book an exam</Link></li>
            <li><Link href="/status" className="transition hover:text-white">Check my booking</Link></li>
            <li><Link href="/terms" className="transition hover:text-white">Terms of booking</Link></li>
            <li><Link href="/privacy" className="transition hover:text-white">Privacy</Link></li>
          </ul>
        </nav>

        <nav aria-label="Easyway">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--gold-bright)]">Easyway</p>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li>
              <a href="https://easywayschoollms.com.ng/exams/osd" className="transition hover:text-white">ÖSD prep classes</a>
            </li>
            <li>
              <a href="https://easywayschoollms.com.ng" className="transition hover:text-white">Student portal</a>
            </li>
            <li><Link href="/credits" className="transition hover:text-white">Photo credits</Link></li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-white/10 px-6 py-5 text-center text-xs text-white/50">
        © {new Date().getFullYear()} Easyway German Language School, Lagos. All rights reserved.
      </div>
    </footer>
  );
}
