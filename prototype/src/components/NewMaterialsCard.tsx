"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * Recently uploaded materials, on the dashboard.
 *
 * A file that only exists behind a menu item gets missed. This surfaces what a
 * tutor added in the last fortnight so a student meets it without going
 * looking, then sends them to the library for the rest.
 *
 * Renders nothing when the library is payment-locked or there is nothing new —
 * an empty panel on a dashboard is worse than no panel.
 */

const RECENT_DAYS = 14;

type Material = {
  id: string;
  title: string;
  fileType: string;
  fileUrl: string;
  createdAt: string;
  course?: { title: string; level: string } | null;
};

const TYPE_ICON: Record<string, string> = {
  pdf: "📄",
  doc: "📝",
  docx: "📝",
  video: "🎥",
  mp4: "🎥",
  image: "🖼️",
  audio: "🎧",
  mp3: "🎧",
};

export default function NewMaterialsCard() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/student/materials", { cache: "no-store" });
        // 403 means the library is still behind the deposit. The payment panel
        // already says so, so this card stays quiet rather than repeating it.
        if (!res.ok || cancelled) return;
        const data = await res.json();

        const cutoff = Date.now() - RECENT_DAYS * 86_400_000;
        const recent = (data.materials ?? []).filter(
          (m: Material) => new Date(m.createdAt).getTime() >= cutoff,
        );
        if (!cancelled) setMaterials(recent);
      } catch {
        /* The dashboard should still render if this one call fails. */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!loaded || materials.length === 0) return null;

  return (
    <div className="cinematic-card rounded-[32px] p-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-slate-500">Just added</p>
          <h2 className="mt-3 text-2xl font-semibold text-slate-900">New materials</h2>
        </div>
        <Link href="/materials" className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">
          Open library
        </Link>
      </div>

      <div className="mt-6 space-y-4">
        {materials.slice(0, 4).map((material) => {
          const days = Math.floor((Date.now() - new Date(material.createdAt).getTime()) / 86_400_000);
          return (
            <a
              key={material.id}
              href={material.fileUrl}
              className="flex items-center gap-4 rounded-[28px] border border-slate-200/70 bg-slate-50/80 p-5 transition-all duration-200 hover:border-[var(--accent)]/30 hover:bg-white"
            >
              <span className="text-2xl" aria-hidden="true">
                {TYPE_ICON[material.fileType?.toLowerCase()] ?? "📎"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-900">{material.title}</p>
                <p className="text-sm text-slate-500">
                  {material.course?.title ?? "Course material"}
                  {" · "}
                  {days === 0 ? "added today" : days === 1 ? "added yesterday" : `added ${days} days ago`}
                </p>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
