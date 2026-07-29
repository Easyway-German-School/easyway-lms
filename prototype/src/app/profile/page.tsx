"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

import { Button } from "@/components/Buttons";
import StudentShell from "@/components/StudentShell";

export default function ProfilePage() {
  const [profile, setProfile] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [formState, setFormState] = useState({
    fullName: "",
    gender: "",
    dateOfBirth: "",
    phone: "",
    email: "",
    address: "",
    branch: "",
    currentLevel: "",
    currentCourse: "",
    preferredExam: "",
  });

  useEffect(() => {
    async function loadProfile() {
      const response = await fetch("/api/student/profile");
      const data = await response.json();
      const student = data?.student || data;
      const user = data?.user || {};

      const loaded = {
        // The official code, not the internal cuid — this is what appears on
        // certificates and exam entries.
        id: student?.studentCode || "Not yet issued",
        fullName: user?.name || student?.name || "Learner",
        gender: student?.admission?.gender || "Female",
        dateOfBirth: student?.admission?.dob || "1998-05-14",
        email: user?.email || "student@example.com",
        phone: student?.admission?.phone || "+234 803 123 4567",
        address: student?.admission?.address || "12 Victoria Island Road, Lagos, Nigeria",
        branch: student?.branch?.name || student?.branch || "Lagos Branch",
        currentLevel: student?.level || "B1",
        currentCourse: student?.pathway || "German for Relocation",
        currentWeek: student?.currentWeek || "Week 6",
        assignedTutor: student?.tutor || "Coach Lena",
        attendancePercentage: student?.attendancePercentage || "92%",
        registrationDate: student?.createdAt ? new Date(student.createdAt).toLocaleDateString() : "10 April 2026",
        paymentStatus: student?.paymentStatus || "Pending",
        paymentBalance: student?.paymentSummary?.balance ?? 0,
        requiredDeposit: student?.paymentSummary?.requiredDeposit ?? 0,
        tuitionFee: student?.paymentSummary?.tuitionFee ?? 150000,
        totalPaid: student?.paymentSummary?.totalPaid ?? 0,
        preferredExam: student?.admission?.preferredExam || student?.preferredExam || "Goethe",
        targetRoute: student?.admission?.targetRoute || student?.targetRoute || "Skilled Worker Route",
        emergencyContact: student?.admission?.emergencyContactName
          ? `${student.admission.emergencyContactName} · ${student.admission.emergencyContactInfo}`
          : "Baba Yusuf · +234 803 987 6543",
        photoUrl:
          student?.photoUrl ||
          "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=facearea&w=400&h=400&q=80",
      };

      setProfile(loaded);
      setFormState({
        fullName: loaded.fullName,
        gender: loaded.gender,
        dateOfBirth: loaded.dateOfBirth,
        phone: loaded.phone,
        email: loaded.email,
        address: loaded.address,
        branch: loaded.branch,
        currentLevel: loaded.currentLevel,
        currentCourse: loaded.currentCourse,
        preferredExam: loaded.preferredExam,
      });
    }

    loadProfile();
  }, []);

  async function handleSave() {
    setSaving(true);
    setMessage("");

    try {
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: formState.fullName,
          email: formState.email,
          phone: formState.phone,
          gender: formState.gender,
          dateOfBirth: formState.dateOfBirth,
          address: formState.address,
          branch: formState.branch,
          currentLevel: formState.currentLevel,
          currentCourse: formState.currentCourse,
          preferredExam: formState.preferredExam,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "Unable to save profile right now.");
        return;
      }

      setMessage("Profile saved successfully.");
      setEditing(false);
      setProfile((prev: any) => ({
        ...prev,
        fullName: formState.fullName,
        gender: formState.gender,
        dateOfBirth: formState.dateOfBirth,
        phone: formState.phone,
        email: formState.email,
        address: formState.address,
        branch: formState.branch,
        currentLevel: formState.currentLevel,
        currentCourse: formState.currentCourse,
        preferredExam: formState.preferredExam,
      }));
    } catch (error) {
      setMessage("Unable to save profile right now.");
    } finally {
      setSaving(false);
    }
  }

  if (!profile) {
    return null;
  }

  return (
    <StudentShell>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="space-y-6 px-6 py-10 md:px-10"
      >
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(10,124,255,0.16),_transparent_35%),linear-gradient(135deg,_#0f172a_0%,_#111827_55%,_#1e293b_100%)] p-6 text-white shadow-[0_30px_90px_rgba(15,23,42,0.26)]">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.35em] text-slate-300">Creator profile</p>
              <h1 className="mt-3 text-4xl font-semibold text-white">{profile.fullName}</h1>
              <p className="mt-3 text-sm leading-7 text-slate-300">Your digital identity, learning path, and payment momentum all in one cinematic profile hub.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <span className="rounded-2xl border border-amber-300/30 bg-amber-300/15 px-4 py-3 text-sm font-semibold text-amber-100 shadow-[0_0_20px_rgba(251,191,36,0.2)]">
                Payment: {profile.paymentStatus}
              </span>
              <Button onClick={() => setEditing(true)} variant="primary" className="rounded-2xl bg-white px-4 py-3 text-slate-950 shadow-lg shadow-white/20 hover:bg-slate-100">
                Edit profile
              </Button>
            </div>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-[28px] border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
              <div className="flex flex-col gap-6 md:flex-row md:items-center">
                <div className="relative h-28 w-28 overflow-hidden rounded-[28px] border border-white/20 bg-slate-900/50 shadow-2xl">
                  <img src={profile.photoUrl} alt="Student photo" className="h-full w-full object-cover" />
                  <button className="absolute bottom-2 right-2 rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-950">
                    Update
                  </button>
                </div>
                <div>
                  <p className="text-sm uppercase tracking-[0.35em] text-slate-300">Student ID</p>
                  <p className="mt-2 font-mono text-xl font-semibold tracking-tight text-white">{profile.id}</p>
                  <p className="mt-2 text-sm text-slate-300">Registered on {profile.registrationDate}</p>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <span className="rounded-full border border-emerald-300/30 bg-emerald-400/15 px-3 py-2 text-sm font-semibold text-emerald-100">{profile.currentLevel} learner</span>
                <span className="rounded-full border border-cyan-300/30 bg-cyan-400/15 px-3 py-2 text-sm font-semibold text-cyan-100">{profile.currentCourse}</span>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-slate-950/45 p-6 backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Momentum</p>
                  <p className="mt-2 text-3xl font-semibold text-white">{profile.paymentStatus}</p>
                </div>
                <div className="rounded-full border border-white/10 bg-white/10 px-3 py-2 text-sm font-semibold text-slate-100">{profile.currentWeek}</div>
              </div>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400" style={{ width: `${Math.min(100, Math.max(12, Number(profile.totalPaid || 0) > 0 ? 40 : 18))}%` }} />
              </div>
              <p className="mt-3 text-sm text-slate-300">Your tuition progress keeps your full learning experience unlocked.</p>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.3em] text-[#0A7CFF]">About you</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-900">Profile spotlight</h2>
              </div>
              <div className="rounded-full bg-[#EEF7FF] px-3 py-2 text-sm font-semibold text-[#0A7CFF]">Live now</div>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-[24px] bg-[#F8FBFF] p-5">
                <p className="text-sm font-medium text-slate-900">Gender</p>
                <p className="mt-2 text-sm text-slate-600">{profile.gender}</p>
              </div>
              <div className="rounded-[24px] bg-[#F8FBFF] p-5">
                <p className="text-sm font-medium text-slate-900">Date of birth</p>
                <p className="mt-2 text-sm text-slate-600">{profile.dateOfBirth}</p>
              </div>
              <div className="rounded-[24px] bg-[#F8FBFF] p-5">
                <p className="text-sm font-medium text-slate-900">Phone number</p>
                <p className="mt-2 text-sm text-slate-600">{profile.phone}</p>
              </div>
              <div className="rounded-[24px] bg-[#F8FBFF] p-5">
                <p className="text-sm font-medium text-slate-900">Emergency contact</p>
                <p className="mt-2 text-sm text-slate-600">{profile.emergencyContact}</p>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-[#0A7CFF]">Enrollment snapshot</p>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-[24px] bg-[#F8FBFF] p-5">
                  <p className="text-sm font-medium text-slate-900">Residential address</p>
                  <p className="mt-2 text-sm text-slate-600">{profile.address}</p>
                </div>
                <div className="rounded-[24px] bg-[#F8FBFF] p-5">
                  <p className="text-sm font-medium text-slate-900">Target Germany route</p>
                  <p className="mt-2 text-sm text-slate-600">{profile.targetRoute}</p>
                </div>
                <div className="rounded-[24px] bg-[#F8FBFF] p-5">
                  <p className="text-sm font-medium text-slate-900">Payment status</p>
                  <p className="mt-2 text-sm font-semibold text-[#c2410c]">{profile.paymentStatus}</p>
                </div>
                <div className="rounded-[24px] bg-[#F8FBFF] p-5">
                  <p className="text-sm font-medium text-slate-900">Preferred exam</p>
                  <p className="mt-2 text-sm text-slate-600">{profile.preferredExam}</p>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-[#0A7CFF]">Learning vibe</p>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-[24px] bg-[#F8FBFF] p-5">
                  <p className="text-sm font-medium text-slate-900">Branch</p>
                  <p className="mt-2 text-sm text-slate-600">{profile.branch}</p>
                </div>
                <div className="rounded-[24px] bg-[#F8FBFF] p-5">
                  <p className="text-sm font-medium text-slate-900">Current course</p>
                  <p className="mt-2 text-sm text-slate-600">{profile.currentCourse}</p>
                </div>
                <div className="rounded-[24px] bg-[#F8FBFF] p-5">
                  <p className="text-sm font-medium text-slate-900">Current week</p>
                  <p className="mt-2 text-sm text-slate-600">{profile.currentWeek}</p>
                </div>
                <div className="rounded-[24px] bg-[#F8FBFF] p-5">
                  <p className="text-sm font-medium text-slate-900">Assigned tutor</p>
                  <p className="mt-2 text-sm text-slate-600">{profile.assignedTutor}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <a href="/" className="inline-flex rounded-full bg-[#111827] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110">
            Back to dashboard
          </a>
        </div>

        {editing && (
          <section className="rounded-[28px] border border-[#0A7CFF]/20 bg-[#eef6ff] p-6 shadow-sm">
            <div className="flex flex-col gap-4">
              <h2 className="text-xl font-semibold text-[#111827]">Edit profile</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {[
                  { label: 'Full name', key: 'fullName' },
                  { label: 'Email', key: 'email' },
                  { label: 'Phone', key: 'phone' },
                  { label: 'Address', key: 'address' },
                  { label: 'Branch', key: 'branch' },
                  { label: 'Current course', key: 'currentCourse' },
                ].map((field) => (
                  <label key={field.key} className="block">
                    <span className="text-sm font-medium text-[#334155]">{field.label}</span>
                    <input
                      type="text"
                      value={(formState as any)[field.key]}
                      onChange={(e) => setFormState((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      className="mt-2 w-full rounded-3xl border border-slate-300 bg-white px-4 py-3 text-sm text-[#0f172a] outline-none transition focus:border-[#0A7CFF] focus:ring-2 focus:ring-[#0A7CFF]/10"
                    />
                  </label>
                ))}

                <label className="block">
                  <span className="text-sm font-medium text-[#334155]">Gender</span>
                  <select
                    value={formState.gender}
                    onChange={(e) => setFormState((prev) => ({ ...prev, gender: e.target.value }))}
                    className="mt-2 w-full rounded-3xl border border-slate-300 bg-white px-4 py-3 text-sm text-[#0f172a] outline-none transition focus:border-[#0A7CFF] focus:ring-2 focus:ring-[#0A7CFF]/10"
                  >
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Other">Other</option>
                  </select>
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-[#334155]">Date of birth</span>
                  <input
                    type="date"
                    value={formState.dateOfBirth}
                    onChange={(e) => setFormState((prev) => ({ ...prev, dateOfBirth: e.target.value }))}
                    className="mt-2 w-full rounded-3xl border border-slate-300 bg-white px-4 py-3 text-sm text-[#0f172a] outline-none transition focus:border-[#0A7CFF] focus:ring-2 focus:ring-[#0A7CFF]/10"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-[#334155]">Current level</span>
                  <select
                    value={formState.currentLevel}
                    onChange={(e) => setFormState((prev) => ({ ...prev, currentLevel: e.target.value }))}
                    className="mt-2 w-full rounded-3xl border border-slate-300 bg-white px-4 py-3 text-sm text-[#0f172a] outline-none transition focus:border-[#0A7CFF] focus:ring-2 focus:ring-[#0A7CFF]/10"
                  >
                    {['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((level) => (
                      <option key={level} value={level}>{level}</option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-[#334155]">Preferred exam</span>
                  <select
                    value={formState.preferredExam}
                    onChange={(e) => setFormState((prev) => ({ ...prev, preferredExam: e.target.value }))}
                    className="mt-2 w-full rounded-3xl border border-slate-300 bg-white px-4 py-3 text-sm text-[#0f172a] outline-none transition focus:border-[#0A7CFF] focus:ring-2 focus:ring-[#0A7CFF]/10"
                  >
                    <option value="Goethe">Goethe</option>
                    <option value="Internal Easyway exam">Internal Easyway exam</option>
                    <option value="OSD">OSD</option>
                  </select>
                </label>
              </div>

              <div className="flex flex-wrap gap-3 pt-3">
                <Button onClick={handleSave} variant="primary" className="rounded-2xl bg-[#0A7CFF] px-5 py-3 text-white hover:bg-[#003087]" disabled={saving}>
                  {saving ? 'Saving...' : 'Save changes'}
                </Button>
                <Button onClick={() => setEditing(false)} variant="secondary" className="rounded-2xl bg-white px-5 py-3 text-[#0f172a] border border-slate-300">
                  Cancel
                </Button>
              </div>

              {message && <p className="text-sm text-[#0A7CFF]">{message}</p>}
            </div>
          </section>
        )}
      </motion.div>
    </StudentShell>
  );
}
