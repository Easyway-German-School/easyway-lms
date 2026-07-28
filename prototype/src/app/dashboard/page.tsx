"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Interactive3DCharacterLoader from "@/components/Interactive3DCharacterLoader";
import PaymentSuccessToastClient from "@/components/PaymentSuccessToastClient";

type Mission = {
  id?: string;
  title: string;
  description: string;
  reward: string;
  category?: string;
  target?: string;
  done?: boolean;
};

type Student = {
  name?: string;
  level?: string;
  pathway?: string;
  examReadiness?: number;
  averageGrade?: number | null;
  gradeCount?: number;
  recentGrades?: Array<{ type: string; score: number; createdAt: string }>;
  paymentSummary?: {
    totalPaid: number;
    registrationFee: number;
    requiredDeposit: number;
    tuitionFee: number;
    registrationPaid: boolean;
    depositPaid: boolean;
    fullPaid: boolean;
    accessLevel: string;
    paymentProgressPercent: number;
  };
};

type Course = {
  id: string;
  title: string;
  description: string;
  progress: number;
  status: string;
  level?: string;
  lessonCount?: number;
  completedLessonCount?: number;
};

type PendingPayment = {
  amount: number;
  reference: string;
  pathwayName?: string;
};

const TUITION_FEES: Record<string, number> = {
  A1: 150000,
  A2: 150000,
  B1: 180000,
  B2: 180000,
  C1: 200000,
  C2: 220000,
};

