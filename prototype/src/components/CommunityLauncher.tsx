"use client";

import { useState } from "react";
import Link from "next/link";

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="3" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

export default function CommunityLauncher() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="w-72 rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-600">Your learning spaces</p>
          <h2 className="mt-2 text-lg font-semibold text-slate-950">Connect with other learners</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">Join discussions with students and lecturers in your enrolled level communities.</p>
          <Link href="/community" className="mt-4 flex items-center justify-between rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-600">
            Open community
            <ArrowIcon className="h-4 w-4" />
          </Link>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={open ? "Close community launcher" : "Open community launcher"}
        className="flex items-center gap-3 rounded-full bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 shadow-[0_14px_35px_rgba(16,185,129,0.32)] transition hover:bg-emerald-400"
      >
        <UsersIcon className="h-5 w-5" />
        <span>{open ? "Close" : "Connect"}</span>
      </button>
    </div>
  );
}