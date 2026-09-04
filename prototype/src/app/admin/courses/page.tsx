"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import { CheckIcon, LessonBuilderIcon, LinkIcon, TrashIcon, UploadIcon } from "@/components/icons";
import { COURSE_LEVELS } from "@/lib/lecturer-assignment";
import { uploadFile } from "@/lib/upload";

/**
 * Courses — and the material that hangs off them.
 *
 * Creating, deleting and bulk-importing a course used to live on the original
 * demo page at `/lecturer`. That page is gone; this is where its work moved to.
 * The office material uploader lives here too: it is the one screen where a
 * course, a level and an audience are all in front of you at once.
 */

type Course = {
  id: string;
  title: string;
  description: string | null;
  level: string;
  duration: number | null;
  published: boolean;
};

type Material = {
  id: string;
  title: string;
  description: string | null;
  courseId: string | null;
  course: { title: string; level: string | null } | null;
  fileName: string;
  fileType: string;
  fileSize: number;
  kind: string;
  level: string | null;
  branchId: string | null;
  sessionSlot: string | null;
  batch: string | null;
  visibleToStudents: boolean;
  lecturerId: string | null;
  filePath: string;
  createdAt: string;
};

type Tutor = {
  lecturerId: string;
  name: string;
  assigned: boolean;
  assignmentLabel: string;
};

type Targets = {
  branches: Array<{ id: string; name: string }>;
  tutors: Tutor[];
  levels: string[];
  sessionSlots: string[];
  batches: string[];
};

type ValidationPreview = {
  validRows: Record<string, string>[];
  errors: Record<string, string[]>;
  validCount: number;
  errorCount: number;
};

const EMPTY_UPLOAD = {
  source: "file" as "file" | "link",
  files: [] as File[],
  sourceUrl: "",
  title: "",
  description: "",
  courseId: "",
  level: "A1",
  audience: "cohort" as "cohort" | "tutor",
  branchId: "",
  sessionSlot: "",
  batch: "",
  lecturerId: "",
  visibleToStudents: true,
};

