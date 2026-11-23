import Image from "next/image";
import Link from "next/link";
import NeedHelp from "@/components/NeedHelp";
import easywayLogo from "@/assets/brand/easyway-logo.png";
import osdLogo from "@/assets/brand/osd-logo.png";

/** The two accredited parties, side by side — partnership-style, not just a monogram. */
export function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-3 rounded-lg bg-white px-3 py-2 shadow-sm">
      <Image src={easywayLogo} alt="Easyway German Language School" className={compact ? "h-9 w-auto" : "h-12 w-auto"} priority />
      <span className="h-8 w-px bg-[var(--line)]" aria-hidden="true" />
      <Image src={osdLogo} alt="ÖSD — Licensed Examination Centre" className={compact ? "h-9 w-auto" : "h-12 w-auto"} priority />
    </span>
  );
}

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
          <BrandLockup compact />
          <span className="font-serif-display hidden truncate text-lg font-semibold leading-none text-white md:inline">
            ÖSD Examination Centre
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
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <BrandLockup />
            <span className="font-serif-display min-w-0 text-lg font-semibold text-white">
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
