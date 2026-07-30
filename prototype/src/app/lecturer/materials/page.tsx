'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import LecturerShell from '@/components/LecturerShell';

interface Course {
  id: string;
  title: string;
  description: string;
  level: string;
  duration: number;
  published: boolean;
}

interface Material {
  id: string;
  title: string;
  description: string;
  courseId: string;
  courseName: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
}

export default function LecturerMaterials() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    courseId: '',
    file: null as File | null,
    // Video-library fields. A class recording is filed by level and date; a
    // lesson video can also be grouped into a named series so it gets its own
    // shelf in the student library.
    isRecording: false,
    level: '',
    series: '',
    episodeNumber: '',
    recordedAt: '',
    durationSeconds: '',
  });

  const isVideoFile = Boolean(formData.file?.type?.startsWith('video/'));

  /**
   * Read the runtime out of the chosen file before uploading.
   *
   * The browser already has the file, so this costs nothing — and without it
   * every video reaches students with no duration, which means no progress bar
   * and nothing in "Continue watching" until someone has watched it once.
   */
  function readVideoDuration(file: File) {
    if (!file.type.startsWith('video/')) return;
    const element = document.createElement('video');
    element.preload = 'metadata';
    element.onloadedmetadata = () => {
      URL.revokeObjectURL(element.src);
      if (Number.isFinite(element.duration)) {
        setFormData((current) => ({ ...current, durationSeconds: String(Math.round(element.duration)) }));
      }
    };
    element.src = URL.createObjectURL(file);
  }

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/lecturer/signin');
      return;
    }

    if (status === 'authenticated') {
      fetchMaterials();
      fetchCourses();
    }
  }, [status, router]);

  async function fetchCourses() {
    try {
      const res = await fetch('/api/admin/courses');
      if (!res.ok) {
        throw new Error('Failed to load courses');
      }
      const data = await res.json();
      const loadedCourses = data.courses || [];
      setCourses(loadedCourses);
      if (loadedCourses.length > 0 && !selectedCourseId) {
        setSelectedCourseId(loadedCourses[0].id);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function fetchMaterials() {
    try {
      const res = await fetch('/api/lecturer/materials');
      
      if (res.status === 401) {
        router.push('/auth/lecturer/signin');
        return;
      }

      if (!res.ok) throw new Error('Failed to fetch materials');
      
      const data = await res.json();
      setMaterials(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const courseId = formData.courseId || selectedCourseId;
    if (!formData.file || !formData.title) {
      setError('Please add a title and choose a file');
      return;
    }
    // A recording is filed by level rather than course, so the two have
    // different required fields.
    if (formData.isRecording ? !formData.level : !courseId) {
      setError(formData.isRecording ? 'Please choose the level this recording is for' : 'Please choose a course');
      return;
    }

    setIsUploading(true);
    const formDataToSend = new FormData();
    formDataToSend.append('title', formData.title);
    formDataToSend.append('description', formData.description);
    formDataToSend.append('courseId', formData.isRecording ? '' : courseId);
    formDataToSend.append('file', formData.file);
    formDataToSend.append('isRecording', String(formData.isRecording));
    formDataToSend.append('level', formData.level);
    formDataToSend.append('series', formData.series);
    formDataToSend.append('episodeNumber', formData.episodeNumber);
    formDataToSend.append('recordedAt', formData.recordedAt);
    formDataToSend.append('durationSeconds', formData.durationSeconds);

    try {
      const res = await fetch('/api/lecturer/materials', {
        method: 'POST',
        body: formDataToSend,
      });

      if (!res.ok) {
        // The API says exactly what is missing; swallowing it left tutors
        // staring at a generic "Upload failed" with no idea what to fix.
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Upload failed');
      }

      const newMaterial = await res.json();
      setMaterials([newMaterial, ...materials]);
      setFormData({
        title: '',
        description: '',
        courseId: '',
        file: null,
        isRecording: false,
        level: '',
        series: '',
        episodeNumber: '',
        recordedAt: '',
        durationSeconds: '',
      });
      setShowForm(false);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  }

  if (status === 'loading' || loading) {
    return (
      <LecturerShell>
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <div className="mb-4">⏳</div>
            <p className="text-[var(--foreground)]">Loading materials...</p>
          </div>
        </div>
      </LecturerShell>
    );
  }

  return (
    <LecturerShell>
      <div className="h-screen overflow-y-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-[var(--accent)]/20 to-transparent p-6 border-b border-[var(--border)]">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-[var(--foreground)]">Course Materials 📚</h1>
              <p className="text-[var(--muted)] mt-2">Upload and manage course resources</p>
            </div>
            <button
              onClick={() => setShowForm(!showForm)}
              className="bg-[var(--accent)] text-white px-4 py-2 rounded-lg hover:opacity-90 transition-opacity"
            >
              {showForm ? 'Cancel' : '+ Upload Material'}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-7xl mx-auto p-6">
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
              {error}
            </div>
          )}

          {/* Upload Form */}
          {showForm && (
            <div className="mb-6 bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6">
              <h2 className="text-lg font-bold text-[var(--foreground)] mb-1">Upload New Material</h2>
              <p className="mb-4 text-sm text-[var(--muted)]">
                Students at this course&apos;s level get it in their Materials library and see it flagged as
                newly added on their dashboard. To tie it to one class day instead, attach it from
                the Timetable page.
              </p>
              <form onSubmit={handleUpload} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">
                    Material Title
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., Introduction to JavaScript"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="w-full px-4 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-[var(--foreground)] placeholder-[var(--muted)]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">
                    Description
                  </label>
                  <textarea
                    placeholder="Describe the material..."
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-4 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-[var(--foreground)] placeholder-[var(--muted)] min-h-[100px]"
                  />
                </div>

                {!formData.isRecording && (
                  <div>
                    <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">
                      Course
                    </label>
                    <select
                      value={formData.courseId || selectedCourseId}
                      onChange={(e) => setFormData({ ...formData, courseId: e.target.value })}
                      className="w-full px-4 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-[var(--foreground)]"
                    >
                      <option value="">Select a course...</option>
                      {courses.map((course) => (
                        <option key={course.id} value={course.id}>
                          {course.title} ({course.level})
                        </option>
                      ))}
                    </select>
                    {courses.length === 0 && (
                      <p className="mt-2 text-sm text-[var(--muted)]">No courses available yet. Create a course first in your lecturer dashboard.</p>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">
                    File Upload
                  </label>
                  <input
                    type="file"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      setFormData({ ...formData, file, durationSeconds: '' });
                      if (file) readVideoDuration(file);
                    }}
                    className="w-full px-4 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-[var(--foreground)]"
                    required
                  />
                  <p className="text-xs text-[var(--muted)] mt-1">Supported: PDF, PPT, DOCX, MP4 (max 100MB)</p>
                  {formData.durationSeconds && (
                    <p className="text-xs text-[var(--accent)] mt-1">
                      Runtime detected: {Math.floor(Number(formData.durationSeconds) / 60)} min {Number(formData.durationSeconds) % 60} sec
                    </p>
                  )}
                </div>

                {/* Everything below only applies to video. A PDF upload never
                    sees any of it, which keeps the common case a three-field
                    form. */}
                {isVideoFile && (
                  <div className="rounded-lg border border-[var(--accent)]/25 bg-[var(--accent-soft)] p-4 space-y-4">
                    <div>
                      <p className="text-sm font-semibold text-[var(--foreground)]">This video is…</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {[
                          { value: false, label: '🎓 A lesson video', hint: 'Prepared teaching material' },
                          { value: true, label: '📹 A class recording', hint: "A tape of a class you taught" },
                        ].map((option) => (
                          <button
                            key={String(option.value)}
                            type="button"
                            onClick={() => setFormData({ ...formData, isRecording: option.value })}
                            className={`rounded-lg border px-4 py-2.5 text-left text-sm transition ${
                              formData.isRecording === option.value
                                ? 'border-[var(--accent)] bg-white font-semibold text-[var(--foreground)]'
                                : 'border-[var(--border)] bg-white/50 text-[var(--muted)]'
                            }`}
                          >
                            <span className="block">{option.label}</span>
                            <span className="block text-xs font-normal text-[var(--muted)]">{option.hint}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">
                          Level {formData.isRecording ? '(required)' : '(optional)'}
                        </label>
                        <select
                          value={formData.level}
                          onChange={(e) => setFormData({ ...formData, level: e.target.value })}
                          className="w-full px-4 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-[var(--foreground)]"
                        >
                          <option value="">Take the level from the course</option>
                          {['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((level) => (
                            <option key={level} value={level}>{level}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">
                          {formData.isRecording ? 'Date of the class' : 'Publish date (optional)'}
                        </label>
                        <input
                          type="date"
                          value={formData.recordedAt}
                          onChange={(e) => setFormData({ ...formData, recordedAt: e.target.value })}
                          className="w-full px-4 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-[var(--foreground)]"
                        />
                        <p className="text-xs text-[var(--muted)] mt-1">Leave blank for today.</p>
                      </div>
                    </div>

                    {!formData.isRecording && (
                      <div className="grid gap-4 sm:grid-cols-3">
                        <div className="sm:col-span-2">
                          <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">
                            Series name (optional)
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. A1 Speaking Lab"
                            value={formData.series}
                            onChange={(e) => setFormData({ ...formData, series: e.target.value })}
                            className="w-full px-4 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-[var(--foreground)] placeholder-[var(--muted)]"
                          />
                          <p className="text-xs text-[var(--muted)] mt-1">
                            Videos sharing a series name get their own row in the student library.
                          </p>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">
                            Episode
                          </label>
                          <input
                            type="number"
                            min={1}
                            placeholder="1"
                            value={formData.episodeNumber}
                            onChange={(e) => setFormData({ ...formData, episodeNumber: e.target.value })}
                            className="w-full px-4 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-[var(--foreground)] placeholder-[var(--muted)]"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isUploading}
                  className="w-full bg-[var(--accent)] text-white py-2 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {isUploading ? 'Uploading...' : 'Upload Material'}
                </button>
              </form>
            </div>
          )}

          {/* Materials List */}
          {materials.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-3xl mb-2">📭</p>
              <p className="text-[var(--foreground)] font-semibold">No materials uploaded yet</p>
              <p className="text-[var(--muted)] text-sm mt-1">Upload your first course material to get started</p>
            </div>
          ) : (
            <div className="space-y-4">
              {materials.map((material) => (
                <div
                  key={material.id}
                  className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">📄</span>
                        <div>
                          <h3 className="font-semibold text-[var(--foreground)]">{material.title}</h3>
                          <p className="text-sm text-[var(--muted)]">{material.courseName}</p>
                        </div>
                      </div>
                      <p className="text-sm text-[var(--muted)] mt-2">{material.description}</p>
                      <div className="flex items-center gap-4 mt-3 text-xs text-[var(--muted)]">
                        <span>📦 {(material.fileSize / 1024 / 1024).toFixed(2)} MB</span>
                        <span>📅 {new Date(material.uploadedAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => window.open(material.filePath, '_blank')}
                      className="ml-4 px-3 py-1 bg-[var(--accent)] text-white text-sm rounded hover:opacity-90 transition-opacity"
                    >
                      Download
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </LecturerShell>
  );
}