export default function AdminCoursesPage() {
  const router = useRouter();
  const [courses, setCourses] = useState<Course[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [targets, setTargets] = useState<Targets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [form, setForm] = useState({ title: "", description: "", level: "A1" });
  const [creating, setCreating] = useState(false);

  const [upload, setUpload] = useState(EMPTY_UPLOAD);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");

  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<ValidationPreview | null>(null);
  const [importMessage, setImportMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const [coursesRes, materialsRes, targetsRes] = await Promise.all([
        fetch("/api/admin/courses", { cache: "no-store" }),
        fetch("/api/admin/materials", { cache: "no-store" }),
        fetch("/api/admin/materials/targets", { cache: "no-store" }),
      ]);
      if (coursesRes.status === 401 || coursesRes.status === 403) {
        router.push("/auth/admin");
        return;
      }
      const coursesData = await coursesRes.json().catch(() => ({}));
      if (!coursesRes.ok) throw new Error(coursesData.error || "Could not load courses");
      setCourses(coursesData.courses || []);
      setMaterials(materialsRes.ok ? await materialsRes.json().catch(() => []) : []);
      if (targetsRes.ok) setTargets(await targetsRes.json().catch(() => null));
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load courses");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function createCourse() {
    setCreating(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/admin/course", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not create the course");
      setSuccess(`"${form.title}" created.`);
      setForm({ title: "", description: "", level: "A1" });
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create the course");
    } finally {
      setCreating(false);
    }
  }

  async function deleteCourse(course: Course) {
    if (!confirm(`Delete "${course.title}" and all its modules, lessons and materials?`)) return;
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/admin/course/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId: course.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not delete the course");
      setSuccess(`"${course.title}" deleted.`);
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete the course");
    }
  }

  /* ---------------------------------------------------------------- upload */

  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === upload.courseId) || null,
    [courses, upload.courseId],
  );

  /** The level the material actually lands at — the course's, or the picked one. */
  const effectiveLevel = selectedCourse?.level || upload.level;

  async function submitUpload() {
    if (upload.source === "file" && upload.files.length === 0) {
      setUploadMessage("Choose at least one file, or switch to a link.");
      return;
    }
    if (upload.source === "link" && !upload.sourceUrl.trim()) {
      setUploadMessage("Paste a YouTube, Vimeo, Loom or Google Drive link.");
      return;
    }
    if (!upload.courseId && !upload.level) {
      setUploadMessage("Pick a course, or the level this is for.");
      return;
    }
    if (upload.audience === "tutor" && !upload.lecturerId) {
      setUploadMessage("Choose the tutor this is for.");
      return;
    }

    setUploading(true);
    setUploadMessage("");
    setError("");
    setSuccess("");

    const base = {
      description: upload.description.trim(),
      courseId: upload.courseId,
      level: upload.courseId ? "" : upload.level,
      branchId: upload.audience === "cohort" ? upload.branchId : "",
      sessionSlot: upload.audience === "cohort" ? upload.sessionSlot : "",
      batch: upload.audience === "cohort" ? upload.batch : "",
      lecturerId: upload.audience === "tutor" ? upload.lecturerId : "",
      visibleToStudents: upload.visibleToStudents,
    };

    try {
      if (upload.source === "link") {
        const res = await fetch("/api/admin/materials", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...base,
            title: upload.title.trim() || "Shared video",
            sourceUrl: upload.sourceUrl.trim(),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Upload failed");
      } else {
        let done = 0;
        for (const file of upload.files) {
          const uploaded = await uploadFile(file, "materials");
          const res = await fetch("/api/admin/materials", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...base,
              // With one file the typed title wins; with many, each file keeps
              // its own name so they do not all land as "Week 3".
              title:
                upload.files.length === 1 && upload.title.trim()
                  ? upload.title.trim()
                  : file.name.replace(/\.[^.]+$/, ""),
              fileUrl: uploaded.url,
              fileName: uploaded.filename,
              fileType: uploaded.contentType,
              fileSize: uploaded.size,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || `Upload failed for ${file.name}`);
          done += 1;
          setUploadMessage(`Uploaded ${done} of ${upload.files.length}…`);
        }
      }

      setSuccess(
        upload.audience === "tutor"
          ? "Material sent to the tutor."
          : upload.visibleToStudents
            ? "Material published to the class and its tutors."
            : "Material sent to the assigned tutors.",
      );
      setUpload((current) => ({ ...EMPTY_UPLOAD, level: current.level, audience: current.audience }));
      await load();
    } catch (uploadError) {
      setUploadMessage(uploadError instanceof Error ? uploadError.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function deleteMaterial(material: Material) {
    if (!confirm(`Remove "${material.title}"? Students and tutors lose access immediately.`)) return;
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/admin/materials", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: material.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not remove the material");
      setSuccess(`"${material.title}" removed.`);
      setMaterials((current) => current.filter((item) => item.id !== material.id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not remove the material");
    }
  }

  function audienceSummary(material: Material): string {
    if (material.lecturerId) {
      const tutor = targets?.tutors.find((t) => t.lecturerId === material.lecturerId);
      return `Tutor only${tutor ? `: ${tutor.name}` : ""}`;
    }
    const parts: string[] = [];
    parts.push(material.level ? `${material.level}` : material.course?.level || "All levels");
    if (material.branchId) {
      parts.push(targets?.branches.find((b) => b.id === material.branchId)?.name || "one branch");
    }
    if (material.sessionSlot) parts.push(material.sessionSlot);
    if (material.batch) parts.push(material.batch);
    parts.push(material.visibleToStudents ? "students + tutors" : "tutors only");
    return parts.join(" · ");
  }

  /* ---------------------------------------------------------------- import */

  async function validateCsv(file: File) {
    setImporting(true);
    setImportMessage("");
    try {
      const csv_text = await file.text();
      const res = await fetch("/api/admin/import/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "courses", csv_text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Validation failed");
      setPreview({
        validRows: data.validRows || [],
        errors: data.errors || {},
        validCount: data.validCount || 0,
        errorCount: data.errorCount || 0,
      });
      setImportMessage(
        `Ready to import: ${data.validCount} valid row(s)${data.errorCount > 0 ? `, ${data.errorCount} error(s)` : ""}`,
      );
    } catch (validateError) {
      setImportMessage(validateError instanceof Error ? validateError.message : "Validation failed");
    } finally {
      setImporting(false);
    }
  }

  async function confirmImport() {
    if (!preview?.validRows.length) return;
    setImporting(true);
    try {
      const res = await fetch("/api/admin/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "courses", rows: preview.validRows }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Import failed");
      setImportMessage("Import complete.");
      setPreview(null);
      await load();
    } catch (importError) {
      setImportMessage(importError instanceof Error ? importError.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  const inputClass =
    "mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm";

  return (
    <AdminShell>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Content</p>
          <h1 className="flex items-center gap-3 text-3xl font-bold">
            <LessonBuilderIcon className="h-7 w-7 text-[var(--accent)]" />
            Courses &amp; materials
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            The course shells that Materials, classes and the lesson builder hang off — and the office
            uploader that puts video, PDFs, slides, worksheets or a link in front of a class and its tutors.
          </p>
        </div>

        {error ? <div className="rounded-2xl bg-rose-500/10 p-4 text-sm text-rose-700">{error}</div> : null}
        {success ? <div className="rounded-2xl bg-emerald-500/10 p-4 text-sm text-emerald-800">{success}</div> : null}

        {/* ---------------------------------------------------------- upload */}
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm md:p-8">
          <h2 className="flex items-center gap-2 text-2xl font-bold">
            <UploadIcon className="h-6 w-6 text-[var(--accent)]" />
            Upload material
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Any file type, or paste a video link. Choose who it is for — a whole cohort, or one tutor — and
            it reaches every assigned tutor for that class, across branches and batches.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            {(["file", "link"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setUpload((c) => ({ ...c, source: option }))}
                className={`rounded-lg border px-4 py-2 text-sm font-semibold ${
                  upload.source === option
                    ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--foreground)]"
                    : "border-[var(--border)] text-[var(--muted)]"
                }`}
              >
                {option === "file" ? "Upload files" : "Paste a link"}
              </button>
            ))}
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {upload.source === "file" ? (
              <label className="block text-sm font-medium md:col-span-2">
                Files <span className="text-[var(--muted)]">(PDF, DOCX, PPTX, XLSX, MP4, MP3, ZIP, images…)</span>
                <input
                  type="file"
                  multiple
                  onChange={(event) => setUpload((c) => ({ ...c, files: Array.from(event.target.files || []) }))}
                  className={inputClass}
                />
                {upload.files.length > 0 ? (
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {upload.files.length} file{upload.files.length === 1 ? "" : "s"} —{" "}
                    {(upload.files.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024).toFixed(1)} MB total
                  </p>
                ) : null}
              </label>
            ) : (
              <label className="block text-sm font-medium md:col-span-2">
                <span className="flex items-center gap-1.5">
                  <LinkIcon className="h-4 w-4" /> Video link
                </span>
                <input
                  type="url"
                  inputMode="url"
                  value={upload.sourceUrl}
                  onChange={(event) => setUpload((c) => ({ ...c, sourceUrl: event.target.value }))}
                  placeholder="https://www.youtube.com/watch?v=…"
                  className={inputClass}
                />
              </label>
            )}

            <label className="block text-sm font-medium">
              Title{" "}
              <span className="text-[var(--muted)]">
                {upload.source === "file" && upload.files.length > 1 ? "(each file keeps its name)" : ""}
              </span>
              <input
                value={upload.title}
                onChange={(event) => setUpload((c) => ({ ...c, title: event.target.value }))}
                placeholder="e.g. Week 3 — Perfekt worksheet"
                className={inputClass}
                disabled={upload.source === "file" && upload.files.length > 1}
              />
            </label>

            <label className="block text-sm font-medium">
              Course <span className="text-[var(--muted)]">(optional)</span>
              <select
                value={upload.courseId}
                onChange={(event) => setUpload((c) => ({ ...c, courseId: event.target.value }))}
                className={inputClass}
              >
                <option value="">No course — level only</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title} ({course.level})
                  </option>
                ))}
              </select>
            </label>

            {!upload.courseId ? (
              <label className="block text-sm font-medium">
                Level
                <select
                  value={upload.level}
                  onChange={(event) => setUpload((c) => ({ ...c, level: event.target.value }))}
                  className={inputClass}
                >
                  {COURSE_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          {/* audience */}
          <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-5">
            <p className="text-sm font-semibold text-[var(--foreground)]">Who is this for?</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(
                [
                  { value: "cohort" as const, label: "A cohort", hint: "Branch / sitting / batch" },
                  { value: "tutor" as const, label: "One tutor", hint: "By name" },
                ]
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setUpload((c) => ({ ...c, audience: option.value }))}
                  className={`rounded-lg border px-4 py-2.5 text-left text-sm ${
                    upload.audience === option.value
                      ? "border-[var(--accent)] bg-[var(--surface)] font-semibold"
                      : "border-[var(--border)] text-[var(--muted)]"
                  }`}
                >
                  <span className="block">{option.label}</span>
                  <span className="block text-xs font-normal text-[var(--muted)]">{option.hint}</span>
                </button>
              ))}
            </div>

            {upload.audience === "cohort" ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <label className="block text-sm font-medium">
                  Branch
                  <select
                    value={upload.branchId}
                    onChange={(event) => setUpload((c) => ({ ...c, branchId: event.target.value }))}
                    className={inputClass}
                  >
                    <option value="">Every branch</option>
                    {(targets?.branches || []).map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-medium">
                  Sitting
                  <select
                    value={upload.sessionSlot}
                    onChange={(event) => setUpload((c) => ({ ...c, sessionSlot: event.target.value }))}
                    className={inputClass}
                  >
                    <option value="">All sittings</option>
                    {(targets?.sessionSlots || []).map((slot) => (
                      <option key={slot} value={slot}>
                        {slot}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-medium">
                  Batch
                  <select
                    value={upload.batch}
                    onChange={(event) => setUpload((c) => ({ ...c, batch: event.target.value }))}
                    className={inputClass}
                  >
                    <option value="">All batches</option>
                    {(targets?.batches || []).map((batch) => (
                      <option key={batch} value={batch}>
                        {batch}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <label className="mt-4 block text-sm font-medium">
                Tutor
                <select
                  value={upload.lecturerId}
                  onChange={(event) => setUpload((c) => ({ ...c, lecturerId: event.target.value }))}
                  className={inputClass}
                >
                  <option value="">Choose a tutor…</option>
                  {(targets?.tutors || []).map((tutor) => (
                    <option key={tutor.lecturerId} value={tutor.lecturerId}>
                      {tutor.name}
                      {tutor.assignmentLabel && tutor.assignmentLabel !== "No class assigned"
                        ? ` — ${tutor.assignmentLabel}`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="mt-4 flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={upload.visibleToStudents}
                onChange={(event) => setUpload((c) => ({ ...c, visibleToStudents: event.target.checked }))}
                className="h-4 w-4 rounded border-[var(--border)]"
              />
              Release to students now
              <span className="text-xs font-normal text-[var(--muted)]">
                — leave off to hand it to the tutor(s) only
              </span>
            </label>

            <p className="mt-3 text-xs text-[var(--muted)]">
              Lands at <span className="font-semibold">{effectiveLevel}</span>
              {upload.audience === "cohort" ? (
                <>
                  {upload.branchId
                    ? ` · ${targets?.branches.find((b) => b.id === upload.branchId)?.name ?? "one branch"}`
                    : " · every branch"}
                  {upload.sessionSlot ? ` · ${upload.sessionSlot}` : ""}
                  {upload.batch ? ` · ${upload.batch}` : ""}
                </>
              ) : (
                " · one tutor"
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={submitUpload}
            disabled={uploading}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            <UploadIcon className="h-4 w-4" />
            {uploading ? "Uploading…" : "Upload"}
          </button>
          {uploadMessage ? <p className="mt-3 text-sm text-[var(--muted)]">{uploadMessage}</p> : null}
        </div>

        {/* ---------------------------------------------------- material list */}
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm md:p-8">
          <h2 className="text-2xl font-bold">Material library</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {loading ? "Loading…" : `${materials.length} item${materials.length === 1 ? "" : "s"}.`}
          </p>

          <div className="mt-5 space-y-3">
            {!loading && materials.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[var(--border)] p-5 text-sm text-[var(--muted)]">
                Nothing uploaded yet.
              </p>
            ) : null}

            {materials.map((material) => (
              <div
                key={material.id}
                className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-5"
              >
                <div className="min-w-0 flex-1">
                  <a
                    href={material.filePath}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-[var(--accent)] hover:underline"
                  >
                    {material.title}
                  </a>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {material.course?.title ? `${material.course.title} · ` : ""}
                    {audienceSummary(material)}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    <span className="rounded-full bg-[var(--surface)] px-2 py-0.5 font-semibold uppercase">
                      {material.kind === "recording" ? "recording" : material.fileType.split("/").pop()}
                    </span>{" "}
                    {material.fileSize ? `${(material.fileSize / 1024 / 1024).toFixed(1)} MB · ` : ""}
                    {new Date(material.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => deleteMaterial(material)}
                  aria-label={`Remove ${material.title}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-rose-600"
                >
                  <TrashIcon className="h-4 w-4" />
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* ---------------------------------------------------------------- */}
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm md:p-8">
          <h2 className="text-2xl font-bold">All courses</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {loading ? "Loading…" : `${courses.length} course${courses.length === 1 ? "" : "s"}.`}
          </p>

          <div className="mt-5 space-y-3">
            {!loading && courses.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[var(--border)] p-5 text-sm text-[var(--muted)]">
                No courses yet — create one below or import a CSV.
              </p>
            ) : null}

            {courses.map((course) => (
              <div
                key={course.id}
                className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-5"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[var(--foreground)]">{course.title}</p>
                  {course.description ? (
                    <p className="mt-1 text-sm text-[var(--muted)]">{course.description}</p>
                  ) : null}
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    Level {course.level}
                    {course.duration ? ` · ${course.duration} min` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                      course.published ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/15 text-amber-800"
                    }`}
                  >
                    {course.published ? "Published" : "Draft"}
                  </span>
                  <button
                    type="button"
                    onClick={() => deleteCourse(course)}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs font-semibold text-rose-600"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ---------------------------------------------------------------- */}
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm md:p-8">
          <h2 className="text-2xl font-bold">Create a course</h2>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium md:col-span-2">
              Title
              <input
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="German A1 Fundamentals"
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium md:col-span-2">
              Description
              <textarea
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                rows={3}
                placeholder="What students will learn"
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium">
              Level
              <select
                value={form.level}
                onChange={(event) => setForm((current) => ({ ...current, level: event.target.value }))}
                className={inputClass}
              >
                {COURSE_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button
            type="button"
            onClick={createCourse}
            disabled={creating || !form.title.trim()}
            className="mt-6 rounded-lg bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {creating ? "Creating…" : "Create course"}
          </button>
        </div>

        {/* ---------------------------------------------------------------- */}
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm md:p-8">
          <h2 className="text-2xl font-bold">Import courses from CSV</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Columns: <code>course_title,module_title,lesson_title</code>. Students are imported separately, on the
            Import students page.
          </p>

          {preview ? (
            <div className="mt-5 space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-5">
              <div className="flex flex-wrap gap-4 text-sm">
                <p className="font-semibold text-emerald-700">{preview.validCount} valid row(s)</p>
                {preview.errorCount > 0 ? (
                  <p className="font-semibold text-rose-700">{preview.errorCount} error(s)</p>
                ) : null}
              </div>

              {preview.validRows.length > 0 ? (
                <div className="max-h-56 overflow-auto rounded-xl border border-[var(--border)]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-[var(--surface)]">
                      <tr>
                        {Object.keys(preview.validRows[0]).map((key) => (
                          <th key={key} className="px-3 py-2 text-left font-semibold">
                            {key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.validRows.slice(0, 5).map((row, index) => (
                        <tr key={index} className="border-t border-[var(--border)]">
                          {Object.values(row).map((value, cell) => (
                            <td key={cell} className="px-3 py-2">
                              {String(value)}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {preview.validRows.length > 5 ? (
                        <tr className="border-t border-[var(--border)]">
                          <td
                            colSpan={Object.keys(preview.validRows[0]).length}
                            className="px-3 py-2 text-center text-[var(--muted)]"
                          >
                            +{preview.validRows.length - 5} more rows
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {Object.keys(preview.errors).length > 0 ? (
                <div className="max-h-32 space-y-1 overflow-auto rounded-xl bg-rose-500/10 p-4 text-xs text-rose-700">
                  {Object.entries(preview.errors).map(([rowIndex, messages]) => (
                    <div key={rowIndex}>
                      <strong>Row {Number(rowIndex) + 2}:</strong> {messages.join("; ")}
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={confirmImport}
                  disabled={importing || preview.validCount === 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {importing ? "Importing…" : <><CheckIcon className="h-4 w-4" /> Confirm import</>}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPreview(null);
                    setImportMessage("");
                  }}
                  disabled={importing}
                  className="rounded-lg border border-[var(--border)] px-5 py-2.5 text-sm font-semibold"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border-2 border-dashed border-[var(--border)] p-8 text-center">
              <input
                id="course-csv"
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) validateCsv(file);
                }}
              />
              <label htmlFor="course-csv" className="cursor-pointer text-sm text-[var(--muted)]">
                Click to choose a CSV file
              </label>
            </div>
          )}

          {importMessage ? <p className="mt-3 text-sm text-[var(--muted)]">{importMessage}</p> : null}
        </div>
      </div>
    </AdminShell>
  );
}
