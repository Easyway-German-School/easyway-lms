"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Tldraw } from "@tldraw/tldraw";
import CommunityLauncher from "@/components/CommunityLauncher";

const lessons = [
  { title: "Week 1: Introductions", desc: "Practice greetings, pronunciation, and everyday phrases.", tags: ["Pronunciation", "Speaking", "A1"] },
  { title: "Week 2: Daily Routine", desc: "Talk about your schedule and habits in German.", tags: ["Grammar", "Listening", "A1"] },
  { title: "Week 3: Travel Basics", desc: "Prepare for airport, hotel, and transport conversations.", tags: ["Roleplay", "Vocabulary", "A2"] },
];

export default function DashboardClient({ initialStudent, userId }: { initialStudent: any; userId: string }) {
  const [offline, setOffline] = useState(false);
  const [selectedLesson, setSelectedLesson] = useState(0);
  const [notes, setNotes] = useState("");
  const [phrase, setPhrase] = useState("Ich möchte ein Visum beantragen.");
  const [feedback, setFeedback] = useState<string[]>(["Type a phrase and press Analyze."]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [pathway, setPathway] = useState(initialStudent.pathway);
  const [recommendation, setRecommendation] = useState({ nextAction: "Loading your next module...", focus: "Personalized grammar and speaking practice", score: 0 });
  const [student, setStudent] = useState(initialStudent);

  useEffect(() => {
    async function loadRecommendation() {
      try {
        const response = await fetch(`/api/recommendations?pathway=${encodeURIComponent(pathway)}&progress=${student.examReadiness}`);
        const data = await response.json();
        setRecommendation(data);
      } catch (error) {
        console.error(error);
      }
    }

    loadRecommendation();
  }, [pathway, student.examReadiness]);

  useEffect(() => {
    setOffline(!navigator.onLine);
    const saved = window.localStorage.getItem("easyway-notes");
    if (saved) setNotes(saved);
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem("easyway-notes", notes);
  }, [notes]);

  const selected = lessons[selectedLesson];

  async function handleAnalyze() {
    if (!phrase.trim()) return;
    setIsAnalyzing(true);
    setFeedback(["Analyzing your pronunciation..."]);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrase }),
      });
      const json = await response.json();
      setFeedback(json.feedback || ["No feedback returned."]);
    } catch (error) {
      console.error(error);
      setFeedback(["Unable to reach the AI coach.", "Check your network or run the prototype locally."]);
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-6 md:px-10">
        <header className="flex flex-col gap-6 rounded-3xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-950 p-8 text-slate-50 shadow-xl sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.25em] text-slate-300">Hybrid learning platform</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">EASYWAY LMS</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
              A student portal with real backend auth, pathway-driven recommendations, live coaching, and AI feedback.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className={`rounded-full px-4 py-2 font-semibold ${offline ? "bg-rose-500" : "bg-emerald-500"}`}>
              {offline ? "Offline" : "Online"}
            </span>
            <div className="flex flex-wrap gap-3">
              <Link href="/live" className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600">
                Join live room
              </Link>
              <Link href="/essay" className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/20">
                Goethe essay lab
              </Link>
              <Link href="/profile" className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/20">
                My profile
              </Link>
            </div>
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { title: "German A1 Foundations", progress: 72, status: "In progress" },
                { title: "Goethe Essay Prep", progress: 46, status: "Next up" },
                { title: "Live Speaking Lab", progress: 91, status: "Almost done" },
              ].map((course) => (
                <div key={course.title} className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-slate-500">Course</p>
                      <h3 className="text-lg font-semibold text-slate-950">{course.title}</h3>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-slate-500">{course.status}</p>
                      <p className="text-xl font-semibold text-slate-900">{course.progress}%</p>
                    </div>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${course.progress}%` }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-3xl bg-slate-950 p-6 text-slate-50 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.2em] text-slate-400">Current student</p>
                  <h2 className="mt-2 text-2xl font-semibold">{student.name}</h2>
                  <p className="mt-2 text-sm text-slate-300">Level: {student.level} · Pathway: {student.pathway}</p>
                  <p className="mt-2 text-sm text-slate-300">{student.outcome}</p>
                </div>
                <div className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950">
                  {student.nextLive}
                </div>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <div className="rounded-3xl bg-slate-900 p-4">
                  <p className="text-sm text-slate-400">Next module</p>
                  <p className="mt-2 text-lg font-semibold text-white">{recommendation.nextAction}</p>
                </div>
                <div className="rounded-3xl bg-slate-900 p-4">
                  <p className="text-sm text-slate-400">Focus area</p>
                  <p className="mt-2 text-lg font-semibold text-white">{recommendation.focus}</p>
                </div>
                <div className="rounded-3xl bg-slate-900 p-4">
                  <p className="text-sm text-slate-400">Goethe readiness</p>
                  <p className="mt-2 text-lg font-semibold text-white">{recommendation.score}%</p>
                </div>
              </div>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <label className="text-sm font-medium text-slate-300">Pathway</label>
                <select
                  value={pathway}
                  onChange={(event) => setPathway(event.target.value)}
                  className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400"
                >
                  {[
                    { key: "Goethe exam mastery", label: "Goethe Exam Mastery" },
                    { key: "Nursing career path", label: "Nursing Career Path" },
                    { key: "IT relocation track", label: "IT Relocation Track" },
                    { key: "Ausbildung & Vocational Route", label: "Ausbildung & Vocational Route" },
                  ].map((option) => (
                    <option key={option.key} value={option.key} className="bg-slate-950 text-white">
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <button className="rounded-full bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-600">
                  Continue learning
                </button>
                <Link href={`/pathway?pathway=${encodeURIComponent(pathway)}`} className="rounded-full border border-slate-700 bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
                  View pathway details
                </Link>
                <Link href="/programs" className="rounded-full border border-slate-700 bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
                  View program tracks
                </Link>
              </div>
            </div>

            <div className="rounded-3xl bg-white p-8 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-slate-500">Lesson player</p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-950">{selected.title}</h2>
                </div>
                <div className="rounded-full bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
                  Offline ready
                </div>
              </div>
              <p className="mt-4 text-slate-600">{selected.desc}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                {lessons.map((lesson, index) => (
                  <button
                    key={lesson.title}
                    onClick={() => setSelectedLesson(index)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${selectedLesson === index ? "bg-slate-950 text-white" : "bg-slate-200 text-slate-700 hover:bg-slate-300"}`}
                  >
                    {lesson.title}
                  </button>
                ))}
              </div>
              <div className="mt-6 flex flex-wrap gap-2 text-sm text-slate-500">
                {selected.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-slate-100 px-3 py-2">
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-3xl bg-white p-8 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-slate-500">AI Pronunciation Coach</p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-950">Speak like a native</h2>
                </div>
                <div className="rounded-full bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
                  Live demo
                </div>
              </div>
              <p className="mt-4 text-slate-600">Type a German phrase and get structured feedback instantly. This is a prototype backend analysis.</p>
              <textarea
                value={phrase}
                onChange={(event) => setPhrase(event.target.value)}
                rows={4}
                className="mt-4 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 text-slate-950 outline-none focus:border-emerald-400"
              />
              <button
                onClick={handleAnalyze}
                disabled={isAnalyzing}
                className="mt-4 inline-flex items-center justify-center rounded-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isAnalyzing ? "Analyzing..." : "Analyze phrase"}
              </button>
              <div className="mt-4 space-y-2 rounded-3xl bg-slate-950 p-5 text-slate-50">
                {feedback.map((line, index) => (
                  <p key={index} className="text-sm">
                    {line}
                  </p>
                ))}
              </div>
            </div>

            <div className="rounded-3xl bg-white p-8 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-slate-500">Study journal</p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-950">Offline notes</h2>
                </div>
                <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">Cached locally</div>
              </div>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={6}
                className="mt-4 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 text-slate-950 outline-none focus:border-emerald-400"
                placeholder="Write notes here and they will be saved locally for offline review."
              />
              <p className="mt-3 text-sm text-slate-500">Notes persist in this browser and work offline as part of the prototype.</p>
            </div>
          </div>

          <aside className="space-y-6">
            <div className="rounded-3xl bg-white p-8 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-slate-500">Live classroom</p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-950">Virtual practice room</h2>
                </div>
                <div className="rounded-full bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">Demo</div>
              </div>
              <p className="mt-4 text-slate-600">Placeholder for LiveKit / BigBlueButton integration. This is where synchronous speaking practice and shared whiteboards would appear.</p>
              <div className="mt-6 space-y-3 rounded-3xl bg-slate-100 p-5 text-sm text-slate-600">
                <p>• Live session ready state</p>
                <p>• Speaker queue</p>
                <p>• Shared notes and collaboration canvas</p>
              </div>
              <button className="mt-6 w-full rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
                Join live practice room
              </button>
            </div>

            <div className="rounded-3xl bg-white p-8 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-slate-500">Collaborative lesson canvas</p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-950">Interactive whiteboard</h2>
                </div>
                <div className="rounded-full bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">TLDraw</div>
              </div>
              <div className="mt-6 h-[420px] overflow-hidden rounded-3xl border border-slate-200 bg-slate-100">
                <Tldraw />
              </div>
            </div>

            <div className="rounded-3xl bg-slate-950 p-8 text-slate-50 shadow-sm">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Roadmap</p>
              <h2 className="mt-3 text-2xl font-semibold">Phase 1 → Phase 3</h2>
              <div className="mt-6 space-y-3 text-sm text-slate-300">
                <p>• Core portal with courses and progress</p>
                <p>• PWA-ready offline notes and lesson player</p>
                <p>• AI coach endpoint stubbed in backend</p>
                <p>• Live collaboration placeholder ready for LiveKit/TLDraw</p>
              </div>
            </div>
          </aside>
        </section>
      </div>
      <CommunityLauncher />
    </div>
  );
}
