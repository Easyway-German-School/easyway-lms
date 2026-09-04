"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import { type StudentWithUser } from "@/types/admin";
import PasswordInput from "@/components/PasswordInput";
import BulkStudentAdd from "@/components/BulkStudentAdd";
import { goalFor } from "@/lib/germany-goals";
import { TIME_SLOTS, SLOT_DEFAULTS } from "@/lib/class-times";
import { isOnlineBranchName } from "@/lib/online-branch";
import { packageOptions } from "@/app/auth/signup/options";

/**
 * Pathway choices for the manual "Add student" form only. Mirrors the signup
 * form's list, plus "Travel Package" which the office offers to walk-in students
 * but which isn't part of self-service signup.
 */
const addStudentPathwayOptions = [...packageOptions, "Travel Package"];

/** Bare month names — matches the signup form and the roster's Batch filter. */
const BATCH_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

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

/**
 * How a highlighted row is drawn, per focus tone.
 *
 * The point is that somebody arriving from a dashboard tile can see at a glance
 * which rows the number was about, without reading a single value — so the
 * treatment is a left bar, a faint tinted background and a weight change
 * together rather than colour alone. Colour alone excludes anyone who cannot
 * distinguish it, and this is a list people act on: ringing a student, chasing
 * a fee.
 *
 * Every value is a theme token, not a raw Tailwind palette class. The old
 * `bg-red-50` / `text-red-700` set was built for a white page and turned into a
 * flat pink slab with shouting text on the dark themes. `--danger-soft` and
 * friends already carry a low alpha tuned per theme, so the tint stays a
 * whisper on any background.
 */
const FOCUS_TONE: Record<
  string,
  { row: string; text: string; bar: string; accent: string; soft: string }
> = {
  danger: {
    row: "bg-[var(--danger-soft)]",
    text: "text-[var(--danger)]",
    bar: "before:bg-[var(--danger)]",
    accent: "var(--danger)",
    soft: "var(--danger-soft)",
  },
  warn: {
    row: "bg-[var(--warning-soft)]",
    text: "text-[var(--warning)]",
    bar: "before:bg-[var(--warning)]",
    accent: "var(--warning)",
    soft: "var(--warning-soft)",
  },
  good: {
    row: "bg-[var(--success-soft)]",
    text: "text-[var(--success)]",
    bar: "before:bg-[var(--success)]",
    accent: "var(--success)",
    soft: "var(--success-soft)",
  },
  info: {
    row: "bg-[var(--accent-soft)]",
    text: "text-[var(--accent-ink)]",
    bar: "before:bg-[var(--accent-strong)]",
    accent: "var(--accent-strong)",
    soft: "var(--accent-soft)",
  },
};

type FocusMeta = { id: string; label: string; hint: string; tone: string };

type StudentFinanceRow = {
  cohort: string;
  behindOnTuition: boolean;
  lockedOut: boolean;
  daysEnrolled: number;
  agingBucket: string;
  paid?: number;
  owed?: number;
  owedOnDeposit?: number;
  tuitionFee?: number;
  progressPercent?: number;
};

