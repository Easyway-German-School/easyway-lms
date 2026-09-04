"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import BrandLoader from "@/components/BrandLoader";
import PaymentSuccessToastClient from "@/components/PaymentSuccessToastClient";
import TuitionNudge from "@/components/TuitionNudge";
import PrivateUpgradeNudge from "@/components/PrivateUpgradeNudge";
import LiveClassBanner from "@/components/live/LiveClassBanner";
import LevelAdvance from "@/components/LevelAdvance";
import WelcomeTour from "@/components/WelcomeTour";
import NotificationInvite from "@/components/NotificationInvite";
import { ArrowRightIcon, BookOpenIcon, CheckCircleIcon, CompassIcon, FlameIcon, SparklesIcon, StarIcon, TargetIcon, TrendingDownIcon, TrendingUpIcon, UserIcon, VideoIcon } from "@/components/icons";
import { summarizeGamification } from "@/lib/gamification";
import { isReceivedPayment, isRegistrationFeePayment, REGISTRATION_FEE, requiredDepositFor, tuitionFeeFor } from "@/lib/payment";
import { useGamification } from "@/lib/useGamification";
import { useLiveClass } from "@/lib/useLiveClass";

/** Paystack transaction statuses that will never become "success". A stored
 *  reference in one of these is dead, so its dashboard breadcrumbs should be
 *  cleared rather than left showing a "payment processing" band forever. */
const TERMINAL_PAYSTACK_FAILURE = new Set(["failed", "abandoned", "reversed", "cancelled"]);

function clearPendingPaystackBreadcrumbs() {
  try {
    window.localStorage.removeItem("pendingPaystackReference");
    window.localStorage.removeItem("pendingPaystackAmount");
    window.localStorage.removeItem("pendingPaystackPathwayName");
  } catch {
    /* storage unavailable */
  }
}

type Mission = {
  id?: string;
  title: string;
  description: string;
  reward: string;
  category?: string;
  target?: string;
  done?: boolean;
  /** lesson | assignment | quiz | attendance | voice | essay | generic — see mission-detection.ts. Absent on the offline fallback list. */
  detectType?: string;
};

/** A destination for each mission's detectType, so the card is finally something a student can act on instead of just a status report. */
const MISSION_HREF: Record<string, string> = {
  lesson: "/materials",
  assignment: "/assignment",
  quiz: "/games",
  attendance: "/live",
  voice: "/tandem",
  essay: "/essay",
  scene: "/tandem",
  generic: "/materials",
};

type Announcement = {
  id: string;
  title: string;
  text: string;
  time: string;
};

/** Mirrors MissionHistory in src/lib/mission-history-server.ts. */
type MissionHistory = {
  days: { day: string; total: number; done: number }[];
  categories: { detectType: string; label: string; total: number; done: number; rate: number }[];
  totalDone: number;
  totalMissions: number;
};

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

