import Image from "next/image";
import castle from "@/assets/images/neuschwanstein.jpg";
import { ArrowRightIcon } from "@/components/icons";
import { EXAM_PREP_LINK } from "@/lib/config";

/** The soft-sell into Easyway's prep classes — the actual business model behind this centre. */
export default function PrepBanner() {
  return (
    <section className="relative isolate overflow-hidden text-white">
      <Image
        src={castle}
        alt="Neuschwanstein Castle on its cliff above the Bavarian countryside"
        fill
        placeholder="blur"
        sizes="100vw"
        className="-z-10 object-cover object-[50%_35%]"
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#071328]/90 via-[#071328]/45 to-transparent" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-[#071328]/40 to-transparent" />

      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-6 sm:py-32">
        <div className="reveal max-w-xl">
          <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--gold-bright)]">
            <span className="h-px w-8 bg-[var(--gold-bright)]" />
            Prepare with Easyway
          </p>
          <h2 className="font-serif-display mt-4 text-4xl font-semibold leading-tight sm:text-5xl">
            Walk into the exam room ready.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-white/80">
            ÖSD is a very learnable examination once you know its format and marking rules. Easyway runs
            preparatory classes for candidates who want structured practice before sitting — reading,
            listening, writing and speaking, marked the way the exam itself is marked.
          </p>
          <a
            href={EXAM_PREP_LINK}
            className="group mt-8 inline-flex items-center gap-2 rounded-full bg-[var(--gold-bright)] px-8 py-3.5 text-sm font-semibold text-[var(--navy-deep)] shadow-xl shadow-black/30 transition hover:brightness-110"
          >
            Explore ÖSD prep classes
            <ArrowRightIcon className="h-4 w-4 transition group-hover:translate-x-1" />
          </a>
        </div>
      </div>
    </section>
  );
}
