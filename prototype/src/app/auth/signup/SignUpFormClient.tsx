"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { buildApiUrl } from "@/lib/api";
import BrandLoader from "@/components/BrandLoader";
import { countries, nigerianStates, packageOptions, professionOptions } from "@/app/auth/signup/options";
import PasswordInput from "@/components/PasswordInput";
import { uploadImage } from "@/lib/upload";
import {
  CONNECTION_OPTIONS,
  DEVICE_OPTIONS,
  TIMEZONE_OPTIONS,
  isOnlineBranch,
} from "@/lib/online-branch";

type BranchOption = { id: string; name: string; location?: string | null; mode?: string | null };

type SignUpFormClientProps = { pageTitle?: string; initialBranchName?: string };

const branchGuidanceMap: Record<string, string> = {
  Lagos: "Lagos branch students get access to weekday group classes and Lagos campus support.",
  Abuja: "Abuja branch students get access to capital city study plans and local visa guidance.",
  "Port Harcourt": "Port Harcourt branch students get local cohort support plus flexible evening sessions.",
  Online: "Online students join live classes over video from anywhere, and every class is recorded so a dropped connection never costs you the lesson.",
};

/**
 * Class times are quoted in Nigerian time because that is when the tutors
 * teach. Shown as a fixed WAT label rather than converted per student: a
 * timetable that silently reads differently for two classmates is worse than
 * one everybody has to convert once.
 */
const SESSION_SLOTS = [
  { value: "morning", campus: "Morning — 9:00 to 11:00", online: "Morning — 9:00 to 11:00 WAT" },
  { value: "afternoon", campus: "Afternoon — 13:00 to 15:00", online: "Afternoon — 13:00 to 15:00 WAT" },
  { value: "evening", campus: "Evening — 17:00 to 19:00", online: "Evening — 17:00 to 19:00 WAT" },
] as const;

