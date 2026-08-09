"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";

import AdminShell from "@/components/AdminShell";
import {
  AlertIcon,
  AttendanceIcon,
  CertificateIcon,
  CheckCircleIcon,
  ClockIcon,
  CrossCircleIcon,
  LockIcon,
  MailIcon,
  MapIcon,
  PulseIcon,
  ResultsIcon,
  ShieldIcon,
  UnlockIcon,
  WalletIcon,
} from "@/components/icons";

/**
 * One student's file.
 *
 * WHAT THIS REPLACES. A row in a table, and a modal that printed the raw
 * admission JSON with the keys prettified. Everything else the school knew
 * about a person — whether they had paid, whether they were turning up,
 * whether they were passing, whether our email to them had bounced — lived on
 * a different screen or on no screen at all.
 *
 * IT REFRESHES ITSELF. A file that goes stale the moment it is opened is a
 * screenshot. This re-reads every 20 seconds and says plainly, in the header,
 * when it last did — so an admin on the phone to a student who is paying right
 * now watches the padlock open rather than wondering whether to hit reload.
 * Paused when the tab is hidden: a file left open on a second monitor
 * overnight should not be four thousand queries by morning.
 *
 * WHAT IT DELIBERATELY DOES NOT SHOW. The uploaded ID documents. The dossier
 * surfaces the fact that an ID was provided and its file name, because "did
 * this person supply ID" is an admissions question; the scan itself is not
 * something the front desk needs on screen to answer a phone call, and putting
 * it one click from the roster is how a passport ends up on a shared monitor.
 * The passport photo IS shown — recognising the person is the point of a file.
 */

type Dossier = {
  generatedAt: string;
  viewer: { adminRole: string; canSeeMoney: boolean };
  identity: {
    id: string;
    studentCode: string | null;
    name: string;
    email: string | null;
    phone: string | null;
    photoUrl: string | null;
    status: string;
    level: string;
    sessionSlot: string;
    classType: string;
    deliveryMode: string;
    pathway: string;
    outcome: string;
    examReadiness: number;
    branch: { id: string; name: string; mode: string; location: string | null } | null;
    tutor: { id: string; name: string; email: string | null; status: string } | null;
    registeredAt: string;
    updatedAt: string;
    daysEnrolled: number;
    graduationDate: string | null;
  };
  account: {
    userId: string | null;
    twoFactorOn: boolean;
    passwordClaimed: boolean;
    accountCreatedAt: string | null;
    welcomeTourSeenAt: string | null;
    lastJourneySeenAt: string | null;
  };
  origin: { source: string; status: string; enquiredAt: string; notes: string | null } | null;
  money: {
    paywall: "unpaid" | "registeredOnly" | "depositPaid" | "fullPaid";
    lockedOut: boolean;
    fee?: number;
    deposit?: number;
    paid?: number;
    owed?: number;
    payments?: Array<{
      id: string;
      amount: number;
      currency: string;
      status: string;
      method: string;
      description: string | null;
      createdAt: string;
    }>;
  };
  attendance: {
    total: number;
    attended: number;
    rate: number | null;
    last30: { total: number; attended: number; rate: number | null };
    recent: Array<{ id: string; date: string; status: string; present: boolean; notes: string | null }>;
  };
  academics: {
    averageScore: number | null;
    grades: Array<{ id: string; type: string; score: number; grade: string | null; createdAt: string }>;
    submissions: Array<{ id: string; title: string; score: number | null; createdAt: string }>;
    examRegistrations: Array<{ id: string; status: string; createdAt: string }>;
    certificates: Array<{
      id: string;
      kind: string;
      level: string;
      award: string;
      serial: string;
      passed: boolean;
      createdAt: string;
    }>;
  };
  journey: {
    classesStartedAt: string | null;
    startConfirmedAt: string | null;
    startConfirmedVia: string | null;
    notStartedCount: number;
    notStartedReason: string | null;
    levelCompletedAt: string | null;
    levelCompletedFor: string | null;
    germanyGoal: string | null;
    germanyGoalNote: string | null;
    events: Array<{
      id: string;
      type: string;
      stage: string | null;
      label: string;
      detail: string | null;
      source: string;
      occurredAt: string;
    }>;
  };
  engagement: {
    videos: Array<{ id: string; title: string; completed: boolean; positionSeconds: number; updatedAt: string }>;
    notifications: Array<{ id: string; title: string; message: string; createdAt: string }>;
  };
  email: {
    queued: number;
    log: Array<{
      id: string;
      type: string;
      subject: string;
      status: string;
      errorMessage: string | null;
      createdAt: string;
    }>;
  };
  admissionEntries: Array<{ key: string; value: string }>;
};

