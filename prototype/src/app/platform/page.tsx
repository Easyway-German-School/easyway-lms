import Link from "next/link";
import type { Metadata } from "next";
import EduPrimeLogo, { EduPrimeMark } from "@/components/platform/EduPrimeLogo";
import DemoRequestForm from "@/components/platform/DemoRequestForm";
import {
  EDUPRIME,
  EDUPRIME_PILLARS,
  EDUPRIME_STEPS,
} from "@/lib/platform/brand";

export const metadata: Metadata = {
  title: EDUPRIME.tagline,
  description: EDUPRIME.blurb,
};

/**
 * The EduPrime marketing site — the platform sold to a school owner.
 *
 * A public, unauthenticated page. It says plainly what EasyWay's own portal
 * never had reason to: this is a *platform*, a second school can run on it
 * without seeing the first, and the bill for doing so is one a school can
 * argue with. Honest about what is not built yet — a school owner has heard
 * every SaaS promise, and specificity is the only thing that reads as real.
 */

const METERS = [
  { meter: "ai.tokens", per: "1,000 tokens", source: "model provider" },
  { meter: "live.participant_minutes", per: "participant-minute", source: "LiveKit" },
  { meter: "storage.gb_month", per: "GB-month", source: "object storage" },
  { meter: "email.sent", per: "send", source: "email provider" },
  { meter: "api.request", per: "1,000 requests", source: "the platform" },
  { meter: "students.active_monthly", per: "active student", source: "the platform" },
];

const FAQ = [
  {
    q: "Is this separate from EasyWay?",
    a: "Yes. EasyWay German Language School is one school running on EduPrime — the first one. EduPrime is the layer underneath it: the tenancy, the billing ledger, the API, the operator console. A school on EduPrime never sees EasyWay's data, and EasyWay never sees theirs.",
  },
  {
    q: "Can a school use its own domain and branding?",
    a: "That is the point. Point a domain at us and that school's students see that school end to end — its name, its logo, its colour, its wording. The square app emblem stays ours; nothing else does.",
  },
  {
    q: "How is isolation actually enforced?",
    a: "Every database query is tenant-scoped underneath the ORM, from an identifier that rides on the request. A query against a school-owned table with no school in context throws in development rather than quietly returning another school's rows in production. Row-level security in the database is written and staged as the next layer.",
  },
  {
    q: "What does it cost?",
    a: "Prepaid credit, drawn down against six meters. Five of the six are pass-throughs of an invoice the platform already receives, so a school can be shown exactly which of its own actions produced each line. Final rates are set against real provider invoices during onboarding — we will not quote you a placeholder.",
  },
  {
    q: "Is there self-service signup?",
    a: "No, and that is deliberate. An operator creates each tenant, points the domain, issues the key and sets which features are live. Onboarding is a white-glove afternoon, not a form that leaves half-configured accounts behind.",
  },
];

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--primary)]">
      {children}
    </p>
  );
}