type Student = {
  name?: string;
  level?: string;
  /** Needed for the fee: Abuja is priced above Lagos and Port Harcourt. */
  branchName?: string | null;
  /** group | private — drives whether the private-class upsell shows. */
  classType?: string;
  deliveryMode?: string;
  tutorId?: string | null;
  tutorName?: string | null;
  tutorPhotoUrl?: string | null;
  tutorSpecialization?: string | null;
  tutorBio?: string | null;
  pathway?: string;
  germanyGoal?: string | null;
  germanyGoalNote?: string | null;
  examReadiness?: number;
  /** Used to make the notification ask concrete: "your next class is …". */
  nextLive?: string | null;
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
    fullPaidAt: string | null;
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

import StudentShell from "@/components/StudentShell";
import StudentBrief from "@/components/StudentBrief";
import QuestHistoryCard from "@/components/QuestHistoryCard";
import UpcomingExamsCard from "@/components/UpcomingExamsCard";
import NewMaterialsCard from "@/components/NewMaterialsCard";
import SkillMasteryPanel from "@/components/SkillMasteryPanel";
import Leaderboard from "@/components/Leaderboard";
import TutorBioCard from "@/components/TutorBioCard";
import TutorMessagesCard from "@/components/TutorMessagesCard";
import SessionNotesCard from "@/components/SessionNotesCard";
import JourneyMapPoster from "@/components/JourneyMapPoster";
import GermanyJourney from "@/components/journey/GermanyJourney";
import DeliveryExperiencePanel from "@/components/DeliveryExperiencePanel";
import PremiumProgressPanel from "@/components/PremiumProgressPanel";
import PrivateScheduleSetup from "@/components/PrivateScheduleSetup";

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--background)] flex items-center justify-center text-[var(--foreground)]"><p className="text-[var(--muted)]">Loading dashboard…</p></div>}>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const { data: session, status } = useSession();
  const { game } = useGamification();
  const { live } = useLiveClass();
  const [student, setStudent] = useState<Student | null>(null);
  const [paymentSummary, setPaymentSummary] = useState<Student["paymentSummary"] | null>(null);
  const [fullPaymentExpired, setFullPaymentExpired] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [paymentUnlock, setPaymentUnlock] = useState<{ requiredDeposit: number; totalPaid: number; tuitionFee: number } | null>(null);
  const [pathway, setPathway] = useState("Language training");
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [insights, setInsights] = useState({
    completedLessons: 0,
    totalLessons: 0,
    streak: 0,
    nextMilestone: "First lesson",
  });
  const [dailyMissions, setDailyMissions] = useState<Mission[]>([]);
  const [missionHistory, setMissionHistory] = useState<MissionHistory | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
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
      setFullPaymentExpired(Boolean(
        data.paymentSummary?.fullPaid &&
        data.paymentSummary.fullPaidAt &&
        new Date(data.paymentSummary.fullPaidAt).getTime() + 24 * 60 * 60 * 1000 <= Date.now(),
      ));
      if (data?.pathway) setPathway(data.pathway);
      setDashboardError(null);

      if (!data.paymentSummary) {
        const paymentsResponse = await fetchWithTiming("/api/student/payments", undefined, "student-payments");
        if (paymentsResponse.ok) {
          const paymentsData = await paymentsResponse.json();
          const received = (paymentsData.payments || []).filter(
            (payment: any) => isReceivedPayment(payment.status) && !isRegistrationFeePayment(payment.description),
          );
          const totalPaid = received.reduce((sum: number, payment: any) => sum + Number(payment.amount || 0), 0);
          const feeLookup = { level: data.level, branch: data.branchName ?? null, classType: data.classType ?? null };
          const tuitionFee = tuitionFeeFor(feeLookup);
          const requiredDeposit = requiredDepositFor(feeLookup);
          setPaymentUnlock({ requiredDeposit, totalPaid, tuitionFee });
        }
      }
    } catch (error) {
      console.error("Failed to load student data:", error);
      const fallbackStudent: Student = {
        name: session?.user?.name || "Learner",
        level: "A1",
        pathway: "Language training",
        examReadiness: 0,
        averageGrade: null,
        gradeCount: 0,
        recentGrades: [],
        paymentSummary: {
          totalPaid: 0,
          registrationFee: REGISTRATION_FEE,
          requiredDeposit: requiredDepositFor({ level: "A1", branch: null }),
          tuitionFee: tuitionFeeFor({ level: "A1", branch: null }),
          registrationPaid: true,
          depositPaid: false,
          fullPaid: false,
          fullPaidAt: null,
          accessLevel: "registered",
          paymentProgressPercent: 0,
        },
      };
      setStudent(fallbackStudent);
      setPaymentSummary(fallbackStudent.paymentSummary ?? null);
      setFullPaymentExpired(false);
      setPathway(fallbackStudent.pathway || "Language training");
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

      // `ok` only means Paystack answered — a pending bank transfer answers
      // too. Clearing the stored reference on that would abandon a payment
      // that had not settled yet, and nothing would ever check it again.
      const verifyData = await verifyResponse.json().catch(() => null);

      if (verifyResponse.ok && verifyData?.paid) {
        clearPendingPaystackBreadcrumbs();
        setPendingPayment(null);
      } else if (
        verifyResponse.ok &&
        TERMINAL_PAYSTACK_FAILURE.has(String(verifyData?.transactionStatus || ""))
      ) {
        // Paystack answered and the charge is dead (abandoned / failed /
        // reversed). Nothing is ever coming for this reference. A student who
        // closed the tab on Paystack's failure screen never reaches
        // /enrollment/success, so without this the "payment processing" band
        // would follow them on every visit from here on.
        console.info("Discarding dead Paystack reference", {
          pendingReference,
          transactionStatus: verifyData?.transactionStatus,
        });
        clearPendingPaystackBreadcrumbs();
        setPendingPayment(null);
      } else {
        console.warn("Pending Paystack reference has not cleared yet", {
          pendingReference,
          status: verifyResponse.status,
          transactionStatus: verifyData?.transactionStatus,
        });
      }
    } catch (error) {
      console.error("Unable to verify pending Paystack payment", error);
    } finally {
      await loadStudentData();
      await loadCourses();
    }
  }, [loadStudentData, loadCourses]);

  /**
   * The server decides today's missions AND whether each is done — see
   * /api/student/missions and src/lib/mission-detection.ts. There is
   * deliberately no client-side toggle any more: "done" used to be whatever
   * the student last tapped, which is not the same thing as having done it.
   */
  const loadMissions = useCallback(() => {
    if (typeof window === "undefined") return;
    void fetch("/api/student/missions", { credentials: "include", cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setDailyMissions(Array.isArray(data?.missions) ? data.missions : []))
      .catch(() => setDailyMissions([]));
  }, []);

  /**
   * The record of every DailyMission row this student has ever had, rolled up
   * by day and by detectType — see src/lib/mission-history-server.ts. Fetched
   * alongside today's missions so a completed quest updates both "today" and
   * "the trend" in the same round trip.
   */
  const loadMissionHistory = useCallback(() => {
    if (typeof window === "undefined") return;
    void fetch("/api/student/missions/history", { credentials: "include", cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setMissionHistory(data && Array.isArray(data.days) ? data : null))
      .catch(() => setMissionHistory(null));
  }, []);

  /**
   * Real school announcements, not a fixed sample pair. Same feed the bell
   * icon reads (see NotificationCenter) — this is just the "announcement"
   * kind, most recent two, filtered client-side rather than duplicating the
   * shared /api/notifications query logic for one caller.
   */
  const loadAnnouncements = useCallback(() => {
    if (typeof window === "undefined") return;
    void fetch("/api/notifications?limit=25", { credentials: "include", cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const rows = Array.isArray(data?.notifications) ? data.notifications : [];
        const items = rows
          .filter((n: { kind?: string }) => typeof n.kind === "string" && n.kind.startsWith("announcement"))
          .slice(0, 2)
          .map((n: { id: string; title: string; message: string; createdAt: string }) => ({
            id: n.id,
            title: n.title,
            text: n.message,
            time: relativeTime(n.createdAt),
          }));
        setAnnouncements(items);
      })
      .catch(() => setAnnouncements([]));
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;

    const refreshOnFocus = () => {
      void syncPendingPayment();
      // Coming back from /tandem (or any mission destination) should show the
      // quest as done without a manual reload — detection already ran server
      // side the moment the real activity happened, this just goes and looks.
      loadMissions();
      loadMissionHistory();
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
  }, [status, syncPendingPayment, loadMissions, loadMissionHistory]);

  // Initial load: fetch student and courses in parallel.
  useEffect(() => {
    if (status !== "authenticated") return;

    // show a fast fallback UI after 2.5s so users aren't stuck on a spinner
    const t = setTimeout(() => setFastFallback(true), 2500);

    void (async () => {
      try {
        const p1 = loadStudentData();
        const p2 = loadCourses();
        await Promise.allSettled([p1, p2]);
      } catch (err) {
        console.error('Initial dashboard fetch error', err);
      }
    })();

    return () => clearTimeout(t);
  }, [status, loadStudentData, loadCourses]);

  useEffect(() => {
    if (!student) return;
    loadMissions();
    loadMissionHistory();
    loadAnnouncements();
  }, [student, loadMissions, loadMissionHistory, loadAnnouncements]);

  /**
   * The badge on the home-screen icon — the closest an installed PWA gets to
   * a native widget's "you have things waiting" glance. Set from the same
   * server-detected `done`, so it can never over-promise what the quest
   * board itself shows; cleared once nothing is left outstanding.
   */
  useEffect(() => {
    if (typeof navigator === "undefined" || !("setAppBadge" in navigator)) return;
    const outstanding = dailyMissions.filter((m) => !m.done).length;
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (outstanding > 0) void nav.setAppBadge?.(outstanding).catch(() => {});
    else void nav.clearAppBadge?.().catch(() => {});
  }, [dailyMissions]);

  useEffect(() => {
    const fullPaidAt = paymentSummary?.fullPaidAt;
    if (!paymentSummary?.fullPaid || !fullPaidAt) return;

    const expiry = new Date(fullPaidAt).getTime() + 24 * 60 * 60 * 1000;
    const remaining = expiry - Date.now();
    if (remaining <= 0) return;

    const timer = window.setTimeout(() => setFullPaymentExpired(true), remaining);
    return () => window.clearTimeout(timer);
  }, [paymentSummary]);



  const fallbackStudent: Student = {
    name: session?.user?.name || "Learner",
    level: "A1",
    pathway: "Language training",
    examReadiness: 0,
    averageGrade: null,
    gradeCount: 0,
    recentGrades: [],
    paymentSummary: {
      totalPaid: 0,
      registrationFee: REGISTRATION_FEE,
      requiredDeposit: requiredDepositFor({ level: "A1", branch: null }),
      tuitionFee: tuitionFeeFor({ level: "A1", branch: null }),
      registrationPaid: true,
      depositPaid: false,
      fullPaid: false,
      fullPaidAt: null,
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
  const isPrivateStudent = resolvedStudent?.classType === "private";

  /**
   * Shared card styling for the private tier — the dark radial-gold panel
   * from PremiumPrivateClasses, reused as the surface for every card on this
   * page rather than just the hero, so a private student never scrolls back
   * into a light "everyone else" card. Declared once here instead of
   * repeating the ternary at every card, since it is the same swap six times
   * over.
   */
  const eliteSurface = "border-[#D4AF37]/25 bg-[radial-gradient(circle_at_15%_0%,_#1c1917_0%,_#0b0a09_60%,_#000000_100%)]";
  const cardClass = isPrivateStudent ? `relative overflow-hidden rounded-[32px] border p-8 ${eliteSurface}` : "cinematic-card rounded-[32px] p-8";
  const eyebrowClass = isPrivateStudent ? "text-[#E8C766]" : "text-[var(--muted)]";
  const headingClass = isPrivateStudent ? "text-white" : "text-[var(--foreground)]";
  const mutedClass = isPrivateStudent ? "text-white/50" : "text-[var(--muted)]";
  const innerPanelClass = isPrivateStudent
    ? "border-[#D4AF37]/20 bg-white/[0.03] backdrop-blur-sm"
    : "border-[var(--border)] bg-[var(--surface-alt)]";
  const trackClass = isPrivateStudent ? "bg-white/10" : "bg-[var(--border)]";
  const fillStyle = isPrivateStudent ? { background: "linear-gradient(to right, #D4AF37, #F4E3B2)" } : undefined;
  const goldButtonClass = "bg-gradient-to-r from-[#D4AF37] via-[#E8C766] to-[#D4AF37] text-[#1c1508] shadow-[0_14px_30px_-10px_rgba(212,175,55,0.6)] hover:brightness-110";

  if (status === "loading" && !student && !dashboardError && !fastFallback) {
    return (
      <StudentShell>
        {/* PaymentSuccessToastClient is deliberately NOT rendered here. It
            consumes the one-shot `paystackPaymentSuccess` flag on mount; if it
            mounts behind the loader and this branch then unmounts once the
            dashboard is ready, the flag is already gone and the real instance
            below never shows the toast. It renders once, after load. */}
        <BrandLoader />
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

  // Server-derived XP is authoritative — it can see attendance, submissions and
  // mission ticks. The local fallback keeps the hero card populated on the first
  // paint (and if the request fails) using the same shared formula, so the two
  // never disagree by more than the data each had available.
  const fallbackGame = summarizeGamification({
    completedLessons: insights.completedLessons,
    streak: insights.streak,
    examReadiness: resolvedStudent?.examReadiness || 0,
    averageGrade: resolvedStudent?.averageGrade ?? null,
  });
  const xp = game?.xp ?? fallbackGame.xp;
  const level = game?.level ?? fallbackGame.level;
  const xpProgress = game?.levelProgressPercent ?? fallbackGame.levelProgressPercent;
  const streakDays = game?.streak ?? insights.streak;
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
  const paymentFullyPaid = Boolean(
    paymentSummary
      ? paymentSummary.fullPaid && !fullPaymentExpired
      : tuitionFee > 0 && effectiveTotalPaid >= tuitionFee
  );
  const showPaymentProgress = paymentSummary
    ? !paymentSummary.fullPaid || !fullPaymentExpired
    : true;
  const effectivePayment = paymentSummary ?? (paymentUnlock
    ? {
        totalPaid: paymentUnlock.totalPaid,
        requiredDeposit: paymentUnlock.requiredDeposit,
        tuitionFee: paymentUnlock.tuitionFee,
        depositPaid: paymentUnlock.totalPaid >= paymentUnlock.requiredDeposit,
        fullPaid: false,
        fullPaidAt: null,
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
  const missionCompletedCount = displayMissions.filter((mission) => mission.done).length;
  const missionCompletePercent = displayMissions.length > 0 ? Math.round((missionCompletedCount / displayMissions.length) * 100) : 0;
  const quickStats = [
    { label: 'Courses enrolled', value: resolvedCourses.length.toString(), icon: <BookOpenIcon className="h-6 w-6" /> },
    { label: 'Active quests', value: displayMissions.length.toString(), icon: <CompassIcon className="h-6 w-6" /> },
    { label: 'Progress', value: `${xpProgress}%`, icon: <TrendingUpIcon className="h-6 w-6" /> },
    { label: 'Exam readiness', value: `${resolvedStudent?.examReadiness ?? 0}%`, icon: <TargetIcon className="h-6 w-6" /> },
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
        <div className="mx-auto w-full min-w-0 max-w-7xl overflow-x-clip px-3 py-6 sm:px-6 sm:py-10">
          {/* Shows once per account, on the very first visit, then never again. */}
          <WelcomeTour />
          {/* Ranks BELOW the tour in the moment queue, so a new student meets
              the portal before being asked for anything. The queue's two-modal
              cap usually pushes this to their second visit, which is exactly
              when the ask makes sense. */}
          <NotificationInvite
            tutorName={null}
            nextClass={student?.nextLive && student.nextLive !== "No live session scheduled" ? student.nextLive : null}
          />
          {/* ABOVE EVEN THE TUITION BAND, and it is the only thing that goes
              there. Everything else on this dashboard is still true in an hour;
              a class in session is not. It renders nothing at all when no class
              is live, so it costs the other 23 hours of the day nothing. */}
          <LiveClassBanner className="mb-6" />
          {/* Above the hero on purpose: a student with a balance should meet it
              before anything else, and it disappears entirely once settled. */}
          <PrivateScheduleSetup classType={resolvedStudent?.classType} />
          <TuitionNudge className="mb-6" />
          {/* Same slot the balance band just vacated — a group student stops
              seeing TuitionNudge the moment they finish paying, and this is
              what a FULLY PAID group student sees there instead. See
              PrivateUpgradeNudge for why "paid in full" is the gate rather
              than "just registered", which the /programs popup already
              covers at the moment they choose how to pay. */}
          <div className="mb-6">
            <PrivateUpgradeNudge classType={resolvedStudent?.classType} fullPaid={paymentFullyPaid} />
          </div>
          <DeliveryExperiencePanel
            classType={resolvedStudent?.classType}
            deliveryMode={resolvedStudent?.deliveryMode}
          />
          <PremiumProgressPanel
            classType={resolvedStudent?.classType}
            deliveryMode={resolvedStudent?.deliveryMode}
          />
          {/* Sits above the hero for the same reason the nudge does: a student
              whose level has just ended needs to meet that before their
              streak. Fires ONLY when a super admin has signed the level off —
              never off the batch month, which used to congratulate people who
              had not attended a lesson. */}
          <LevelAdvance className="mb-6" />
          {/* The road to Germany: the map, the running two-month clock, and the
              once-a-day moment. Above the hero deliberately — the streak and
              the XP are about this week, and this is about the reason they
              enrolled at all. */}
          <GermanyJourney className="mb-8" premium={isPrivateStudent} />
          {/* The printed poster for this student's level, if the artwork exists.
              A different thing from the map above: this is the picture the
              school prints, the same for everybody at that level. */}
          {!isPrivateStudent && <div className="mb-6"><JourneyMapPoster level={resolvedStudent.level} /></div>}
          {/* The hero used to be a flat solid orange-to-orange fill — legible,
              but it read as "theme colours applied to a box" rather than an
              actual design, and it broke down in Nacht/Dämmerung because a
              literal brand-orange panel does not belong to any of the three
              palettes. It is a dark glass panel now in every theme, and the
              brand colour shows up as ambient LIGHT (drifting glow orbs, a
              particle field) instead of as paint — the same trick the rest of
              the app's scene layer already uses, just concentrated here where
              the student actually lands. */}
          <section
            className={`relative overflow-hidden rounded-[36px] border p-8 ${
              isPrivateStudent
                ? "border-[#D4AF37]/25 bg-[radial-gradient(circle_at_15%_0%,_#1c1917_0%,_#0b0a09_55%,_#000000_100%)] shadow-[0_30px_90px_-30px_rgba(212,175,55,0.35)]"
                : "border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)]"
            }`}
          >
            {/* Light sweeping through the glass, not sitting on it — see
                .aurora-sweep. Behind the blobs and particles so it reads as
                depth, not another spot of colour. Private gets its own gold
                sheen instead — this whole panel is meant to read as a
                different tier of the product, the way the upgrade card
                already does (see PremiumPrivateClasses), not the same glass
                with a gold badge stapled on. */}
            {isPrivateStudent ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 -translate-x-full bg-[linear-gradient(115deg,transparent_35%,rgba(255,255,255,0.06)_50%,transparent_65%)] [animation:pan_7s_ease-in-out_infinite]"
              />
            ) : (
              <div className="aurora-sweep" />
            )}
            <div
              className="pointer-events-none absolute -right-16 -top-24 h-80 w-80 rounded-full opacity-70 blur-[100px] animate-blob"
              style={{
                background: isPrivateStudent
                  ? "radial-gradient(circle, rgba(212,175,55,0.35), transparent 70%)"
                  : "radial-gradient(circle, color-mix(in srgb, var(--accent) 60%, transparent), transparent 70%)",
              }}
            />
            <div
              className="pointer-events-none absolute -left-24 -bottom-24 h-72 w-72 rounded-full opacity-60 blur-[100px] animate-blob animation-delay-4000"
              style={{
                background: isPrivateStudent
                  ? "radial-gradient(circle, rgba(255,102,0,0.28), transparent 70%)"
                  : "radial-gradient(circle, color-mix(in srgb, var(--accent-strong) 55%, transparent), transparent 70%)",
              }}
            />
            {!isPrivateStudent && <div className="scene-particles pointer-events-none absolute inset-0 opacity-70" />}
            <div className="relative grid gap-8 lg:grid-cols-[1.45fr_0.95fr] lg:items-end">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <div
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] ${
                      isPrivateStudent
                        ? "border-[#D4AF37]/40 bg-[#D4AF37]/10 text-[#E8C766]"
                        : "border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent-ink)]"
                    }`}
                  >
                    <span className={`h-2 w-2 animate-pulse rounded-full ${isPrivateStudent ? "bg-[#D4AF37]" : "bg-[var(--accent)]"}`} />
                    {isPrivateStudent ? "Private membership" : "Student dashboard"}
                  </div>
                  {isPrivateStudent && (
                    <span className="inline-flex items-center gap-1 text-[#E8C766]/80">
                      {[0, 1, 2].map((i) => (
                        <StarIcon key={i} className="h-3.5 w-3.5" strokeWidth={1.4} />
                      ))}
                    </span>
                  )}
                </div>
                <h1
                  className={`mt-4 text-4xl font-semibold ${
                    isPrivateStudent
                      ? "bg-gradient-to-r from-white via-[#F4E3B2] to-[#D4AF37] bg-clip-text text-transparent"
                      : "text-[var(--foreground)]"
                  }`}
                >
                  Welcome back, {resolvedStudent?.name || session?.user?.name || 'Learner'}
                </h1>
                <p className={`mt-4 max-w-2xl ${isPrivateStudent ? "text-white/60" : "text-[var(--muted)]"}`}>
                  {isPrivateStudent
                    ? "A tutor dedicated to you, on your schedule — with everything the group track gets, plus the parts money buys."
                    : "Your academy experience is now a cinematic quest board with live XP, missions, and progress tracking."}
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  {isPrivateStudent ? (
                    <>
                      <div className="flex items-center gap-2 rounded-full border border-[#D4AF37]/25 bg-white/[0.04] px-3 py-2 text-sm text-white/70 backdrop-blur-sm">
                        <span className="text-[#E8C766]"><UserIcon className="h-4 w-4" /></span>
                        {resolvedStudent?.tutorName ? `Tutor: ${resolvedStudent.tutorName}` : "Tutor being assigned"}
                      </div>
                      <div className="flex items-center gap-2 rounded-full border border-[#D4AF37]/25 bg-white/[0.04] px-3 py-2 text-sm text-white/70 backdrop-blur-sm">
                        <span className="text-[#E8C766]"><FlameIcon className="h-4 w-4" /></span> Streak {streakDays} days
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground-soft)]"><span className="text-[var(--accent)]"><SparklesIcon /></span> XP boost active</div>
                      <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground-soft)]"><span className="text-[var(--accent)]"><FlameIcon /></span> Streak {streakDays} days</div>
                      <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground-soft)]"><span className="text-[var(--accent)]"><TargetIcon /></span> Next: {insights.nextMilestone}</div>
                    </>
                  )}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <motion.div
                  whileHover={{ y: -4, scale: 1.01 }}
                  className={`rounded-[28px] border p-5 ${
                    isPrivateStudent ? "border-[#D4AF37]/20 bg-white/[0.03] backdrop-blur-sm" : "border-[var(--border)] bg-[var(--surface-alt)]"
                  }`}
                >
                  <p className={`text-xs uppercase tracking-[0.3em] ${isPrivateStudent ? "text-white/40" : "text-[var(--muted)]"}`}>Current level</p>
                  <p className={`mt-3 text-3xl font-semibold ${isPrivateStudent ? "text-white" : "text-[var(--foreground)]"}`}>{level}</p>
                  <div className={`mt-4 h-2 overflow-hidden rounded-full ${isPrivateStudent ? "bg-white/10" : "bg-[var(--border)]"}`}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${xpProgress}%`,
                        background: isPrivateStudent ? "linear-gradient(to right, #D4AF37, #F4E3B2)" : undefined,
                      }}
                    >
                      {!isPrivateStudent && <div className="h-full w-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-strong)]" />}
                    </div>
                  </div>
                  <p className={`mt-2 text-sm ${isPrivateStudent ? "text-white/50" : "text-[var(--muted)]"}`}>{xp} XP to your next milestone</p>
                </motion.div>
                <motion.div
                  whileHover={{ y: -4, scale: 1.01 }}
                  className={`rounded-[28px] border p-5 ${
                    isPrivateStudent ? "border-[#D4AF37]/20 bg-white/[0.03] backdrop-blur-sm" : "border-[var(--border)] bg-[var(--surface-alt)]"
                  }`}
                >
                  <p className={`text-xs uppercase tracking-[0.3em] ${isPrivateStudent ? "text-white/40" : "text-[var(--muted)]"}`}>Unlock progress</p>
                  <p
                    className={`mt-3 text-3xl font-semibold ${
                      isPrivateStudent ? "bg-gradient-to-r from-[#F4E3B2] to-[#D4AF37] bg-clip-text text-transparent" : "text-[var(--foreground)]"
                    }`}
                  >
                    {paymentProgressPercent}%
                  </p>
                  <p className={`mt-2 text-sm ${isPrivateStudent ? "text-white/50" : "text-[var(--muted)]"}`}>
                    {isPrivateStudent
                      ? paymentFullyPaid
                        ? "Your one-to-one coaching is fully unlocked."
                        : "Your dedicated tutor is waiting on the rest of your tuition."
                      : paymentFullyPaid
                      ? 'Premium library access is fully unlocked.'
                      : paymentUnlocked
                      ? 'Premium library access is unlocked.'
                      : 'Premium library access is moving closer.'}
                  </p>
                </motion.div>
              </div>
            </div>
          </section>

          {/* 2-up on a phone rather than one long stacked column — the same
              four numbers, half the scroll to get past them. */}
          <section className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6">
            {quickStats.map((stat, index) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.06 * index, duration: 0.35 }}
                whileHover={{ y: -4, scale: 1.01 }}
                className={`relative overflow-hidden rounded-[24px] p-4 sm:rounded-[28px] sm:p-6 ${
                  isPrivateStudent ? `border ${eliteSurface}` : "cinematic-card"
                }`}
              >
                <div
                  className="pointer-events-none absolute -left-10 top-10 h-24 w-24 rounded-full opacity-60 blur-3xl"
                  style={{
                    background: isPrivateStudent
                      ? "radial-gradient(circle, rgba(212,175,55,0.3), transparent 70%)"
                      : "radial-gradient(circle, color-mix(in srgb, var(--accent) 45%, transparent), transparent 70%)",
                  }}
                />
                <div
                  className="pointer-events-none absolute -right-10 bottom-8 h-20 w-20 rounded-full opacity-50 blur-3xl"
                  style={{
                    background: isPrivateStudent
                      ? "radial-gradient(circle, rgba(255,102,0,0.25), transparent 70%)"
                      : "radial-gradient(circle, color-mix(in srgb, var(--accent-strong) 45%, transparent), transparent 70%)",
                  }}
                />
                {/* Stacked on a phone — icon then label side by side was tight
                    at half-width — row again from sm up, where there is room. */}
                <div className="relative flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <span className={isPrivateStudent ? "text-[#E8C766]" : "text-[var(--accent)]"}>{stat.icon}</span>
                  <span className={`rounded-full border px-2.5 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.2em] sm:px-3 sm:text-[0.65rem] sm:tracking-[0.28em] ${innerPanelClass} ${mutedClass}`}>{stat.label}</span>
                </div>
                <p className={`relative mt-3 text-2xl font-semibold sm:mt-6 sm:text-3xl ${headingClass}`}>{stat.value}</p>
              </motion.div>
            ))}
          </section>

          <section className="mt-8 grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
            <div className="space-y-6">
              {showPaymentProgress && <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} whileHover={{ y: -3, scale: 1.005 }} className={cardClass}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className={`text-sm uppercase tracking-[0.3em] ${eyebrowClass}`}>{isPrivateStudent ? "Private coaching" : "Path progress"}</p>
                    <h2 className={`mt-3 text-2xl font-semibold ${headingClass}`}>
                      {isPrivateStudent
                        ? paymentFullyPaid
                          ? 'Your one-to-one tuition is fully paid — book with your tutor'
                          : paymentUnlocked
                          ? 'Deposit received — balance still outstanding'
                          : 'Pay to start your one-to-one classes'
                        : paymentFullyPaid
                        ? 'Your tuition is fully paid — enjoy your classes'
                        : paymentUnlocked
                        ? 'Deposit received — balance still outstanding'
                        : 'Pay the tuition fee to start your classes'}
                    </h2>
                  </div>
                  {paymentFullyPaid ? null : (
                    <Link
                      href="/programs"
                      className={`rounded-full px-5 py-3 text-sm font-semibold shadow-lg transition hover:brightness-110 ${
                        isPrivateStudent
                          ? goldButtonClass
                          : "text-white bg-gradient-to-r from-[var(--accent)] to-[var(--accent-strong)] shadow-[0_10px_30px_-8px_color-mix(in_srgb,var(--accent)_70%,transparent)]"
                      }`}
                    >
                      {paymentUnlocked ? 'Pay balance' : 'Pay deposit'}
                    </Link>
                  )}
                </div>
                <div className={`mt-6 rounded-[28px] border p-6 shadow-[inset_0_2px_10px_rgba(0,0,0,0.15)] ${innerPanelClass}`}>
                  <p className={`text-sm ${mutedClass}`}>{paymentUnlocked ? 'Your premium learning library is unlocked.' : `You’ve paid ${Math.max(effectivePayment?.totalPaid ?? 0, effectiveTotalPaid).toLocaleString()} of ${tuitionFee.toLocaleString()} NGN tuition.`}</p>
                  <div className={`mt-5 h-3 overflow-hidden rounded-full ${trackClass}`}>
                    <div className={`h-full rounded-full ${isPrivateStudent ? "" : "bg-[var(--accent)]"}`} style={{ width: `${paymentProgressPercent}%`, ...(fillStyle ?? {}) }} />
                  </div>
                  <p className={`mt-3 text-sm ${mutedClass}`}>{paymentProgressPercent}% complete</p>
                </div>
              </motion.div>}

              <StudentBrief />

              <div className={cardClass}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className={`text-sm uppercase tracking-[0.3em] ${eyebrowClass}`}>{isPrivateStudent ? "This week's focus" : "Daily missions"}</p>
                    <h2 className={`mt-3 text-2xl font-semibold ${headingClass}`}>{isPrivateStudent ? "Your coaching plan" : "Quest board"}</h2>
                  </div>
                  <motion.span
                    key={missionCompletePercent}
                    initial={{ scale: 0.82, opacity: 0.4 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 320, damping: 18 }}
                    className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] ${
                      isPrivateStudent ? "bg-[#D4AF37]/10 text-[#E8C766]" : "bg-[var(--accent-soft)] text-[var(--accent)]"
                    }`}
                  >
                    {missionCompletePercent}% complete
                  </motion.span>
                </div>
                <div className="mt-6 space-y-4">
                  {displayMissions.slice(0, 3).map((quest) => {
                    const done = quest.done;
                    // "Done" is server-detected, never a checkbox — see
                    // src/lib/mission-detection.ts. What was missing wasn't a
                    // tap-to-complete button, it was ANY way to get from "here
                    // is your mission" to the page where you'd actually do it.
                    // A finished quest STAYS in the list rather than
                    // disappearing — see missionHistory below for where it
                    // goes once the day rolls over.
                    const href = MISSION_HREF[quest.detectType ?? "generic"] ?? "/materials";
                    return (
                      <Link
                        key={quest.id || quest.title}
                        href={href}
                        className={`group flex w-full items-start gap-4 rounded-[28px] border p-5 text-left transition-all duration-200 ${
                          done
                            ? "border-[var(--success)]/25 bg-[var(--success-soft)]/40"
                            : isPrivateStudent
                            ? `${innerPanelClass} hover:border-[#D4AF37]/40`
                            : "border-[var(--border)] bg-[var(--surface-alt)] hover:border-[var(--accent)]/30 hover:bg-[var(--surface)]"
                        }`}
                      >
                        <span
                          className={`mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                            done
                              ? 'bg-[var(--success)] text-white'
                              : isPrivateStudent
                              ? "bg-[#D4AF37]/15 text-transparent"
                              : 'bg-[var(--accent-soft)] text-transparent'
                          }`}
                        >
                          {done ? (
                            <CheckCircleIcon className="h-4 w-4" />
                          ) : (
                            <span
                              className={`h-2.5 w-2.5 rounded-full ${
                                isPrivateStudent
                                  ? "bg-[#D4AF37] shadow-[0_0_10px_2px_rgba(212,175,55,0.5)] animate-pulse"
                                  : 'bg-[var(--accent)] shadow-[0_0_10px_2px_color-mix(in_srgb,var(--accent)_65%,transparent)] animate-pulse'
                              }`}
                            />
                          )}
                        </span>
                        <div className="flex flex-1 items-start justify-between gap-4">
                          <div>
                            <p className={`font-semibold ${done ? `${mutedClass} line-through decoration-[var(--success)]/60` : headingClass}`}>{quest.title}</p>
                            <p className={`mt-2 text-sm ${mutedClass}`}>{quest.description}</p>
                          </div>
                          <span
                            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                              done ? 'bg-[var(--success-soft)] text-[var(--success)]' : isPrivateStudent ? "bg-[#D4AF37]/10 text-[#E8C766]" : 'bg-[var(--accent-soft)] text-[var(--accent)]'
                            }`}
                          >
                            {done ? 'Completed' : 'Go do this'}
                            {!done && (
                              <ArrowRightIcon className="h-3.5 w-3.5 shrink-0 transition group-hover:translate-x-0.5" />
                            )}
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>

              {!isPrivateStudent && missionHistory && missionHistory.totalMissions > 0 && (
                <QuestHistoryCard history={missionHistory} cardClass={cardClass} eyebrowClass={eyebrowClass} headingClass={headingClass} mutedClass={mutedClass} />
              )}
            </div>

            <div className="space-y-6">
              {isPrivateStudent && (
                <div className="relative overflow-hidden rounded-[32px] border border-[#D4AF37]/30 bg-[radial-gradient(circle_at_20%_0%,_#1c1917_0%,_#0b0a09_60%,_#000000_100%)] p-6">
                  <div
                    aria-hidden
                    className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[#D4AF37] opacity-[0.14] blur-3xl"
                  />
                  <div className="relative flex items-start justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#E8C766]">Your one-to-one coaching</p>
                    {live?.personal && (
                      <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                        <motion.span
                          className="h-1.5 w-1.5 rounded-full bg-[#4ADE80]"
                          animate={{ opacity: [1, 0.3, 1] }}
                          transition={{ duration: 1.4, repeat: Infinity }}
                        />
                        Live now
                      </span>
                    )}
                  </div>

                  <div className="relative mt-4 flex items-center gap-3">
                    <span className="grid h-12 w-12 flex-none place-items-center overflow-hidden rounded-full border border-[#D4AF37]/40 bg-[#D4AF37]/10 text-[#E8C766]">
                      {resolvedStudent?.tutorPhotoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={resolvedStudent.tutorPhotoUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <UserIcon className="h-5 w-5" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">
                        {live?.personal && live?.tutorName ? live.tutorName : resolvedStudent?.tutorName || "Tutor being assigned"}
                      </p>
                      <p className="truncate text-xs text-white/50">
                        {live?.personal
                          ? "is waiting for you right now"
                          : resolvedStudent?.nextLive && resolvedStudent.nextLive !== "No live session scheduled"
                          ? resolvedStudent.nextLive
                          : "No session booked yet"}
                      </p>
                    </div>
                  </div>

                  <p className="relative mt-4 text-sm leading-6 text-white/50">
                    {live?.personal
                      ? "They rang the room for you specifically — this is not a shared class link."
                      : "Your tutor books your sessions directly — check Classes for the full calendar, or message them from Community if you need a time that isn't on it yet."}
                  </p>

                  {live?.personal ? (
                    <Link
                      href={`/live?code=${live.joinCode}`}
                      className="relative mt-4 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#D4AF37] via-[#E8C766] to-[#D4AF37] px-5 py-2.5 text-sm font-bold text-[#1c1508] shadow-[0_14px_30px_-10px_rgba(212,175,55,0.6)] transition hover:brightness-110"
                    >
                      <VideoIcon className="h-4 w-4" />
                      Join now
                    </Link>
                  ) : (
                    <Link
                      href="/calendar"
                      className="relative mt-4 inline-flex rounded-full bg-[#D4AF37] px-5 py-2.5 text-sm font-semibold text-[#1a1206] transition hover:brightness-110"
                    >
                      View calendar
                    </Link>
                  )}
                </div>
              )}
              {isPrivateStudent && (
                <>
                  <TutorBioCard
                    tutorName={resolvedStudent?.tutorName}
                    tutorPhotoUrl={resolvedStudent?.tutorPhotoUrl}
                    tutorSpecialization={resolvedStudent?.tutorSpecialization}
                    tutorBio={resolvedStudent?.tutorBio}
                  />
                  <TutorMessagesCard tutorName={resolvedStudent?.tutorName} />
                  <SessionNotesCard />
                </>
              )}
              {/* Bookings made on the public exam-centre page appear here too —
                  both write the same registrations. */}
              <UpcomingExamsCard />

              <NewMaterialsCard />

              <SkillMasteryPanel />

              {/* Ranking a private 1:1 student against whoever happens to share
                  their branch/level/sitting is meaningless — they have no real
                  cohort. Group students only. */}
              {!isPrivateStudent && (
                <div className="cinematic-card rounded-[32px] p-8">
                  <Leaderboard />
                </div>
              )}

              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} whileHover={{ y: -3, scale: 1.005 }} className={cardClass}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className={`text-sm uppercase tracking-[0.3em] ${eyebrowClass}`}>{isPrivateStudent ? "Your curriculum" : "Course highlights"}</p>
                    <h2 className={`mt-3 text-2xl font-semibold ${headingClass}`}>Your active courses</h2>
                  </div>
                  <Link
                    href="/materials"
                    className={`rounded-full px-5 py-3 text-sm font-semibold shadow-[0_10px_30px_-8px_color-mix(in_srgb,var(--accent)_70%,transparent)] transition hover:brightness-110 ${
                      isPrivateStudent ? goldButtonClass + " shadow-none" : "text-white bg-gradient-to-r from-[var(--accent)] to-[var(--accent-strong)]"
                    }`}
                  >
                    Open library
                  </Link>
                </div>
                <div className="mt-6 space-y-4">
                  {resolvedCourses.slice(0, 3).map((course) => (
                    <div
                      key={course.id}
                      className={`rounded-[28px] border p-5 transition-all duration-200 ${
                        isPrivateStudent ? `${innerPanelClass} hover:border-[#D4AF37]/40` : "border-[var(--border)] bg-[var(--surface-alt)] hover:border-[var(--accent)]/30 hover:bg-[var(--surface)]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className={`font-semibold ${headingClass}`}>{course.title}</p>
                          <p className={`mt-1 text-sm ${mutedClass}`}>{course.description}</p>
                        </div>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] ${
                            isPrivateStudent ? "bg-[#D4AF37]/10 text-[#E8C766]" : "bg-[var(--accent-soft)] text-[var(--accent)]"
                          }`}
                        >
                          {course.progress}%
                        </span>
                      </div>
                      <div className={`mt-4 h-2 overflow-hidden rounded-full ${trackClass}`}>
                        <div className={`h-full rounded-full ${isPrivateStudent ? "" : "bg-[var(--accent)]"}`} style={{ width: `${course.progress}%`, ...(fillStyle ?? {}) }} />
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>

              {/*
                Used to be a full card here — pronunciation practice and the
                personalized plan, always expanded, the single biggest block
                on the page. A dashboard is a five-second glance at where you
                stand; a text box waiting for AI feedback is a workspace, and
                the two do not belong on the same screen. Both tools moved to
                the AI Coach tab, next to Games — this is a doorway, not a
                demotion.
              */}
              <Link
                href="/games"
                className={`group flex items-center gap-4 rounded-[32px] p-6 transition ${
                  isPrivateStudent ? `${cardClass} hover:border-[#D4AF37]/40` : "cinematic-card hover:border-[var(--accent)]/30"
                }`}
              >
                <span
                  className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${
                    isPrivateStudent ? "bg-[#D4AF37]/10 text-[#E8C766]" : "bg-[var(--accent-soft)] text-[var(--accent)]"
                  }`}
                >
                  <SparklesIcon className="h-6 w-6" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-semibold uppercase tracking-[0.2em] ${eyebrowClass}`}>AI Coach</span>
                  <span className={`mt-1 block text-lg font-semibold ${headingClass}`}>
                    Pronunciation practice &amp; your study plan
                  </span>
                </span>
                <ArrowRightIcon
                  className={`h-5 w-5 shrink-0 transition group-hover:translate-x-1 ${
                    isPrivateStudent ? "text-white/40 group-hover:text-[#E8C766]" : "text-[var(--muted)] group-hover:text-[var(--accent)]"
                  }`}
                />
              </Link>
            </div>
          </section>

          {announcements.length > 0 && (
            <section className="mt-8">
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} whileHover={{ y: -3, scale: 1.005 }} className={cardClass}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className={`text-sm uppercase tracking-[0.3em] ${eyebrowClass}`}>Announcements</p>
                    <h2 className={`mt-3 text-2xl font-semibold ${headingClass}`}>What’s new</h2>
                  </div>
                </div>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  {announcements.map((item) => (
                    <div
                      key={item.id}
                      className={`rounded-[28px] border p-5 transition-all duration-200 ${
                        isPrivateStudent ? `${innerPanelClass} hover:border-[#D4AF37]/40` : "border-[var(--border)] bg-[var(--surface-alt)] hover:border-[var(--accent)]/30 hover:bg-[var(--surface)]"
                      }`}
                    >
                      <p className={`font-semibold ${headingClass}`}>{item.title}</p>
                      <p className={`mt-2 text-sm ${mutedClass}`}>{item.text}</p>
                      <p className={`mt-3 text-xs uppercase tracking-[0.3em] ${mutedClass}`}>{item.time}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            </section>
          )}
        </div>
      </motion.div>
    </StudentShell>
  );
}