const PAYWALL_LABEL: Record<Dossier["money"]["paywall"], string> = {
  unpaid: "Nothing paid",
  registeredOnly: "Registered only — below deposit",
  depositPaid: "Deposit paid",
  fullPaid: "Paid in full",
};

const ADMISSION_LABELS: Record<string, string> = {
  dob: "Date of birth",
  bloodGroup: "Blood group",
  motherTongue: "Mother tongue",
  birthPlace: "Place of birth",
  idNumber: "ID number",
  idProofFileName: "ID document",
  photoFileName: "Photo file",
  parentIdProofFileName: "Parent ID document",
  prevSchoolName: "Previous school",
  prevSchoolAddress: "Previous school address",
  prevSchoolClass: "Previous class",
  prevPassoutYear: "Year left",
  studentType: "Student type",
  classApplied: "Class applied for",
  fatherName: "Father",
  fatherPhone: "Father's phone",
  fatherOccupation: "Father's occupation",
  motherName: "Mother",
  motherPhone: "Mother's phone",
  motherOccupation: "Mother's occupation",
  emergencyContactName: "Emergency contact",
  emergencyContactInfo: "Emergency number",
  allowParentLogin: "Parent login allowed",
  transportRoute: "Transport route",
  heardFrom: "Heard about us via",
};

function labelFor(key: string) {
  return (
    ADMISSION_LABELS[key] ??
    key
      .replace(/([A-Z])/g, " $1")
      .replace(/_/g, " ")
      .replace(/^./, (character) => character.toUpperCase())
  );
}

function naira(value: number) {
  return `₦${value.toLocaleString("en-NG")}`;
}

function when(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function timeAgo(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-3xl border border-[var(--border)] bg-white/80 p-6 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--foreground)]">{title}</h2>
        {hint && <p className="text-xs text-[var(--muted)]">{hint}</p>}
      </div>
      <div className="mt-5">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-[var(--foreground)]">{value || "—"}</p>
    </div>
  );
}

