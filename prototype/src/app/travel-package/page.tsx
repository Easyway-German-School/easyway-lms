"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import StudentShell from "@/components/StudentShell";
import Mascot from "@/components/Mascot";
import {
  PlaneIcon,
  SparklesIcon,
  ChevronDownIcon,
  CheckCircleIcon,
  GraduationCapIcon,
  ToolboxIcon,
  BriefcaseIcon,
  CareIcon,
  MapIcon,
  DocumentIcon,
  ShieldIcon,
} from "@/components/icons";

/**
 * THE TRAVEL PACKAGE VISA & INTERVIEW PREP GUIDE.
 *
 * Travel Package students are the one group actually walking into a German
 * visa interview, not just a classroom — the office's own "German Visa
 * Interview Bootcamp" handbook and final-exam worksheet (99 + 47 pages) carry
 * the real substance, but nobody was going to read either cover to cover on
 * a phone. This is that material cut down to what a student actually uses in
 * the ten minutes before the office calls them in: pick the route that is
 * actually theirs, see what the officer is checking for on it, flip through
 * the questions that come up every time, and tick off the documents as they
 * get them.
 *
 * Visible to Travel Package students only — see the gate below. Reached from
 * Becca's one-time announcement (lib/travel-package-prep-notice.ts) and from
 * the Travel Package card on /programs.
 */

type RouteKey = "study" | "ausbildung" | "work" | "aupair";

type RouteBrief = {
  key: RouteKey;
  label: string;
  icon: typeof GraduationCapIcon;
  tagline: string;
  know: string;
  prepare: string;
  doThis: string;
  dontDo: string;
  mock: string[];
};

const ROUTE_BRIEFS: RouteBrief[] = [
  {
    key: "study",
    label: "University study",
    icon: GraduationCapIcon,
    tagline: "Bachelor, master, Studienkolleg or a student PhD",
    know:
      "The interview connects your academic history, your exact admission, the course content and how it's financed. A related master's is easier to explain than a field change — but a field change is not automatically a problem if you can explain the bridge.",
    prepare:
      "Read every line of the admission letter — programme title, campus, teaching language, start date, conditions, enrolment deadline. Name three modules you'll actually take. Know the city, the federal state and roughly what you'll pay.",
    doThis: "Link your previous learning to specific modules. Say clearly whether you have an admission offer or completed enrolment — they are not the same thing.",
    dontDo: "Don't invent university rankings or professors. Don't claim every German university is free, and don't imply a blocked account also covers unpaid tuition.",
    mock: [
      "Why this degree?",
      "Which two modules matter most to you?",
      "How does that connect to what you studied before?",
      "Where is that shown in your documents?",
      "How will you fund the full first year?",
    ],
  },
  {
    key: "ausbildung",
    label: "Ausbildung",
    icon: ToolboxIcon,
    tagline: "Vocational training with a signed contract",
    know:
      "Know whether your programme is dual (company + school) or school-based. The officer wants the occupation, the training provider, the school, the duration and the pay — not a vague 'training in Germany'.",
    prepare:
      "Read your contract aloud, in plain language, before the interview. Know the employer, the school, the start date, gross pay for each year, hours, leave and any accommodation deduction. Check the language level the actual programme expects — it can be higher than the visa minimum.",
    doThis: "Explain why you want this occupation and how the classroom and workplace halves connect.",
    dontDo: "Don't describe training as an unrestricted full-time skilled job. Don't confuse gross and take-home pay. A recruiter's verbal promise is not the signed contract.",
    mock: [
      "What is the exact German title of your training occupation?",
      "Who is your training employer, and where are they located?",
      "What will you learn in year one?",
      "What is your gross pay, and is there a funding gap?",
      "What happens if the start date moves?",
    ],
  },
  {
    key: "work",
    label: "Skilled work",
    icon: BriefcaseIcon,
    tagline: "A real job offer, or the EU Blue Card",
    know:
      "A regular skilled-worker visa and an EU Blue Card are not the same route — each has its own qualification and salary conditions. Know which one your offer actually fits before the interview, not during it.",
    prepare:
      "Research the employer on their own site, not just the offer letter. Know the exact job title, duties, salary, hours and start date. For a Blue Card, check the current salary threshold yourself rather than using a figure a friend quoted months ago.",
    doThis: "Explain your own recruitment and duties. Know the difference between base salary, variable pay and take-home pay.",
    dontDo: "Don't describe an unsigned offer as a signed contract. Don't hide a previous refusal or job — it comes up, and the honest version is always the better one to have told first.",
    mock: [
      "What is your exact job title and what will you be doing?",
      "How were you assessed for the role?",
      "What qualification supports it?",
      "What is the salary, and which route does that meet?",
      "When does employment begin?",
    ],
  },
  {
    key: "aupair",
    label: "Au Pair",
    icon: CareIcon,
    tagline: "Cultural exchange with a host family",
    know:
      "This is a cultural-exchange arrangement, not an unlimited domestic-work placement — the mission checks for ages 18–26, a 6–12 month stay, and that you are not related to the host parents.",
    prepare:
      "Know the host parents' names, the children's ages, the household's daily routine, your agreed duties and where you'll attend language classes. Have had genuine direct contact with the family — not just an agency profile.",
    doThis: "Explain your real interest in children and cultural exchange, and answer a simple German question naturally rather than from memory.",
    dontDo: "Don't invent childcare experience, and don't accept an unlimited workload without asking first — that's a fair question to ask the family themselves, not a red flag to hide.",
    mock: [
      "Why do you want to be an au pair?",
      "Why this family, and how did you find them?",
      "What are the children's ages and routine?",
      "What language is used in the household?",
      "Whom would you contact if something felt unsafe?",
    ],
  },
];

