"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { usePathname } from "next/navigation";
import LoadingExperience from "@/components/LoadingExperience";
import Interactive3DCharacterLoader from "@/components/Interactive3DCharacterLoader";

export default function StudentAccessGate({
  children,
  hasAccess,
  loading,
}: {
  children: React.ReactNode;
  hasAccess: boolean;
  loading: boolean;
}) {
  const pathname = usePathname();

  const protectedRoutes = ["/calendar", "/assignment", "/attendance", "/certificates"];
  const isProtected = protectedRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));

  if (!loading && !hasAccess && isProtected) {
    return (
      <div className="relative min-h-[78vh] overflow-hidden rounded-[32px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.25),_transparent_35%),linear-gradient(135deg,_#020617_0%,_#111827_45%,_#0f172a_100%)] p-6 text-white shadow-[0_30px_80px_rgba(2,8,23,0.28)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,_rgba(250,204,21,0.22),_transparent_24%)]" />
        <div className="absolute inset-0 backdrop-blur-xl" />
        <div className="relative z-10 flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
          <motion.div
            initial={{ y: 18, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.35 }}
            className="max-w-2xl rounded-[32px] border border-white/15 bg-white/10 p-8 shadow-2xl"
          >
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-amber-300/40 bg-amber-300/15 text-4xl shadow-[0_0_30px_rgba(251,191,36,0.25)]">
              🔒
            </div>
            <p className="mt-6 text-sm font-semibold uppercase tracking-[0.35em] text-slate-200">Access locked</p>
            <h2 className="mt-3 text-3xl font-semibold text-white">Pay your tuition to unlock classes</h2>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-slate-300">
              Your learning portal is in onboarding mode until the tuition fee is paid. Once that is complete, classes, assignments, attendance, and certificates become available.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href="/programs" className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-white/20 transition hover:-translate-y-0.5 hover:bg-slate-100">
                Pay tuition now
              </Link>
              <Link href="/payments" className="rounded-full border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/15">
                View payments
              </Link>
            </div>

            <div className="mt-8 rounded-[24px] border border-white/10 bg-slate-950/40 p-4">
              <div className="flex items-center justify-center gap-4">
                <svg viewBox="0 0 200 200" className="h-24 w-24" aria-hidden="true">
                  <circle cx="100" cy="78" r="28" fill="#f8fafc" />
                  <rect x="65" y="102" width="70" height="58" rx="20" fill="#38bdf8" />
                  <rect x="82" y="118" width="36" height="24" rx="8" fill="#0f172a" />
                  <path d="M78 102v-18c0-12 9-22 20-22h4c11 0 20 10 20 22v18" stroke="#f8fafc" strokeWidth="10" strokeLinecap="round" fill="none" />
                  <path d="M76 152l-12 18" stroke="#f8fafc" strokeWidth="8" strokeLinecap="round" />
                  <path d="M124 152l12 18" stroke="#f8fafc" strokeWidth="8" strokeLinecap="round" />
                  <path d="M92 160l8 12 12-20" stroke="#fbbf24" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
                <div className="text-left">
                  <p className="text-lg font-semibold">Your coach is waiting</p>
                  <p className="mt-1 text-sm text-slate-300">Complete tuition to unlock your next lessons and start your journey.</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="px-6 py-10">
        <Interactive3DCharacterLoader />
      </div>
    );
  }

  return <>{children}</>;
}