/** A number with its own headline. Used for the four vitals under the header. */
function Vital({
  icon,
  label,
  value,
  sub,
  tone = "neutral",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneClass = {
    neutral: "text-[var(--foreground)]",
    good: "text-emerald-600",
    warn: "text-amber-600",
    bad: "text-red-600",
  }[tone];

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white/80 p-4">
      <div className="flex items-center gap-2 text-[var(--muted)]">
        <span className="text-[var(--accent)]">{icon}</span>
        <p className="text-[10px] font-bold uppercase tracking-[0.16em]">{label}</p>
      </div>
      <p className={`mt-2 text-2xl font-black tracking-tight ${toneClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-[var(--muted)]">{sub}</p>}
    </div>
  );
}

export default function StudentDossierPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const [data, setData] = useState<Dossier | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (showSpinner = true) => {
      if (!id) return;
      if (showSpinner) setLoading(true);
      try {
        const response = await fetch(`/api/admin/students/${id}/dossier`, { cache: "no-store" });
        if (response.status === 404) throw new Error("No student with that id. They may have been removed.");
        if (response.status === 403) throw new Error("You do not have permission to open student files.");
        if (!response.ok) throw new Error("Could not load this student's file");
        setData(await response.json());
        setError(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Could not load this student's file");
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * The live part. Twenty seconds is slow enough to be free and fast enough
   * that a payment taken at the desk shows up before the conversation ends.
   *
   * `visibilitychange` matters more than the interval does — without it a file
   * left open in a background tab keeps polling all night, which is the sort
   * of thing that gets noticed on a database bill rather than in testing.
   */
  useEffect(() => {
    if (!id) return;
    const tick = () => {
      if (document.visibilityState === "visible") void load(false);
    };
    const timer = window.setInterval(tick, 20_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [id, load]);

  if (error && !data) {
    return (
      <AdminShell>
        <div className="rounded-3xl border border-red-300 bg-red-50 p-6 text-sm text-red-700">
          <p className="font-bold">{error}</p>
          <div className="mt-4 flex gap-3">
            <button type="button" onClick={() => void load()} className="font-bold underline">
              Retry
            </button>
            <Link href="/admin/students" className="font-bold underline">
              Back to the roster
            </Link>
          </div>
        </div>
      </AdminShell>
    );
  }

  if (!data) {
    return (
      <AdminShell>
        <p className="text-sm text-[var(--muted)]">{loading ? "Opening the file…" : "Nothing to show."}</p>
      </AdminShell>
    );
  }

  const { identity, money, attendance, academics, journey, engagement, account, origin, email } = data;
  const failedEmail = email.log.filter((entry) => entry.status !== "sent").length;

  return (
    <AdminShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="text-sm font-semibold text-[var(--muted)] transition hover:text-[var(--foreground)]"
          >
            ← Back
          </button>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Live · refreshed {timeAgo(data.generatedAt)}
            </span>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold transition hover:bg-white"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* ---- Header ---------------------------------------------------- */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="overflow-hidden rounded-3xl border border-[var(--border)] bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 p-6 text-white shadow-lg sm:p-8"
        >
          <div className="flex flex-wrap items-start gap-6">
            <div className="relative">
              {identity.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={identity.photoUrl}
                  alt={identity.name}
                  className="h-28 w-28 rounded-2xl border-2 border-white/20 object-cover"
                />
              ) : (
                <div className="flex h-28 w-28 items-center justify-center rounded-2xl border-2 border-dashed border-white/25 text-3xl font-black text-white/40">
                  {identity.name.slice(0, 1).toUpperCase()}
                </div>
              )}
              <span
                className={`absolute -bottom-2 -right-2 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                  identity.status === "active"
                    ? "bg-emerald-500 text-white"
                    : identity.status === "graduated"
                      ? "bg-sky-500 text-white"
                      : "bg-slate-500 text-white"
                }`}
              >
                {identity.status}
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <p className="font-mono text-xs tracking-[0.2em] text-white/50">
                {identity.studentCode ?? "NO STUDENT ID ISSUED"}
              </p>
              <h1 className="mt-1 text-3xl font-black tracking-tight">{identity.name}</h1>
              <p className="mt-1 text-sm text-white/70">
                {identity.email}
                {identity.phone ? ` · ${identity.phone}` : ""}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  identity.level,
                  identity.sessionSlot,
                  identity.classType === "private" ? "Private" : "Group",
                  identity.deliveryMode,
                  identity.branch?.name ?? "No branch",
                ].map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold capitalize"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>

            {/* The padlock. Shown to every admin, priced only for some. */}
            <div
              className={`rounded-2xl border px-5 py-4 ${
                money.lockedOut ? "border-red-400/40 bg-red-500/10" : "border-emerald-400/40 bg-emerald-500/10"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={money.lockedOut ? "text-red-300" : "text-emerald-300"}>
                  {money.lockedOut ? <LockIcon /> : <UnlockIcon />}
                </span>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/70">
                  {money.lockedOut ? "Portal locked" : "Portal open"}
                </p>
              </div>
              <p className="mt-2 text-sm font-bold">{PAYWALL_LABEL[money.paywall]}</p>
              {data.viewer.canSeeMoney && money.owed !== undefined && (
                <p className="mt-0.5 text-xs text-white/60">
                  {money.owed > 0 ? `${naira(money.owed)} outstanding` : "Nothing outstanding"}
                </p>
              )}
            </div>
          </div>
        </motion.div>

        {/* ---- Vitals ---------------------------------------------------- */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Vital
            icon={<AttendanceIcon />}
            label="Attendance"
            value={attendance.rate === null ? "No record" : `${attendance.rate}%`}
            sub={
              attendance.total === 0
                ? "Never marked on a register"
                : `${attendance.attended}/${attendance.total} sessions · ${
                    attendance.last30.rate === null ? "none in 30 days" : `${attendance.last30.rate}% last 30 days`
                  }`
            }
            tone={
              attendance.rate === null ? "neutral" : attendance.rate >= 75 ? "good" : attendance.rate >= 50 ? "warn" : "bad"
            }
          />
          <Vital
            icon={<ResultsIcon />}
            label="Average score"
            value={academics.averageScore === null ? "Unscored" : `${academics.averageScore}`}
            sub={`${academics.grades.length} graded · ${academics.submissions.length} submissions`}
            tone={
              academics.averageScore === null
                ? "neutral"
                : academics.averageScore >= 70
                  ? "good"
                  : academics.averageScore >= 50
                    ? "warn"
                    : "bad"
            }
          />
          <Vital
            icon={<WalletIcon />}
            label="Tuition"
            value={
              data.viewer.canSeeMoney && money.paid !== undefined ? naira(money.paid) : PAYWALL_LABEL[money.paywall]
            }
            sub={
              data.viewer.canSeeMoney && money.fee !== undefined
                ? `of ${naira(money.fee)} · deposit ${naira(money.deposit ?? 0)}`
                : "Amounts are restricted to the payments role"
            }
            tone={money.lockedOut ? "bad" : money.paywall === "fullPaid" ? "good" : "warn"}
          />
          <Vital
            icon={<ClockIcon />}
            label="With the school"
            value={`${identity.daysEnrolled}d`}
            sub={`Registered ${when(identity.registeredAt)}${
              journey.classesStartedAt ? ` · started ${when(journey.classesStartedAt)}` : " · not started yet"
            }`}
            tone={!journey.classesStartedAt && identity.daysEnrolled > 21 ? "warn" : "neutral"}
          />
        </div>

        {/* Deliverability warning, because this is the failure nobody sees. */}
        {(failedEmail > 0 || email.queued > 0) && (
          <div className="flex flex-wrap items-center gap-3 rounded-3xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
            <span className="text-amber-600">
              <AlertIcon />
            </span>
            <p>
              <strong>Email to this student is not all getting through.</strong>{" "}
              {failedEmail > 0 && `${failedEmail} of the last ${email.log.length} attempts did not send. `}
              {email.queued > 0 && `${email.queued} message${email.queued === 1 ? "" : "s"} still sitting in the queue.`}
            </p>
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-2">
          {/* ---- Who they are ------------------------------------------- */}
          <Card title="Registration" hint={`Updated ${timeAgo(identity.updatedAt)}`}>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <Field label="Student ID" value={identity.studentCode ?? "Not issued"} />
              <Field label="Level" value={identity.level} />
              <Field label="Session" value={<span className="capitalize">{identity.sessionSlot}</span>} />
              <Field label="Class type" value={identity.classType === "private" ? "Private" : "Group"} />
              <Field label="Attending" value={<span className="capitalize">{identity.deliveryMode}</span>} />
              <Field
                label="Branch"
                value={
                  identity.branch
                    ? `${identity.branch.name}${identity.branch.location ? ` · ${identity.branch.location}` : ""}`
                    : "None selected"
                }
              />
              <Field label="Pathway" value={identity.pathway} />
              <Field
                label="Tutor"
                value={
                  identity.tutor
                    ? `${identity.tutor.name}${
                        identity.tutor.status && identity.tutor.status !== "active"
                          ? ` (${identity.tutor.status.replace("_", " ")})`
                          : ""
                      }`
                    : "Not assigned"
                }
              />
              <Field label="Exam readiness" value={`${identity.examReadiness}%`} />
              <Field label="Registered" value={when(identity.registeredAt)} />
              <Field label="Graduated" value={when(identity.graduationDate)} />
              <Field
                label="Came from"
                value={origin ? `${origin.source} enquiry · ${when(origin.enquiredAt)}` : "Direct signup"}
              />
            </div>
            <p className="mt-5 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
              Goal: {identity.outcome}
            </p>
          </Card>

          {/* ---- Money --------------------------------------------------- */}
          <Card
            title="Payments"
            hint={data.viewer.canSeeMoney ? `${money.payments?.length ?? 0} transactions` : "Restricted"}
          >
            {!data.viewer.canSeeMoney ? (
              <div className="flex items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/40 p-4 text-sm text-[var(--muted)]">
                <span className="text-[var(--muted)]">
                  <ShieldIcon />
                </span>
                <p>
                  Amounts are visible only to an admin with the payments capability. You can still see that this student
                  is <strong>{PAYWALL_LABEL[money.paywall].toLowerCase()}</strong>, which is what decides whether their
                  portal is locked.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4">
                  <Field label="Tuition" value={naira(money.fee ?? 0)} />
                  <Field label="Paid" value={naira(money.paid ?? 0)} />
                  <Field
                    label="Outstanding"
                    value={
                      <span className={(money.owed ?? 0) > 0 ? "text-red-600" : "text-emerald-600"}>
                        {naira(money.owed ?? 0)}
                      </span>
                    }
                  />
                </div>
                <div className="mt-5 space-y-2">
                  {(money.payments ?? []).length === 0 && (
                    <p className="text-sm text-[var(--muted)]">No payment has ever been recorded for this student.</p>
                  )}
                  {(money.payments ?? []).map((payment) => (
                    <div
                      key={payment.id}
                      className="flex items-center justify-between gap-3 border-b border-[var(--border)]/60 pb-2 last:border-0"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{naira(payment.amount)}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {payment.method} · {when(payment.createdAt)}
                          {payment.description ? ` · ${payment.description}` : ""}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                          payment.status === "completed"
                            ? "bg-emerald-100 text-emerald-700"
                            : payment.status === "pending"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-red-100 text-red-700"
                        }`}
                      >
                        {payment.status}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>

          {/* ---- Attendance ---------------------------------------------- */}
          <Card title="Attendance" hint={`Last ${attendance.recent.length} sessions`}>
            {attendance.recent.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                This student has never appeared on a register. If their class has started, that is worth a phone call.
              </p>
            ) : (
              <div className="space-y-2">
                {attendance.recent.map((record) => (
                  <div
                    key={record.id}
                    className="flex items-center justify-between gap-3 border-b border-[var(--border)]/60 pb-2 last:border-0"
                  >
                    <p className="text-sm">{when(record.date)}</p>
                    <div className="flex items-center gap-2">
                      {record.notes && <span className="text-xs text-[var(--muted)]">{record.notes}</span>}
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                          record.status === "present"
                            ? "bg-emerald-100 text-emerald-700"
                            : record.status === "late"
                              ? "bg-amber-100 text-amber-700"
                              : record.status === "excused"
                                ? "bg-sky-100 text-sky-700"
                                : "bg-red-100 text-red-700"
                        }`}
                      >
                        {record.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* ---- Academics ------------------------------------------------ */}
          <Card title="Results" hint={`${academics.certificates.length} certificates`}>
            <div className="space-y-4">
              {academics.grades.length === 0 && academics.submissions.length === 0 && (
                <p className="text-sm text-[var(--muted)]">Nothing has been graded or submitted yet.</p>
              )}

              {academics.grades.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Grades</p>
                  <div className="mt-2 space-y-1.5">
                    {academics.grades.slice(0, 8).map((grade) => (
                      <div key={grade.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="capitalize text-[var(--muted)]">{grade.type}</span>
                        <span className="font-bold">
                          {grade.score}
                          {grade.grade ? ` · ${grade.grade}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {academics.submissions.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Submissions</p>
                  <div className="mt-2 space-y-1.5">
                    {academics.submissions.slice(0, 6).map((submission) => (
                      <div key={submission.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate text-[var(--muted)]">{submission.title}</span>
                        <span className={`shrink-0 font-bold ${submission.score === null ? "text-amber-600" : ""}`}>
                          {submission.score === null ? "Ungraded" : submission.score}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {academics.certificates.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Certificates</p>
                  <div className="mt-2 space-y-1.5">
                    {academics.certificates.map((certificate) => (
                      <div key={certificate.id} className="flex items-center gap-2 text-sm">
                        <span className="text-[var(--accent)]">
                          <CertificateIcon />
                        </span>
                        <span className="capitalize">
                          {certificate.level} {certificate.kind} · {certificate.award}
                        </span>
                        <span className="ml-auto font-mono text-xs text-[var(--muted)]">{certificate.serial}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* ---- Journey -------------------------------------------------- */}
          <Card title="Journey" hint={journey.germanyGoal ? `Goal: ${journey.germanyGoal}` : "No goal set"}>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Field label="Classes started" value={when(journey.classesStartedAt)} />
              <Field
                label="Confirmed by"
                value={journey.startConfirmedVia ? <span className="capitalize">{journey.startConfirmedVia}</span> : "—"}
              />
              <Field label="Level closed" value={journey.levelCompletedFor ?? "—"} />
              <Field
                label={'Said "not yet"'}
                value={
                  <span className={journey.notStartedCount >= 3 ? "text-amber-600" : undefined}>
                    {journey.notStartedCount} time{journey.notStartedCount === 1 ? "" : "s"}
                  </span>
                }
              />
            </div>
            {journey.notStartedReason && (
              <p className="mt-4 rounded-2xl bg-[var(--surface)]/40 p-3 text-sm text-[var(--muted)]">
                Last reason given: “{journey.notStartedReason}”
              </p>
            )}
            {journey.germanyGoalNote && (
              <p className="mt-3 text-sm text-[var(--muted)]">In their words: “{journey.germanyGoalNote}”</p>
            )}

            <div className="mt-5 space-y-2 border-t border-[var(--border)] pt-4">
              {journey.events.length === 0 && (
                <p className="text-sm text-[var(--muted)]">Nothing has been recorded on their map yet.</p>
              )}
              {journey.events.slice(0, 8).map((event) => (
                <div key={event.id} className="flex items-start gap-3">
                  <span className="mt-0.5 text-[var(--accent)]">
                    <MapIcon />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{event.label}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {when(event.occurredAt)} · {event.source}
                      {event.detail ? ` · ${event.detail}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* ---- Email trail ---------------------------------------------- */}
          <Card title="Email we have sent them" hint={`${email.queued} queued`}>
            {email.log.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                No email has ever been attempted to this address. If they registered recently, the confirmation should
                appear here within a minute of signing up.
              </p>
            ) : (
              <div className="space-y-2">
                {email.log.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-start justify-between gap-3 border-b border-[var(--border)]/60 pb-2 last:border-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{entry.subject}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {entry.type} · {when(entry.createdAt)}
                      </p>
                      {entry.errorMessage && <p className="mt-0.5 text-xs text-red-600">{entry.errorMessage}</p>}
                    </div>
                    <span className={`mt-0.5 shrink-0 ${entry.status === "sent" ? "text-emerald-600" : "text-red-600"}`}>
                      {entry.status === "sent" ? <CheckCircleIcon /> : <CrossCircleIcon />}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* ---- Account & security ---------------------------------------- */}
          <Card title="Account" hint={account.userId ? "Signed-in user" : "No login"}>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Field label="Account created" value={when(account.accountCreatedAt)} />
              <Field
                label="Password set"
                value={account.passwordClaimed ? "Yes" : "Never claimed"}
              />
              <Field label="Two-factor" value={account.twoFactorOn ? "On" : "Off"} />
              <Field label="Finished the tour" value={when(account.welcomeTourSeenAt)} />
              <Field label="Last opened their map" value={when(account.lastJourneySeenAt)} />
              <Field label="Notifications sent" value={`${engagement.notifications.length}`} />
            </div>

            {engagement.videos.length > 0 && (
              <div className="mt-5 border-t border-[var(--border)] pt-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                  Last watched
                </p>
                <div className="mt-2 space-y-1.5">
                  {engagement.videos.slice(0, 5).map((video) => (
                    <div key={video.id} className="flex items-center gap-2 text-sm">
                      <span className="text-[var(--accent)]">
                        <PulseIcon />
                      </span>
                      <span className="min-w-0 truncate">{video.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-[var(--muted)]">
                        {video.completed ? "finished" : `${Math.round(video.positionSeconds / 60)}m in`} ·{" "}
                        {timeAgo(video.updatedAt)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* ---- Admission form ------------------------------------------- */}
          <Card title="Admission form" hint={`${data.admissionEntries.length} fields`}>
            {data.admissionEntries.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">Nothing beyond the basics was collected at signup.</p>
            ) : (
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                {data.admissionEntries.map((entry) => (
                  <Field key={entry.key} label={labelFor(entry.key)} value={entry.value} />
                ))}
              </div>
            )}
            <p className="mt-5 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
              <span className="mr-1.5 inline-block align-middle">
                <ShieldIcon />
              </span>
              Uploaded ID documents are recorded here by file name only. The scans themselves are not displayed on this
              screen.
            </p>
          </Card>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/students"
            className="rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold transition hover:bg-white"
          >
            Back to the roster
          </Link>
          {identity.email && (
            <a
              href={`mailto:${identity.email}`}
              className="flex items-center gap-2 rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold transition hover:bg-white"
            >
              <MailIcon />
              Email {identity.name.split(" ")[0]}
            </a>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