const FOUNDATION_CARDS = [
  {
    title: "What the appointment is really for",
    body:
      "It's an evidence conversation, not an exam with a pass mark. Expect questions that connect your stated purpose to your qualifications, funding, host or itinerary. An official may ask for clarification — that is normal, not a bad sign. Being nervous or having an accent is not evidence of dishonesty; the aim is understandable, accurate answers backed by genuine documents.",
  },
  {
    title: "Your one-page case map",
    body:
      "Before you rehearse a single answer, be able to state: your exact purpose, who pays and how, your German destination, your dates (including the latest you can arrive), your accommodation status, and which document proves each one. If you can't fill a line, that's a research task — not an invitation to guess.",
  },
  {
    title: "Introduce yourself with purpose",
    body:
      "Name → relevant background → present activity → purpose in Germany → destination. Practise three lengths: 15 seconds (name, purpose, destination), 45 seconds (add the education/work link), and 90 seconds only if asked for more detail. Say it in your own words — not a speech someone else wrote for you.",
  },
  {
    title: "Answer difficult questions honestly",
    body:
      "Answer → reason → evidence → stop. If you don't understand, ask for the question to be repeated. If you don't remember an exact figure, say so and offer to check your documents. Never invent a return plan, hide relatives in Germany, or describe a job search as tourism.",
  },
  {
    title: "Composure, without acting it",
    body:
      "Prepare in short daily sessions rather than memorising paragraphs. If your mind goes blank: feet on the floor, shoulders down, one slow breath, then restart with the simplest true fact. Clean, comfortable clothing is enough — you don't need to perform confidence.",
  },
];

const GENERAL_FLASHCARDS = [
  { q: "What is the exact purpose of your proposed stay?", a: "State your visa category and the specific activity it permits — not a general \"to study/work in Germany\". Match the wording to your own documents." },
  { q: "Who will pay for your stay, and what is your relationship to them?", a: "Name the person, the relationship, and the documented source of the funds. \"My uncle has money\" is not an answer — the relationship, the amount, and how it was earned is." },
  { q: "Have you ever had a visa refused, cancelled or curtailed?", a: "Answer honestly. \"I applied in [year]. The stated reason was [X]. I have addressed it by [Y]\" is a complete, safe answer — a hidden refusal that surfaces later is the actual risk." },
  { q: "What is the latest date you can arrive without losing your place?", a: "Know this exact date from your admission letter or contract, and have a written fallback if your visa is delayed past it." },
  { q: "Is your accommodation confirmed, reserved, or only applied for?", a: "Say which one, truthfully. A booking confirmation and a tenancy application are different things — don't let one sound like the other." },
  { q: "Why should we believe you?", a: "Don't argue or beg. Ask what's actually being questioned (\"are you asking about the source of the funds, or my sponsor's relationship to me?\") and answer that specific concern with evidence." },
];

