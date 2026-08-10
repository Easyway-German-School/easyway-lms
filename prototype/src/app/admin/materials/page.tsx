"use client";

/**
 * MATERIALS — the activity tracker, and the library underneath it.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS WRONG WITH THIS PAGE
 * ---------------------------------------------------------------------------
 * It was an upload form and a table of files, and it opened on a course
 * dropdown — so a school that had not yet created a course saw the words "No
 * courses available" and nothing else, on a page called Materials, in a portal
 * where the tutors had been uploading material all week. Every class recording
 * the platform captures, every live class, every private lesson: none of it
 * appeared here, because a recording belongs to a level and a date rather than
 * to a course, and the only view was filtered by course.
 *
 * So the page now opens on what the school DID — every live class, every
 * private class, every capture LiveKit made and every file a human uploaded,
 * over a window — and the library it was before is the second tab.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CHARTS ARE HAND-DRAWN SVG
 * ---------------------------------------------------------------------------
 * There is no chart library in this project and adding one to draw four bars
 * would be a dependency, a bundle and a theming problem in exchange for
 * something that is forty lines of `<rect>`. The shapes here are deliberately
 * simple for the same reason: a stacked daily bar and a ranked list answer
 * "how much, and where" without anybody having to learn to read them.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import AdminShell from "@/components/AdminShell";
import BrandLoader from "@/components/BrandLoader";
import { uploadFile } from "@/lib/upload";
import {
  BarChartIcon,
  BookOpenIcon,
  BroadcastIcon,
  DatabaseIcon,
  FilmIcon,
  PrivateClassIcon,
  RefreshIcon,
  TrashIcon,
  UploadIcon,
  UsersIcon,
} from "@/components/icons";

interface Course {
  id: string;
  title: string;
  level: string;
}

interface Material {
  id: string;
  courseId: string;
  title: string;
  description?: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  course: { title: string };
  createdAt: string;
}

type Activity = {
  window: { days: number; since: string };
  totals: {
    liveClasses: number;
    privateClasses: number;
    liveHours: number;
    privateHours: number;
    attendedJoins: number;
    recordings: number;
    recordedHours: number;
    recordedGb: number;
    uploads: number;
    uploadedMb: number;
    libraryTotal: number;
    recordingsEver: number;
  };
  series: Array<{ key: string; liveClasses: number; privateClasses: number; recordings: number; uploads: number }>;
  recordingStatus: Record<string, number>;
  uploadKinds: Record<string, number>;
  byLevel: Array<{ level: string; count: number }>;
  feed: Array<{ at: string; type: "live" | "private" | "recording" | "upload"; title: string; detail: string }>;
};

/**
 * One colour per activity, used by the chart, the legend and the feed alike.
 * Written once so a bar and the dot next to its name can never disagree, which
 * is the classic way a hand-rolled chart goes quietly wrong.
 */
const SERIES = [
  { key: "liveClasses" as const, label: "Live classes", colour: "#0D7C7E" },
  { key: "privateClasses" as const, label: "Private classes", colour: "#7C3AED" },
  { key: "recordings" as const, label: "Recordings", colour: "#FF6600" },
  { key: "uploads" as const, label: "Uploads", colour: "#0EA5E9" },
];

const FEED_ICON = {
  live: BroadcastIcon,
  private: PrivateClassIcon,
  recording: FilmIcon,
  upload: UploadIcon,
};

