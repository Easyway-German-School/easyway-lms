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
  });

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
    if (!formData.file || !formData.title || !courseId) {
      setError('Please fill all fields');
      return;
    }

    setIsUploading(true);
    const formDataToSend = new FormData();
    formDataToSend.append('title', formData.title);
    formDataToSend.append('description', formData.description);
    formDataToSend.append('courseId', courseId);
    formDataToSend.append('file', formData.file);

    try {
      const res = await fetch('/api/lecturer/materials', {
        method: 'POST',
        body: formDataToSend,
      });

      if (!res.ok) throw new Error('Upload failed');

      const newMaterial = await res.json();
      setMaterials([newMaterial, ...materials]);
      setFormData({ title: '', description: '', courseId: '', file: null });
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

                <div>
                  <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">
                    Course
                  </label>
                  <select
                    value={formData.courseId || selectedCourseId}
                    onChange={(e) => setFormData({ ...formData, courseId: e.target.value })}
                    className="w-full px-4 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-[var(--foreground)]"
                    required
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

                <div>
                  <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">
                    File Upload
                  </label>
                  <input
                    type="file"
                    onChange={(e) => setFormData({ ...formData, file: e.target.files?.[0] || null })}
                    className="w-full px-4 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-[var(--foreground)]"
                    required
                  />
                  <p className="text-xs text-[var(--muted)] mt-1">Supported: PDF, PPT, DOCX, MP4 (max 100MB)</p>
                </div>

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