const JOB_INTERVIEW_FLASHCARDS = [
  { q: "Why did you apply to us?", a: "Name one real thing about the employer or training provider you researched, and connect it to a genuine interest of yours — not a generic \"I want to work hard\"." },
  { q: "What are your strengths and weaknesses?", a: "Give one strength with a real example behind it, and one honest, minor weakness with what you're doing about it. Don't disguise a strength as a weakness." },
  { q: "Where do you see yourself in five years?", a: "Name a realistic next step inside this field — more responsibility, a specific skill, a qualification — not a vague \"successful\"." },
  { q: "How do you deal with stress?", a: "Describe one real situation and the concrete thing you did (broke the task down, took a short pause) — not just \"I stay calm\"." },
  { q: "Do you have any questions for us?", a: "Always have two or three ready: about the training structure, the team, or what happens after this conversation. Never ask something the website already answers." },
];

const GERMAN_PHRASES: Array<[string, string]> = [
  ["Könnten Sie die Frage bitte wiederholen?", "Could you please repeat the question?"],
  ["Darf ich kurz in meinen Unterlagen nachsehen?", "May I briefly check my documents?"],
  ["Das genaue Datum weiß ich gerade nicht.", "I cannot recall the exact date right now."],
  ["Ich möchte meine letzte Antwort korrigieren.", "I would like to correct my last answer."],
  ["Hier ist mein Vertrag / meine Zulassung.", "Here is my contract / admission."],
  ["Vielen Dank für Ihre Zeit.", "Thank you for your time."],
];

const CHECKLIST_ITEMS = [
  "Correct route checklist downloaded from the current official page",
  "Passport details match every form and supporting document",
  "Admission letter / contract is still current and signed",
  "Financial proof matches the route (blocked account, scholarship or obligation letter)",
  "Tuition/fees and living costs are evidenced separately — not counted twice",
  "Language certificate meets the route's requirement, not just the mission minimum",
  "Insurance dates line up with your actual travel plan",
  "Appointment confirmation and exact venue verified",
];

const LS_CASE_MAP = "easyway-travel-prep-case-map";
const LS_CHECKLIST = "easyway-travel-prep-checklist";

type CaseMap = {
  purpose: string;
  destination: string;
  dates: string;
  funding: string;
  accommodation: string;
};

const EMPTY_CASE_MAP: CaseMap = { purpose: "", destination: "", dates: "", funding: "", accommodation: "" };

function FlipCard({ q, a }: { q: string; a: string }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setFlipped((f) => !f)}
      className="flex min-h-[132px] flex-col justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left shadow-sm transition hover:border-[var(--accent)]/40"
    >
      <p className={`text-sm font-semibold leading-6 ${flipped ? "text-[var(--muted)]" : "text-[var(--foreground)]"}`}>
        {flipped ? a : q}
      </p>
      <span className="mt-3 inline-flex items-center gap-1 self-start text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">
        {flipped ? "← Back to question" : "Tap for a good answer →"}
      </span>
    </button>
  );
}