export default function SignUpFormClient({ pageTitle, initialBranchName }: SignUpFormClientProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const branchRole = "student";
  const [branchId, setBranchId] = useState("");
  const [level, setLevel] = useState("A1");
  const [pathway, setPathway] = useState(packageOptions[0]);
  const [gender, setGender] = useState("");
  const [dob, setDob] = useState("");
  const [religion, setReligion] = useState("");
  const [profession, setProfession] = useState("");
  const [batch, setBatch] = useState("");
  const [sessionSlot, setSessionSlot] = useState("morning");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [stateField, setStateField] = useState("");
  const [country, setCountry] = useState("Nigeria");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoFileName, setPhotoFileName] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [heardFrom] = useState("");
  const [emergencyContactName] = useState("");
  const [emergencyContactInfo] = useState("");
  // Online-only answers. They decide what the classroom optimises for, so they
  // are asked once at signup rather than left for the student to discover
  // through a frozen video mid-lesson.
  const [timezone, setTimezone] = useState("Africa/Lagos");
  const [device, setDevice] = useState("");
  const [connection, setConnection] = useState("");
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const stepCount = 3;
  const router = useRouter();
  const selectedBranch = branches.find((branch) => branch.id === branchId) || null;

  // The one switch the whole form turns on. Everything below reads from it
  // rather than testing the branch name again, so an online student never sees
  // a campus question and a campus student never sees a bandwidth one.
  const isOnline = isOnlineBranch(selectedBranch);

  const stepTitles = isOnline ? ["Program", "Your setup", "Launch"] : ["Program", "Profile", "Launch"];
  const stepIntroText = (
    isOnline
      ? {
          1: "Pick your level, your session, and your account details.",
          2: "Tell us how you will be joining class so we can tune your video.",
          3: "Review and finish — you go straight to your dashboard.",
        }
      : {
          1: "Pick your branch, pathway, and account details.",
          2: "Tell us about yourself so we can tailor your plan.",
          3: "Review and finish your signup quickly.",
        }
  )[step] as string;
  const isLastStep = step === stepCount;
  const isDobValid = (value: string) => /^(0[1-9]|[12][0-9]|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/.test(value.trim());
  const isAusbildungPathway = pathway === "Ausbildung (vocational training)";

  // The Nigerian-states dropdown only makes sense inside Nigeria. Online reaches
  // the diaspora, so outside Nigeria the field becomes free text — a student in
  // Berlin was previously stuck picking a state they do not live in.
  const usesNigerianStates = country === "Nigeria";

  const canAdvanceStep =
    step === 1
      ? name.trim() !== "" && email.trim() !== "" && password.length >= 8 && branchId !== "" && pathway.trim() !== "" && batch !== ""
      : step === 2
      ? phone.trim() !== "" &&
        city.trim() !== "" &&
        address.trim() !== "" &&
        stateField.trim() !== "" &&
        gender.trim() !== "" &&
        dob.trim() !== "" &&
        isDobValid(dob) &&
        (!isAusbildungPathway || profession.trim() !== "") &&
        (!isOnline || (device !== "" && connection !== "" && timezone !== ""))
      : true;
  const nextButtonLabel = !isLastStep ? "Next" : "Finish signup";
  const branchHint = selectedBranch
    ? branchGuidanceMap[selectedBranch.name] ||
      (isOnline
        ? "You are joining an online cohort — live classes over video, recorded every time."
        : `You are signing up for the ${selectedBranch.name} branch.`)
    : "Pick a campus, or choose Online to study live over video from anywhere.";

  useEffect(() => {
    async function loadBranches() {
      try {
        const res = await fetch(buildApiUrl("/api/branches"));
        if (!res.ok) return;
        const data = await res.json();
        const receivedBranches = data.branches || [];
        setBranches(receivedBranches);

        if (initialBranchName) {
          const branch = receivedBranches.find(
            (item: BranchOption) => item.name.toLowerCase() === initialBranchName.toLowerCase(),
          );
          if (branch) {
            setBranchId(branch.id);
          }
        }
      } catch (err) {
        console.error(err);
      }
    }

    loadBranches();
  }, [initialBranchName]);

  /**
   * Prefill from an enrolment invite link.
   *
   * Read from window.location rather than useSearchParams so the component does
   * not need a Suspense boundary. Runs once: it seeds the fields and then stays
   * out of the way, so nothing the student subsequently types gets overwritten.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const prefill = (key: string, apply: (value: string) => void) => {
      const value = params.get(key)?.trim();
      if (value) apply(value);
    };

    prefill("email", setEmail);
    prefill("name", setName);
    prefill("level", (v) => setLevel(v.toUpperCase()));
    prefill("branchId", setBranchId);
    prefill("sessionSlot", (v) => {
      const slot = v.toLowerCase();
      if (["morning", "afternoon", "evening"].includes(slot)) setSessionSlot(slot);
    });
  }, []);

  // Returns the uploaded URL so callers can use it immediately — React state
  // updates (setPhotoUrl) are async and would still be stale in the same tick.
  const uploadFile = async (file: File): Promise<string> => {
    setUploadingPhoto(true);
    setError("");
    setPhotoFileName(file.name);

    try {
      const uploadedUrl = await uploadImage(file);
      setPhotoUrl(uploadedUrl);
      return uploadedUrl;
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
      setPhotoFileName("");
      setPhotoUrl("");
      return "";
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSignUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!name.trim() || !email.trim() || !password) {
      setError("Name, email and password are required");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (branchRole === "student" && !branchId) {
      setError("Please select a branch");
      return;
    }

    if (!batch.trim()) {
      setError("Please choose a batch.");
      return;
    }

    if (!pathway.trim()) {
      setError("Please choose a package type.");
      return;
    }

    if (!dob.trim() || !isDobValid(dob)) {
      setError("Date of birth must use dd/mm/yyyy format.");
      return;
    }

    if (!photoFile && !photoUrl) {
      setError("Please upload a profile photo (camera capture supported).");
      return;
    }

    setLoading(true);

    try {
      // Upload the photo first and use the RETURNED url (state would be stale here).
      let uploadedPhotoUrl = photoUrl;
      if (photoFile) {
        uploadedPhotoUrl = await uploadFile(photoFile);
      }

      if (!uploadedPhotoUrl) {
        setError("Your profile photo could not be uploaded. Please re-select it and try again.");
        setLoading(false);
        return;
      }

      const payload = {
        email,
        password,
        name,
        role: branchRole,
        branchId,
        level,
        sessionSlot,
        pathway,
        batch,
        classApplied: level,
        gender,
        dob,
        religion,
        profession,
        address,
        phone,
        city,
        state: stateField,
        country,
        photoUrl: uploadedPhotoUrl,
        photoFileName,
        heardFrom,
        emergencyContactName,
        emergencyContactInfo,
        // Only sent for an online signup. A campus student has no meaningful
        // answer to any of it, and an empty object in their admission record
        // would just be noise for whoever reads it in the admin later.
        ...(isOnline ? { online: { timezone, device, connection } } : {}),
      } as Record<string, unknown>;

      const res = await fetch(buildApiUrl("/api/auth/signup"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || "Sign up failed");
      }

      // An online student has no branch office to walk into, so a page telling
      // them to go and sign in is a dead end at the exact moment they are most
      // likely to drop off. Sign them straight in and land them in the portal.
      // A campus student still gets the confirmation page, which is where the
      // office's next-steps instructions live.
      if (isOnline) {
        setSuccessMessage("Welcome to EasyWay Online. Taking you to your dashboard…");
        setShowSuccess(true);

        const signedIn = await signIn("credentials", {
          email,
          password,
          role: "student",
          redirect: false,
        });

        // A failed auto sign-in must not look like a failed signup — the
        // account exists either way, so fall back to the normal sign-in page.
        router.replace(signedIn?.ok ? "/dashboard" : "/auth/signin?message=Your%20account%20is%20ready.%20Please%20sign%20in.");
        return;
      }

      setSuccessMessage("Signup successful. You will receive confirmation and can sign in next.");
      setShowSuccess(true);
      window.setTimeout(() => {
        router.replace("/auth/signup/success");
      }, 750);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <BrandLoader
        fullscreen
        size="lg"
        title="Wir richten dein Konto ein…"
        message="Setting up your account and reserving your place in class."
      />
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,102,0,0.12),_transparent_35%),linear-gradient(180deg,_#f5f5f5_0%,_#ffffff_100%)] px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-5xl space-y-10">
        <div className="rounded-[32px] bg-gradient-to-br from-[#0D7C7E] via-[#FF6600] to-[#FF8533] px-8 py-8 text-white shadow-[0_30px_90px_-30px_rgba(13,124,126,0.25)] sm:px-12">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.36em] text-sky-100">EASYWAY LMS STUDENT SIGNIN</p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight sm:text-5xl">{pageTitle || "Student Signin"}</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-sky-100/90">
              Secure your place, choose your pathway, and launch your learning progress with a simpler signin experience.
            </p>
          </div>
        </div>

        <form onSubmit={handleSignUp} className="space-y-6 rounded-[32px] bg-white/95 p-8 shadow-[0_30px_80px_-24px_rgba(15,23,42,0.18)] ring-1 ring-slate-200/70">
          {error ? <div className="rounded-xl bg-rose-500/10 p-4 text-sm text-rose-700">{error}</div> : null}
          {successMessage && showSuccess ? (
            <div className="rounded-3xl border border-emerald-200/80 bg-emerald-500/10 p-5 text-sm text-emerald-900 shadow-lg shadow-emerald-500/10 transition-all duration-200">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 h-10 w-10 flex-none rounded-2xl bg-emerald-600/10 text-emerald-700 grid place-items-center text-lg">✅</div>
                <div>
                  <p className="font-semibold text-emerald-900">Signup complete</p>
                  <p className="mt-1 text-[var(--muted)]">{successMessage}</p>
                </div>
              </div>
            </div>
          ) : null}

          <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              {stepTitles.map((title, index) => {
                const active = step === index + 1;
                return (
                  <div key={title} className="flex items-center gap-3">
                    <span className={`h-9 w-9 shrink-0 rounded-full grid place-items-center text-sm font-semibold ${active ? "bg-[var(--accent)] text-white" : "bg-[var(--surface)] text-[var(--muted)]"}`}>
                      {index + 1}
                    </span>
                    <div>
                      <div className={`text-xs uppercase tracking-[0.24em] ${active ? "text-[var(--foreground)]" : "text-[var(--muted)]"}`}>{title}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--background)]">
              <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${(step / stepCount) * 100}%` }} />
            </div>
            <div className="mt-4 rounded-3xl bg-white/80 p-4 text-sm text-[var(--muted)] shadow-sm">
              <p className="font-semibold text-[var(--foreground)]">Step {step} of {stepCount}</p>
              <p className="mt-1">{stepIntroText}</p>
            </div>
          </div>

          {step === 1 ? (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label htmlFor="branchId" className="block text-sm font-semibold text-[var(--muted)]">Choose your branch</label>
                  <select id="branchId" name="branchId" value={branchId} onChange={(e) => setBranchId(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-[var(--surface-alt)]">
                    <option value="">Choose branch</option>
                    {/* A flat list. The campuses need no explanation, and the
                        one option that does carries it in its own label. */}
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {isOnlineBranch(branch) ? `${branch.name} (Study from Anywhere)` : branch.name}
                      </option>
                    ))}
                  </select>
                  <p className={`mt-2 text-xs ${isOnline ? "font-medium text-[var(--accent)]" : "text-[var(--muted)]"}`}>{branchHint}</p>
                </div>
                <div>
                  <label htmlFor="pathway" className="block text-sm font-semibold text-[var(--muted)]">Package type</label>
                  <select id="pathway" name="pathway" value={pathway} onChange={(e) => setPathway(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-[var(--surface-alt)]">
                    {packageOptions.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="batch" className="block text-sm font-semibold text-[var(--muted)]">Batch</label>
                  <select id="batch" name="batch" value={batch} onChange={(e) => setBatch(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-[var(--surface-alt)]">
                    <option value="">Select batch</option>
                    <option>January</option>
                    <option>February</option>
                    <option>March</option>
                    <option>April</option>
                    <option>May</option>
                    <option>June</option>
                    <option>July</option>
                    <option>August</option>
                    <option>September</option>
                    <option>October</option>
                    <option>November</option>
                    <option>December</option>
                  </select>
                  <p className="mt-2 text-xs text-[var(--muted)]">You can select a future batch — payments for future batches are recorded and your access will be activated when the batch begins.</p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-1">
                <div>
                  <label htmlFor="level" className="block text-sm font-semibold text-[var(--muted)]">What class are you starting with?</label>
                  <select id="level" name="level" value={level} onChange={(e) => setLevel(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-[var(--surface-alt)]">
                    <option value="A1">A1 Beginner — new learners starting from basics</option>
                    <option value="A2">A2 — upper beginners class</option>
                    <option value="B1">B1 — intermediate class</option>
                    <option value="B2">B2 — semi professional class</option>
                    <option value="C1">C1 — professional class</option>
                  </select>
                  <p className="mt-2 text-xs text-[var(--muted)]">Choose the level that best matches your current language confidence. A1/A2 are for beginners, B1/B2 are for learners moving into stronger communication, and C1 is for professional learners.</p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-1">
                <div>
                  <label htmlFor="sessionSlot" className="block text-sm font-semibold text-[var(--muted)]">Which session suits you?</label>
                  <select id="sessionSlot" name="sessionSlot" value={sessionSlot} onChange={(e) => setSessionSlot(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-[var(--surface-alt)]">
                    {SESSION_SLOTS.map((slot) => (
                      <option key={slot.value} value={slot.value}>{isOnline ? slot.online : slot.campus}</option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    {isOnline
                      ? "Class times are Nigerian time (WAT). Your dashboard converts them to your own timezone once you tell us where you are, on the next step."
                      : "Your calendar and your tutor come from the session you pick. Contact your branch office if you need to change it later."}
                  </p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label htmlFor="name" className="block text-sm font-semibold text-[var(--muted)]">Name</label>
                  <input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-white" />
                </div>
                <div>
                  <label htmlFor="email" className="block text-sm font-semibold text-[var(--muted)]">Email</label>
                  <input id="email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-white" />
                </div>
                <div>
                  <label htmlFor="password" className="block text-sm font-semibold text-[var(--muted)]">Create password</label>
                  <PasswordInput id="password" name="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-white" />
                </div>
              </div>
            </div>
          ) : step === 2 ? (
            <div className="space-y-6">
              {isOnline ? (
                <div className="rounded-3xl border border-[var(--accent)]/25 bg-[var(--accent-soft)] p-5">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 grid h-10 w-10 flex-none place-items-center rounded-2xl bg-white/80 text-lg shadow-sm">📶</span>
                    <div>
                      <h2 className="text-base font-semibold text-[var(--foreground)]">How you will join class</h2>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        We use these three answers to choose your starting video quality. Nigerian networks are unpredictable — starting you
                        at the right level means the lesson holds instead of freezing while it works itself out.
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-3">
                    <div>
                      <label htmlFor="timezone" className="block text-sm font-semibold text-[var(--muted)]">Where are you studying from?</label>
                      <select id="timezone" name="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-white">
                        {TIMEZONE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      <p className="mt-2 text-xs text-[var(--muted)]">Your timetable is shown in this timezone.</p>
                    </div>
                    <div>
                      <label htmlFor="device" className="block text-sm font-semibold text-[var(--muted)]">What will you join on?</label>
                      <select id="device" name="device" value={device} onChange={(e) => setDevice(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-white">
                        <option value="">Select your device</option>
                        {DEVICE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      <p className="mt-2 text-xs text-[var(--muted)]">Most of our online students are on a phone. That is fine.</p>
                    </div>
                    <div>
                      <label htmlFor="connection" className="block text-sm font-semibold text-[var(--muted)]">How is your internet?</label>
                      <select id="connection" name="connection" value={connection} onChange={(e) => setConnection(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-white">
                        <option value="">Select your connection</option>
                        {CONNECTION_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      <p className="mt-2 text-xs text-[var(--muted)]">
                        {CONNECTION_OPTIONS.find((option) => option.value === connection)?.hint ??
                          "Be honest — a lower setting is not a worse class, it is a class that does not freeze."}
                      </p>
                    </div>
                  </div>

                  <p className="mt-4 rounded-2xl bg-white/70 px-4 py-3 text-xs leading-5 text-[var(--muted)]">
                    Whatever you pick, every online class is recorded and lands in your video library the same day. If your network drops,
                    you have not lost the lesson.
                  </p>
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label htmlFor="phone" className="block text-sm font-semibold text-[var(--muted)]">Phone</label>
                  <input id="phone" name="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-white" />
                </div>
                <div>
                  <label htmlFor="city" className="block text-sm font-semibold text-[var(--muted)]">City</label>
                  <input id="city" name="city" value={city} onChange={(e) => setCity(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-white" />
                </div>
                <div>
                  <label htmlFor="address" className="block text-sm font-semibold text-[var(--muted)]">Address</label>
                  <input id="address" name="address" value={address} onChange={(e) => setAddress(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-white" />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="state" className="block text-sm font-semibold text-[var(--muted)]">{usesNigerianStates ? "State" : "State / region"}</label>
                  {usesNigerianStates ? (
                    <select id="state" name="state" value={stateField} onChange={(e) => setStateField(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-white">
                      <option value="">Select state</option>
                      {nigerianStates.map((state) => (
                        <option key={state} value={state}>{state}</option>
                      ))}
                    </select>
                  ) : (
                    <input id="state" name="state" value={stateField} onChange={(e) => setStateField(e.target.value)} placeholder="e.g. Nordrhein-Westfalen" className="mt-1 w-full rounded-xl border px-3 py-2 bg-white" />
                  )}
                </div>
                <div>
                  <label htmlFor="country" className="block text-sm font-semibold text-[var(--muted)]">Country</label>
                  <select
                    id="country"
                    name="country"
                    value={country}
                    onChange={(e) => {
                      // The state field changes shape with the country, so a
                      // stale Nigerian state must not survive a move abroad.
                      setCountry(e.target.value);
                      setStateField("");
                    }}
                    className="mt-1 w-full rounded-xl border px-3 py-2 bg-white"
                  >
                    <option value="Nigeria">Nigeria</option>
                    {countries.filter((countryName) => countryName !== "Nigeria").map((countryName) => (
                      <option key={countryName} value={countryName}>{countryName}</option>
                    ))}
                  </select>
                  {isOnline ? (
                    <p className="mt-2 text-xs text-[var(--muted)]">Studying from outside Nigeria is fine — the online branch was built for it.</p>
                  ) : null}
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="dob" className="block text-sm font-semibold text-[var(--muted)]">Date of Birth</label>
                  <input id="dob" name="dob" type="text" placeholder="dd/mm/yyyy" value={dob} onChange={(e) => setDob(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-white" />
                  <p className="mt-2 text-xs text-[var(--muted)]">Enter a valid date in dd/mm/yyyy format.</p>
                </div>
                <div>
                  <label htmlFor="gender" className="block text-sm font-semibold text-[var(--muted)]">Gender</label>
                  <select id="gender" name="gender" value={gender} onChange={(e) => setGender(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-white">
                    <option value="">Select</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--muted)]">Religion</label>
                <input value={religion} onChange={(e) => setReligion(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-white" />
              </div>
              <div>
                <label htmlFor="profession" className="block text-sm font-semibold text-[var(--muted)]">{isAusbildungPathway ? "Ausbildung focus" : "Profession or occupation"}</label>
                <select id="profession" name="profession" value={profession} onChange={(e) => setProfession(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-white">
                  <option value="">{isAusbildungPathway ? "Select Ausbildung focus" : "Select your profession"}</option>
                  {isAusbildungPathway ? (
                    ["IT", "Nursing", "Engineering", "Plumbing"].map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))
                  ) : (
                    professionOptions.map((professionOption) => (
                      <option key={professionOption} value={professionOption}>{professionOption}</option>
                    ))
                  )}
                </select>
                <p className="mt-2 text-xs text-[var(--muted)]">{isAusbildungPathway ? "Pick the vocational track you are registering for." : "Choose the closest match. Select “Other / not listed” if your occupation is not shown."}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-5">
                <h2 className="text-lg font-semibold">Almost there</h2>
                <p className="mt-2 text-sm text-[var(--muted)]">Review your choices before finishing your registration.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-3xl border border-[var(--border)] bg-white p-4">
                  <h3 className="text-sm font-semibold text-[var(--foreground)]">Program</h3>
                  <p className="mt-2 text-sm text-[var(--muted)]">Branch: {selectedBranch?.name || "Not selected"}{isOnline ? " (live over video)" : ""}</p>
                  <p className="mt-2 text-sm text-[var(--muted)]">Pathway: {pathway}</p>
                  <p className="mt-2 text-sm text-[var(--muted)]">Level: {level}</p>
                </div>
                <div className="rounded-3xl border border-[var(--border)] bg-white p-4">
                  <h3 className="text-sm font-semibold text-[var(--foreground)]">Profile</h3>
                  <p className="mt-2 text-sm text-[var(--muted)]">Name: {name}</p>
                  <p className="mt-2 text-sm text-[var(--muted)]">Email: {email}</p>
                  <p className="mt-2 text-sm text-[var(--muted)]">Phone: {phone || "Not specified"}</p>
                  <p className="mt-2 text-sm text-[var(--muted)]">City: {city || "Not specified"}</p>
                  <p className="mt-2 text-sm text-[var(--muted)]">DOB: {dob || "Not specified"}</p>
                </div>
                {isOnline ? (
                  <div className="rounded-3xl border border-[var(--accent)]/25 bg-[var(--accent-soft)] p-4 md:col-span-2">
                    <h3 className="text-sm font-semibold text-[var(--foreground)]">Your online setup</h3>
                    <div className="mt-2 grid gap-2 text-sm text-[var(--muted)] sm:grid-cols-3">
                      <p>Timezone: {TIMEZONE_OPTIONS.find((option) => option.value === timezone)?.label || timezone}</p>
                      <p>Device: {DEVICE_OPTIONS.find((option) => option.value === device)?.label || "Not specified"}</p>
                      <p>Connection: {CONNECTION_OPTIONS.find((option) => option.value === connection)?.label || "Not specified"}</p>
                    </div>
                    <p className="mt-3 text-xs text-[var(--muted)]">You can change any of this later in Settings — nothing here is locked in.</p>
                  </div>
                ) : null}
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--muted)]">Upload profile photo</label>
                <input type="file" accept="image/*" capture="user" onChange={(e) => { const file = e.target.files?.[0] || null; setPhotoFile(file); setPhotoFileName(file?.name || ""); }} className="mt-1 w-full rounded-xl border px-3 py-2 bg-white" />
                <p className="mt-2 text-xs text-[var(--muted)]">Camera capture supported. Photo is required to complete signup.</p>
                {uploadingPhoto ? <p className="mt-2 text-xs text-[var(--muted)]">Uploading photo…</p> : photoUrl ? <p className="mt-2 text-xs text-[var(--muted)]">Uploaded: <a href={photoUrl} className="text-[var(--accent)]" target="_blank" rel="noreferrer">View</a></p> : photoFileName ? <p className="mt-2 text-xs text-[var(--muted)]">Selected: {photoFileName}</p> : null}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
            <div className="flex gap-3">
              {step > 1 ? (
                <button type="button" onClick={() => setStep((current) => Math.max(1, current - 1))} className="rounded-xl border border-slate-200 bg-slate-50 px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">Back</button>
              ) : null}
              {!isLastStep ? (
                <button type="button" onClick={() => canAdvanceStep && setStep((current) => Math.min(stepCount, current + 1))} disabled={!canAdvanceStep} className="rounded-xl bg-gradient-to-r from-[#0D7C7E] to-[#FF6600] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#FF6600]/10 disabled:opacity-60 disabled:cursor-not-allowed">{nextButtonLabel}</button>
              ) : null}
            </div>
            {isLastStep ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <button type="submit" disabled={loading || uploadingPhoto} className="rounded-xl bg-gradient-to-r from-[#0D7C7E] to-[#FF6600] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#FF6600]/20 transition duration-200 hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60">{loading ? "Submitting…" : uploadingPhoto ? "Uploading files…" : "Finish signup"}</button>
                <button type="button" onClick={() => router.push("/auth/signin")} className="rounded-xl border border-slate-200 bg-slate-50 px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">Cancel</button>
              </div>
            ) : (
              <button type="button" onClick={() => router.push("/auth/signin")} className="rounded-xl border border-slate-200 bg-slate-50 px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">Cancel</button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
