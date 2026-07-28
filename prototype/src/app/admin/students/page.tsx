"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { type StudentWithUser } from "@/types/admin";

type BranchOption = {
  id: string;
  name: string;
};

type AdmissionData = Record<string, unknown> | null;

const admissionLabelMap: Record<string, string> = {
  gender: "Gender",
  dob: "Date of birth",
  religion: "Religion",
   profession: "Profession / Ausbildung focus",
  phone: "Phone",
  city: "City",
  state: "State",
  country: "Country",
  motherTongue: "Mother tongue",
  birthPlace: "Birth place",
  idNumber: "ID number",
  idProofUrl: "ID proof URL",
  photoUrl: "Photo URL",
  parentIdProofUrl: "Parent ID proof URL",
  idProofFileName: "ID proof file",
  photoFileName: "Photo file",
  parentIdProofFileName: "Parent ID proof file",
  prevSchoolName: "Previous school",
  prevSchoolAddress: "Previous school address",
  prevSchoolClass: "Previous school class",
  prevPassoutYear: "Previous school passout year",
  studentType: "Student type",
  classApplied: "Starting class",
  section: "Section",
  subjects: "Subjects",
  activity: "Activity",
  medium: "Medium",
  fatherName: "Father name",
  fatherPhone: "Father phone",
  fatherOccupation: "Father occupation",
  motherName: "Mother name",
  motherPhone: "Mother phone",
  motherOccupation: "Mother occupation",
  allowParentLogin: "Allow parent login",
  transportRoute: "Transport route",
  heardFrom: "Heard from",
};

