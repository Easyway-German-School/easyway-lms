"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import { CheckIcon, LessonBuilderIcon } from "@/components/icons";
import { COURSE_LEVELS } from "@/lib/lecturer-assignment";

/**
 * Courses.
 *
 * Creating, deleting and bulk-importing a course used to live on the original
 * demo page at `/lecturer` — an admin screen that had ended up in the tutor
 * portal, calling `/api/admin/*` the whole time. That page is gone; this is
 * where its work moved to, next to Materials, which reads the courses this
 * page produces.
 */

type Course = {
  id: string;
  title: string;
  description: string | null;
  level: string;
  duration: number | null;
  published: boolean;
};

type ValidationPreview = {
  validRows: Record<string, string>[];
  errors: Record<string, string[]>;
  validCount: number;
  errorCount: number;
};

export default function AdminCoursesPage() {
  const router = useRouter();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [form, setForm] = useState({ title: "", description: "", level: "A1" });
  const [creating, setCreating] = useState(false);

  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<ValidationPreview | null>(null);
  const [importMessage, setImportMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/courses", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        router.push("/auth/admin");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load courses");
      setCourses(data.courses || []);
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
    if (!confirm(`Delete "${course.title}" and all its modules and lessons?`)) return;
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

  /** Validate first, show what would land, and only then write anything. */
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

  return (
    <AdminShell>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Content</p>
          <h1 className="flex items-center gap-3 text-3xl font-bold">
            <LessonBuilderIcon className="h-7 w-7 text-[var(--accent)]" />
            Courses
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            The course shells that Materials, classes and the lesson builder all hang off. Deleting one takes its
            modules and lessons with it.
          </p>
        </div>

        {error ? <div className="rounded-2xl bg-rose-500/10 p-4 text-sm text-rose-700">{error}</div> : null}
        {success ? <div className="rounded-2xl bg-emerald-500/10 p-4 text-sm text-emerald-800">{success}</div> : null}

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
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm"
              />
            </label>
            <label className="block text-sm font-medium md:col-span-2">
              Description
              <textarea
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                rows={3}
                placeholder="What students will learn"
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm"
              />
            </label>
            <label className="block text-sm font-medium">
              Level
              <select
                value={form.level}
                onChange={(event) => setForm((current) => ({ ...current, level: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm"
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
