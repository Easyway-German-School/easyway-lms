"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import LecturerShell from "@/components/LecturerShell";
import { uploadFile } from "@/lib/upload";

export default function CourseEditorPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const courseId = params?.id as string | undefined;

  const [course, setCourse] = useState<any>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState("A1");
  const [published, setPublished] = useState(true);
  const [message, setMessage] = useState("");
  const [moduleTitle, setModuleTitle] = useState("");
  const [moduleDescription, setModuleDescription] = useState("");
  const [lessonModuleId, setLessonModuleId] = useState("");
  const [lessonTitle, setLessonTitle] = useState("");
  const [lessonContent, setLessonContent] = useState("");
  const [lessonType, setLessonType] = useState("lesson");
  const [lessonDuration, setLessonDuration] = useState(20);

  // AI auto-structure states
  const [outline, setOutline] = useState<any | null>(null);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlinePreviewVisible, setOutlinePreviewVisible] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/lecturer/signin");
      return;
    }
    if (courseId) {
      fetchCourse();
    }
  }, [status, courseId]);

  const fetchCourse = async () => {
    try {
      const res = await fetch(`/api/courses?courseId=${courseId}`);
      if (!res.ok) throw new Error("Course not found");
      const data = await res.json();
      const courseData = data.course || data.courses?.[0];
      if (!courseData) throw new Error("Course data missing");
      setCourse(courseData);
      setTitle(courseData.title);
      setDescription(courseData.description);
      setLevel(courseData.level || "A1");
      setPublished(courseData.published ?? true);
    } catch (error) {
      console.error(error);
      setMessage("Unable to load course.");
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseId) return;

    try {
      const res = await fetch("/api/admin/course/edit", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, title, description, level, published }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Update failed.");
        return;
      }
      setMessage("Course updated successfully.");
      setCourse(data.course);
    } catch (error) {
      console.error(error);
      setMessage("Unable to save course.");
    }
  };

  const handleAddModule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseId || !moduleTitle) return;

    try {
      const res = await fetch("/api/admin/module", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, title: moduleTitle, description: moduleDescription, order: (course?.modules?.length || 0) + 1 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Module creation failed.");
        return;
      }
      setModuleTitle("");
      setModuleDescription("");
      setMessage("Module created successfully.");
      fetchCourse();
    } catch (error) {
      console.error(error);
      setMessage("Unable to create module.");
    }
  };

  const handleAddLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lessonModuleId || !lessonTitle) return;

    try {
      const res = await fetch("/api/admin/lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          moduleId: lessonModuleId,
          title: lessonTitle,
          description: lessonTitle,
          content: lessonContent,
          type: lessonType,
          order: (course?.modules?.find((mod: any) => mod.id === lessonModuleId)?.lessons?.length || 0) + 1,
          duration: lessonDuration,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Lesson creation failed.");
        return;
      }
      setLessonTitle("");
      setLessonContent("");
      setLessonType("lesson");
      setLessonDuration(20);
      setMessage("Lesson created successfully.");
      fetchCourse();
    } catch (error) {
      console.error(error);
      setMessage("Unable to create lesson.");
    }
  };

  const handleDeleteLesson = async (lessonId: string, lessonTitle: string) => {
    if (!confirm(`Delete lesson "${lessonTitle}"?`)) return;

    try {
      const res = await fetch("/api/admin/lesson/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId })
      });

      if (res.ok) {
        setMessage("Lesson deleted successfully.");
        fetchCourse();
      } else {
        const err = await res.json();
        setMessage(err.error || "Delete failed.");
      }
    } catch (error) {
      console.error("Delete failed:", error);
      setMessage("Delete failed.");
    }
  };

  // AI auto-structure functions
  const handleGenerateOutline = async () => {
    if (!courseId) return;
    setOutlineLoading(true);
    try {
      const res = await fetch('/api/ai/course-outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course: { title, description, level } }),
      });
      const data = await res.json();
      setOutline(data.outline);
      setOutlinePreviewVisible(true);
      setMessage('Outline generated. Preview below.');
    } catch (err) {
      console.error('Outline error', err);
      setMessage('Failed to generate outline.');
    } finally {
      setOutlineLoading(false);
    }
  };

  const handleApplyOutline = async () => {
    if (!outline || !outline.modules || !courseId) return;
    setMessage('Applying outline...');
    try {
      for (let i = 0; i < outline.modules.length; i++) {
        const mod = outline.modules[i];
        const modRes = await fetch('/api/admin/module', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseId, title: mod.title, description: mod.description, order: (course?.modules?.length || 0) + i + 1 }),
        });
        const modJson = await modRes.json();
        const moduleId = modJson.module?.id || modJson.id || null;
        if (!moduleId) continue;
        if (Array.isArray(mod.lessons)) {
          for (let j = 0; j < mod.lessons.length; j++) {
            const lesson = mod.lessons[j];
            await fetch('/api/admin/lesson', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ moduleId, title: lesson.title, description: lesson.description, content: lesson.description || '', type: lesson.type || 'lesson', order: j + 1, duration: lesson.duration || 20 }),
            });
          }
        }
      }
      setMessage('Outline applied. Refreshing course...');
      fetchCourse();
      setOutlinePreviewVisible(false);
    } catch (err) {
      console.error('Apply outline error', err);
      setMessage('Failed to apply outline.');
    }
  };

  return (
    <LecturerShell>
    <div className="min-h-screen bg-[var(--background)] py-10">
      <div className="mx-auto max-w-4xl px-6 md:px-10 space-y-8">
        <header className="rounded-3xl bg-[var(--surface)] p-8 shadow-[var(--shadow)]">
          <h1 className="text-4xl font-bold text-[var(--foreground)]">Edit Course</h1>
          <p className="text-[var(--muted)] mt-2">Update course details and publish state.</p>
        </header>

        <div className="rounded-3xl bg-[var(--surface)] p-8 shadow-[var(--shadow)] space-y-6">
          <form onSubmit={handleSave} className="space-y-6">
            <div>
              <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-4 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-4 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--accent)] resize-none h-28"
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">Level</label>
                <select
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                  className="w-full px-4 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value="A1">A1</option>
                  <option value="A2">A2</option>
                  <option value="B1">B1</option>
                  <option value="B2">B2</option>
                  <option value="C1">C1</option>
                  <option value="C2">C2</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">Published</label>
                <label className="inline-flex items-center gap-3 bg-[var(--surface-alt)] px-4 py-3 rounded-lg w-full">
                  <input
                    type="checkbox"
                    checked={published}
                    onChange={(e) => setPublished(e.target.checked)}
                    className="w-4 h-4 text-[var(--accent)] rounded"
                  />
                  <span className="text-sm text-[var(--muted)]">Visible to students</span>
                </label>
              </div>
            </div>
            <div className="flex gap-3">
              <button type="submit" className="px-6 py-3 bg-[var(--accent)] text-white rounded-lg font-semibold hover:brightness-110">
                Save Course
              </button>
              <button type="button" onClick={handleGenerateOutline} disabled={outlineLoading} className="px-6 py-3 bg-[var(--surface-alt)] text-[var(--foreground)] rounded-lg font-semibold hover:brightness-110">
                {outlineLoading ? 'Generating...' : 'Auto-structure with AI'}
              </button>
            </div>
          </form>

          {outlinePreviewVisible && outline ? (
            <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
              <h3 className="font-semibold text-[var(--foreground)]">AI generated outline (preview)</h3>
              <div className="mt-3 space-y-3 text-sm text-[var(--muted)]">
                {outline.modules?.map((mod: any, idx: number) => (
                  <div key={idx} className="rounded-lg bg-[var(--surface)] p-3">
                    <p className="font-semibold text-[var(--foreground)]">{mod.title}</p>
                    <p className="text-xs">{mod.description}</p>
                    <div className="mt-2 space-y-1">
                      {mod.lessons?.map((lesson: any, j: number) => (
                        <div key={j} className="text-xs flex items-center justify-between">
                          <span>{j + 1}. {lesson.title}</span>
                          <span className="text-[var(--muted)]">{lesson.duration || 20}m</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex gap-3">
                <button onClick={handleApplyOutline} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg font-semibold">Apply Outline</button>
                <button onClick={() => { setOutlinePreviewVisible(false); setOutline(null); }} className="px-4 py-2 bg-[var(--surface)] text-[var(--foreground)] rounded-lg">Dismiss</button>
              </div>
            </div>
          ) : null}

          {course?.modules?.length ? (
            <div className="border-t border-[var(--border)] pt-8 space-y-6">
              <div>
                <h2 className="text-2xl font-semibold text-[var(--foreground)]">Modules</h2>
                <p className="text-sm text-[var(--muted)]">Add modules and lessons to this course.</p>
              </div>
              <div className="space-y-4">
                {course.modules.map((module: any) => (
                  <div key={module.id} className="rounded-2xl border border-[var(--border)] p-5 bg-[var(--background)]">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h3 className="font-semibold text-[var(--foreground)]">{module.title}</h3>
                        <p className="text-sm text-[var(--muted)]">{module.description}</p>
                      </div>
                      <span className="text-xs text-[var(--muted)]">Lessons: {module.lessons?.length || 0}</span>
                    </div>
                    <div className="mt-4 space-y-3">
                      {module.lessons?.map((lesson: any) => (
                        <div key={lesson.id} className="rounded-2xl bg-[var(--surface)] p-4 border border-[var(--border)]">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <h4 className="font-semibold text-[var(--foreground)]">{lesson.title}</h4>
                              <p className="text-xs text-[var(--muted)]">{lesson.type} • {lesson.duration} min</p>
                            </div>
                            <div className="flex gap-2">
                              <a href={`/lesson?id=${lesson.id}`} className="text-[var(--accent)] text-sm hover:underline">Preview</a>
                              <button onClick={() => handleDeleteLesson(lesson.id, lesson.title)} className="text-[var(--danger)] text-sm hover:underline">Delete</button>
                            </div>
                          </div>
                          <p className="text-sm text-[var(--muted)] mt-2">{lesson.content?.slice(0, 120)}{lesson.content?.length > 120 ? "..." : ""}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="border-t border-[var(--border)] pt-8 space-y-6">
            <div>
              <h2 className="text-2xl font-semibold text-[var(--foreground)]">Add Module</h2>
            </div>
            <form onSubmit={handleAddModule} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">Module title</label>
                <input
                  type="text"
                  value={moduleTitle}
                  onChange={(e) => setModuleTitle(e.target.value)}
                  className="w-full px-4 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--accent)]"
                  placeholder="e.g., Module 1: Grammar basics"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">Module description</label>
                <textarea
                  value={moduleDescription}
                  onChange={(e) => setModuleDescription(e.target.value)}
                  className="w-full px-4 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--accent)] resize-none h-24"
                  placeholder="Short module description"
                />
              </div>
              <button className="px-6 py-3 bg-[var(--foreground)] text-[var(--surface)] rounded-lg font-semibold hover:brightness-110">
                Create Module
              </button>
            </form>
          </div>

          <div className="border-t border-[var(--border)] pt-8 space-y-6">
            <div>
              <h2 className="text-2xl font-semibold text-[var(--foreground)]">Add Lesson</h2>
            </div>
            <form onSubmit={handleAddLesson} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">Select module</label>
                <select
                  value={lessonModuleId}
                  onChange={(e) => setLessonModuleId(e.target.value)}
                  className="w-full px-4 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value="">Choose a module</option>
                  {course?.modules?.map((module: any) => (
                    <option key={module.id} value={module.id}>{module.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">Lesson title</label>
                <input
                  type="text"
                  value={lessonTitle}
                  onChange={(e) => setLessonTitle(e.target.value)}
                  className="w-full px-4 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--accent)]"
                  placeholder="e.g., Lesson 1: Introduction"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">Content</label>
                <textarea
                  value={lessonContent}
                  onChange={(e) => setLessonContent(e.target.value)}
                  className="w-full px-4 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--accent)] resize-none h-28"
                  placeholder="Lesson text or instructions"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">Attach media (optional)</label>
                <input
                  type="file"
                  accept="image/*,video/*,audio/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const uploaded = await uploadFile(file, "materials");
                      const mediaTag = file.type.startsWith("image")
                        ? `![](${uploaded.url})`
                        : `\n<video controls src="${uploaded.url}"></video>\n`;
                      setLessonContent((prev) => prev ? prev + "\n\n" + mediaTag : mediaTag);
                      setMessage("Media uploaded and attached to lesson content.");
                    } catch (err) {
                      console.error("Upload error", err);
                      setMessage(err instanceof Error ? err.message : "Upload failed.");
                    }
                  }}
                  className="w-full text-sm rounded-lg border border-[var(--border)] px-3 py-2"
                />
                <p className="text-xs text-[var(--muted)] mt-2">Supported: images, video, audio.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">Type</label>
                  <select
                    value={lessonType}
                    onChange={(e) => setLessonType(e.target.value)}
                    className="w-full px-4 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--accent)]"
                  >
                    <option value="lesson">Lesson</option>
                    <option value="quiz">Quiz</option>
                    <option value="assignment">Assignment</option>
                    <option value="discussion">Discussion</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">Duration</label>
                  <input
                    type="number"
                    value={lessonDuration}
                    onChange={(e) => setLessonDuration(Number(e.target.value))}
                    className="w-full px-4 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--accent)]"
                    min={5}
                  />
                </div>
              </div>
              <button className="px-6 py-3 bg-[var(--foreground)] text-[var(--surface)] rounded-lg font-semibold hover:brightness-110">
                Create Lesson
              </button>
            </form>
          </div>

          {message ? <p className="text-sm text-[var(--muted)]">{message}</p> : null}
        </div>
      </div>
    </div>
    </LecturerShell>
  );
}