export default function AdminStudentsPage() {
  const [students, setStudents] = useState<StudentWithUser[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [filterBranchId, setFilterBranchId] = useState<string>("");
  const [filterTutorId, setFilterTutorId] = useState<string>("");
  const [filterLevel, setFilterLevel] = useState<string>("");
  const [filterBatch, setFilterBatch] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterPaymentStatus, setFilterPaymentStatus] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [lecturers, setLecturers] = useState<Array<{ id: string; user: { name?: string | null; email: string } }>>([]);

  const [showStudentForm, setShowStudentForm] = useState(false);
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newLevel, setNewLevel] = useState("A1");
  const [newBranchId, setNewBranchId] = useState<string>("");
  const [newTutorId, setNewTutorId] = useState<string>("");
  const [newStatus, setNewStatus] = useState("active");
  const [studentError, setStudentError] = useState("");
  const [selectedAdmission, setSelectedAdmission] = useState<AdmissionData>(null);
  const [selectedStudentName, setSelectedStudentName] = useState("");

  async function loadBranches() {
    const [branchesRes, lecturersRes] = await Promise.all([
      fetch("/api/admin/branches"),
      fetch("/api/admin/lecturers"),
    ]);

    if (branchesRes.ok) {
      const data = await branchesRes.json();
      setBranches(data.branches || []);
    }

    if (lecturersRes.ok) {
      const data = await lecturersRes.json();
      setLecturers(data.lecturers || []);
    }
  }

  async function loadStudents() {
    setLoading(true);
    const url = new URL("/api/admin/students", window.location.origin);
    if (filterBranchId) url.searchParams.set("branchId", filterBranchId);
    if (filterTutorId) url.searchParams.set("tutorId", filterTutorId);
    if (filterLevel) url.searchParams.set("level", filterLevel);
    if (filterBatch) url.searchParams.set("batch", filterBatch);
    if (filterStatus) url.searchParams.set("status", filterStatus);
    if (filterPaymentStatus) url.searchParams.set("paymentStatus", filterPaymentStatus);
    if (search) url.searchParams.set("search", search);
    if (page) url.searchParams.set("page", String(page));
    if (pageSize) url.searchParams.set("pageSize", String(pageSize));
    const res = await fetch(url.toString());
    if (res.ok) {
      const data = await res.json();
      setStudents(data.students || []);
      setTotalCount(typeof data.totalCount === "number" ? data.totalCount : 0);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadBranches();
  }, []);

  useEffect(() => {
    loadStudents();
  }, [filterBranchId, filterTutorId, filterLevel, filterBatch, filterStatus, filterPaymentStatus, search, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [filterBranchId, filterTutorId, filterLevel, filterStatus, filterPaymentStatus, search, pageSize]);

  async function handleSaveStudent() {
    setStudentError("");
    if (!newName.trim() || !newEmail.trim()) {
      setStudentError("Name and email are required.");
      return;
    }

    const payload = {
      name: newName.trim(),
      email: newEmail.trim().toLowerCase(),
      level: newLevel,
      branchId: newBranchId || null,
      tutorId: newTutorId || null,
      status: newStatus,
    } as Record<string, unknown>;

    let res: Response;

    if (editingStudentId) {
      payload.studentId = editingStudentId;
      res = await fetch("/api/admin/students", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      if (!newPassword.trim()) {
        setStudentError("Password is required for new students.");
        return;
      }

      payload.password = newPassword;
      res = await fetch("/api/admin/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setStudentError(data?.error || "Unable to save student.");
      return;
    }

    setEditingStudentId(null);
    setNewName("");
    setNewEmail("");
    setNewPassword("");
    setNewLevel("A1");
    setNewBranchId("");
    setNewTutorId("");
    setNewStatus("active");
    setShowStudentForm(false);
    await loadStudents();
  }

  async function handleUpdateStudentStatus(studentId: string, status: string) {
    setStudentError("");
    const res = await fetch("/api/admin/students", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, status }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setStudentError(data?.error || "Unable to update student status.");
      return;
    }

    await loadStudents();
  }

  function startEditingStudent(student: StudentWithUser) {
    setEditingStudentId(student.id);
    setNewName(student.user.name || "");
    setNewEmail(student.user.email);
    setNewPassword("");
    setNewLevel(student.level || "A1");
    setNewBranchId(student.branch?.id || "");
    setNewTutorId(student.tutor?.id || "");
    setNewStatus(student.status || "active");
    setStudentError("");
    setShowStudentForm(true);
  }

  function cancelEditingStudent() {
    setEditingStudentId(null);
    setNewName("");
    setNewEmail("");
    setNewPassword("");
    setNewLevel("A1");
    setNewBranchId("");
    setNewTutorId("");
    setNewStatus("active");
    setStudentError("");
    setShowStudentForm(false);
  }

  function viewAdmission(student: StudentWithUser) {
    setSelectedStudentName(student.user.name || student.user.email);
    setSelectedAdmission((student.admission as AdmissionData) || null);
  }

  function closeAdmission() {
    setSelectedAdmission(null);
    setSelectedStudentName("");
  }

  function renderAdmissionValue(value: unknown) {
    if (Array.isArray(value)) return value.filter((item) => item != null).join(", ");
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return String(value);
  }

  function formatAdmissionLabel(key: string) {
    return admissionLabelMap[key] || key.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function renderAdmissionSection(title: string, keys: string[]) {
    if (!selectedAdmission) return null;
    const rows = keys
      .map((key) => {
        const value = (selectedAdmission as Record<string, unknown>)[key];
        if (value === undefined || value === null || value === "") return null;
        const displayValue = renderAdmissionValue(value);
        if (!displayValue) return null;

        const isUrl = typeof value === "string" && /^(https?:\/\/|\/)/i.test(value);
        return (
          <div key={key} className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
            <dt className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">{formatAdmissionLabel(key)}</dt>
            <dd className="mt-1 text-sm">
              {isUrl ? (
                <a href={String(value)} target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">
                  {String(value)}
                </a>
              ) : (
                displayValue
              )}
            </dd>
          </div>
        );
      })
      .filter(Boolean);

    if (rows.length === 0) return null;

    return (
      <div className="grid gap-4">
        <h3 className="text-lg font-semibold">{title}</h3>
        <div className="grid gap-3 sm:grid-cols-2">{rows}</div>
      </div>
    );
  }

  function renderAdditionalAdmissionFields() {
    if (!selectedAdmission) return null;

    const knownKeys = new Set<string>([
      "gender",
      "dob",
      "religion",
      "caste",
      "bloodGroup",
      "address",
      "phone",
      "city",
      "state",
      "country",
      "motherTongue",
      "birthPlace",
      "idNumber",
      "idProofUrl",
      "photoUrl",
      "parentIdProofUrl",
      "idProofFileName",
      "photoFileName",
      "parentIdProofFileName",
      "prevSchoolName",
      "prevSchoolAddress",
      "prevSchoolClass",
      "prevPassoutYear",
      "studentType",
      "classApplied",
      "section",
      "subjects",
      "activity",
      "medium",
      "fatherName",
      "fatherPhone",
      "fatherOccupation",
      "motherName",
      "motherPhone",
      "motherOccupation",
      "allowParentLogin",
      "transportRoute",
      "heardFrom",
    ]);

    const rows = Object.keys(selectedAdmission as Record<string, unknown>)
      .filter((key) => !knownKeys.has(key))
      .map((key) => {
        const value = (selectedAdmission as Record<string, unknown>)[key];
        if (value === undefined || value === null || value === "") return null;
        const displayValue = renderAdmissionValue(value);
        if (!displayValue) return null;
        const isUrl = typeof value === "string" && /^(https?:\/\/|\/)/i.test(value);
        return (
          <div key={key} className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
            <dt className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">{formatAdmissionLabel(key)}</dt>
            <dd className="mt-1 text-sm">
              {isUrl ? (
                <a href={String(value)} target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">
                  {String(value)}
                </a>
              ) : (
                displayValue
              )}
            </dd>
          </div>
        );
      })
      .filter(Boolean);

    if (rows.length === 0) return null;

    return (
      <div className="grid gap-4">
        <h3 className="text-lg font-semibold">Additional admission details</h3>
        <div className="grid gap-3 sm:grid-cols-2">{rows}</div>
      </div>
    );
  }

  function downloadAdmission() {
    if (!selectedAdmission) return;
    const content = JSON.stringify(selectedAdmission, null, 2);
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedStudentName || "admission"}-details.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function handleDeleteStudent(studentId: string) {
    if (!confirm("Delete this student? This will remove the student record permanently.")) {
      return;
    }

    const res = await fetch("/api/admin/students", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setStudentError(data?.error || "Unable to delete student.");
      return;
    }

    if (editingStudentId === studentId) {
      cancelEditingStudent();
    }

    await loadStudents();
  }

  return (
    <AdminShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Admin</p>
            <h1 className="text-3xl font-bold">Students</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">Filter, edit, and manage student enrollment records.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                <label htmlFor="search" className="block text-sm font-semibold text-[var(--muted)]">Search</label>
                <input
                  id="search"
                  placeholder="Name or email"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                <label htmlFor="branchFilter" className="block text-sm font-semibold text-[var(--muted)]">Branch</label>
                <select
                  id="branchFilter"
                  value={filterBranchId}
                  onChange={(event) => setFilterBranchId(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="">All branches</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </select>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                <label htmlFor="tutorFilter" className="block text-sm font-semibold text-[var(--muted)]">Tutor</label>
                <select
                  id="tutorFilter"
                  value={filterTutorId}
                  onChange={(event) => setFilterTutorId(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="">All tutors</option>
                  {lecturers.map((lecturer) => (
                    <option key={lecturer.id} value={lecturer.id}>{lecturer.user.name || lecturer.user.email}</option>
                  ))}
                </select>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                <label htmlFor="levelFilter" className="block text-sm font-semibold text-[var(--muted)]">Level</label>
                <select
                  id="levelFilter"
                  value={filterLevel}
                  onChange={(event) => setFilterLevel(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="">All levels</option>
                  {['A1','A2','B1','B2','C1','C2'].map((level) => (
                    <option key={level} value={level}>{level}</option>
                  ))}
                </select>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                <label htmlFor="batchFilter" className="block text-sm font-semibold text-[var(--muted)]">Batch</label>
                <select
                  id="batchFilter"
                  value={filterBatch}
                  onChange={(event) => setFilterBatch(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="">All batches</option>
                  {['January','February','March','April','May','June','July','August','September','October','November','December'].map((month) => (
                    <option key={month} value={month}>{month}</option>
                  ))}
                </select>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                <label htmlFor="statusFilter" className="block text-sm font-semibold text-[var(--muted)]">Status</label>
                <select
                  id="statusFilter"
                  value={filterStatus}
                  onChange={(event) => setFilterStatus(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="">All statuses</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="graduated">Graduated</option>
                </select>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                <label htmlFor="paymentStatusFilter" className="block text-sm font-semibold text-[var(--muted)]">Payment Status</label>
                <select
                  id="paymentStatusFilter"
                  value={filterPaymentStatus}
                  onChange={(event) => setFilterPaymentStatus(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="">All payments</option>
                  <option value="pending">Pending</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
            </div>
            <div className="flex items-end justify-end">
              <button
                type="button"
                className="rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white"
                onClick={() => setShowStudentForm((current) => !current)}
              >
                {showStudentForm ? "Close form" : "Add student"}
              </button>
            </div>
          </div>
        </div>

        {showStudentForm ? (
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Name</span>
                <input
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Email</span>
                <input
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Password</span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Level</span>
                <select
                  value={newLevel}
                  onChange={(event) => setNewLevel(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  {['A1','A2','B1','B2','C1','C2'].map((level) => (
                    <option key={level} value={level}>{level}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Branch</span>
                <select
                  value={newBranchId}
                  onChange={(event) => setNewBranchId(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="">Unassigned</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Status</span>
                <select
                  value={newStatus}
                  onChange={(event) => setNewStatus(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="graduated">Graduated</option>
                </select>
              </label>
            </div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleSaveStudent}
                className="rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white"
              >
                {editingStudentId ? "Update student" : "Save student"}
              </button>
              {editingStudentId ? (
                <button
                  type="button"
                  onClick={cancelEditingStudent}
                  className="rounded-lg border border-[var(--border)] bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                >
                  Cancel
                </button>
              ) : null}
              {studentError ? <p className="text-sm text-red-500">{studentError}</p> : null}
            </div>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--background)] shadow-sm">
          <table className="min-w-full divide-y divide-[var(--border)]">
            <thead className="bg-[var(--surface)] text-left text-sm uppercase tracking-[0.16em] text-[var(--muted)]">
              <tr>
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Email</th>
                <th className="px-6 py-4">Branch</th>
                <th className="px-6 py-4">Starting class</th>
                <th className="px-6 py-4">Batch</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Payment</th>
                <th className="px-6 py-4">Balance</th>
                <th className="px-6 py-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] bg-[var(--background)]">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-sm text-[var(--muted)]">Loading students…</td>
                </tr>
              ) : students.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-sm text-[var(--muted)]">No students found yet.</td>
                </tr>
              ) : (
                students.map((student) => (
                  <tr key={student.id}>
                    <td className="px-6 py-4">{student.user.name}</td>
                    <td className="px-6 py-4">{student.user.email}</td>
                    <td className="px-6 py-4">{student.branch?.name || "—"}</td>
                    <td className="px-6 py-4">{student.admission && typeof student.admission === "object" && (student.admission as any).classApplied ? String((student.admission as any).classApplied) : (student.level || "—")}</td>
                    <td className="px-6 py-4">{typeof student.admission === "object" && student.admission && !Array.isArray(student.admission) && (student.admission as Record<string, unknown>).batch ? String((student.admission as Record<string, unknown>).batch) : "—"}</td>
                    <td className="px-6 py-4">{student.status || "active"}</td>
                    <td className="px-6 py-4">{student.payments?.[0]?.status || "none"}</td>
                    <td className="px-6 py-4 font-semibold">{student._paymentSummary ? `₦${student._paymentSummary.balance}` : "—"}</td>
                    <td className="px-6 py-4 flex flex-wrap gap-2">
                      <button
                        className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                        onClick={() => startEditingStudent(student)}
                      >
                        Edit
                      </button>
                      {student.status !== "graduated" ? (
                        <button
                          className="rounded-lg border border-yellow-500 text-yellow-600 px-3 py-2 text-sm"
                          onClick={() => handleUpdateStudentStatus(student.id, "graduated")}
                        >
                          Graduate
                        </button>
                      ) : (
                        <button
                          className="rounded-lg border border-emerald-500 text-emerald-600 px-3 py-2 text-sm"
                          onClick={() => handleUpdateStudentStatus(student.id, "active")}
                        >
                          Re-admit
                        </button>
                      )}
                      {student.admission ? (
                        <button
                          className="rounded-lg border border-slate-400 text-slate-700 px-3 py-2 text-sm"
                          onClick={() => viewAdmission(student)}
                        >
                          View admission
                        </button>
                      ) : null}
                      <button
                        className="rounded-lg border border-red-500 text-red-600 px-3 py-2 text-sm"
                        onClick={() => handleDeleteStudent(student.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="flex items-center justify-between gap-4 border-t border-[var(--border)] bg-[var(--surface)] px-6 py-4">
            <div className="text-sm text-[var(--muted)]">
            Page {page} • Showing {students.length} of {totalCount} students
          </div>
            <div className="flex items-center gap-3">
              <button
                className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-semibold disabled:opacity-50"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Prev
              </button>
              <button
                className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-semibold disabled:opacity-50"
                onClick={() => setPage((p) => p + 1)}
                disabled={page * pageSize >= totalCount}
              >
                Next
              </button>
              <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-2 text-sm">
                <option value={10}>10/page</option>
                <option value={20}>20/page</option>
                <option value={50}>50/page</option>
              </select>
            </div>
          </div>
        </div>
        {selectedAdmission ? (
          <div className="mt-6 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold">Admission details for {selectedStudentName}</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">Review the saved admission payload for this student.</p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={downloadAdmission}
                  className="rounded-lg border border-[var(--border)] bg-[var(--accent)]/10 px-4 py-2 text-sm font-semibold text-[var(--accent)]"
                >
                  Download JSON
                </button>
                <button
                  type="button"
                  onClick={closeAdmission}
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="mt-6 grid gap-8">
              {renderAdmissionSection("Student information", [
                "gender",
                "dob",
                "religion",
                "caste",
                "batch",
                "bloodGroup",
                "address",
                "phone",
                "city",
                "state",
                "country",
                "motherTongue",
                "birthPlace",
                "idNumber",
              ])}
              {renderAdmissionSection("Document uploads", [
                "idProofUrl",
                "photoUrl",
                "parentIdProofUrl",
                "idProofFileName",
                "photoFileName",
                "parentIdProofFileName",
              ])}
              {renderAdmissionSection("Previous school", [
                "prevSchoolName",
                "prevSchoolAddress",
                "prevSchoolClass",
                "prevPassoutYear",
              ])}
              {renderAdmissionSection("Admission details", [
                "studentType",
                "classApplied",
                "section",
                "subjects",
                "activity",
                "medium",
              ])}
              {renderAdmissionSection("Parent info", [
                "fatherName",
                "fatherPhone",
                "fatherOccupation",
                "motherName",
                "motherPhone",
                "motherOccupation",
              ])}
              {renderAdmissionSection("Additional details", [
                "allowParentLogin",
                "transportRoute",
                "heardFrom",
              ])}
              {renderAdditionalAdmissionFields()}
            </div>
          </div>
        ) : null}
      </div>
    </AdminShell>
  );
}
