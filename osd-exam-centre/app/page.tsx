import Link from "next/link";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";

const STEPS = [
  { n: "01", title: "Register", body: "Enter your details exactly as they appear on your international passport." },
  { n: "02", title: "Pay", body: "Transfer the fee to the centre's account and upload your receipt." },
  { n: "03", title: "Upload documents", body: "A passport photograph and your passport's data page." },
  { n: "04", title: "Get your seat", body: "Once payment is confirmed your seat is reserved automatically — print your admission slip." },
];

const RULES = [
  "Do not arrive late — latecomers may not be admitted to the exam room.",
  "Bring a normal ballpoint pen. No pencils, no correction fluid.",
  "Bring your international passport's data page and your printed admission slip.",
  "Mobile phones and smart watches must be switched off and out of reach during the exam.",
  "A booking is not reversible or refundable once payment is confirmed.",
];

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main>
        <section className="border-b border-[var(--line)] bg-gradient-to-b from-[var(--navy)] to-[var(--navy-deep)] px-6 py-20 text-white">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gold)]">
              ÖSD Prüfungszentrum · Lagos
            </p>
            <h1 className="font-serif-display mt-5 text-4xl font-semibold leading-tight sm:text-5xl">
              Sit your ÖSD German examination in Nigeria
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-white/75">
              Easyway German Language School is Nigeria's ÖSD-accredited examination centre —
              internationally recognised in Germany, Austria and Switzerland. Register below.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/book"
                className="rounded-sm bg-[var(--gold)] px-8 py-3 text-sm font-semibold text-[var(--navy-deep)] transition hover:brightness-110"
              >
                Book your exam
              </Link>
              <Link
                href="/status"
                className="rounded-sm border border-white/30 px-8 py-3 text-sm font-semibold text-white/90 transition hover:bg-white/10"
              >
                Check an existing booking
              </Link>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="font-serif-display text-center text-2xl font-semibold text-[var(--navy)]">How registration works</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step) => (
              <div key={step.n} className="seal-border rounded-sm bg-[var(--paper-raised)] p-5">
                <p className="font-serif-display text-3xl text-[var(--gold)]">{step.n}</p>
                <p className="mt-3 font-semibold text-[var(--navy)]">{step.title}</p>
                <p className="mt-1.5 text-sm text-[var(--ink-soft)]">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-y border-[var(--line)] bg-[var(--gold-soft)]/40 px-6 py-16">
          <div className="mx-auto max-w-3xl">
            <h2 className="font-serif-display text-2xl font-semibold text-[var(--navy)]">Examination rules and requirements</h2>
            <ul className="mt-6 space-y-3">
              {RULES.map((rule) => (
                <li key={rule} className="flex gap-3 text-sm text-[var(--ink-soft)]">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--red)]" />
                  {rule}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-6 py-16 text-center">
          <h2 className="font-serif-display text-2xl font-semibold text-[var(--navy)]">After your exam</h2>
          <p className="mx-auto mt-4 max-w-xl text-sm text-[var(--ink-soft)]">
            ÖSD is a very learnable examination once you know its format and marking rules. Easyway runs
            preparatory classes for candidates who want structured practice before sitting — reading,
            listening, writing and speaking, marked the way the exam itself is marked.
          </p>
          <a
            href="https://easywayschoollms.com.ng/exams/osd"
            className="mt-6 inline-block rounded-sm border border-[var(--navy)] px-6 py-2.5 text-sm font-semibold text-[var(--navy)] hover:bg-[var(--navy)] hover:text-white"
          >
            Explore ÖSD prep classes
          </a>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
