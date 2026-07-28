"use client";

import { useEffect, useState } from "react";

const loaderLabels = ["Processing…", "Syncing…", "Preparing…", "Loading…"];
const loaderIcons = ["📘", "🧠", "📈", "🔔", "📝"];

export default function Interactive3DCharacterLoader() {
  const [iconIndex, setIconIndex] = useState(0);
  const [labelIndex, setLabelIndex] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setIconIndex((current) => (current + 1) % loaderIcons.length);
      setLabelIndex((current) => (current + 1) % loaderLabels.length);
    }, 1600);

    return () => window.clearInterval(interval);
  }, []);

  const handleClick = () => {
    setIconIndex((current) => (current + 1) % loaderIcons.length);
    setLabelIndex((current) => (current + 1) % loaderLabels.length);
  };

  return (
    <div className="w-full min-h-screen flex items-center justify-center bg-transparent px-4 py-12 sm:px-6">
      <button
        type="button"
        onClick={handleClick}
        className="group relative flex flex-col items-center justify-center rounded-[32px] border border-white/10 bg-slate-950/80 px-8 py-10 text-center shadow-[0_30px_60px_rgba(15,23,42,0.3)] transition duration-300 hover:-translate-y-1 hover:border-sky-300/20 hover:bg-slate-950/90 focus:outline-none focus:ring-4 focus:ring-sky-400/20"
      >
        <div className="relative flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 shadow-[0_0_40px_rgba(56,189,248,0.15)]">
          <span className="absolute inset-0 rounded-full border border-sky-400/10" />
          <span className="text-7xl sm:text-8xl">{loaderIcons[iconIndex]}</span>
        </div>

        <div className="mt-5 space-y-2">
          <p className="text-sm uppercase tracking-[0.26em] text-slate-400">loading indicator</p>
          <p className="text-2xl font-semibold text-white">{loaderLabels[labelIndex]}</p>
          <p className="text-sm text-slate-500">Tap the icon to refresh the state</p>
        </div>
      </button>
    </div>
  );
}
