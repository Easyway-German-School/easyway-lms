"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useState } from "react";
import StudentShell from "@/components/StudentShell";
import Mascot from "@/components/Mascot";
import {
  ArrowRightIcon,
  CalendarIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ClockIcon,
  ExternalLinkIcon,
  GraduationCapIcon,
  MapIcon,
  SparklesIcon,
  TrophyIcon,
} from "@/components/icons";
import {
  campaignPhase,
  deadlineCountdown,
  examDatesLabel,
  feeForLevel,
  formatMoney,
  type ExamCampaignConfig,
} from "@/lib/exam-campaign";

type Response = { registered: boolean; enquired: boolean };

const WHY = [
  { icon: GraduationCapIcon, title: "Internationally recognised", body: "Accepted in Germany, Austria, Switzerland and by German authorities for visa, study and work." },
  { icon: MapIcon, title: "Now in Nigeria", body: "Sit it in Ikeja, Lagos — no travelling to Ghana, Togo or Benin for a slot." },
  { icon: SparklesIcon, title: "Free preparation class", body: "Registered candidates get a free prep session the day before the exam." },
  { icon: ClockIcon, title: "Fast results", body: "Regular results in about 2–4 weeks; an express option turns it around in about a week." },
  { icon: TrophyIcon, title: "Professionally marked", body: "Assessed through ÖSD's own authorised examiners, not judged only at the local centre." },
  { icon: CheckCircleIcon, title: "Affordable", body: "Priced so more Nigerian candidates can get an official German certificate close to home." },
];

