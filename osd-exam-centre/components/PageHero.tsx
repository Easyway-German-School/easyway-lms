import Image, { type StaticImageData } from "next/image";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/SiteChrome";

/**
 * Photo banner for inner pages (book, status, booking). The page content is
 * meant to overlap its bottom edge (`-mt-*` on the <main> that follows), which
 * is what makes forms feel like part of the journey rather than a separate app.
 */
export default function PageHero({
  eyebrow,
  title,
  subtitle,
  image,
  alt,
  position = "object-center",
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  image: StaticImageData;
  alt: string;
  position?: string;
  children?: ReactNode;
}) {
  return (
    <section className="relative isolate overflow-hidden bg-[var(--navy-deep)] text-white">
      <Image
        src={image}
        alt={alt}
        fill
        preload
        placeholder="blur"
        sizes="100vw"
        className={`-z-10 object-cover ${position}`}
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[#071328]/85 via-[#071328]/55 to-[#071328]/92" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#071328]/70 via-transparent to-transparent" />
      <div className="grain absolute inset-0 -z-10" />

      <SiteHeader variant="overlay" />

      <div className="mx-auto max-w-3xl px-5 pb-28 pt-32 sm:px-6 sm:pt-36">
        <p className="fade-up flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--gold-bright)]">
          <span className="h-px w-8 bg-[var(--gold-bright)]" />
          {eyebrow}
        </p>
        <h1 className="font-serif-display fade-up delay-1 mt-4 text-4xl font-semibold leading-tight sm:text-5xl">{title}</h1>
        {subtitle && <p className="fade-up delay-2 mt-4 max-w-xl text-base leading-relaxed text-white/80">{subtitle}</p>}
        {children}
      </div>
    </section>
  );
}
