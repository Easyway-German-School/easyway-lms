"use client";

export const dynamic = "force-dynamic";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

type Material = {
  id: string;
  title: string;
  description?: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  uploadedBy: string;
  createdAt: string;
  course?: { title: string; level?: string };
};

import StudentShell from "@/components/StudentShell";
import InteractiveLockedGate from "@/components/InteractiveLockedGate";

export default function MaterialsPage() {
  const { data: session } = useSession();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState("all");
  const [lockedMessage, setLockedMessage] = useState<string | null>(null);
  const [unlockProgress, setUnlockProgress] = useState<{ requiredDeposit: number; totalPaid: number; tuitionFee: number } | null>(null);

  useEffect(() => {
    async function loadMaterials() {
      try {
        const res = await fetch("/api/student/materials");
        if (res.status === 401) {
          setError("Please log in to view course materials");
          setLoading(false);
          return;
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (res.status === 403) {
            setMaterials([]);
            setLockedMessage(data.message || "Pay the required deposit to unlock materials.");
            setUnlockProgress({
              requiredDeposit: Number(data.requiredDeposit || 0),
              totalPaid: Number(data.totalPaid || 0),
              tuitionFee: Number(data.tuitionFee || 0),
            });
            setError(null);
            setLoading(false);
            return;
          }
          throw new Error(data.error || "Failed to load materials");
        }
        const data = await res.json();
        setMaterials(data.materials || []);
        setLockedMessage(null);
        setUnlockProgress(null);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load materials");
      } finally {
        setLoading(false);
      }
    }

    loadMaterials();
  }, []);

  const filteredMaterials = filterType === "all" ? materials : materials.filter((m) => m.fileType === filterType);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const fileTypeIcon = (type: string) => {
    if (type.includes("pdf")) return "📄";
    if (type.includes("word")) return "📝";
    if (type.includes("video")) return "🎬";
    if (type.includes("audio")) return "🔊";
    if (type.includes("image")) return "🖼️";
    return "📦";
  };

  return (
    <StudentShell>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="min-h-screen bg-[var(--background)] px-6 py-10 text-[var(--foreground)]"
      >
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="rounded-3xl bg-[var(--surface)] p-8 shadow-xl ring-1 ring-white/10">
          <p className="text-sm uppercase tracking-[0.24em] text-[var(--accent)]">Learning resources</p>
          <h1 className="mt-3 text-4xl font-bold">Course Materials</h1>
          <p className="mt-2 text-[var(--muted)]">Download and review materials for your enrolled courses</p>
        </div>

        {error && (
          <div className="rounded-xl bg-red-500/10 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {lockedMessage && unlockProgress && (
          <InteractiveLockedGate
            requiredDeposit={unlockProgress.requiredDeposit}
            totalPaid={unlockProgress.totalPaid}
            tuitionFee={unlockProgress.tuitionFee}
            onPayClick={() => window.location.href = "/programs"}
          />
        )}

        <div className="flex gap-3 flex-wrap">
          <button
            onClick={() => setFilterType("all")}
            className={`rounded-full px-6 py-2 text-sm font-semibold transition ${
              filterType === "all"
                ? "bg-[var(--accent)] text-white"
                : "border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--surface-alt)]"
            }`}
          >
            All materials
          </button>
          <button
            onClick={() => setFilterType("pdf")}
            className={`rounded-full px-6 py-2 text-sm font-semibold transition ${
              filterType === "pdf"
                ? "bg-[var(--accent)] text-white"
                : "border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--surface-alt)]"
            }`}
          >
            📄 PDFs
          </button>
          <button
            onClick={() => setFilterType("video")}
            className={`rounded-full px-6 py-2 text-sm font-semibold transition ${
              filterType === "video"
                ? "bg-[var(--accent)] text-white"
                : "border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--surface-alt)]"
            }`}
          >
            🎬 Videos
          </button>
        </div>

        {loading ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-12 text-center">
            <p className="text-[var(--muted)]">Loading materials…</p>
          </div>
        ) : filteredMaterials.length === 0 ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-12 text-center">
            <p className="text-lg font-semibold">No materials found</p>
            <p className="mt-2 text-[var(--muted)]">Check back later for new course materials</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredMaterials.map((material) => (
              <motion.div
                key={material.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-4 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 transition hover:bg-[var(--surface-alt)]"
              >
                <div className="text-4xl">{fileTypeIcon(material.fileType)}</div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[var(--foreground)] truncate">{material.title}</p>
                  {material.description && (
                    <p className="mt-1 text-sm text-[var(--muted)] truncate">{material.description}</p>
                  )}
                  <div className="mt-2 flex gap-4 text-xs text-[var(--muted)]">
                    {material.course && (
                      <span>{material.course.title}</span>
                    )}
                    <span>{formatFileSize(material.fileSize)}</span>
                    <span>{new Date(material.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <a
                  href={material.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110 shrink-0"
                >
                  Download
                </a>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  </StudentShell>
  );
}
