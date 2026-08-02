"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import BrandLoader from "@/components/BrandLoader";
import { uploadFile } from "@/lib/upload";

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
  course: {
    title: string;
  };
  createdAt: string;
}

export default function MaterialsPage() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
  });

  useEffect(() => {
    Promise.all([loadCourses()]);
  }, []);

  useEffect(() => {
    if (selectedCourseId) {
      loadMaterials();
    }
  }, [selectedCourseId]);

  async function loadCourses() {
    try {
      const res = await fetch("/api/admin/courses");
      if (!res.ok) throw new Error("Failed to fetch courses");
      const data = await res.json();
      setCourses(data);
      if (data.length > 0) {
        setSelectedCourseId(data[0].id);
      }
    } catch (err) {
      setError("Failed to load courses");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadMaterials() {
    if (!selectedCourseId) return;
    try {
      const res = await fetch(
        `/api/admin/materials?courseId=${selectedCourseId}`
      );
      if (!res.ok) throw new Error("Failed to fetch materials");
      const data = await res.json();
      setMaterials(data);
    } catch (err) {
      setError("Failed to load materials");
      console.error(err);
    }
  }

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

  if (loading) {
    return (
      <AdminShell>
        <BrandLoader fill size="lg" message="Loading materials." />
      </AdminShell>
    );
  }

  if (courses.length === 0) {
    return (
      <AdminShell>
        <div className="p-8">
          <h1 className="text-3xl font-bold mb-4">Course Materials</h1>
          <p className="text-gray-500">
            No courses available. Create courses first.
          </p>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-8">Course Materials</h1>

        {error && (
          <div className="mb-4 p-4 bg-red-100 text-red-700 rounded">
            {error}
          </div>
        )}

        {/* Course Selector */}
        <div className="mb-8">
          <label className="block text-sm font-medium mb-2">Select Course</label>
          <select
            value={selectedCourseId}
            onChange={(e) => setSelectedCourseId(e.target.value)}
            className="w-full px-3 py-2 border rounded"
          >
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title} ({course.level})
              </option>
            ))}
          </select>
        </div>

        {/* Upload Form */}
        <div className="bg-white rounded-lg border p-6 mb-8">
          <h2 className="text-xl font-semibold mb-1">Upload Material</h2>
          <p className="mb-4 text-sm text-slate-500">
            The file lands in the Materials library of every student at this course&apos;s level, and shows
            on their dashboard as newly added. Tutors can also attach it to a specific day from
            the class timetable.
          </p>
          <form onSubmit={handleUpload} className="grid gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                File *
              </label>
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="w-full px-3 py-2 border rounded"
                required
              />
              {file && (
                <p className="text-sm text-gray-600 mt-1">
                  {file.name} ({(file.size / 1024).toFixed(2)} KB)
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Title *
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) =>
                  setFormData({ ...formData, title: e.target.value })
                }
                placeholder="e.g., Module 1 Study Guide"
                className="w-full px-3 py-2 border rounded"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="Optional description"
                className="w-full px-3 py-2 border rounded h-20"
              />
            </div>

            <button
              type="submit"
              disabled={uploading}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
            >
              {uploading ? "Uploading..." : "Upload Material"}
            </button>
          </form>
        </div>

        {/* Materials Table */}
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-medium">
                  Title
                </th>
                <th className="px-6 py-3 text-left text-sm font-medium">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-sm font-medium">
                  Size
                </th>
                <th className="px-6 py-3 text-left text-sm font-medium">
                  Uploaded
                </th>
                <th className="px-6 py-3 text-left text-sm font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {materials.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-4 text-center text-gray-500">
                    No materials uploaded for this course
                  </td>
                </tr>
              ) : (
                materials.map((material) => (
                  <tr key={material.id} className="border-b hover:bg-gray-50">
                    <td className="px-6 py-3">
                      <a
                        href={material.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 font-medium"
                      >
                        {material.title}
                      </a>
                      {material.description && (
                        <p className="text-sm text-gray-600 mt-1">
                          {material.description}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <span className="inline-block px-2 py-1 bg-gray-100 rounded text-xs font-medium">
                        {material.fileType.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm">
                      {(material.fileSize / 1024).toFixed(2)} KB
                    </td>
                    <td className="px-6 py-3 text-sm">
                      {new Date(material.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-3">
                      <button
                        onClick={() => handleDelete(material.id)}
                        className="text-red-600 hover:text-red-800"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}