function Accordion({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="text-sm font-bold text-[var(--foreground)]">{title}</span>
        <ChevronDownIcon className={`h-4 w-4 shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="border-t border-[var(--border)] px-5 pb-5 pt-4 text-sm leading-6 text-[var(--foreground-soft)]">{children}</div>}
    </div>
  );
}

export default function TravelPackagePrepPage() {
  const [pathway, setPathway] = useState<string | null | "loading">("loading");
  const [route, setRoute] = useState<RouteKey>("study");
  const [caseMap, setCaseMap] = useState<CaseMap>(EMPTY_CASE_MAP);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/student", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setPathway(data?.pathway ?? null))
      .catch(() => setPathway(null));
  }, []);

  useEffect(() => {
    try {
      const rawMap = window.localStorage.getItem(LS_CASE_MAP);
      if (rawMap) setCaseMap({ ...EMPTY_CASE_MAP, ...JSON.parse(rawMap) });
      const rawChecklist = window.localStorage.getItem(LS_CHECKLIST);
      if (rawChecklist) setChecked(JSON.parse(rawChecklist));
    } catch {
      // Fine — the worksheet just starts blank.
    }
  }, []);

  function saveCaseMap(next: CaseMap) {
    setCaseMap(next);
    try {
      window.localStorage.setItem(LS_CASE_MAP, JSON.stringify(next));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    } catch {
      // Private browsing — the fields still hold their values on screen.
    }
  }

  function toggleCheck(i: number) {
    const next = { ...checked, [i]: !checked[i] };
    setChecked(next);
    try {
      window.localStorage.setItem(LS_CHECKLIST, JSON.stringify(next));
    } catch {
      // Fine — just won't survive a reload in private browsing.
    }
  }

  const brief = useMemo(() => ROUTE_BRIEFS.find((r) => r.key === route) ?? ROUTE_BRIEFS[0], [route]);
  const checkedCount = Object.values(checked).filter(Boolean).length;
  const showJobCards = route === "ausbildung" || route === "work" || route === "aupair";

  if (pathway === "loading") {
    return (
      <StudentShell>
        <div className="px-6 py-16 text-center text-sm text-[var(--muted)]">Loading…</div>
      </StudentShell>
    );
  }

  if (pathway !== "Travel Package") {
    return (
      <StudentShell>
        <div className="mx-auto max-w-lg px-6 py-16 text-center">
          <Mascot mood="thinking" className="mx-auto h-24 w-24" />
          <h1 className="mt-4 text-lg font-bold text-[var(--foreground)]">This guide is for the Travel Package</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            It's built around the visa interview and relocation paperwork specifically, so it only applies once you're on
            that track.
          </p>
          <Link
            href="/programs"
            className="mt-5 inline-flex items-center justify-center rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            See the Travel Package
          </Link>
        </div>
      </StudentShell>
    );
  }

  return (
    <StudentShell>
      <div className="mx-auto max-w-3xl space-y-6 px-4 pb-16 pt-6 sm:px-6">
        {/* ---------------------------------------------------------- hero */}
        <section className="overflow-hidden rounded-[28px] bg-[radial-gradient(circle_at_85%_0%,_#0f1c2e_0%,_#0a0f1a_55%,_#000000_100%)] px-6 py-7 text-white sm:px-9 sm:py-9">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <Mascot mood="presenting" className="h-24 w-24 shrink-0 drop-shadow-xl" />
            <div className="min-w-0">
              <span className="inline-flex items-center gap-2 rounded-full border border-[#D4AF37]/40 bg-[#D4AF37]/10 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#E8C766]">
                <PlaneIcon className="h-3.5 w-3.5" /> Travel Package
              </span>
              <h1 className="mt-3 text-2xl font-extrabold leading-tight sm:text-3xl">Your visa & interview prep</h1>
              <p className="mt-2 text-sm leading-6 text-white/70">
                Becca: "This is the real handbook the office uses to train for the German visa interview, cut down to what
                actually matters for your route. Pick your route below, and I'll keep the rest out of your way."
              </p>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------- route */}
        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">Your actual route</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ROUTE_BRIEFS.map((r) => {
              const Icon = r.icon;
              const active = r.key === route;
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setRoute(r.key)}
                  className={`flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-center transition ${
                    active
                      ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                      : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]/40"
                  }`}
                >
                  <Icon className={`h-5 w-5 ${active ? "text-[var(--accent)]" : "text-[var(--muted)]"}`} />
                  <span className="text-xs font-semibold text-[var(--foreground)]">{r.label}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">{brief.tagline}</p>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">What the officer is checking</p>
              <p className="mt-1 text-sm leading-6 text-[var(--foreground-soft)]">{brief.know}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">How to prepare</p>
              <p className="mt-1 text-sm leading-6 text-[var(--foreground-soft)]">{brief.prepare}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-emerald-500/10 p-3">
                <p className="text-xs font-bold text-emerald-700">Do</p>
                <p className="mt-1 text-xs leading-5 text-emerald-800">{brief.doThis}</p>
              </div>
              <div className="rounded-xl bg-rose-500/10 p-3">
                <p className="text-xs font-bold text-rose-700">Don't</p>
                <p className="mt-1 text-xs leading-5 text-rose-800">{brief.dontDo}</p>
              </div>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Mini mock interview</p>
              <ol className="mt-1 space-y-1">
                {brief.mock.map((q, i) => (
                  <li key={q} className="flex gap-2 text-sm text-[var(--foreground-soft)]">
                    <span className="font-semibold text-[var(--accent)]">{i + 1}.</span> {q}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------- foundation */}
        <section className="space-y-2">
          <h2 className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">The foundation — every route</h2>
          {FOUNDATION_CARDS.map((c, i) => (
            <Accordion key={c.title} title={c.title} defaultOpen={i === 0}>
              {c.body}
            </Accordion>
          ))}
        </section>

        {/* ------------------------------------------------------- practice */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
            <SparklesIcon className="h-3.5 w-3.5" /> Practice — tap a card to flip it
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {GENERAL_FLASHCARDS.map((c) => (
              <FlipCard key={c.q} q={c.q} a={c.a} />
            ))}
          </div>
          {showJobCards && (
            <>
              <p className="mb-3 mt-5 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                Your route also means a job/training interview — practise this too
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {JOB_INTERVIEW_FLASHCARDS.map((c) => (
                  <FlipCard key={c.q} q={c.q} a={c.a} />
                ))}
              </div>
            </>
          )}
        </section>

        {/* ---------------------------------------------------- phrasebook */}
        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">A few German phrases worth knowing</h2>
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            {GERMAN_PHRASES.map(([de, en], i) => (
              <div
                key={de}
                className={`flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between ${
                  i > 0 ? "border-t border-[var(--border)]" : ""
                }`}
              >
                <span className="text-sm font-semibold text-[var(--foreground)]">{de}</span>
                <span className="text-xs text-[var(--muted)]">{en}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------- case map */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
            <MapIcon className="h-3.5 w-3.5" /> Your one-page case map
          </h2>
          <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <p className="text-xs leading-5 text-[var(--muted)]">
              Fill this in from your real documents — it stays on this device only, for your own rehearsal, not sent to
              the office.
            </p>
            {([
              ["purpose", "Exact purpose (e.g. \"MSc Materials Engineering at RWTH Aachen, Summer 2027\")"],
              ["destination", "German destination — institution/host, city, federal state"],
              ["dates", "Start date, enrolment deadline, latest arrival"],
              ["funding", "Who pays, how much, and from what source"],
              ["accommodation", "Accommodation — confirmed, reserved, or still applying"],
            ] as Array<[keyof CaseMap, string]>).map(([key, label]) => (
              <label key={key} className="block text-xs font-semibold text-[var(--muted)]">
                {label}
                <input
                  value={caseMap[key]}
                  onChange={(e) => saveCaseMap({ ...caseMap, [key]: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm font-normal text-[var(--foreground)]"
                />
              </label>
            ))}
            {saved && <p className="text-xs font-semibold text-emerald-600">Saved to this device.</p>}
          </div>
        </section>

        {/* --------------------------------------------------- checklist */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
            <DocumentIcon className="h-3.5 w-3.5" /> Document checklist ({checkedCount}/{CHECKLIST_ITEMS.length})
          </h2>
          <div className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            {CHECKLIST_ITEMS.map((item, i) => (
              <label key={item} className="flex cursor-pointer items-start gap-3 rounded-xl p-2 hover:bg-[var(--surface-soft)]">
                <input
                  type="checkbox"
                  checked={Boolean(checked[i])}
                  onChange={() => toggleCheck(i)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                />
                <span className={`text-sm leading-5 ${checked[i] ? "text-[var(--muted)] line-through" : "text-[var(--foreground-soft)]"}`}>
                  {item}
                </span>
              </label>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------- footer */}
        <section className="flex items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--accent-soft)] p-5">
          <ShieldIcon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]" />
          <p className="text-xs leading-5 text-[var(--foreground-soft)]">
            This is independent preparation material, not an embassy publication — practise the facts of your own
            application, not a script. If anything here doesn't match what your appointment letter says, follow the
            letter and ask the office.
          </p>
        </section>
        <div className="text-center">
          <CheckCircleIcon className="mx-auto h-5 w-5 text-[var(--muted)]" />
          <p className="mt-1 text-xs text-[var(--muted)]">Questions about your own appointment? Message the office from Support.</p>
        </div>
      </div>
    </StudentShell>
  );
}