function longDate(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function OsdExamPage() {
  const [config, setConfig] = useState<ExamCampaignConfig | null>(null);
  const [response, setResponse] = useState<Response>({ registered: false, enquired: false });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<null | "registered" | "undo" | "enquire">(null);

  const [level, setLevel] = useState<string>("A1");
  const [express, setExpress] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  useEffect(() => {
    fetch("/api/student/exam-campaign", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.campaign) return;
        setConfig(data.campaign as ExamCampaignConfig);
        setResponse(data.response ?? { registered: false, enquired: false });
        const levels = (data.campaign as ExamCampaignConfig).levels;
        if (levels?.length) setLevel(levels[0]);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const act = useCallback(async (action: "registered" | "undo" | "enquire") => {
    setBusy(action);
    try {
      const res = await fetch("/api/student/exam-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data?.response) setResponse(data.response);
    } catch {
      /* ignore — the buttons stay available to retry */
    } finally {
      setBusy(null);
    }
  }, []);

  const fee = useMemo(() => (config ? feeForLevel(config, level) ?? 0 : 0), [config, level]);
  const total = fee + (express && config ? config.expressFee : 0);

  if (!loaded) {
    return (
      <StudentShell>
        <div className="px-6 py-16 text-center text-sm text-[var(--muted)]">Loading…</div>
      </StudentShell>
    );
  }

  if (!config) {
    return (
      <StudentShell>
        <div className="mx-auto max-w-lg px-6 py-16 text-center">
          <Mascot mood="thinking" className="mx-auto h-24 w-24" />
          <p className="mt-4 text-sm text-[var(--muted)]">There is no exam campaign running right now.</p>
        </div>
      </StudentShell>
    );
  }

  const phase = campaignPhase(config);
  const countdown = deadlineCountdown(config);
  const closed = phase === "closed" || phase === "disabled" || countdown.started;

  return (
    <StudentShell>
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        {/* ------------------------------------------------------------- hero */}
        <section className="overflow-hidden rounded-[28px] bg-gradient-to-br from-[#0D7C7E] via-[#0D7C7E] to-[#FF6600] px-6 py-7 text-white sm:px-9 sm:py-9">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <Mascot mood="presenting" className="h-28 w-28 shrink-0 drop-shadow-xl" />
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-white/75">
                {config.examBody} German Examination
              </p>
              <h1 className="mt-2 text-2xl font-extrabold leading-tight sm:text-3xl">{config.title}</h1>
              <p className="mt-2 text-sm text-white/85">{config.tagline}</p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-bold">
              <CalendarIcon className="h-3.5 w-3.5" />
              Exam {examDatesLabel(config)}
            </span>
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-bold ${
                closed ? "bg-white/15" : phase === "closing-soon" ? "bg-white text-[#B91C1C]" : "bg-white/15"
              }`}
            >
              <ClockIcon className="h-3.5 w-3.5" />
              {closed ? "Registration closed" : `Closes ${countdown.label} · ${longDate(config.registrationDeadline)}`}
            </span>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href={config.registerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-[#0D7C7E] transition hover:bg-white/90"
            >
              Register on the {config.examBody} site <ExternalLinkIcon className="h-4 w-4" />
            </a>
            {response.registered ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-white/40 px-5 py-3 text-sm font-semibold">
                <CheckCircleIcon className="h-4 w-4" /> You&apos;ve marked yourself registered
              </span>
            ) : (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => act("registered")}
                className="inline-flex items-center gap-2 rounded-full border border-white/50 px-5 py-3 text-sm font-semibold transition hover:bg-white/10 disabled:opacity-60"
              >
                {busy === "registered" ? "Saving…" : "I've registered"}
              </button>
            )}
          </div>
          {response.registered ? (
            <button
              type="button"
              onClick={() => act("undo")}
              disabled={busy !== null}
              className="mt-2 text-xs font-medium text-white/70 underline"
            >
              Not registered yet? Undo
            </button>
          ) : null}
        </section>

        <p className="mt-6 text-sm leading-6 text-[var(--foreground-soft)]">{config.blurb}</p>

        {/* -------------------------------------------------- fee calculator */}
        <section className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
          <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--muted)]">What it costs</h2>

          <div className="mt-4 flex flex-wrap gap-2">
            {config.levels.map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setLevel(lvl)}
                className={`rounded-full border px-4 py-2 text-sm font-bold transition ${
                  level === lvl
                    ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-alt)]"
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>

          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-[var(--surface-alt)] p-3.5">
            <input
              type="checkbox"
              checked={express}
              onChange={(e) => setExpress(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
            />
            <span>
              <span className="block text-sm font-semibold text-[var(--foreground)]">
                Express result — {formatMoney(config.expressFee, config.currency)}
              </span>
              <span className="block text-xs text-[var(--muted)]">
                Result in {config.expressResultText} instead of {config.regularResultText}.
              </span>
            </span>
          </label>

          <div className="mt-4 flex items-end justify-between rounded-xl bg-[var(--accent)]/[0.06] p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                {level} {express ? "· with express" : ""}
              </p>
              <p className="mt-1 text-3xl font-black text-[var(--foreground)]">{formatMoney(total, config.currency)}</p>
            </div>
            <p className="text-right text-xs text-[var(--muted)]">
              Exam {formatMoney(fee, config.currency)}
              {express ? <><br />Express {formatMoney(config.expressFee, config.currency)}</> : null}
            </p>
          </div>
          <p className="mt-2 text-[11px] text-[var(--muted)]">
            Paid on the {config.examBody} registration site, not in the portal.
          </p>
        </section>

        {/* -------------------------------------------------------- timeline */}
        <section className="mt-8">
          <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--muted)]">How it runs</h2>
          <ol className="mt-4 space-y-3">
            {[
              { when: `By ${longDate(config.registrationDeadline)}`, what: `Register and pay on the ${config.examBody} site.` },
              { when: longDate(config.prepClassDate), what: `Free preparation class — ${config.prepClassVenue}.` },
              { when: examDatesLabel(config), what: "The exam, across reading, listening, writing and speaking." },
              { when: `Then ${config.regularResultText}`, what: `Results (${config.expressResultText} with express).` },
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-xs font-bold text-white">
                    {i + 1}
                  </span>
                  {i < 3 ? <span className="mt-1 w-px flex-1 bg-[var(--border)]" /> : null}
                </div>
                <div className="pb-2">
                  <p className="text-sm font-semibold text-[var(--foreground)]">{step.when}</p>
                  <p className="text-xs text-[var(--muted)]">{step.what}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ------------------------------------------------------------- why */}
        <section className="mt-8">
          <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--muted)]">Why take it</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {WHY.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
                  <Icon className="h-4 w-4" />
                </span>
                <p className="mt-2.5 text-sm font-bold text-[var(--foreground)]">{title}</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------- venues */}
        <section className="mt-8">
          <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--muted)]">Where</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {config.venues.map((v) => (
              <div key={v.address} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="flex items-center gap-2 text-sm font-bold text-[var(--foreground)]">
                  <MapIcon className="h-4 w-4 text-[var(--accent)]" /> {v.name}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">{v.address}</p>
              </div>
            ))}
          </div>
          <a
            href={config.practiceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent)]"
          >
            Official practice materials & model questions <ExternalLinkIcon className="h-4 w-4" />
          </a>
        </section>

        {/* ------------------------------------------------------------- faq */}
        <section className="mt-8">
          <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--muted)]">Questions</h2>
          <div className="mt-4 divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)]">
            {[
              { q: "Which levels can I sit?", a: `${config.levels.join(", ")}. Pick the level you have been preparing for.` },
              { q: "Is the ÖSD certificate accepted in Germany?", a: "Yes — it is recognised in Germany, Austria and Switzerland, and can be used for visa, study, employment and Ausbildung purposes depending on the specific requirement." },
              { q: "How do I actually register?", a: `Online, on the ${config.examBody} registration site linked at the top of this page. Once you have registered there, come back and tap "I've registered" so we stop reminding you.` },
              { q: "What is the free prep class?", a: `A free session on ${longDate(config.prepClassDate)} at ${config.prepClassVenue}, walking through the exam format and the task types so you go in familiar with it.` },
              { q: "I still have a question", a: `Use "Ask the office" below and someone will get back to you here in the portal. You can also email ${config.contactEmail}.` },
            ].map((item, i) => (
              <div key={i}>
                <button
                  type="button"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold text-[var(--foreground)]"
                >
                  {item.q}
                  <ChevronDownIcon className={`h-4 w-4 shrink-0 transition ${openFaq === i ? "rotate-180" : ""}`} />
                </button>
                {openFaq === i ? <p className="px-4 pb-3 text-xs leading-relaxed text-[var(--muted)]">{item.a}</p> : null}
              </div>
            ))}
          </div>
        </section>

        {/* --------------------------------------------------------- actions */}
        <section className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-5 text-center">
          <p className="text-sm font-semibold text-[var(--foreground)]">Ready?</p>
          <div className="mt-3 flex flex-wrap justify-center gap-3">
            <a
              href={config.registerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-bold text-white transition hover:brightness-110"
            >
              Register now <ArrowRightIcon className="h-4 w-4" />
            </a>
            {response.enquired ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-5 py-3 text-sm font-semibold text-[var(--muted)]">
                <CheckCircleIcon className="h-4 w-4" /> The office has your enquiry
              </span>
            ) : (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => act("enquire")}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-5 py-3 text-sm font-semibold text-[var(--foreground-soft)] transition hover:bg-[var(--surface)] disabled:opacity-60"
              >
                {busy === "enquire" ? "Sending…" : "Ask the office"}
              </button>
            )}
          </div>
        </section>
      </div>
    </StudentShell>
  );
}