function StudentsRoster() {
  const params = useSearchParams();

  const [students, setStudents] = useState<StudentWithUser[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  /**
   * SEEDED FROM THE URL, not reset to blank.
   *
   * This is the whole reason a dashboard figure can lead anywhere useful. The
   * page used to start every filter empty and ignore the query string, so
   * `/admin/students?focus=behind_tuition` rendered the complete roster and the
   * reader was back to hunting for the seven people they had just clicked on.
   */
  const [filterBranchId, setFilterBranchId] = useState<string>(params.get("branchId") ?? "");
  const [filterTutorId, setFilterTutorId] = useState<string>(params.get("tutorId") ?? "");
  const [filterLevel, setFilterLevel] = useState<string>(params.get("level") ?? "");
  const [filterBatch, setFilterBatch] = useState<string>(params.get("batch") ?? "");
  const [filterClassType, setFilterClassType] = useState<string>(params.get("classType") ?? "");
  const [filterSessionSlot, setFilterSessionSlot] = useState<string>(params.get("sessionSlot") ?? "");
  const [filterStatus, setFilterStatus] = useState<string>(params.get("status") ?? "");
  const [filterPaymentStatus, setFilterPaymentStatus] = useState<string>(params.get("paymentStatus") ?? "");
  const [search, setSearch] = useState<string>(params.get("search") ?? "");

  /** The derived rule this view is pinned to, and the exact set it selected. */
  const [focus, setFocus] = useState<string>(params.get("focus") ?? "");
  const [focusIds] = useState<string>(params.get("ids") ?? "");
  const [agingBucket, setAgingBucket] = useState<string>(params.get("agingBucket") ?? "");
  const [focusMeta, setFocusMeta] = useState<FocusMeta | null>(null);
  const [matchedIds, setMatchedIds] = useState<Set<string> | null>(null);
  const [canSeeMoney, setCanSeeMoney] = useState(true);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [lecturers, setLecturers] = useState<Array<{ id: string; user: { name?: string | null; email: string } }>>([]);

  const [showStudentForm, setShowStudentForm] = useState(false);
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newLevel, setNewLevel] = useState("A1");
  const [newBranchId, setNewBranchId] = useState<string>("");
  const [newTutorId, setNewTutorId] = useState<string>("");
  const [newStatus, setNewStatus] = useState("active");
  const [newClassType, setNewClassType] = useState("group");
  const [newSessionSlot, setNewSessionSlot] = useState("morning");
  const [newDeliveryMode, setNewDeliveryMode] = useState("physical");
  const [newBatch, setNewBatch] = useState("");
  const [newPathway, setNewPathway] = useState(packageOptions[0]);
  const [newAmountPaid, setNewAmountPaid] = useState("");
  const [studentError, setStudentError] = useState("");
  /** Shown once, right after a manual add, so the admin has something to copy. */
  const [savedCredentials, setSavedCredentials] = useState<{
    name: string;
    email: string;
    password: string;
    studentCode?: string | null;
  } | null>(null);
  /** Whether the "send their login by email?" prompt has been answered yet, for the credentials just created. */
  const [sendCredsState, setSendCredsState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  /** Which row's tutor select is mid-save, so it can be disabled while it is. */
  const [savingTutorFor, setSavingTutorFor] = useState("");
  const [selectedAdmission, setSelectedAdmission] = useState<AdmissionData>(null);
  const [selectedStudentName, setSelectedStudentName] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  /** Set once the reader has ticked "select every student that matches", not just the page. */
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  /** Which admin sub-role is signed in — "super" unlocks the Reset roster tool. */
  const [adminRole, setAdminRole] = useState<string>("");
  /** Short outcome line after a bulk delete: "Removed 18. 2 were already gone." */
  const [deleteFeedback, setDeleteFeedback] = useState<string>("");
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetPhrase, setResetPhrase] = useState("");
  const [resetting, setResetting] = useState(false);

  const loadBranches = useCallback(async () => {
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
  }, []);

  const loadStudents = useCallback(async () => {
    setLoading(true);
    const url = new URL("/api/admin/students", window.location.origin);
    if (filterBranchId) url.searchParams.set("branchId", filterBranchId);
    if (filterTutorId) url.searchParams.set("tutorId", filterTutorId);
    if (filterLevel) url.searchParams.set("level", filterLevel);
    if (filterBatch) url.searchParams.set("batch", filterBatch);
    if (filterClassType) url.searchParams.set("classType", filterClassType);
    if (filterSessionSlot) url.searchParams.set("sessionSlot", filterSessionSlot);
    if (filterStatus) url.searchParams.set("status", filterStatus);
    if (filterPaymentStatus) url.searchParams.set("paymentStatus", filterPaymentStatus);
    if (search) url.searchParams.set("search", search);
    if (focus) url.searchParams.set("focus", focus);
    if (agingBucket) url.searchParams.set("agingBucket", agingBucket);
    if (focusIds) url.searchParams.set("ids", focusIds);
    if (page) url.searchParams.set("page", String(page));
    if (pageSize) url.searchParams.set("pageSize", String(pageSize));
    const res = await fetch(url.toString());
    if (res.ok) {
      const data = await res.json();
      setStudents(data.students || []);
      setTotalCount(typeof data.totalCount === "number" ? data.totalCount : 0);
      // The wording comes back with the data rather than living in a lookup
      // table here — one edit to the preset changes the tile and the banner.
      setFocusMeta(data.focus ?? null);
      setMatchedIds(Array.isArray(data.matchedIds) ? new Set<string>(data.matchedIds) : null);
      setCanSeeMoney(data.canSeeMoney !== false);
      setAdminRole(typeof data.adminRole === "string" ? data.adminRole : "");
    }
    setLoading(false);
  }, [agingBucket, filterBatch, filterBranchId, filterClassType, filterLevel, filterPaymentStatus, filterSessionSlot, filterStatus, filterTutorId, focus, focusIds, page, pageSize, search]);

  function clearFocus() {
    setFocus("");
    setAgingBucket("");
    setFocusMeta(null);
    setMatchedIds(null);
    setPage(1);
    // Strip the query string so a refresh or a shared link does not silently
    // re-apply a filter the reader has just dismissed.
    window.history.replaceState(null, "", "/admin/students");
  }

  useEffect(() => {
    void loadBranches();
  }, [loadBranches]);

  useEffect(() => {
    void loadStudents();
  }, [loadStudents]);

  async function handleSaveStudent() {
    setStudentError("");
    setSavedCredentials(null);
    setSendCredsState("idle");
    if (!newName.trim() || !newEmail.trim()) {
      setStudentError("Name and email are required.");
      return;
    }

    const isOnlineSelection = isOnlineBranchName(branches.find((branch) => branch.id === newBranchId)?.name);
    const payload = {
      name: newName.trim(),
      email: newEmail.trim().toLowerCase(),
      phone: newPhone.trim(),
      level: newLevel,
      branchId: newBranchId || null,
      tutorId: newTutorId || null,
      status: newStatus,
      classType: newClassType,
      sessionSlot: newSessionSlot,
      deliveryMode: isOnlineSelection ? "online" : newDeliveryMode,
      pathway: newPathway,
      batch: newBatch,
    } as Record<string, unknown>;

    let res: Response;
    const wasNewStudent = !editingStudentId;

    if (editingStudentId) {
      payload.studentId = editingStudentId;
      // A password left blank here means "leave it alone" — only new students
      // require one; editing an existing one must never silently reset it.
      if (newPassword.trim()) payload.password = newPassword.trim();
      res = await fetch("/api/admin/students", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      // A blank password is fine on create too — the server mints a readable
      // temporary one and hands it back, same as the CSV and paste-many tools.
      if (newPassword.trim()) payload.password = newPassword.trim();
      // Up-front payment is a create-only concept — recorded once, when the
      // account is made. Editing a student never re-posts it.
      const amount = Number(newAmountPaid);
      if (Number.isFinite(amount) && amount > 0) payload.amountPaid = Math.round(amount);
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

    if (wasNewStudent) {
      const data = await res.json().catch(() => ({}));
      setSavedCredentials({
        name: newName.trim(),
        email: newEmail.trim().toLowerCase(),
        password: typeof data?.password === "string" ? data.password : newPassword.trim(),
        studentCode: data?.studentCode ?? null,
      });
    }

    setEditingStudentId(null);
    setNewName("");
    setNewEmail("");
    setNewPhone("");
    setNewPassword("");
    setNewLevel("A1");
    setNewBranchId("");
    setNewTutorId("");
    setNewStatus("active");
    setNewDeliveryMode("physical");
    setNewBatch("");
    setNewPathway(packageOptions[0]);
    setNewAmountPaid("");
    setShowStudentForm(false);
    await loadStudents();
  }

  /** The "send it now?" action behind the credentials banner — single-add's version of the bulk tools' prompt. */
  async function sendSavedCredentials() {
    if (!savedCredentials) return;
    setSendCredsState("sending");
    try {
      const res = await fetch("/api/admin/students/send-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ students: [savedCredentials] }),
      });
      const data = await res.json().catch(() => ({}));
      const ok = res.ok && data?.results?.[0]?.emailed;
      setSendCredsState(ok ? "sent" : "error");
    } catch {
      setSendCredsState("error");
    }
  }

  /**
   * Change who teaches one student, from the row itself.
   *
   * Deliberately not behind the Edit form. "Who is this student's tutor?" is
   * the question this page gets asked about a whole column at a time — the
   * office reassigning a sitting, or checking that a new tutor picked up their
   * class — and making each one a four-click round trip through a modal is how
   * it stops being done at all. The same endpoint the tutor's own screen uses,
   * so both people are notified either way.
   */
  async function changeTutor(studentId: string, lecturerId: string) {
    setStudentError("");
    setSavingTutorFor(studentId);
    try {
      const res = await fetch("/api/admin/lecturers/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, lecturerId: lecturerId || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStudentError(data?.error || "Unable to change this student's tutor.");
        return;
      }
      await loadStudents();
    } finally {
      setSavingTutorFor("");
    }
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
    setNewPhone(typeof (student.admission as AdmissionData)?.phone === "string" ? String((student.admission as AdmissionData)?.phone) : "");
    setNewPassword("");
    setNewLevel(student.level || "A1");
    setNewBranchId(student.branch?.id || "");
    setNewTutorId(student.tutor?.id || "");
    setNewStatus(student.status || "active");
    setNewClassType(student.classType || "group");
    setNewSessionSlot(student.sessionSlot || "morning");
    setNewDeliveryMode(student.deliveryMode === "hybrid" ? "hybrid" : "physical");
    setNewBatch(
      typeof (student.admission as AdmissionData)?.batch === "string"
        ? String((student.admission as AdmissionData)?.batch)
        : "",
    );
    setNewPathway(student.pathway || packageOptions[0]);
    // Not an edit concept — the initial payment was recorded when the account
    // was created. Adjustments go through the student's own finance screen.
    setNewAmountPaid("");
    setStudentError("");
    setSavedCredentials(null);
    setShowStudentForm(true);
  }

  function cancelEditingStudent() {
    setEditingStudentId(null);
    setNewName("");
    setNewEmail("");
    setNewPhone("");
    setNewPassword("");
    setNewLevel("A1");
    setNewBranchId("");
    setNewTutorId("");
    setNewStatus("active");
    setNewClassType("group");
    setNewSessionSlot("morning");
    setNewDeliveryMode("physical");
    setNewBatch("");
    setNewPathway(packageOptions[0]);
    setNewAmountPaid("");
    setStudentError("");
    setSavedCredentials(null);
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
    if (!confirm("Are you sure you want to delete this student? This action is not reversible from the portal and will log them out everywhere.")) {
      return;
    }

    const res = await fetch("/api/admin/students", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, confirmation: "DELETE STUDENTS" }),
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

  /** The filters currently narrowing the roster, in the shape the reset endpoint reads. */
  function currentFilterPayload() {
    return {
      ...(filterBranchId ? { branchId: filterBranchId } : {}),
      ...(filterLevel ? { level: filterLevel } : {}),
      ...(filterStatus ? { status: filterStatus } : {}),
    };
  }

  async function handleDeleteSelectedStudents() {
    setStudentError("");
    setDeleteFeedback("");

    // "Select all matching" hands the job to the server so it is not capped by
    // one page of ids — it re-resolves the set from the same filters.
    if (selectAllMatching) {
      if (!confirm(`Remove all ${totalCount} students that match the current filters? They can be restored from Security → Audit trail.`)) return;
      const res = await fetch("/api/admin/students", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "all", confirmation: "RESET STUDENTS", filters: currentFilterPayload() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStudentError(data?.error || "Unable to remove the selected students.");
        return;
      }
      setDeleteFeedback(`Removed ${data.deleted ?? 0} student${(data.deleted ?? 0) === 1 ? "" : "s"}.`);
      setSelectAllMatching(false);
      setSelectedStudentIds(new Set());
      setPage(1);
      await loadStudents();
      return;
    }

    const ids = [...selectedStudentIds];
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} student${ids.length === 1 ? "" : "s"}? They can be restored from Security → Audit trail.`)) return;
    const res = await fetch("/api/admin/students", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentIds: ids, confirmation: "DELETE STUDENTS" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStudentError(data?.error || "Unable to delete selected students.");
      return;
    }
    const deleted: number = typeof data.deleted === "number" ? data.deleted : ids.length;
    const skipped: string[] = Array.isArray(data.skipped) ? data.skipped : [];
    setDeleteFeedback(
      `Removed ${deleted} student${deleted === 1 ? "" : "s"}.` +
        (skipped.length ? ` ${skipped.length} were already gone or outside your access.` : ""),
    );
    // Drop only what actually went, so anything skipped stays visible/selectable.
    setSelectedStudentIds((current) => {
      const next = new Set(current);
      for (const id of ids) if (!skipped.includes(id)) next.delete(id);
      return next;
    });
    await loadStudents();
  }

  async function handleResetRoster() {
    if (resetPhrase !== "RESET STUDENTS") return;
    setResetting(true);
    setStudentError("");
    setDeleteFeedback("");
    try {
      const res = await fetch("/api/admin/students", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "all", confirmation: "RESET STUDENTS" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStudentError(data?.error || "Unable to reset the roster.");
        return;
      }
      setDeleteFeedback(`Roster reset — removed ${data.deleted ?? 0} student${(data.deleted ?? 0) === 1 ? "" : "s"}. Restore any of them from Security → Audit trail.`);
      setShowResetModal(false);
      setResetPhrase("");
      setSelectAllMatching(false);
      setSelectedStudentIds(new Set());
      setPage(1);
      await loadStudents();
    } finally {
      setResetting(false);
    }
  }

  const tone = FOCUS_TONE[focusMeta?.tone ?? "danger"] ?? FOCUS_TONE.danger;
  const isHighlighted = (studentId: string) => Boolean(matchedIds?.has(studentId));

  return (
    <AdminShell>
      <div className="space-y-6">
        {/*
          THE BANNER IS NOT DECORATION.

          A roster that silently shows 7 of 340 students is indistinguishable
          from a roster that is broken, and the second reading is the one a
          person reaches for when the list looks too short. So the filtered view
          says which rule is applied, in the same words the dashboard tile used,
          and offers one click out of it.
        */}
        {focusMeta && (
          <div
            className="flex flex-wrap items-center justify-between gap-4 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] py-4 pl-5 pr-4 shadow-sm"
            style={{ borderLeft: `3px solid ${tone.accent}` }}
          >
            <div className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden="true"
                className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                style={{ background: tone.soft, color: tone.accent }}
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 5h16l-6.4 8v5.5L10.4 21v-8L4 5Z" />
                </svg>
              </span>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: tone.accent }}>
                  {focusMeta.label}
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {focusMeta.hint}. Showing {totalCount} {totalCount === 1 ? "student" : "students"} of the whole roster,
                  highlighted below.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={clearFocus}
              className="shrink-0 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--surface-soft)]"
            >
              Clear focus
            </button>
          </div>
        )}

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
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                <label htmlFor="branchFilter" className="block text-sm font-semibold text-[var(--muted)]">Branch</label>
                <select
                  id="branchFilter"
                  value={filterBranchId}
                  onChange={(event) => {
                    setFilterBranchId(event.target.value);
                    setPage(1);
                  }}
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
                  onChange={(event) => {
                    setFilterTutorId(event.target.value);
                    setPage(1);
                  }}
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
                  onChange={(event) => {
                    setFilterLevel(event.target.value);
                    setPage(1);
                  }}
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
                  onChange={(event) => {
                    setFilterBatch(event.target.value);
                    setPage(1);
                  }}
                  className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="">All batches</option>
                  {['January','February','March','April','May','June','July','August','September','October','November','December'].map((month) => (
                    <option key={month} value={month}>{month}</option>
                  ))}
                </select>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                <label htmlFor="classTypeFilter" className="block text-sm font-semibold text-[var(--muted)]">Membership</label>
                <select
                  id="classTypeFilter"
                  value={filterClassType}
                  onChange={(event) => {
                    setFilterClassType(event.target.value);
                    setPage(1);
                  }}
                  className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="">All memberships</option>
                  <option value="group">Group class</option>
                  <option value="private">Private membership</option>
                </select>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                <label htmlFor="sessionSlotFilter" className="block text-sm font-semibold text-[var(--muted)]">Session</label>
                <select
                  id="sessionSlotFilter"
                  value={filterSessionSlot}
                  onChange={(event) => {
                    setFilterSessionSlot(event.target.value);
                    setPage(1);
                  }}
                  className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="">All sittings</option>
                  {TIME_SLOTS.map((slot) => (
                    <option key={slot} value={slot}>{SLOT_DEFAULTS[slot].label}</option>
                  ))}
                </select>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                <label htmlFor="statusFilter" className="block text-sm font-semibold text-[var(--muted)]">Status</label>
                <select
                  id="statusFilter"
                  value={filterStatus}
                  onChange={(event) => {
                    setFilterStatus(event.target.value);
                    setPage(1);
                  }}
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
                  onChange={(event) => {
                    setFilterPaymentStatus(event.target.value);
                    setPage(1);
                  }}
                  className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="">All payments</option>
                  <option value="pending">Pending</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
            </div>
            <div className="flex items-end justify-end gap-2">
              {/* One at a time here; a whole cohort at once through the
                  importer, which is the launch-day case. */}
              <Link
                href="/admin/students/import"
                className="rounded-lg border border-[var(--border)] px-4 py-3 text-sm font-semibold text-[var(--foreground)]"
              >
                Import many
              </Link>
              <button
                type="button"
                className="rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white"
                onClick={() => setShowStudentForm((current) => !current)}
              >
                {showStudentForm ? "Close form" : "Add student"}
              </button>
              {/* The switchover tool: clear the whole roster in one deliberate,
                  restorable action. Super admin only — the server enforces it
                  too. */}
              {adminRole === "super" ? (
                <button
                  type="button"
                  className="rounded-lg border border-red-500 px-4 py-3 text-sm font-semibold text-red-600"
                  onClick={() => { setResetPhrase(""); setShowResetModal(true); }}
                >
                  Reset roster
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {showResetModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md space-y-4 rounded-3xl border border-red-300 bg-[var(--surface)] p-6 shadow-xl">
              <h2 className="text-xl font-bold text-red-600">Reset the student roster</h2>
              <p className="text-sm text-[var(--foreground-soft)]">
                This removes <strong>every student currently in the LMS</strong>
                {totalCount ? <> — <strong>{totalCount}</strong> right now</> : null}. They stop being able to sign
                in immediately. Every one of them can be restored from{" "}
                <span className="font-semibold">Security → Audit trail</span> afterwards.
              </p>
              <p className="text-sm text-[var(--muted)]">Type <span className="font-mono font-bold">RESET STUDENTS</span> to confirm.</p>
              <input
                value={resetPhrase}
                onChange={(event) => setResetPhrase(event.target.value)}
                placeholder="RESET STUDENTS"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              />
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => { setShowResetModal(false); setResetPhrase(""); }}
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={resetPhrase !== "RESET STUDENTS" || resetting}
                  onClick={handleResetRoster}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {resetting ? "Removing…" : "Remove all students"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Sits beside the one-at-a-time form on purpose: the moment somebody
            realises they have fourteen students to add is the moment they are
            looking at this page, not hunting for an importer in the sidebar. */}
        <BulkStudentAdd branches={branches} onImported={loadStudents} />

        {savedCredentials ? (
          <div className="space-y-3 rounded-3xl border border-emerald-300 bg-emerald-50 px-6 py-4 text-sm text-emerald-800">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p>
                <strong>{savedCredentials.name}</strong> was added
                {savedCredentials.studentCode ? ` — ${savedCredentials.studentCode}` : ""}. Login — email:{" "}
                <span className="font-mono">{savedCredentials.email}</span>, password:{" "}
                <span className="font-mono">{savedCredentials.password}</span>
              </p>
              <button
                type="button"
                onClick={() => {
                  setSavedCredentials(null);
                  setSendCredsState("idle");
                }}
                className="rounded-lg border border-emerald-300 px-3 py-1.5 text-xs font-semibold text-emerald-800"
              >
                Dismiss
              </button>
            </div>
            {/* The credentials stay on screen either way — this is only about
                whether the student also gets them by email right now. */}
            <div className="flex flex-wrap items-center gap-3 border-t border-emerald-200 pt-3">
              {sendCredsState === "sent" ? (
                <p className="font-semibold">Their login details have been emailed to them.</p>
              ) : sendCredsState === "error" ? (
                <>
                  <p className="font-semibold text-amber-700">Could not send that email — try again, or hand the login over directly.</p>
                  <button
                    type="button"
                    onClick={() => void sendSavedCredentials()}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Retry
                  </button>
                </>
              ) : (
                <>
                  <p>Send {savedCredentials.name.split(" ")[0]} their login details by email now?</p>
                  <button
                    type="button"
                    disabled={sendCredsState === "sending"}
                    onClick={() => void sendSavedCredentials()}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    {sendCredsState === "sending" ? "Sending…" : "Yes, email it now"}
                  </button>
                </>
              )}
            </div>
          </div>
        ) : null}

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
                <span className="font-semibold text-[var(--muted)]">Phone</span>
                <input
                  value={newPhone}
                  onChange={(event) => setNewPhone(event.target.value)}
                  placeholder="e.g. 0812 345 6789"
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">
                  {editingStudentId ? "New password" : "Password"}
                </span>
                <PasswordInput
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder={editingStudentId ? "Leave blank to keep the current one" : "Leave blank to auto-generate one"}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
                <span className="block text-xs font-normal text-[var(--muted)]">
                  {editingStudentId
                    ? "Only set this if you want to change their password — it is left alone otherwise."
                    : "Leave this empty and a readable temporary password is generated automatically."}
                </span>
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
                <span className="font-semibold text-[var(--muted)]">Batch month</span>
                <select
                  value={newBatch}
                  onChange={(event) => setNewBatch(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="">No batch set</option>
                  {BATCH_MONTHS.map((month) => (
                    <option key={month} value={month}>{month}</option>
                  ))}
                </select>
                <span className="block text-xs font-normal text-[var(--muted)]">
                  The month this student&apos;s level started. The timetable and the level-end date are
                  worked out from it — without it neither exists and they never auto-promote.
                </span>
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Pathway</span>
                <select
                  value={newPathway}
                  onChange={(event) => setNewPathway(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  {addStudentPathwayOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
                <span className="block text-xs font-normal text-[var(--muted)]">
                  What Germany is for. Drives the study plan and the goal shown on their journey — the
                  same choice the signup form asks new students to make.
                </span>
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
              {/* The state behind this field existed and was posted with every
                  save; the control itself was never rendered, so the form
                  quietly sent whatever it had loaded and no tutor could be set
                  from here at all. */}
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Tutor</span>
                <select
                  value={newTutorId}
                  onChange={(event) => setNewTutorId(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="">No tutor assigned</option>
                  {lecturers.map((lecturer) => (
                    <option key={lecturer.id} value={lecturer.id}>
                      {lecturer.user.name || lecturer.user.email}
                    </option>
                  ))}
                </select>
                <span className="block text-xs font-normal text-[var(--muted)]">
                  Naming a tutor here puts this student on that tutor&apos;s roster, register and gradebook whatever
                  their class assignment says. Leave it empty and the student is found by branch, level and sitting.
                </span>
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
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Session</span>
                <select
                  value={newSessionSlot}
                  onChange={(event) => setNewSessionSlot(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="morning">Morning</option>
                  <option value="afternoon">Afternoon</option>
                  <option value="evening">Evening</option>
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Class type</span>
                <select
                  value={newClassType}
                  onChange={(event) => setNewClassType(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="group">Group class</option>
                  <option value="private">Private (one-to-one)</option>
                </select>
                {newClassType === "private" && (
                  <span className="block text-xs font-normal text-[var(--muted)]">
                    Private students follow no group timetable. Their calendar comes only from
                    sessions booked on the tutor&apos;s Private classes page.
                  </span>
                )}
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Delivery mode</span>
                {isOnlineBranchName(branches.find((branch) => branch.id === newBranchId)?.name) ? (
                  <div className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--muted)]">
                    Online — set automatically by the Online branch
                  </div>
                ) : (
                  <select
                    value={newDeliveryMode}
                    onChange={(event) => setNewDeliveryMode(event.target.value)}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                  >
                    <option value="physical">On campus only</option>
                    <option value="hybrid">On campus + live video (hybrid)</option>
                  </select>
                )}
                <span className="block text-xs font-normal text-[var(--muted)]">
                  Decides whether &quot;Live class&quot; shows up in this student&apos;s sidebar. For a
                  fully online student, pick the <span className="font-semibold">Online</span> branch above —
                  that switches this to Online on its own.
                </span>
              </label>
              {!editingStudentId ? (
                <label className="space-y-2 text-sm">
                  <span className="font-semibold text-[var(--muted)]">Amount already paid (₦)</span>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    inputMode="numeric"
                    value={newAmountPaid}
                    onChange={(event) => setNewAmountPaid(event.target.value)}
                    placeholder="e.g. 150000"
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                  />
                  <span className="block text-xs font-normal text-[var(--muted)]">
                    For a student who paid before joining the portal. Records a completed payment so the
                    paywall does not lock them out of a level they have already paid for. Leave blank for none.
                  </span>
                </label>
              ) : null}
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
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-semibold text-[var(--foreground-soft)]"
                >
                  Cancel
                </button>
              ) : null}
              {studentError ? <p className="text-sm text-red-500">{studentError}</p> : null}
            </div>
          </div>
        ) : null}

        {deleteFeedback ? (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <span>{deleteFeedback}</span>
            <button type="button" onClick={() => setDeleteFeedback("")} className="rounded-lg border border-emerald-300 px-3 py-1.5 text-xs font-semibold">Dismiss</button>
          </div>
        ) : null}

        {selectedStudentIds.size > 0 || selectAllMatching ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            <div className="flex flex-wrap items-center gap-2">
              <span>
                {selectAllMatching
                  ? `All ${totalCount} student${totalCount === 1 ? "" : "s"} matching the current filters are selected`
                  : `${selectedStudentIds.size} student${selectedStudentIds.size === 1 ? "" : "s"} selected`}
              </span>
              {/* Every visible row ticked but there are more pages behind the
                  filter — offer the whole matching set, Gmail-style. */}
              {!selectAllMatching &&
              students.length > 0 &&
              students.every((student) => selectedStudentIds.has(student.id)) &&
              totalCount > students.length ? (
                <button
                  type="button"
                  onClick={() => setSelectAllMatching(true)}
                  className="rounded-lg border border-red-400 px-3 py-1.5 text-xs font-semibold underline-offset-2 hover:underline"
                >
                  Select all {totalCount} matching
                </button>
              ) : null}
              {selectAllMatching ? (
                <button
                  type="button"
                  onClick={() => { setSelectAllMatching(false); setSelectedStudentIds(new Set()); }}
                  className="rounded-lg border border-red-400 px-3 py-1.5 text-xs font-semibold"
                >
                  Clear selection
                </button>
              ) : null}
            </div>
            <button type="button" onClick={handleDeleteSelectedStudents} className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white">
              {selectAllMatching ? `Remove all ${totalCount}` : "Delete selected"}
            </button>
          </div>
        ) : null}
        <div className="overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--background)] shadow-sm">
          <div className="w-full overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--border)]">
            <thead className="bg-[var(--surface)] text-left text-sm uppercase tracking-[0.16em] text-[var(--muted)]">
              <tr>
                <th className="px-6 py-4"><input type="checkbox" aria-label="Select all visible students" checked={students.length > 0 && students.every((student) => selectedStudentIds.has(student.id))} onChange={(event) => { setSelectAllMatching(false); setSelectedStudentIds(event.target.checked ? new Set(students.map((student) => student.id)) : new Set()); }} /></th>
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Email</th>
                <th className="px-6 py-4">Branch</th>
                <th className="px-6 py-4">Starting class</th>
                <th className="px-6 py-4">Batch</th>
                {/* What the student said Germany is FOR. It is the single most
                    useful thing about them at a front desk — the conversation
                    with somebody chasing an Ausbildung place is not the
                    conversation with somebody joining a spouse — and until now
                    it lived only inside the student's own journey map. */}
                <th className="px-6 py-4">Goal</th>
                {/* Who teaches them. It was on the filter bar but nowhere in
                    the list, so the office could ask for one tutor's students
                    and still not see, for any given student, whose they were. */}
                <th className="px-6 py-4">Tutor</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Payment</th>
                <th className="px-6 py-4">Balance</th>
                <th className="px-6 py-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] bg-[var(--background)]">
              {loading ? (
                <tr>
                  <td colSpan={12} className="px-6 py-10 text-center text-sm text-[var(--muted)]">Loading students…</td>
                </tr>
              ) : students.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-6 py-10 text-center text-sm text-[var(--muted)]">No students found yet.</td>
                </tr>
              ) : (
                students.map((student) => {
                  const highlighted = isHighlighted(student.id);
                  const isPrivateMember = student.classType === "private";
                  const money = (student as unknown as { _finance?: StudentFinanceRow })._finance;
                  return (
                  <tr
                    key={student.id}
                    className={
                      highlighted
                        ? `relative ${tone.row} before:absolute before:inset-y-0 before:left-0 before:w-[3px] ${tone.bar}`
                        : undefined
                    }
                  >
                    <td className="px-6 py-4"><input type="checkbox" aria-label={`Select ${student.user.name || student.user.email}`} checked={selectAllMatching || selectedStudentIds.has(student.id)} onChange={(event) => { setSelectAllMatching(false); setSelectedStudentIds((current) => { const next = new Set(current); if (event.target.checked) next.add(student.id); else next.delete(student.id); return next; }); }} /></td>
                    {/* The name is the way into the person's file. It was plain
                        text, so the only thing a row could do was be edited —
                        the roster could tell you a student existed and nothing
                        else about them. */}
                    <td className="px-6 py-4">
                      <Link
                        href={`/admin/students/${student.id}`}
                        className={`underline-offset-4 hover:underline ${
                          highlighted ? "font-bold" : "font-semibold hover:text-[var(--accent)]"
                        }`}
                      >
                        {student.user.name}
                      </Link>
                      {isPrivateMember ? (
                        <span
                          title="Private membership"
                          className="ml-2 inline-flex items-center gap-1 rounded-full border border-[#D4AF37]/50 bg-[#D4AF37]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#8A6914]"
                        >
                          <span aria-hidden="true">★</span>
                          Private membership
                        </span>
                      ) : null}
                      {highlighted && money && (
                        <p className={`mt-0.5 text-xs font-semibold ${tone.text}`}>
                          {money.daysEnrolled}d enrolled
                          {canSeeMoney && money.owedOnDeposit != null && money.owedOnDeposit > 0
                            ? ` · ₦${money.owedOnDeposit.toLocaleString("en-NG")} short of deposit`
                            : ""}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4">{student.user.email}</td>
                    <td className="px-6 py-4">{student.branch?.name || "—"}</td>
                    <td className="px-6 py-4">{student.admission && typeof student.admission === "object" && (student.admission as any).classApplied ? String((student.admission as any).classApplied) : (student.level || "—")}</td>
                    <td className="px-6 py-4">{typeof student.admission === "object" && student.admission && !Array.isArray(student.admission) && (student.admission as Record<string, unknown>).batch ? String((student.admission as Record<string, unknown>).batch) : "—"}</td>
                    <td className="px-6 py-4">
                      {student.germanyGoal ? (
                        <span
                          className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-ink)]"
                          title={student.germanyGoalNote ?? undefined}
                        >
                          {goalFor(student.germanyGoal).label.replace(/^I am (going )?/i, "")}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">Not asked yet</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <select
                        aria-label={`Tutor for ${student.user.name || student.user.email}`}
                        value={student.tutor?.id || ""}
                        disabled={savingTutorFor === student.id}
                        onChange={(event) => changeTutor(student.id, event.target.value)}
                        className={`w-44 rounded-lg border px-2 py-1.5 text-xs ${
                          student.tutor
                            ? "border-[var(--border)] bg-[var(--background)]"
                            : "border-amber-300 bg-amber-50 text-amber-800"
                        }`}
                      >
                        {/* "No tutor" is a real state and is worth looking
                            wrong: a student nobody teaches will not appear on
                            any register until somebody notices. */}
                        <option value="">No tutor</option>
                        {/* The student's own tutor is listed first and
                            unconditionally. The tutor list and the student list
                            are two separate fetches, and a select holding a
                            value none of its options match renders as the first
                            one — which would read "No tutor" in amber for a
                            student who has one. */}
                        {(student.tutor &&
                        !lecturers.some((lecturer) => lecturer.id === student.tutor?.id)
                          ? [
                              {
                                id: student.tutor.id,
                                user: { name: student.tutor.user?.name, email: student.tutor.user?.email ?? "" },
                              },
                              ...lecturers,
                            ]
                          : lecturers
                        ).map((lecturer) => (
                          <option key={lecturer.id} value={lecturer.id}>
                            {lecturer.user.name || lecturer.user.email}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-6 py-4">{student.status || "active"}</td>
                    {/* The cohort, not the status of whichever transaction
                        happened to be most recent — a student whose last
                        payment failed reads as "failed" here while being paid
                        in full, which is the opposite of what the office needs
                        to know. */}
                    <td className="px-6 py-4">
                      {money ? (
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            money.cohort === "full_paid"
                              ? "bg-emerald-100 text-emerald-700"
                              : money.cohort === "deposit_paid"
                              ? "bg-sky-100 text-sky-700"
                              : money.cohort === "registered_only"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {money.cohort === "full_paid"
                            ? "Paid in full"
                            : money.cohort === "deposit_paid"
                            ? "Deposit paid"
                            : money.cohort === "registered_only"
                            ? "Part paid"
                            : "Nothing paid"}
                        </span>
                      ) : (
                        student.payments?.[0]?.status || "none"
                      )}
                    </td>
                    {/* Priced off the fee table, like every other outstanding
                        figure in the portal. It used to be invoiced-minus-paid,
                        which reads ₦0 for a student who never had an invoice
                        raised — that is, for most of the people who owe money. */}
                    <td className={`px-6 py-4 font-semibold ${highlighted ? tone.text : ""}`}>
                      {!canSeeMoney
                        ? "—"
                        : money?.owed != null
                        ? `₦${money.owed.toLocaleString("en-NG")}`
                        : "—"}
                    </td>
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
                      <button
                        className="rounded-lg border border-red-500 text-red-600 px-3 py-2 text-sm"
                        onClick={() => handleDeleteStudent(student.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
            </table>
          </div>
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

export default function AdminStudentsPage() {
  // `useSearchParams` needs a Suspense boundary above it, or the whole route
  // opts out of static rendering and the build fails.
  return (
    <Suspense
      fallback={
        <AdminShell>
          <p className="p-6 text-sm text-[var(--muted)]">Loading the roster…</p>
        </AdminShell>
      }
    >
      <StudentsRoster />
    </Suspense>
  );
}
