"use client";

import Interactive3DCharacterLoader from "@/components/Interactive3DCharacterLoader";

export default function LoadingExperience({
  title = "Just a moment…",
  message = "Your learning world is loading. We’re warming up the classroom and refreshing your dashboard.",
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6 py-10 text-slate-900">
      <div className="relative max-w-4xl rounded-[32px] border border-slate-200 bg-white/95 p-6 shadow-[0_34px_80px_rgba(15,23,42,0.12)] sm:p-10">
        <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-sky-500/10 blur-2xl" />
        <div className="absolute -left-8 bottom-8 h-28 w-28 rounded-full bg-amber-300/10 blur-2xl" />
        <div className="relative z-10 grid gap-8 xl:grid-cols-[340px_auto] items-center">
          <Interactive3DCharacterLoader />
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Hang tight</p>
            <h1 className="mt-3 text-3xl font-semibold text-slate-950">{title}</h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-slate-600">{message}</p>
            <div className="mt-6 flex items-center gap-3 text-sm font-medium text-slate-600">
              <div className="h-3 w-3 rounded-full bg-sky-500 animate-pulse" />
              <span>Refreshing your latest classes, payments, and progress.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