export default function EduPrimeMarketingPage() {
  return (
    <div className="min-h-screen text-[var(--foreground)]">
      {/* ---- nav ---- */}
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 sm:px-8">
          <EduPrimeLogo markSize={28} />
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/auth/admin"
              className="rounded-xl px-3.5 py-2 text-sm font-semibold text-[var(--foreground-soft)] transition hover:text-[var(--foreground)]"
            >
              Operator sign in
            </Link>
            <a
              href="#demo"
              className="eduprime-cta rounded-xl px-4 py-2 text-sm font-semibold"
            >
              Book a demo
            </a>
          </div>
        </div>
      </header>

      {/* ---- hero ---- */}
      <section className="relative overflow-hidden">
        <div className="eduprime-grid-bg pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-16 sm:px-8 sm:pb-24 sm:pt-24">
          <SectionEyebrow>The platform layer</SectionEyebrow>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
            {EDUPRIME.tagline}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--muted)] sm:text-lg">
            {EDUPRIME.blurb}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href="#demo" className="eduprime-cta rounded-xl px-6 py-3 text-sm font-semibold">
              Request onboarding
            </a>
            <a
              href="#how"
              className="rounded-xl border border-[var(--border-strong)] px-6 py-3 text-sm font-semibold text-[var(--foreground-soft)] transition hover:border-[var(--primary)] hover:text-[var(--foreground)]"
            >
              See how it works
            </a>
          </div>

          <div className="mt-14 grid max-w-3xl grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
            {[
              ["1", "deployment"],
              ["∞", "walled schools"],
              ["6", "usage meters"],
              ["1", "console"],
            ].map(([n, label]) => (
              <div key={label}>
                <p className="text-3xl font-semibold tracking-tight sm:text-4xl">{n}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">{label}</p>
              </div>
            ))}
          </div>
        </div>
        <hr className="eduprime-spectrum-rule border-0" />
      </section>

      {/* ---- two products ---- */}
      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
        <SectionEyebrow>Two products, one codebase</SectionEyebrow>
        <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
          The school is what a learner sees. The platform is what lets there be more than one.
        </h2>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
            <p className="text-sm font-semibold text-[var(--muted)]">The school</p>
            <p className="mt-2 text-lg font-semibold">Classes, tuition, live lessons, certificates</p>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              Students, tutors and office staff. Timetables, attendance, a gradebook, an exam
              centre, an AI tandem partner, a community. This is the part a school already knows
              it needs.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_6%,var(--surface))] p-6 sm:p-8">
            <div className="mb-1 flex items-center gap-2">
              <EduPrimeMark size={20} />
              <p className="text-sm font-semibold text-[var(--primary)]">The platform — EduPrime</p>
            </div>
            <p className="mt-2 text-lg font-semibold">Tenancy, billing, keys, the operator console</p>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              A second school runs on the same deployment and never sees the first one&apos;s data.
              Usage accrues against a prepaid ledger. Partners integrate through a scoped API. One
              console runs all of it.
            </p>
          </div>
        </div>
      </section>

      {/* ---- pillars ---- */}
      <section className="border-y border-[var(--border)] bg-[var(--surface-alt)]">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <SectionEyebrow>What you actually get</SectionEyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
            Specific promises, not a feature wall
          </h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {EDUPRIME_PILLARS.map((p) => (
              <div
                key={p.key}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6"
              >
                <p className="text-base font-semibold">{p.title}</p>
                <p className="mt-2.5 text-sm leading-6 text-[var(--muted)]">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- how ---- */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16 sm:px-8 sm:py-24">
        <SectionEyebrow>Onboarding a school</SectionEyebrow>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Four steps, one afternoon</h2>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {EDUPRIME_STEPS.map((s) => (
            <div key={s.n} className="relative rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white"
                style={{ background: "var(--primary)" }}
              >
                {s.n}
              </span>
              <p className="mt-3 text-base font-semibold">{s.title}</p>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- billing ---- */}
      <section className="border-y border-[var(--border)] bg-[var(--surface-alt)]">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <SectionEyebrow>Pricing you can argue with</SectionEyebrow>
          <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
            Five of six meters are a bill the platform already receives
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Prepaid credit in naira, drawn down nightly. Rounding happens once, in the daily
            rollup — never per event. Test-environment keys are never metered.
          </p>

          <div className="mt-8 overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-[var(--muted)]">
                <tr className="border-b border-[var(--border)]">
                  <th className="px-5 py-3 font-semibold">Meter</th>
                  <th className="px-5 py-3 font-semibold">Billed per</th>
                  <th className="px-5 py-3 font-semibold">Source</th>
                </tr>
              </thead>
              <tbody>
                {METERS.map((m) => (
                  <tr key={m.meter} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-5 py-3 font-mono text-[13px]">{m.meter}</td>
                    <td className="px-5 py-3 text-[var(--muted)]">{m.per}</td>
                    <td className="px-5 py-3 text-[var(--muted)]">{m.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---- honesty ---- */}
      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
          <SectionEyebrow>Straight about the edges</SectionEyebrow>
          <ul className="mt-4 grid gap-3 text-sm leading-6 text-[var(--muted)] sm:grid-cols-2">
            <li>
              <span className="font-semibold text-[var(--foreground)]">Nothing is auto-suspended.</span>{" "}
              A school at zero balance is warned, then served — enforcement is a deliberate operator
              decision, not a switch that trips overnight.
            </li>
            <li>
              <span className="font-semibold text-[var(--foreground)]">Rates are set during onboarding.</span>{" "}
              Against real provider invoices and a stated margin. No customer sees a placeholder number.
            </li>
            <li>
              <span className="font-semibold text-[var(--foreground)]">Enrolment stays in-app.</span>{" "}
              The API reads students, payments, classes and attendance; it does not create accounts,
              because half of that flow over an API leaves accounts the school&apos;s own screens
              cannot finish.
            </li>
            <li>
              <span className="font-semibold text-[var(--foreground)]">Onboarding is by hand.</span>{" "}
              On purpose. You get a person, not a wizard.
            </li>
          </ul>
        </div>
      </section>

      {/* ---- demo ---- */}
      <section id="demo" className="border-t border-[var(--border)] bg-[var(--surface-alt)]">
        <div className="mx-auto max-w-3xl scroll-mt-20 px-5 py-16 sm:px-8 sm:py-24">
          <SectionEyebrow>Talk to an operator</SectionEyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
            Tell us about your school
          </h2>
          <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
            We&apos;ll walk through your domain, your branding, the features you want live, and
            pricing against your real usage. Or email{" "}
            <a className="font-semibold text-[var(--primary)]" href={`mailto:${EDUPRIME.contactEmail}`}>
              {EDUPRIME.contactEmail}
            </a>
            .
          </p>
          <div className="mt-8">
            <DemoRequestForm />
          </div>
        </div>
      </section>

      {/* ---- faq ---- */}
      <section className="mx-auto max-w-3xl px-5 py-16 sm:px-8 sm:py-24">
        <SectionEyebrow>Questions</SectionEyebrow>
        <div className="mt-8 divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold">
                {f.q}
                <span className="text-[var(--muted)] transition group-open:rotate-45">＋</span>
              </summary>
              <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ---- footer ---- */}
      <footer className="border-t border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <EduPrimeLogo markSize={24} />
            <p className="mt-3 text-xs text-[var(--muted)]">{EDUPRIME.positioning}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {EDUPRIME.legalName} · built alongside EasyWay German Language School
            </p>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-[var(--muted)]">
            <Link href="/auth/admin" className="hover:text-[var(--foreground)]">Operator sign in</Link>
            <a href={`mailto:${EDUPRIME.contactEmail}`} className="hover:text-[var(--foreground)]">Contact</a>
            <Link href="/privacy" className="hover:text-[var(--foreground)]">Privacy</Link>
            <Link href="/terms" className="hover:text-[var(--foreground)]">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
