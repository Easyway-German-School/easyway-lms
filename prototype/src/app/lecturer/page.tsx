"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LecturerPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [courses, setCourses] = useState<any[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importMode, setImportMode] = useState("students");
  const [uploadMessage, setUploadMessage] = useState("");
  const [newCourse, setNewCourse] = useState({
    title: "",
    description: "",
    level: "A1"
  });
  const [validationPreview, setValidationPreview] = useState<any>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [unauthorized, setUnauthorized] = useState(false);

  const fetchCourses = async () => {
    try {
      const res = await fetch("/api/admin/courses");
      if (!res.ok) {
        throw new Error("Failed to load courses");
      }
      const data = await res.json();
      setCourses(data.courses || []);
      setErrorMessage(null);
    } catch (e) {
      console.error("Failed to fetch courses:", e);
      setErrorMessage("Unable to load courses. Please refresh or try again later.");
    }
  };

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin");
      return;
    }
    if (status === "authenticated") {
      const role = ((session as any)?.user?.role as string | undefined)?.toLowerCase();
      if (!(role === "lecturer" || role === "admin")) {
        setUnauthorized(true);
        router.push("/dashboard");
        return;
      }
      fetchCourses();
    }
  }, [status, router, session]);

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      const res = await fetch("/api/admin/course", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newCourse)
      });
      if (res.ok) {
        setNewCourse({ title: "", description: "", level: "A1" });
        alert("Course created!");
        fetchCourses();
      }
    } catch (error) {
      console.error("Failed to create course:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCsvUpload = async (file: File) => {
    setIsImporting(true);
    setUploadMessage("");

    try {
      const text = await file.text();

      // Step 1: Validate CSV
      const validateRes = await fetch("/api/admin/import/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: importMode, csv_text: text })
      });

      const validation = await validateRes.json();

      if (!validateRes.ok) {
        setUploadMessage(validation.error || "Validation failed.");
        setIsImporting(false);
        return;
      }

      // Show preview
      setValidationPreview({
        validRows: validation.validRows,
        errors: validation.errors,
        validCount: validation.validCount,
        errorCount: validation.errorCount
      });
      setPendingFile(file);
      setUploadMessage(`Ready to import: ${validation.validCount} valid row(s)${validation.errorCount > 0 ? `, ${validation.errorCount} error(s)` : ""}`);
    } catch (error) {
      console.error("Validation failed:", error);
      setUploadMessage("Validation failed. Check CSV format.");
    } finally {
      setIsImporting(false);
    }
  };

  const confirmImport = async () => {
    if (!validationPreview || !validationPreview.validRows.length) {
      setUploadMessage("No valid rows to import.");
      return;
    }

    setIsImporting(true);
    try {
      const res = await fetch("/api/admin/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: importMode, rows: validationPreview.validRows })
      });

      const result = await res.json();
      if (res.ok) {
        setUploadMessage("✓ Import complete!");
        setValidationPreview(null);
        setPendingFile(null);
        fetchCourses();
      } else {
        setUploadMessage(result.error || "Import failed.");
      }
    } catch (error) {
      console.error("Import failed:", error);
      setUploadMessage("Import failed.");
    } finally {
      setIsImporting(false);
    }
  };

  const cancelPreview = () => {
    setValidationPreview(null);
    setPendingFile(null);
    setUploadMessage("");
  };

  const handleDeleteCourse = async (courseId: string, courseTitle: string) => {
    if (!confirm(`Delete course "${courseTitle}" and all its modules/lessons?`)) return;

    try {
      const res = await fetch("/api/admin/course/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId })
      });

      if (res.ok) {
        alert("Course deleted!");
        fetchCourses();
      } else {
        const err = await res.json();
        alert(err.error || "Delete failed.");
      }
    } catch (error) {
      console.error("Delete failed:", error);
      alert("Delete failed.");
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await handleCsvUpload(file);
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center text-[var(--foreground)]">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--accent)] mx-auto"></div>
          <p className="text-[var(--muted)]">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--background)] py-10 text-[var(--foreground)]">
      <div className="mx-auto max-w-4xl px-6 md:px-10 space-y-8">
        {/* Header */}
        <header className="rounded-3xl bg-[var(--surface)] p-8 shadow-[var(--shadow)]">
          <div className="mb-4">
            <Link href="/dashboard" className="text-[var(--accent)] hover:brightness-110 text-sm font-semibold">
              ← Back to dashboard
            </Link>
          </div>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-4xl font-bold text-[var(--foreground)]">Lecturer Dashboard</h1>
              <p className="text-[var(--muted)] mt-2">Create and manage courses for your students</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/lecturer/lesson-builder" className="inline-flex items-center justify-center rounded-lg bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--surface)] hover:brightness-110">
                🤖 AI Lesson Builder
              </Link>
              <Link href="/lecturer/gradebook" className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-5 py-3 text-sm font-semibold text-[var(--foreground)] hover:brightness-110">
                📊 View Gradebook
              </Link>
              {(session as any)?.user?.role === "ADMIN" ? (
                <Link href="/admin/lecturer-invite" className="inline-flex items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--accent)]/10 px-5 py-3 text-sm font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/20">
                  🔐 Invite Lecturers
                </Link>
              ) : null}
            </div>
          </div>
        </header>

        {/* Create Course Form */}
        <div className="rounded-3xl bg-[var(--surface)] p-8 shadow-[var(--shadow)] space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-[var(--foreground)]">Create New Course</h2>
            <p className="text-[var(--muted)] mt-1">Build a course with modules and assign it to your learners.</p>
          </div>
          <form onSubmit={handleCreateCourse} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">Course Title</label>
              <input
                type="text"
                value={newCourse.title}
                onChange={(e) => setNewCourse({ ...newCourse, title: e.target.value })}
                placeholder="e.g., German A1 Fundamentals"
                className="w-full px-4 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface-alt)] text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">Description</label>
              <textarea
                value={newCourse.description}
                onChange={(e) => setNewCourse({ ...newCourse, description: e.target.value })}
                placeholder="Describe what students will learn..."
                className="w-full px-4 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface-alt)] text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] resize-none h-24"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">Level</label>
              <select
                value={newCourse.level}
                onChange={(e) => setNewCourse({ ...newCourse, level: e.target.value })}
                className="w-full px-4 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface-alt)] text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
              >
                <option value="A1">A1 (Beginner)</option>
                <option value="A2">A2 (Elementary)</option>
                <option value="B1">B1 (Intermediate)</option>
                <option value="B2">B2 (Upper Intermediate)</option>
                <option value="C1">C1 (Advanced)</option>
                <option value="C2">C2 (Mastery)</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={isCreating || !newCourse.title}
              className="w-full py-3 bg-[var(--accent)] text-[var(--surface)] font-semibold rounded-lg hover:brightness-110 disabled:opacity-60"
            >
              {isCreating ? "Creating..." : "Create Course"}
            </button>
          </form>
        </div>

        {/* Upload CSV for Students or Courses */}
        <div className="rounded-3xl bg-[var(--surface)] p-8 shadow-[var(--shadow)] space-y-6">
          <h2 className="text-2xl font-bold text-[var(--foreground)]">Bulk Import</h2>
          <p className="text-sm text-[var(--muted)]">Upload CSV for students or course content.</p>

          <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
            <label className="block text-sm font-semibold text-[var(--foreground)]">Import type</label>
            <select
              value={importMode}
              onChange={(e) => setImportMode(e.target.value)}
              className="w-full px-4 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--accent)]"
            >
              <option value="students">Students</option>
              <option value="courses">Courses</option>
            </select>
          </div>

          {validationPreview ? (
            <div className="border border-[var(--border)] rounded-lg p-6 space-y-4 bg-[var(--surface-alt)]">
              <h3 className="font-semibold text-[var(--foreground)]">Import Preview</h3>
              
              <div className="flex gap-4">
                <div className="text-sm">
                  <p className="text-[var(--accent)] font-semibold">{validationPreview.validCount} valid row(s)</p>
                </div>
                {validationPreview.errorCount > 0 && (
                  <div className="text-sm">
                    <p className="text-[var(--danger)] font-semibold">{validationPreview.errorCount} error(s)</p>
                  </div>
                )}
              </div>

              {validationPreview.validRows.length > 0 && (
                <div className="overflow-x-auto max-h-48 overflow-y-auto">
                  <table className="w-full text-xs border border-[var(--border)]">
                    <thead className="bg-[var(--surface)] sticky top-0">
                      <tr>
                        {Object.keys(validationPreview.validRows[0]).map((k) => (
                          <th key={k} className="px-2 py-1 text-left">{k}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {validationPreview.validRows.slice(0, 5).map((row: any, idx: number) => (
                        <tr key={idx} className="border-t border-[var(--border)] hover:bg-[var(--surface)]">
                          {Object.values(row).map((v: any, i: number) => (
                            <td key={i} className="px-2 py-1">{v}</td>
                          ))}
                        </tr>
                      ))}
                      {validationPreview.validRows.length > 5 && (
                        <tr className="border-t border-[var(--border)]">
                          <td colSpan={Object.keys(validationPreview.validRows[0]).length} className="px-2 py-1 text-center text-[var(--muted)]">
                            +{validationPreview.validRows.length - 5} more rows
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {validationPreview.errors && Object.keys(validationPreview.errors).length > 0 && (
                <div className="bg-[var(--danger-soft)] border border-[var(--danger)] rounded p-4">
                  <p className="text-sm font-semibold text-[var(--danger)] mb-2">Errors:</p>
                  <div className="text-xs text-[var(--danger)]/90 space-y-1 max-h-32 overflow-y-auto">
                    {Object.entries(validationPreview.errors).map(([rowIdx, errs]: any) => (
                      <div key={rowIdx}>
                        <strong>Row {parseInt(rowIdx) + 2}:</strong> {errs.join("; ")}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-3 pt-4">
                <button
                  onClick={confirmImport}
                  disabled={isImporting || validationPreview.validCount === 0}
                  className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg text-sm font-semibold hover:brightness-110 disabled:opacity-60"
                >
                  {isImporting ? "Importing..." : "✓ Confirm Import"}
                </button>
                <button
                  onClick={cancelPreview}
                  disabled={isImporting}
                  className="px-4 py-2 border border-[var(--border)] text-[var(--muted)] rounded-lg text-sm font-semibold hover:bg-[var(--background)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="border-2 border-dashed border-[var(--border)] rounded-lg p-8 text-center">
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  id="bulk-csv"
                  onChange={handleFileChange}
                />
                <label htmlFor="bulk-csv" className="cursor-pointer">
                  <p className="text-[var(--muted)]">Click to upload a CSV file</p>
                  <p className="text-xs text-[var(--muted)] mt-2">Students: name,email,level | Courses: course_title,module_title,lesson_title</p>
                </label>
              </div>

              {uploadMessage ? (
                <p className="text-sm text-[var(--muted)]">{uploadMessage}</p>
              ) : null}
              {isImporting ? <p className="text-sm text-[var(--muted)]">Validating…</p> : null}
            </>
          )}
        </div>

        {/* Manage Courses */}
        <div className="rounded-3xl bg-[var(--surface)] p-8 shadow-[var(--shadow)] space-y-6">
          <h2 className="text-2xl font-bold text-[var(--foreground)]">Your Courses</h2>
          <p className="text-sm text-[var(--muted)]">Manage courses you uploaded via the CSV or the create form.</p>

          {courses.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No courses yet — create one or import via CSV.</p>
          ) : (
            <div className="grid gap-4">
              {courses.map((c) => (
                <div key={c.id} className="p-4 border border-[var(--border)] rounded-lg bg-[var(--surface-alt)] flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">{c.title}</h3>
                    <p className="text-sm text-[var(--muted)]">{c.description}</p>
                    <p className="text-xs text-[var(--muted)] mt-1">Level: {c.level} • {c.duration} min</p>
                    <p className="text-xs mt-1">
                      <span className={c.published ? "text-[var(--accent)]" : "text-[var(--warning)]"}>
                        {c.published ? "Published" : "Draft"}
                      </span>
                    </p>
                  </div>
                  <div className="space-x-2">
                    <a href={`/lecturer/course/${c.id}`} className="text-[var(--accent)] hover:underline text-sm">Edit</a>
                    <button onClick={() => handleDeleteCourse(c.id, c.title)} className="text-[var(--danger)] hover:underline text-sm">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