import StudentShell from "@/components/StudentShell";

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--background)] flex items-center justify-center text-[var(--foreground)]"><p className="text-[var(--muted)]">Loading dashboard…</p></div>}>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const { data: session, status } = useSession();
  const [student, setStudent] = useState<Student | null>(null);
  const [paymentSummary, setPaymentSummary] = useState<Student["paymentSummary"] | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [paymentUnlock, setPaymentUnlock] = useState<{ requiredDeposit: number; totalPaid: number; tuitionFee: number } | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [personalizedPlan, setPersonalizedPlan] = useState<any>(null);
  const [plannerStrategy, setPlannerStrategy] = useState<string>('hybrid');
  const [pathway, setPathway] = useState("Goethe exam mastery");
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [phrase, setPhrase] = useState("Ich möchte ein Visum beantragen.");
  const [feedback, setFeedback] = useState<string[]>(["Type a phrase and press Analyze."]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [insights, setInsights] = useState({
    completedLessons: 0,
    totalLessons: 0,
    streak: 0,
    nextMilestone: "First lesson",
  });
  const [dailyMissions, setDailyMissions] = useState<Mission[]>([]);
  const [completedMissionIds, setCompletedMissionIds] = useState<Record<string, boolean>>({});
  const [refreshToken, setRefreshToken] = useState(0);
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
  const [fastFallback, setFastFallback] = useState(false);

  // Lightweight fetch wrapper that logs timing for debugging slow endpoints.
  const fetchWithTiming = async (url: string, opts?: RequestInit, label?: string) => {
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const res = await fetch(url, opts as any);
    const duration = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start;
    try {
      // eslint-disable-next-line no-console
      console.info(`[dashboard] fetch ${label || url} -> ${res.status} in ${Math.round(duration)}ms`);
      if (typeof window !== 'undefined') {
        // @ts-ignore
        window.__dashboardFetchTimings = window.__dashboardFetchTimings || [];
        // @ts-ignore
        window.__dashboardFetchTimings.push({ url, label: label || url, status: res.status, duration });
      }
    } catch {
      // ignore logging errors
    }
    return res;
  };

  const loadStudentData = useCallback(async () => {
    try {
      const res = await fetchWithTiming("/api/student", { cache: "no-store", credentials: "include" }, "student");
      if (!res.ok) {
        throw new Error(`Student fetch failed with status ${res.status}`);
      }
      const data = await res.json();
      setStudent(data);
      setPaymentSummary(data.paymentSummary ?? null);
      if (data?.pathway) setPathway(data.pathway);
      setDashboardError(null);

      if (!data.paymentSummary) {
        const paymentsResponse = await fetchWithTiming("/api/student/payments", undefined, "student-payments");
        if (paymentsResponse.ok) {
          const paymentsData = await paymentsResponse.json();
          const completed = (paymentsData.payments || []).filter((payment: any) => payment.status === "completed");
          const totalPaid = completed.reduce((sum: number, payment: any) => sum + Number(payment.amount || 0), 0);
          const tuitionFee = TUITION_FEES[data.level] ?? TUITION_FEES.A1;
          const requiredDeposit = Math.round(tuitionFee * 0.6);
          setPaymentUnlock({ requiredDeposit, totalPaid, tuitionFee });
        }
      }
    } catch (error) {
      console.error("Failed to load student data:", error);
      const fallbackStudent: Student = {
        name: session?.user?.name || "Learner",
        level: "A1",
        pathway: "Goethe exam mastery",
        examReadiness: 0,
        averageGrade: null,
        gradeCount: 0,
        recentGrades: [],
        paymentSummary: {
          totalPaid: 0,
          registrationFee: 5000,
          requiredDeposit: Math.round(TUITION_FEES.A1 * 0.6),
          tuitionFee: TUITION_FEES.A1,
          registrationPaid: true,
          depositPaid: false,
          fullPaid: false,
          accessLevel: "registered",
          paymentProgressPercent: 0,
        },
      };
      setStudent(fallbackStudent);
      setPaymentSummary(fallbackStudent.paymentSummary ?? null);
      setPathway(fallbackStudent.pathway || "Goethe exam mastery");
      setDashboardError(null);
    }
  }, [session?.user?.name]);

  const loadCourses = useCallback(async () => {
    try {
      const res = await fetchWithTiming("/api/courses", { cache: "no-store", credentials: "include" }, "courses");
      if (!res.ok) {
        throw new Error(`Courses fetch failed with status ${res.status}`);
      }
      const data = await res.json();
      const courseList = Array.isArray(data.courses) ? data.courses : [];
      setCourses(courseList);
      if (data.pathway) setPathway(data.pathway);

      const totalLessons = courseList.reduce((acc: number, course: Course) => acc + (course.lessonCount || 0), 0);
      const completedLessons = courseList.reduce((acc: number, course: Course) => acc + (course.completedLessonCount || 0), 0);
      setInsights({
        completedLessons,
        totalLessons,
        streak: Math.max(1, Math.min(14, Math.round(completedLessons / 3) || 1)),
        nextMilestone: totalLessons > 0 ? `${Math.max(1, totalLessons - completedLessons)} lessons left to your next milestone` : "First lesson",
      });

      setDashboardError(null);
    } catch (error) {
      console.error("Failed to load courses:", error);
      const fallbackCourses: Course[] = [
        {
          id: "fallback-course-1",
          title: "German A1 Foundations",
          description: "Build the core grammar, listening, and speaking habits for exam success.",
          progress: 24,
          status: "Next up",
          level: "A1",
          lessonCount: 3,
          completedLessonCount: 0,
        },
      ];
      setCourses(fallbackCourses);
      setInsights({
        completedLessons: 0,
        totalLessons: 3,
        streak: 1,
        nextMilestone: "3 lessons left to your next milestone",
      });
      setDashboardError(null);
    }
  }, []);

  const syncPendingPayment = useCallback(async () => {
    if (typeof window === "undefined") return;

    const pendingReference = window.localStorage.getItem("pendingPaystackReference");
    const pendingAmount = Number(window.localStorage.getItem("pendingPaystackAmount") || "0");
    const pendingPathway = window.localStorage.getItem("pendingPaystackPathwayName") || undefined;

    if (!pendingReference) {
      setPendingPayment(null);
      await loadStudentData();
      await loadCourses();
      return;
    }

    setPendingPayment({ amount: pendingAmount, reference: pendingReference, pathwayName: pendingPathway });

    try {
      const verifyResponse = await fetchWithTiming(`/api/paystack/verify?reference=${encodeURIComponent(pendingReference)}`, {
        cache: "no-store",
        credentials: "include",
      }, "paystack-verify");

      if (verifyResponse.ok) {
        window.localStorage.removeItem("pendingPaystackReference");
        window.localStorage.removeItem("pendingPaystackAmount");
        window.localStorage.removeItem("pendingPaystackPathwayName");
        setPendingPayment(null);
      } else {
        console.warn("Paystack verification response not OK for pending reference", { pendingReference, status: verifyResponse.status });
      }
    } catch (error) {
      console.error("Unable to verify pending Paystack payment", error);
    } finally {
      await loadStudentData();
      await loadCourses();
    }
  }, [loadStudentData, loadCourses]);

  const loadPersonalizedPlan = useCallback(async () => {
    const savedPlan = typeof window !== 'undefined' ? localStorage.getItem('studentPersonalizedPlan') : null;
    if (savedPlan) {
      try {
        setPersonalizedPlan(JSON.parse(savedPlan));
      } catch {
        // ignore invalid saved plan
      }
    }

    try {
      const compareParam = plannerStrategy === 'compare' ? '&compare=true' : '';
      const res = await fetchWithTiming(`/api/personalize?strategy=${encodeURIComponent(plannerStrategy)}${compareParam}`, { cache: "no-store", credentials: "include" }, "personalize");
      if (!res.ok) {
        console.warn('Personalized plan endpoint returned an error response', res.status);
        return;
      }
      const data = await res.json();
      const nextPlan = data.plan || null;
      setPersonalizedPlan(nextPlan);
      if (nextPlan && typeof window !== 'undefined') {
        localStorage.setItem('studentPersonalizedPlan', JSON.stringify(nextPlan));
      }
    } catch (err) {
      console.warn('Failed to load personalized plan', err);
    }
  }, [plannerStrategy]);

  const loadDailyMissions = useCallback(async () => {
    if (!student) return;
    const readiness = student?.examReadiness ?? 0;

    const missionList: Mission[] = [
      {
        id: "quest-lesson",
        title: "Complete one lesson",
        description: "Finish a lesson and earn a quick streak bonus.",
        reward: "+45 XP",
        done: insights.completedLessons > 0,
      },
      {
        id: "quest-streak",
        title: "Keep the streak alive",
        description: "Practice for 15 minutes to maintain your learning streak.",
        reward: "+20 XP",
        done: insights.streak >= 2,
      },
      {
        id: "quest-speaking",
        title: "Finish a speaking drill",
        description: "Record a short speaking task to boost pronunciation confidence.",
        reward: "+30 XP",
        done: readiness >= 60,
      },
    ];

    setDailyMissions(missionList);
  }, [student, insights.completedLessons, insights.streak]);

  const loadMissionState = useCallback(() => {
    if (typeof window === "undefined") return;
    const savedState = window.localStorage.getItem("dashboardMissionState");

    if (savedState) {
      try {
        setCompletedMissionIds(JSON.parse(savedState));
        return;
      } catch {
        // ignore invalid state
      }
    }

    setCompletedMissionIds({});
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;

    const refreshOnFocus = () => {
      void syncPendingPayment();
      void loadPersonalizedPlan();
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        setRefreshToken((value) => value + 1);
      }
    };

    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [status, loadPersonalizedPlan]);

  // Initial load: fetch student, courses, and personalized plan in parallel
  useEffect(() => {
    if (status !== "authenticated") return;

    // show a fast fallback UI after 2.5s so users aren't stuck on a spinner
    const t = setTimeout(() => setFastFallback(true), 2500);

    void (async () => {
      try {
        const p1 = loadStudentData();
        const p2 = loadCourses();
        const p3 = loadPersonalizedPlan();
        await Promise.allSettled([p1, p2, p3]);
      } catch (err) {
        console.error('Initial dashboard fetch error', err);
      }
    })();

    return () => clearTimeout(t);
  }, [status, loadStudentData, loadCourses, loadPersonalizedPlan]);

  useEffect(() => {
    if (!student) return;
    (async () => {
      await loadDailyMissions();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student, pathway, insights.completedLessons, insights.streak]);

  useEffect(() => {
    if (!student) return;
    loadMissionState();
  }, [student]);


  const handleAnalyze = async () => {
    if (!phrase.trim()) return;
    setIsAnalyzing(true);
    try {
      const res = await fetch("/api/ai/analyze-pronunciation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrase }),
      });
      const data = await res.json();
      const feedbackArray = [
        `Transcription: ${data.transcription}`,
        `Confidence: ${data.confidence}%`,
        ...(data.issues?.map((issue: string) => `Issue: ${issue}`) || []),
        ...(data.corrections?.map((correction: string) => `✓ ${correction}`) || []),
      ];
      setFeedback(feedbackArray.length > 0 ? feedbackArray : ["No feedback available"]);
    } catch (error) {
      console.error("Analyze error:", error);
      setFeedback(["Unable to analyze pronunciation"]);
    } finally {
      setIsAnalyzing(false);
    }
  };



  const fallbackStudent: Student = {
    name: session?.user?.name || "Learner",
    level: "A1",
    pathway: "Goethe exam mastery",
    examReadiness: 0,
    averageGrade: null,
    gradeCount: 0,
    recentGrades: [],
    paymentSummary: {
      totalPaid: 0,
      registrationFee: 5000,
      requiredDeposit: 90000,
      tuitionFee: 150000,
      registrationPaid: true,
      depositPaid: false,
      fullPaid: false,
      accessLevel: "registered",
      paymentProgressPercent: 0,
    },
  };

  const fallbackCourses: Course[] = [
    {
      id: "fallback-course-1",
      title: "German A1 Foundations",
      description: "Build the core grammar, listening, and speaking habits for exam success.",
      progress: 24,
      status: "Next up",
      level: "A1",
      lessonCount: 3,
      completedLessonCount: 0,
    },
  ];

  const resolvedStudent = student ?? fallbackStudent;
  const resolvedCourses = courses.length > 0 ? courses : fallbackCourses;

  if (status === "loading" && !student && !dashboardError && !fastFallback) {
    return (
      <StudentShell>
        <PaymentSuccessToastClient />
        <Interactive3DCharacterLoader />
      </StudentShell>
    );
  }

  if (dashboardError) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center px-6 py-10 text-[var(--foreground)]">
        <div className="max-w-xl rounded-3xl bg-[var(--surface)] p-10 shadow-2xl ring-1 ring-white/10">
          <h1 className="text-2xl font-bold">Unable to load dashboard</h1>
          <p className="mt-4 text-[var(--muted)]">{dashboardError}</p>
          <button
            type="button"
            onClick={() => {
              setDashboardError(null);
              loadStudentData();
              loadCourses();
            }}
            className="mt-6 inline-flex rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--surface)] hover:brightness-110"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const gradeBonus = resolvedStudent?.averageGrade ? Math.round((resolvedStudent.averageGrade - 70) / 2) : 0;
  const xp = Math.max(180, insights.completedLessons * 45 + insights.streak * 25 + (resolvedStudent?.examReadiness || 0) * 2 + gradeBonus);
  const level = Math.floor(xp / 250) + 1;
  const xpIntoLevel = xp % 250;
  const xpProgress = Math.min(100, (xpIntoLevel / 250) * 100);
  const examReadiness = resolvedStudent?.examReadiness ?? 0;
  const tuitionFee = paymentSummary?.tuitionFee ?? paymentUnlock?.tuitionFee ?? 0;
  const requiredDeposit = paymentSummary?.requiredDeposit ?? paymentUnlock?.requiredDeposit ?? 0;
  const pendingAmount = pendingPayment?.amount ?? 0;
  const paymentBaseTotal = paymentSummary?.totalPaid ?? paymentUnlock?.totalPaid ?? 0;
  const effectiveTotalPaid = paymentBaseTotal + pendingAmount;
  const paymentProgressPercent = tuitionFee > 0
    ? Math.min(100, Math.round((effectiveTotalPaid / tuitionFee) * 100))
    : 0;
  const paymentUnlocked = Boolean(
    paymentSummary ? paymentSummary.depositPaid : paymentUnlock && paymentUnlock.totalPaid >= paymentUnlock.requiredDeposit
  );
  const effectivePayment = paymentSummary ?? (paymentUnlock
    ? {
        totalPaid: paymentUnlock.totalPaid,
        requiredDeposit: paymentUnlock.requiredDeposit,
        tuitionFee: paymentUnlock.tuitionFee,
        depositPaid: paymentUnlock.totalPaid >= paymentUnlock.requiredDeposit,
        fullPaid: false,
        accessLevel: paymentUnlock.totalPaid >= paymentUnlock.requiredDeposit ? "partial" : "registered",
        paymentProgressPercent,
      }
    : null);

  const dailyQuests: Mission[] = [
    { title: "Complete one lesson", description: "Finish a lesson and earn a quick streak bonus.", done: insights.completedLessons > 0, reward: "+45 XP" },
    { title: "Keep the streak alive", description: "Practice for 15 minutes to maintain your learning streak.", done: insights.streak >= 2, reward: "+20 XP" },
    { title: "Finish a speaking drill", description: "Record a short speaking task to boost pronunciation confidence.", done: examReadiness >= 60, reward: "+30 XP" },
  ];

  const displayMissions = dailyMissions.length > 0 ? dailyMissions : dailyQuests;
  const missionCompletedCount = displayMissions.filter((mission) => completedMissionIds[mission.id || ""] || mission.done).length;
  const missionCompletePercent = displayMissions.length > 0 ? Math.round((missionCompletedCount / displayMissions.length) * 100) : 0;
  const quickStats = [
    { label: 'Courses enrolled', value: resolvedCourses.length.toString(), icon: '📘' },
    { label: 'Active quests', value: displayMissions.length.toString(), icon: '🧭' },
    { label: 'Progress', value: `${xpProgress}%`, icon: '📈' },
    { label: 'Exam readiness', value: `${resolvedStudent?.examReadiness ?? 0}%`, icon: '🎯' },
  ];

  const displayAnnouncements = [
    { title: 'New exam prep unit available', text: 'The new exam prep module is live in your course library.', time: '2h ago' },
    { title: 'Session time updated', text: 'Wednesday class is now at 7:00 PM for this week.', time: '1d ago' },
  ];

  return (
    <StudentShell>
      <PaymentSuccessToastClient />
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: 'easeOut' }}
        className="dashboard-shell min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(10,124,255,0.08),_transparent_25%),linear-gradient(135deg,_#f8fbff_0%,_#f2f6ff_100%)] text-[var(--foreground)]"
      >
        <div className="mx-auto max-w-7xl px-6 py-10">
          <section className="relative overflow-hidden rounded-[36px] border border-white/60 bg-gradient-to-r from-[var(--accent-strong)] via-[var(--accent)] to-[#FF8533] p-8 text-white shadow-[0_30px_90px_rgba(15,23,42,0.16)]">
            <div className="pointer-events-none absolute -right-8 -top-8 h-36 w-36 rounded-full bg-white/15 blur-3xl" />
            <div className="pointer-events-none absolute bottom-0 left-0 h-32 w-32 rounded-full bg-slate-950/10 blur-3xl" />
            <div className="absolute right-6 top-6 h-24 w-24 rounded-full border border-white/20 hero-orb bg-white/10" />
            <div className="absolute right-6 top-6 h-24 w-24 rounded-full border border-white/20 pulse-ring" />
            <div className="absolute left-8 top-8 h-2.5 w-24 rounded-full bg-white/25" />
            <div className="grid gap-8 lg:grid-cols-[1.45fr_0.95fr] lg:items-end">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-white/85 backdrop-blur-sm glow-pill">
                  <span className="h-2 w-2 rounded-full bg-emerald-300" />
                  Student dashboard
                </div>
                <h1 className="mt-4 text-4xl font-semibold">Welcome back, {resolvedStudent?.name || session?.user?.name || 'Learner'}</h1>
                <p className="mt-4 max-w-2xl text-slate-100">Your academy experience is now a cinematic quest board with live XP, missions, and progress tracking.</p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <div className="glass-chip rounded-full px-3 py-2 text-sm text-white">⚡ XP boost active</div>
                  <div className="glass-chip rounded-full px-3 py-2 text-sm text-white">🔥 Streak {insights.streak} days</div>
                  <div className="glass-chip rounded-full px-3 py-2 text-sm text-white">🎯 Next: {insights.nextMilestone}</div>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <motion.div whileHover={{ y: -4, scale: 1.01 }} className="rounded-[28px] border border-white/20 bg-white/10 p-5 backdrop-blur-sm">
                  <p className="text-xs uppercase tracking-[0.3em] text-white/80">Current level</p>
                  <p className="mt-3 text-3xl font-semibold">{level}</p>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/20">
                    <div className="h-full rounded-full bg-gradient-to-r from-white to-amber-300" style={{ width: `${xpProgress}%` }} />
                  </div>
                  <p className="mt-2 text-sm text-slate-100">{xp} XP to your next milestone</p>
                </motion.div>
                <motion.div whileHover={{ y: -4, scale: 1.01 }} className="rounded-[28px] border border-white/20 bg-white/10 p-5 backdrop-blur-sm">
                  <p className="text-xs uppercase tracking-[0.3em] text-white/80">Unlock progress</p>
                  <p className="mt-3 text-3xl font-semibold">{paymentProgressPercent}%</p>
                  <p className="mt-2 text-sm text-slate-100">Premium library access is moving closer.</p>
                </motion.div>
              </div>
            </div>
          </section>

          <section className="mt-8 grid gap-6 lg:grid-cols-4">
            {quickStats.map((stat, index) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.06 * index, duration: 0.35 }}
                whileHover={{ y: -4, scale: 1.01 }}
                className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle,_rgba(255,255,255,0.08),_rgba(15,23,42,0.2))] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.18)] backdrop-blur-2xl"
              >
                <div className="absolute -left-10 top-10 h-24 w-24 rounded-full bg-[rgba(255,136,34,0.15)] blur-3xl" />
                <div className="absolute -right-10 bottom-8 h-20 w-20 rounded-full bg-[rgba(13,174,255,0.14)] blur-3xl" />
                <div className="flex items-center justify-between gap-3 relative">
                  <span className="text-2xl">{stat.icon}</span>
                  <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.28em] text-slate-200 backdrop-blur-sm">{stat.label}</span>
                </div>
                <p className="mt-6 text-3xl font-semibold text-white drop-shadow-[0_10px_20px_rgba(0,0,0,0.45)]">{stat.value}</p>
              </motion.div>
            ))}
          </section>

          <section className="mt-8 grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
            <div className="space-y-6">
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} whileHover={{ y: -3, scale: 1.005 }} className="cinematic-card rounded-[32px] p-8">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm uppercase tracking-[0.3em] text-slate-500">Path progress</p>
                    <h2 className="mt-3 text-2xl font-semibold text-slate-900">Pay the tuition fee to start your classes</h2>
                  </div>
                  <Link href="/programs" className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white hover:bg-[var(--accent-strong)]">Pay deposit</Link>
                </div>
                <div className="mt-6 rounded-[28px] border border-slate-200/70 bg-slate-50/80 p-6 shadow-inner shadow-slate-100">
                  <p className="text-sm text-slate-500">{paymentUnlocked ? 'Your premium learning library is unlocked.' : `You’ve paid ${Math.max(effectivePayment?.totalPaid ?? 0, effectiveTotalPaid).toLocaleString()} of ${tuitionFee.toLocaleString()} NGN tuition.`}</p>
                  <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${paymentProgressPercent}%` }} />
                  </div>
                  <p className="mt-3 text-sm text-slate-500">{paymentProgressPercent}% complete</p>
                </div>
              </motion.div>

              <div className="rounded-[32px] border border-slate-200/70 bg-white/90 p-8 shadow-[0_16px_50px_rgba(15,23,42,0.06)]">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm uppercase tracking-[0.3em] text-slate-500">Daily missions</p>
                    <h2 className="mt-3 text-2xl font-semibold text-slate-900">Quest board</h2>
                  </div>
                  <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-[var(--accent)]">{missionCompletePercent}% complete</span>
                </div>
                <div className="mt-6 space-y-4">
                  {displayMissions.slice(0, 3).map((quest) => {
                    const done = quest.id ? completedMissionIds[quest.id] : quest.done;
                    return (
                      <div key={quest.id || quest.title} className="rounded-[28px] border border-slate-200/70 bg-slate-50/80 p-5 transition-all duration-200 hover:border-[var(--accent)]/30 hover:bg-white">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-semibold text-slate-900">{quest.title}</p>
                            <p className="mt-2 text-sm text-slate-600">{quest.description}</p>
                          </div>
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{done ? 'Completed' : 'Pending'}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} whileHover={{ y: -3, scale: 1.005 }} className="cinematic-card rounded-[32px] p-8">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm uppercase tracking-[0.3em] text-slate-500">Course highlights</p>
                    <h2 className="mt-3 text-2xl font-semibold text-slate-900">Your active courses</h2>
                  </div>
                  <Link href="/materials" className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">Open library</Link>
                </div>
                <div className="mt-6 space-y-4">
                  {resolvedCourses.slice(0, 3).map((course) => (
                    <div key={course.id} className="rounded-[28px] border border-slate-200/70 bg-slate-50/80 p-5 transition-all duration-200 hover:border-[var(--accent)]/30 hover:bg-white">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="font-semibold text-slate-900">{course.title}</p>
                          <p className="mt-1 text-sm text-slate-600">{course.description}</p>
                        </div>
                        <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-[var(--accent)]">{course.progress}%</span>
                      </div>
                      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
                        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${course.progress}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} whileHover={{ y: -3, scale: 1.005 }} className="cinematic-card rounded-[32px] p-8">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm uppercase tracking-[0.3em] text-slate-500">AI coach</p>
                    <h2 className="mt-3 text-2xl font-semibold text-slate-900">Pronunciation practice</h2>
                  </div>
                </div>
                <p className="mt-4 text-sm text-slate-600">Type your German phrase and get instant AI feedback.</p>
                <textarea
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  rows={4}
                  className="mt-4 w-full rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-900 focus:outline-none"
                  placeholder="Ich möchte ein Visum beantragen."
                />
                <button
                  onClick={handleAnalyze}
                  disabled={isAnalyzing}
                  className="mt-4 inline-flex w-full items-center justify-center rounded-3xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {isAnalyzing ? 'Analyzing...' : 'Analyze pronunciation'}
                </button>
                <div className="mt-4 space-y-2 text-sm text-slate-600">
                  {feedback.map((item, index) => (
                    <p key={`${item}-${index}`}>• {item}</p>
                  ))}
                </div>
              </motion.div>
            </div>
          </section>

          <section className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55 }} whileHover={{ y: -3, scale: 1.005 }} className="cinematic-card rounded-[32px] p-8">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.3em] text-slate-500">Personalized plan</p>
                  <h2 className="mt-3 text-2xl font-semibold text-slate-900">AI learning path</h2>
                </div>
                <select value={plannerStrategy} onChange={(e) => setPlannerStrategy(e.target.value)} className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900">
                  <option value="deterministic">Deterministic</option>
                  <option value="fewshot">Few-shot</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="compare">A/B compare</option>
                </select>
              </div>
              <div className="mt-6 space-y-4">
                {personalizedPlan ? (
                  <>
                    {personalizedPlan.rationale ? <p className="text-sm text-slate-600">{personalizedPlan.rationale}</p> : null}
                    <div className="grid gap-4 sm:grid-cols-2">
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {(personalizedPlan.lessons || []).slice(0, 4).map((lesson: any, idx: number) => (
                        <div key={lesson.id || idx} className="rounded-3xl border border-slate-200/70 bg-slate-50/80 p-5 transition-all duration-200 hover:border-[var(--accent)]/30 hover:bg-white">
                          <p className="font-semibold text-slate-900">{lesson.title}</p>
                          <p className="mt-2 text-sm text-slate-600">{lesson.goal}</p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-slate-600">Your personalized plan will appear here once the AI recommendation service loads.</p>
                )}
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} whileHover={{ y: -3, scale: 1.005 }} className="cinematic-card rounded-[32px] p-8">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.3em] text-slate-500">Announcements</p>
                  <h2 className="mt-3 text-2xl font-semibold text-slate-900">What’s new</h2>
                </div>
              </div>
              <div className="mt-6 space-y-4">
                {displayAnnouncements.map((item) => (
                  <div key={item.title} className="rounded-[28px] border border-slate-200/70 bg-slate-50/80 p-5 transition-all duration-200 hover:border-[var(--accent)]/30 hover:bg-white">
                    <p className="font-semibold text-slate-900">{item.title}</p>
                    <p className="mt-2 text-sm text-slate-600">{item.text}</p>
                    <p className="mt-3 text-xs uppercase tracking-[0.3em] text-slate-500">{item.time}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          </section>
        </div>
      </motion.div>
    </StudentShell>
  );
}
