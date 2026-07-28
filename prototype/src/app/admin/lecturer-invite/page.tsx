"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import AdminShell from "@/components/AdminShell";

type LecturerRecord = {
  id: string;
  user: { name: string | null; email: string; role: string };
  classes: Array<{ id: string; name: string; course: { title: string; level: string } }>;
};

export default function LecturerInvitePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [creatingLecturer, setCreatingLecturer] = useState(false);
  const [lecturers, setLecturers] = useState<LecturerRecord[]>([]);
  const [createdLecturerDetails, setCreatedLecturerDetails] = useState<{
    email: string;
    classes: Array<{ id: string; name: string; courseId: string; courseTitle: string; level: string }>;
  } | null>(null);
  const [lecturerForm, setLecturerForm] = useState({
    name: "",
    email: "",
    password: "",
    specialization: "",
    bio: "",
    phone: "",
  });
  const [selectedLevels, setSelectedLevels] = useState<string[]>([]);

  const levelOptions = ["A1", "A2", "B1", "B2", "C1", "C2"];

  const toggleLevel = (level: string) => {
    setSelectedLevels((current) =>
      current.includes(level)
        ? current.filter((value) => value !== level)
        : [...current, level]
    );
  };

  useEffect(() => {
    if (status === "loading") {
      return; // Wait for session to load
    }

    if (status === "unauthenticated") {
      router.push("/auth/admin");
      return;
    }

    // Only redirect if authenticated but NOT admin
    if (status === "authenticated" && session?.user?.role?.toLowerCase() !== "admin") {
      router.push("/auth/admin");
      return;
    }

    // Load invite code if admin
    if (status === "authenticated" && session?.user?.role?.toLowerCase() === "admin") {
      const loadCode = async () => {
        try {
          const [codeResponse, lecturersResponse] = await Promise.all([
            fetch("/api/admin/lecturer-invite"),
            fetch("/api/admin/lecturers"),
          ]);
          if (!codeResponse.ok || !lecturersResponse.ok) {
            throw new Error("Failed to load lecturer administration data");
          }
          const [codeData, lecturersData] = await Promise.all([
            codeResponse.json(),
            lecturersResponse.json(),
          ]);
          setCode(codeData.code || "");
          setLecturers(lecturersData.lecturers || []);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to load invite code");
        } finally {
          setLoading(false);
        }
      };

      loadCode();
    }
  }, [status, session?.user?.role, router]);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch("/api/admin/lecturer-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      if (!res.ok) {
        throw new Error("Failed to save invite code");
      }

      setSuccess("Lecturer invite code updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save invite code");
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch("/api/admin/lecturer-invite", { method: "DELETE" });
      if (!res.ok) {
        throw new Error("Failed to clear invite code");
      }
      setCode("");
      setSuccess("Lecturer invite code cleared");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear invite code");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateLecturer = async () => {
    setCreatingLecturer(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch("/api/admin/lecturers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...lecturerForm, levels: selectedLevels }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to create lecturer account");
      }

      setSuccess(`Lecturer account created for ${data.lecturer?.email}. Temporary password: ${data.lecturer?.password}`);
      setCreatedLecturerDetails({
        email: data.lecturer?.email || "",
        classes: data.classes || [],
      });
      setLecturers((current) => [
        {
          id: data.lecturer?.lecturerId || data.lecturer?.id,
          user: {
            name: data.lecturer?.name || null,
            email: data.lecturer?.email || "",
            role: data.lecturer?.role || "LECTURER",
          },
          classes: (data.classes || []).map((item: { id: string; name: string; courseTitle: string; level: string }) => ({
            id: item.id,
            name: item.name,
            course: { title: item.courseTitle, level: item.level },
          })),
        },
        ...current,
      ]);
      setLecturerForm({
        name: "",
        email: "",
        password: "",
        specialization: "",
        bio: "",
        phone: "",
      });
      setSelectedLevels([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create lecturer account");
      setCreatedLecturerDetails(null);
    } finally {
      setCreatingLecturer(false);
    }
  };

  if (status === "loading") {
    return (
      <AdminShell>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="mb-4">⏳</div>
            <p className="text-[var(--foreground)]">Loading...</p>
          </div>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Admin</p>
            <h1 className="text-3xl font-bold">Lecturer Invite Management</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Set a secret invite code that new lecturers must use when signing up.
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-lg border border-[var(--border)] px-4 py-3 text-sm font-semibold text-[var(--accent)]"
          >
            ← Back
          </button>
        </div>

        {error && <div className="rounded-3xl bg-rose-500/15 p-4 text-sm text-rose-200">{error}</div>}
        {success && <div className="rounded-3xl bg-emerald-500/15 p-4 text-sm text-emerald-200">{success}</div>}

        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-sm">
          <label className="block text-sm font-medium">
            Invite code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm"
              placeholder="Enter a secure invite code"
              disabled={loading}
            />
          </label>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || loading}
              className="rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save code"}
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={saving || loading}
              className="rounded-lg border border-[var(--border)] bg-white px-4 py-3 text-sm font-semibold"
            >
              {saving ? "Working..." : "Clear code"}
            </button>
          </div>
        </div>

        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-sm">
          <div className="mb-4">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Directory</p>
            <h2 className="mt-2 text-2xl font-bold">Created lecturers</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">This list is loaded from the database and remains available across admin sessions.</p>
          </div>

          {lecturers.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[var(--border)] p-5 text-sm text-[var(--muted)]">No lecturer accounts have been created yet.</p>
          ) : (
            <div className="space-y-3">
              {lecturers.map((lecturer) => (
                <div key={lecturer.id} className="rounded-2xl border border-[var(--border)] bg-white p-5">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="font-semibold">{lecturer.user.name || "Unnamed lecturer"}</p>
                      <p className="text-sm text-[var(--muted)]">{lecturer.user.email}</p>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">Active lecturer</span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {lecturer.classes.length > 0 ? lecturer.classes.map((lecturerClass) => (
                      <span key={lecturerClass.id} className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent)]">
                        {lecturerClass.course.level} · {lecturerClass.course.title}
                      </span>
                    )) : <span className="text-sm text-[var(--muted)]">No levels assigned</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-sm">
          <div className="mb-4">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Provision lecturer</p>
            <h2 className="mt-2 text-2xl font-bold">Create lecturer account</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">Use this to issue a lecturer login directly from the admin console.</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium">
              Full name
              <input value={lecturerForm.name} onChange={(e) => setLecturerForm((current) => ({ ...current, name: e.target.value }))} className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm" placeholder="Dr. Ada Evans" />
            </label>
            <label className="block text-sm font-medium">
              Email
              <input type="email" value={lecturerForm.email} onChange={(e) => setLecturerForm((current) => ({ ...current, email: e.target.value }))} className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm" placeholder="lecturer@easyway.test" />
            </label>
            <label className="block text-sm font-medium">
              Temporary password
              <input type="password" value={lecturerForm.password} onChange={(e) => setLecturerForm((current) => ({ ...current, password: e.target.value }))} className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm" placeholder="Minimum 8 characters" />
            </label>
            <label className="block text-sm font-medium">
              Phone
              <input value={lecturerForm.phone} onChange={(e) => setLecturerForm((current) => ({ ...current, phone: e.target.value }))} className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm" placeholder="+234 ..." />
            </label>
            <label className="block text-sm font-medium md:col-span-2">
              Specialization
              <input value={lecturerForm.specialization} onChange={(e) => setLecturerForm((current) => ({ ...current, specialization: e.target.value }))} className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm" placeholder="German language, exam prep, business communication" />
            </label>
            <label className="block text-sm font-medium md:col-span-2">
              Bio
              <textarea value={lecturerForm.bio} onChange={(e) => setLecturerForm((current) => ({ ...current, bio: e.target.value }))} className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm" rows={4} placeholder="Optional lecturer bio" />
            </label>
            <div className="md:col-span-2">
              <p className="text-sm font-medium mb-2">Assign teaching levels</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {levelOptions.map((level) => (
                  <label key={level} className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm hover:border-[var(--accent)]">
                    <input
                      type="checkbox"
                      checked={selectedLevels.includes(level)}
                      onChange={() => toggleLevel(level)}
                      className="h-4 w-4 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]"
                    />
                    {level}
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-[var(--muted)]">Create class templates for selected levels so this lecturer can upload focused materials for those students.</p>
            </div>
          </div>

          <div className="mt-6">
            <button type="button" onClick={handleCreateLecturer} disabled={creatingLecturer} className="rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
              {creatingLecturer ? "Creating..." : "Create lecturer account"}
            </button>
          </div>

          {createdLecturerDetails && (
            <div className="mt-6 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Lecturer provisioned</p>
              <h3 className="mt-2 text-lg font-bold">{createdLecturerDetails.email}</h3>
              <p className="mt-2 text-sm text-[var(--muted)]">This lecturer was created with the following assigned teaching levels and class templates.</p>

              {createdLecturerDetails.classes.length > 0 ? (
                <ul className="mt-4 space-y-3 text-sm">
                  {createdLecturerDetails.classes.map((klass) => (
                    <li key={klass.id} className="rounded-2xl border border-[var(--border)] bg-white p-4">
                      <p className="font-semibold">{klass.name}</p>
                      <p className="text-[var(--muted)]">Level: {klass.level}</p>
                      <p className="text-[var(--muted)]">Course: {klass.courseTitle}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-[var(--muted)]">No teaching levels were selected, so no class templates were created.</p>
              )}

              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => {
                    setCreatedLecturerDetails(null);
                    setSuccess("");
                    setLecturerForm({ name: "", email: "", password: "", specialization: "", bio: "", phone: "" });
                    setSelectedLevels([]);
                  }}
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold"
                >
                  Create another lecturer
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
