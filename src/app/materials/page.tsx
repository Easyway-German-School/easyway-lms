"use client";

export const dynamic = "force-dynamic";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import StudentShell from "@/components/StudentShell";
import VideoLibrary from "@/components/video/VideoLibrary";
import { isPlayableVideo, type LibraryVideo } from "@/lib/video-library";
import { parseEmbedUrl } from "@/lib/embed-utils";
import { AudioIcon, DocumentIcon, FilmIcon, ImageIcon, PackageIcon, PencilIcon, LinkIcon } from "@/components/icons";

type Material = {
  id: string;
  title: string;
  description?: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  uploadedBy: string;
  createdAt: string;
  isEmbedded?: boolean;
  embedProvider?: string;
  course?: { title: string; level?: string };
};

type Tab = "watch" | "documents";

const DOCUMENT_FILTERS = [
  { value: "all", label: "All documents", icon: null },
  { value: "pdf", label: "PDFs", icon: <DocumentIcon /> },
  { value: "word", label: "Documents", icon: <PencilIcon /> },
  { value: "audio", label: "Audio", icon: <AudioIcon /> },
] as const;

export default function MaterialsPage() {
  const [tab, setTab] = useState<Tab>("watch");

  const [materials, setMaterials] = useState<Material[]>([]);
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [level, setLevel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  // The paywall itself is the shell's job. This only survives so a 403 from
  // either API still says something useful instead of an empty page.
  const [lockedMessage, setLockedMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        // Both in flight together: the two tabs are one page, and a student on
        // a slow link should not pay two round trips to switch between them.
        const [materialsRes, videosRes] = await Promise.all([
          fetch("/api/student/materials", { cache: "no-store" }),
          fetch("/api/student/videos", { cache: "no-store" }),
        ]);

        if (materialsRes.status === 401) {
          setError("Please log in to view course materials");
          return;
        }

        if (materialsRes.status === 403 || videosRes.status === 403) {
          const data = await (materialsRes.status === 403 ? materialsRes : videosRes).json().catch(() => ({}));
          setLockedMessage(data.message || "Pay the required deposit to unlock materials.");
          setMaterials([]);
          setVideos([]);
          return;
        }

        if (materialsRes.ok) {
          const data = await materialsRes.json();
          setMaterials(data.materials || []);
        }

        if (videosRes.ok) {
          const data = await videosRes.json();
          setVideos(data.videos || []);
          setLevel(data.level ?? null);
          // Land on whichever tab actually has something in it. A brand-new
          // level has no recordings yet, and an empty hero is a bad first look.
          if ((data.videos || []).length === 0) setTab("documents");
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load materials");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  // Videos have their own tab, so they are not repeated in the document list.
  // Also exclude embedded URLs from documents - they should only appear in watch tab
  const documents = materials.filter((material) => !isPlayableVideo(material.fileType) && !material.isEmbedded);
  const filteredDocuments =
    filterType === "all" ? documents : documents.filter((material) => material.fileType?.includes(filterType));

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const fileTypeIcon = (type: string) => {
    const className = "h-7 w-7";
    if (type.includes("pdf")) return <DocumentIcon className={className} />;
    if (type.includes("word")) return <PencilIcon className={className} />;
    if (type.includes("audio")) return <AudioIcon className={className} />;
    if (type.includes("image")) return <ImageIcon className={className} />;
    return <PackageIcon className={className} />;
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
            <h1 className="mt-3 text-4xl font-bold">Course materials</h1>
            <p className="mt-2 text-[var(--muted)]">
              Watch your class recordings and lesson videos, or download the documents for your level
              {level ? ` (${level})` : ""}.
            </p>
          </div>

          {error ? <div className="rounded-xl bg-red-500/10 p-4 text-sm text-red-700">{error}</div> : null}

          {lockedMessage ? (
            <div className="rounded-3xl border border-amber-400/40 bg-amber-500/10 p-6 text-sm text-amber-900">
              <p className="font-semibold">Materials are locked</p>
              <p className="mt-2">{lockedMessage}</p>
              <a href="/programs" className="mt-4 inline-flex rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110">
                Pay tuition now
              </a>
            </div>
          ) : null}

          <div className="flex gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1.5">
            {(
              [
                { value: "watch" as const, icon: <FilmIcon />, label: `Watch${videos.length ? ` (${videos.length})` : ""}` },
                { value: "documents" as const, icon: <DocumentIcon />, label: `Documents${documents.length ? ` (${documents.length})` : ""}` },
              ]
            ).map((item) => (
              <button
                key={item.value}
                onClick={() => setTab(item.value)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition ${
                  tab === item.value
                    ? "bg-[var(--accent)] text-white shadow-lg"
                    : "text-[var(--muted)] hover:bg-[var(--surface-alt)]"
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-12 text-center">
              <p className="text-[var(--muted)]">Loading your materials…</p>
            </div>
          ) : tab === "watch" ? (
            <VideoLibrary videos={videos} level={level} />
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-3">
                {DOCUMENT_FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    onClick={() => setFilterType(filter.value)}
                    className={`inline-flex items-center gap-2 rounded-full px-6 py-2 text-sm font-semibold transition ${
                      filterType === filter.value
                        ? "bg-[var(--accent)] text-white"
                        : "border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--surface-alt)]"
                    }`}
                  >
                    {filter.icon}
                    {filter.label}
                  </button>
                ))}
              </div>

              {filteredDocuments.length === 0 ? (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-12 text-center">
                  <p className="text-lg font-semibold">No documents found</p>
                  <p className="mt-2 text-[var(--muted)]">Check back later for new course materials</p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {filteredDocuments.map((material) => (
                    <motion.div
                      key={material.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-4 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 transition hover:bg-[var(--surface-alt)]"
                    >
                      <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
                        {fileTypeIcon(material.fileType)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-[var(--foreground)]">{material.title}</p>
                        {material.description ? (
                          <p className="mt-1 truncate text-sm text-[var(--muted)]">{material.description}</p>
                        ) : null}
                        <div className="mt-2 flex gap-4 text-xs text-[var(--muted)]">
                          {material.course ? <span>{material.course.title}</span> : null}
                          <span>{formatFileSize(material.fileSize)}</span>
                          <span>{new Date(material.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <a
                        href={material.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110"
                      >
                        Download
                      </a>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </StudentShell>
  );
}