const FEED_TONE = {
  live: "bg-teal-100 text-teal-700",
  private: "bg-violet-100 text-violet-700",
  recording: "bg-orange-100 text-orange-700",
  upload: "bg-sky-100 text-sky-700",
};

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function MaterialsPage() {
  const [tab, setTab] = useState<"activity" | "library">("activity");

  return (
    <AdminShell>
      <div className="space-y-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Materials &amp; activity</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            Everything the platform recorded doing: live classes and one-to-ones, the captures LiveKit made of
            them, and the files tutors uploaded by hand. The library itself is the second tab.
          </p>
        </motion.div>

        <div className="flex gap-1 rounded-2xl bg-white p-1 shadow-sm ring-1 ring-slate-200 sm:w-fit">
          {(
            [
              { value: "activity" as const, label: "Activity", icon: BarChartIcon },
              { value: "library" as const, label: "Library", icon: BookOpenIcon },
            ]
          ).map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.value}
                onClick={() => setTab(item.value)}
                className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition sm:flex-none ${
                  tab === item.value ? "bg-[var(--accent)] text-white" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </div>

        {tab === "activity" ? <ActivityTab /> : <LibraryTab />}
      </div>
    </AdminShell>
  );
}

/* ------------------------------------------------------------------ activity */

function ActivityTab() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/materials/activity?days=${days}`, { cache: "no-store" });
      if (!res.ok) throw new Error("failed");
      setData((await res.json()) as Activity);
      setError("");
    } catch {
      setError("Could not load activity.");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) return <BrandLoader fill size="lg" message="Counting what happened." />;
  if (error && !data) return <p className="rounded-2xl bg-rose-50 p-6 text-sm text-rose-700">{error}</p>;
  if (!data) return null;

  const t = data.totals;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {[7, 30, 90].map((option) => (
          <button
            key={option}
            onClick={() => setDays(option)}
            className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
              days === option ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            Last {option} days
          </button>
        ))}
        <button
          onClick={load}
          aria-label="Refresh"
          className="rounded-full bg-white p-2 text-slate-500 ring-1 ring-slate-200 transition hover:bg-slate-50"
        >
          <RefreshIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={<BroadcastIcon className="h-5 w-5" />}
          tone="bg-teal-100 text-teal-700"
          label="Live classes taught"
          value={t.liveClasses}
          hint={`${t.liveHours} teaching hours`}
        />
        <Stat
          icon={<PrivateClassIcon className="h-5 w-5" />}
          tone="bg-violet-100 text-violet-700"
          label="Private classes"
          value={t.privateClasses}
          hint={`${t.privateHours} hours one-to-one`}
        />
        <Stat
          icon={<FilmIcon className="h-5 w-5" />}
          tone="bg-orange-100 text-orange-700"
          label="Classes recorded"
          value={t.recordings}
          hint={`${t.recordedHours} hours of tape`}
        />
        <Stat
          icon={<UsersIcon className="h-5 w-5" />}
          tone="bg-sky-100 text-sky-700"
          label="Student joins"
          value={t.attendedJoins}
          hint="times a student walked into a room"
        />
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Every day in the window</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Stacked, so the height of a day is everything that happened on it.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {SERIES.map((series) => (
              <span key={series.key} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: series.colour }} />
                {series.label}
              </span>
            ))}
          </div>
        </div>
        <StackedBars series={data.series} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-slate-900">Where the teaching went</h2>
          <p className="mt-0.5 text-sm text-slate-500">Sessions by level over the window.</p>
          <RankedBars
            rows={data.byLevel.map((row) => ({ label: row.level, value: row.count }))}
            colour="#0D7C7E"
            empty="No classes were opened in this window."
          />

          <h3 className="mt-6 text-sm font-semibold text-slate-900">What was uploaded</h3>
          <RankedBars
            rows={Object.entries(data.uploadKinds).map(([kind, count]) => ({ label: kind, value: count }))}
            colour="#0EA5E9"
            empty="Nothing was uploaded in this window."
          />
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-slate-900">Recording health</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Failures are shown, not filtered. &ldquo;Was Tuesday recorded?&rdquo; is the question this page exists
            to answer.
          </p>
          <RankedBars
            rows={Object.entries(data.recordingStatus).map(([status, count]) => ({ label: status, value: count }))}
            colour="#FF6600"
            empty="No captures were started in this window."
          />

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <MiniStat icon={<DatabaseIcon className="h-4 w-4" />} label="Tape stored" value={`${t.recordedGb} GB`} />
            <MiniStat icon={<UploadIcon className="h-4 w-4" />} label="Files uploaded" value={`${t.uploadedMb} MB`} />
            <MiniStat icon={<BookOpenIcon className="h-4 w-4" />} label="Library, all time" value={String(t.libraryTotal)} />
            <MiniStat icon={<FilmIcon className="h-4 w-4" />} label="Recordings, all time" value={String(t.recordingsEver)} />
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">As it happened</h2>
        <p className="mt-0.5 text-sm text-slate-500">The last forty things the platform did.</p>
        {data.feed.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">Nothing in this window.</p>
        ) : (
          <div className="mt-4 space-y-1">
            {data.feed.map((event, index) => {
              const Icon = FEED_ICON[event.type];
              return (
                <div key={`${event.at}-${index}`} className="flex items-start gap-3 rounded-2xl p-2.5 hover:bg-slate-50">
                  <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl ${FEED_TONE[event.type]}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{event.title}</p>
                    <p className="truncate text-xs text-slate-500">{event.detail}</p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{timeAgo(event.at)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The daily stack.
 *
 * A viewBox with `preserveAspectRatio="none"` so it fills whatever width it is
 * given without anybody computing pixels — the bars stretch, the labels do not,
 * because the labels live outside the SVG. Ninety days of bars on a phone is
 * unreadable at any width, so the axis labels thin out rather than overlap.
 */
function StackedBars({ series }: { series: Activity["series"] }) {
  const max = useMemo(
    () =>
      Math.max(
        1,
        ...series.map((day) => day.liveClasses + day.privateClasses + day.recordings + day.uploads),
      ),
    [series],
  );

  const step = Math.ceil(series.length / 8);

  return (
    <div className="mt-5">
      <div className="flex h-48 items-end gap-[3px]">
        {series.map((day) => {
          const total = day.liveClasses + day.privateClasses + day.recordings + day.uploads;
          return (
            <div
              key={day.key}
              className="group relative flex min-w-0 flex-1 flex-col justify-end"
              title={`${day.key}: ${total} event${total === 1 ? "" : "s"}`}
            >
              {SERIES.map((entry) => {
                const value = day[entry.key];
                if (!value) return null;
                return (
                  <div
                    key={entry.key}
                    style={{ height: `${(value / max) * 100}%`, background: entry.colour }}
                    className="w-full first:rounded-t-sm"
                  />
                );
              })}
              {/* An empty day still gets a hairline. Without it a quiet
                  fortnight is a gap in the chart, which reads as missing data
                  rather than as nothing having happened. */}
              {total === 0 ? <div className="h-[2px] w-full rounded-sm bg-slate-200" /> : null}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-[3px]">
        {series.map((day, index) => (
          <span key={day.key} className="min-w-0 flex-1 text-center text-[9px] text-slate-400">
            {index % step === 0 ? day.key.slice(5) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function RankedBars({
  rows,
  colour,
  empty,
}: {
  rows: Array<{ label: string; value: number }>;
  colour: string;
  empty: string;
}) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-slate-500">{empty}</p>;
  const max = Math.max(...rows.map((row) => row.value), 1);

  return (
    <div className="mt-4 space-y-2.5">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium capitalize text-slate-700">{row.label}</span>
            <span className="font-semibold text-slate-900">{row.value}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${(row.value / max) * 100}%`, background: colour }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function Stat({
  icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  tone: string;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5">
      <span className={`grid h-10 w-10 place-items-center rounded-xl ${tone}`}>{icon}</span>
      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-3xl font-bold text-slate-900">{value.toLocaleString()}</p>
      <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
        {icon}
        {label}
      </span>
      <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------- library */

/**
 * The page as it was, restyled to match the rest of the admin area and no
 * longer a dead end when no courses exist. The upload form still needs a
 * course — course material genuinely belongs to a course — but the absence of
 * one is now a sentence rather than the entire screen.
 */
function LibraryTab() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [formData, setFormData] = useState({ title: "", description: "" });

  const loadMaterials = useCallback(async () => {
    if (!selectedCourseId) return;
    try {
      const res = await fetch(`/api/admin/materials?courseId=${selectedCourseId}`);
      if (!res.ok) throw new Error("Failed to fetch materials");
      setMaterials(await res.json());
    } catch (err) {
      setError("Failed to load materials");
      console.error(err);
    }
  }, [selectedCourseId]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/courses");
        if (!res.ok) throw new Error("Failed to fetch courses");
        const data = await res.json();
        setCourses(data);
        if (data.length > 0) setSelectedCourseId(data[0].id);
      } catch (err) {
        setError("Failed to load courses");
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    loadMaterials();
  }, [loadMaterials]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !selectedCourseId || !formData.title) {
      setError("Please select a file, course, and enter a title");
      return;
    }

    setUploading(true);
    try {
      // Straight to storage, then post the metadata — course material is
      // routinely larger than a request body may be in production.
      const uploaded = await uploadFile(file, "materials");

      const res = await fetch("/api/admin/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: selectedCourseId,
          title: formData.title,
          description: formData.description,
          fileUrl: uploaded.url,
          fileName: uploaded.filename,
          fileType: uploaded.contentType,
          fileSize: uploaded.size,
        }),
      });

      if (!res.ok) throw new Error("Failed to upload material");

      setError("");
      setFile(null);
      setFormData({ title: "", description: "" });
      await loadMaterials();
    } catch (err) {
      setError("Failed to upload material");
      console.error(err);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this material?")) return;

    try {
      const res = await fetch("/api/admin/materials", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("Failed to delete material");
      setError("");
      await loadMaterials();
    } catch (err) {
      setError("Failed to delete material");
      console.error(err);
    }
  }

  if (loading) return <BrandLoader fill size="lg" message="Loading materials." />;

  return (
    <div className="space-y-5">
      {error ? <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      {courses.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center">
          <BookOpenIcon className="mx-auto h-9 w-9 text-slate-300" />
          <p className="mt-3 text-sm text-slate-600">
            There are no courses yet, and course material has to belong to one. Create a course first —
            recordings and level material are unaffected and still appear under Activity.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
            <label className="block text-sm font-semibold text-slate-900">Course</label>
            <select
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm sm:max-w-md"
            >
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title} ({course.level})
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-slate-900">Upload material</h2>
            <p className="mt-1 text-sm text-slate-500">
              The file lands in the Materials library of every student at this course&apos;s level, and shows on
              their dashboard as newly added. Tutors can also attach it to a specific day from the class
              timetable.
            </p>
            <form onSubmit={handleUpload} className="mt-4 grid gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">File *</label>
                <input
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  required
                />
                {file ? (
                  <p className="mt-1 text-sm text-slate-500">
                    {file.name} ({(file.size / 1024).toFixed(2)} KB)
                  </p>
                ) : null}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">Title *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="e.g., Module 1 Study Guide"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional description"
                  className="mt-1 h-20 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={uploading}
                className="inline-flex w-fit items-center gap-2 rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
              >
                <UploadIcon className="h-4 w-4" />
                {uploading ? "Uploading…" : "Upload material"}
              </button>
            </form>
          </div>

          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem]">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    {["Title", "Type", "Size", "Uploaded", ""].map((heading) => (
                      <th key={heading} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {materials.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-500">
                        No materials uploaded for this course.
                      </td>
                    </tr>
                  ) : (
                    materials.map((material) => (
                      <tr key={material.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="px-5 py-3">
                          <a
                            href={material.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-[var(--accent)] hover:underline"
                          >
                            {material.title}
                          </a>
                          {material.description ? (
                            <p className="mt-0.5 text-xs text-slate-500">{material.description}</p>
                          ) : null}
                        </td>
                        <td className="px-5 py-3">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                            {material.fileType}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-600">
                          {(material.fileSize / 1024).toFixed(0)} KB
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-600">
                          {new Date(material.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-5 py-3">
                          <button
                            onClick={() => handleDelete(material.id)}
                            aria-label={`Delete ${material.title}`}
                            className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
