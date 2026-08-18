"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { buildApiUrl } from "@/lib/api";
import BrandLoader from "@/components/BrandLoader";
import { countries, nigerianStates, packageOptions, professionOptions } from "@/app/auth/signup/options";
import PasswordInput from "@/components/PasswordInput";
import PhotoCapture from "@/components/PhotoCapture";
import SignupJourney from "@/components/SignupJourney";
import { CheckCircleIcon, FamilyIcon, SignalIcon } from "@/components/icons";
import { uploadErrorMessage, uploadImage } from "@/lib/upload";
import {
  CONNECTION_OPTIONS,
  DEVICE_OPTIONS,
  TIMEZONE_OPTIONS,
  isOnlineBranch,
} from "@/lib/online-branch";
import { TIME_SLOTS, slotLabel } from "@/lib/class-times";
import { OFFERED_LEVELS } from "@/lib/levels";

type BranchOption = { id: string; name: string; location?: string | null; mode?: string | null };

type SignUpFormClientProps = { pageTitle?: string; initialBranchName?: string };

const branchGuidanceMap: Record<string, string> = {
  Lagos: "Lagos branch students get access to weekday group classes and Lagos campus support.",
  Abuja: "Abuja branch students get access to capital city study plans and local visa guidance.",
  "Port Harcourt": "Port Harcourt branch students get local cohort support plus flexible evening sessions.",
  Online: "Online-only students join live classes over video from anywhere, with their own tutors and their own cohort. Every class is recorded, so a dropped connection never costs you the lesson.",
};

/**
 * Class times are quoted in Nigerian time because that is when the tutors
 * teach. Shown as a fixed WAT label rather than converted per student: a
 * timetable that silently reads differently for two classmates is worse than
 * one everybody has to convert once.
 *
 * These come from TIME_SLOTS in lib/class-sessions — the same table the
 * generated timetable and the tutor's editor use. They were hardcoded here and
 * had drifted out of step with it, so the signup form quoted students hours
 * their class does not actually run.
 */
const SESSION_SLOTS = TIME_SLOTS.map((slot) => ({ value: slot, label: slotLabel(slot) }));

export default function SignUpFormClient({ pageTitle, initialBranchName }: SignUpFormClientProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const branchRole = "student";
  const [branchId, setBranchId] = useState("");
  // Empty rather than defaulted to "A1" — a student who never opens this
  // dropdown must be stopped by canAdvanceStep below, not silently enrolled
  // as a beginner. Same reasoning for sessionSlot further down.
  const [level, setLevel] = useState("");
  const [pathway, setPathway] = useState(packageOptions[0]);
  const [gender, setGender] = useState("");
  const [dob, setDob] = useState("");
  const [religion, setReligion] = useState("");
  const [profession, setProfession] = useState("");
  const [batch, setBatch] = useState("");
  const [sessionSlot, setSessionSlot] = useState("");
  /**
   * physical | hybrid — how a CAMPUS student attends. The Online branch has no
   * choice to make (it is online by definition), so this control only appears
   * for a campus branch and the server ignores it for an online one.
   */
  const [deliveryMode, setDeliveryMode] = useState("physical");
  /** group | private — a private student books a tutor rather than a seat. */
  const [classType, setClassType] = useState("group");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [stateField, setStateField] = useState("");
  const [country, setCountry] = useState("Nigeria");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoFileName, setPhotoFileName] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [heardFrom] = useState("");
  const [emergencyContactName] = useState("");
  const [emergencyContactInfo] = useState("");
  /**
   * The optional 4th step. Off by default — most students sign themselves up
   * and this whole panel is skippable — but a parent registering on their
   * child's behalf turns it on and gives their OWN email, so the school
   * knows who is actually watching this account. No password field: that
   * account's login is generated and mailed once the form is submitted,
   * because asking somebody to invent and remember a second password inside
   * somebody else's signup is exactly the friction that would make this
   * step skipped by the people who most need it.
   */
  const [parentEnabled, setParentEnabled] = useState(false);
  const [parentName, setParentName] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [parentPhone, setParentPhone] = useState("");
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
  const stepCount = 4;
  const router = useRouter();
  const selectedBranch = branches.find((branch) => branch.id === branchId) || null;

  // The one switch the whole form turns on. Everything below reads from it
  // rather than testing the branch name again, so an online student never sees
  // a campus question and a campus student never sees a bandwidth one.
  const isOnline = isOnlineBranch(selectedBranch);

  /**
   * The three milestones, in the guide's voice.
   *
   * The copy carries the weight here, and every line is doing one job: telling
   * somebody who has just decided to learn German that this is the beginning of
   * something rather than an administrative hurdle. It names the destination
   * ("Germany", "your first class") instead of the mechanism ("submit the
   * form"), and it says what each answer is FOR — a student who knows why they
   * are being asked for a date of birth answers it; one who does not, leaves.
   *
   * The online variant is genuinely different, not reworded: an online student
   * is asked about their connection, and the reason for that question is worth
   * saying out loud on a Nigerian line.
   */
  const milestones = isOnline
    ? [
        { label: "Program", stamp: "Chosen", line: "Willkommen! First — which level are you starting at, and when can you actually make class? Everything after this is shaped around that answer." },
        { label: "Your setup", stamp: "Ready", line: "Now the part most schools skip: how you get online. Tell us honestly and we tune your video to your line, so your first lesson does not freeze." },
        { label: "Parent/Guardian", stamp: "Optional", line: "Registering for yourself? Skip this. Registering for your child, or want a parent kept in the loop? Add their email and we set up their own account too." },
        { label: "Launch", stamp: "Enrolled", line: "That is everything. Finish up and your dashboard, your timetable and your classmates are waiting on the other side." },
      ]
    : [
        { label: "Program", stamp: "Chosen", line: "Willkommen! Let us start with where you are learning and where you are heading. Germany is the destination — this is choosing the road." },
        { label: "Profile", stamp: "Known", line: "Now a little about you. Your tutor sees this, so it is how you stop being a row in a spreadsheet and start being a student they know." },
        { label: "Parent/Guardian", stamp: "Optional", line: "Registering for yourself? Skip this. Registering for your child, or want a parent kept in the loop? Add their email and we set up their own account too." },
        { label: "Launch", stamp: "Enrolled", line: "That is everything. Finish up and your dashboard, your timetable and your classmates are waiting on the other side." },
      ];

  const isLastStep = step === stepCount;
  /**
   * DOB is now a real date picker, so the value arriving here is always
   * yyyy-mm-dd from the browser. The check is about plausibility rather than
   * shape: a date in the future, or one implying a 4-year-old, is a typo.
   */
  const isDobValid = (value: string) => {
    if (!value) return false;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    const now = new Date();
    const age = (now.getTime() - date.getTime()) / (365.25 * 24 * 3600 * 1000);
    return age >= 10 && age <= 100;
  };
  // The office reads dd/mm/yyyy, and every record written before the picker
  // existed is in that format, so that is still what gets stored.
  const dobForRecord = (value: string) => {
    if (!value) return "";
    const [year, month, day] = value.split("-");
    return year && month && day ? `${day}/${month}/${year}` : value;
  };
  const maxDob = new Date(Date.now() - 10 * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const isAusbildungPathway = pathway === "Ausbildung (vocational training)";
  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

  // The Nigerian-states dropdown only makes sense inside Nigeria. Online reaches
  // the diaspora, so outside Nigeria the field becomes free text — a student in
  // Berlin was previously stuck picking a state they do not live in.
  const usesNigerianStates = country === "Nigeria";

  const canAdvanceStep =
    step === 1
      ? name.trim() !== "" &&
        email.trim() !== "" &&
        password.length >= 8 &&
        branchId !== "" &&
        pathway.trim() !== "" &&
        batch !== "" &&
        level !== "" &&
        // A private student agrees their own times with their tutor and never
        // sees the session dropdown (it is hidden below), so it cannot gate
        // them forward.
        (classType === "private" || sessionSlot !== "")
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
      : step === 3
      ? // Skippable by default. Only gates forward progress once the parent
        // section has actually been turned on — a toggle nobody touched must
        // never block anybody's signup.
        (!parentEnabled ||
          (parentName.trim() !== "" && isValidEmail(parentEmail) && parentEmail.trim().toLowerCase() !== email.trim().toLowerCase()))
      : true;
  const nextButtonLabel = !isLastStep ? "Next" : "Finish signup";
  const branchHint = selectedBranch
    ? branchGuidanceMap[selectedBranch.name] ||
      (isOnline
        ? "You are joining an online cohort — live classes over video, recorded every time."
        : `You are signing up for the ${selectedBranch.name} branch.`)
    : "Pick a campus — you can attend it in person or online — or choose Online only to study from anywhere.";

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
    prefill("level", (v) => {
      const requested = v.toUpperCase();
      if ((OFFERED_LEVELS as readonly string[]).includes(requested)) setLevel(requested);
    });
    prefill("branchId", setBranchId);
    prefill("sessionSlot", (v) => {
      const slot = v.toLowerCase();
      if ((TIME_SLOTS as readonly string[]).includes(slot)) setSessionSlot(slot);
    });
  }, []);

  // Returns the uploaded URL so callers can use it immediately — React state
  // updates (setPhotoUrl) are async and would still be stale in the same tick.
  const uploadFile = async (file: File): Promise<string> => {
    setUploadingPhoto(true);
    setUploadMessage("Uploading photo...");
    setError("");
    setPhotoFileName(file.name);

    try {
      const uploadedUrl = await uploadImage(file);
      setPhotoUrl(uploadedUrl);
      // The bytes are in storage now, so drop the File handle. Holding it is
      // what let the submit path re-read a reference the phone had already
      // invalidated.
      setPhotoFile(null);
      setUploadMessage("Photo uploaded successfully.");
      return uploadedUrl;
    } catch (uploadError) {
      const message = uploadErrorMessage(uploadError);
      setError(message);
      setUploadMessage("Photo upload failed. Please try another photo or contact support.");
      setPhotoFileName("");
      setPhotoUrl("");
      return "";
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handlePhotoSelected = async (file: File | null) => {
    if (!file) {
      setPhotoFile(null);
      setPhotoFileName("");
      setPhotoUrl("");
      setUploadMessage("");
      return;
    }

    setPhotoFile(file);
    setPhotoFileName(file.name);
    setPhotoUrl("");
    setUploadMessage("Uploading photo... If the direct upload fails, we will retry through the app.");
    await uploadFile(file);
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

    if (!level.trim()) {
      setError("Please choose your level.");
      return;
    }

    // A private student books their own times with their tutor and never
    // sees this question — see the hidden sessionSlot field in step 1.
    if (classType !== "private" && !sessionSlot.trim()) {
      setError("Please choose a session.");
      return;
    }

    if (!dob.trim() || !isDobValid(dob)) {
      setError("Please pick a valid date of birth.");
      return;
    }

    if (!photoFile && !photoUrl) {
      setError("Please upload a profile photo (camera capture supported).");
      return;
    }

    setLoading(true);

    try {
      // The photo goes up the moment it is chosen, so by here there is normally
      // a URL already and nothing left to do. Only fall back to the File if
      // that first upload failed — re-reading it unconditionally is what broke
      // mobile signups, because a File is an OS handle rather than bytes and
      // the phone invalidates it while the rest of the form is being filled in.
      let uploadedPhotoUrl = photoUrl;
      if (!uploadedPhotoUrl && photoFile) {
        uploadedPhotoUrl = await uploadImage(photoFile);
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
        deliveryMode,
        classType,
        pathway,
        batch,
        classApplied: level,
        gender,
        dob: dobForRecord(dob),
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
        // The optional 4th step. Omitted entirely when skipped, rather than
        // sent empty, so the server's "was a parent section filled in?" check
        // stays a simple truthiness test.
        ...(parentEnabled ? { parent: { name: parentName, email: parentEmail, phone: parentPhone } } : {}),
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
        setSuccessMessage(
          parentEnabled
            ? "Welcome to EasyWay Online. Taking you to your dashboard — your parent/guardian's login is on its way to their email."
            : "Welcome to EasyWay Online. Taking you to your dashboard…",
        );
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

      setSuccessMessage(
        parentEnabled
          ? "Signup successful. You will receive confirmation and can sign in next — your parent/guardian's login is on its way to their email."
          : "Signup successful. You will receive confirmation and can sign in next.",
      );
      setShowSuccess(true);
      window.setTimeout(() => {
        router.replace("/auth/signup/success");
      }, 750);
    } catch (err) {
      // The photo retry above can land here, so route through the same mapper
      // rather than showing a raw DOMException. Anything else keeps its message.
      setError(uploadErrorMessage(err, "An error occurred"));
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
        {/*
          This said "STUDENT SIGN IN" on the page where you create an account,
          twice, and promised "a simpler signin experience". Nobody signing up
          is signing in, and a school that cannot tell the difference on its own
          enrolment page is not a confidence-inspiring place to send ₦400,000.
        */}
        <div className="rounded-[32px] bg-gradient-to-br from-[#0D7C7E] via-[#FF6600] to-[#FF8533] px-6 py-8 text-white shadow-[0_30px_90px_-30px_rgba(13,124,126,0.25)] sm:px-12">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.36em] text-white/70">Enrolment · EasyWay German</p>
            <h1 className="mt-4 text-3xl font-semibold leading-tight sm:text-5xl">{pageTitle || "Start your German journey"}</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/85">
              A few short steps and you are enrolled — your level, your class times, your tutor. Registering for your
              child? There is a spot further in to add their own parent account too.
            </p>
          </div>
        </div>

        {/*
          `p-8` unconditionally was costing 64px of a 375px screen, and the page
          around it another 32. Measured: the companion's speech bubble was
          being squeezed to 171px wide and wrapping to 211px tall — a paragraph
          in a column three words across. Padding is a phone's scarcest
          resource; it earns its place above sm and not below.
        */}
        <form onSubmit={handleSignUp} className="space-y-6 rounded-[32px] bg-white/95 p-4 shadow-[0_30px_80px_-24px_rgba(15,23,42,0.18)] ring-1 ring-slate-200/70 sm:p-8">
          {error ? <div className="rounded-xl bg-rose-500/10 p-4 text-sm text-rose-700">{error}</div> : null}
          {successMessage && showSuccess ? (
            <div className="rounded-3xl border border-emerald-200/80 bg-emerald-500/10 p-5 text-sm text-emerald-900 shadow-lg shadow-emerald-500/10 transition-all duration-200">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 h-10 w-10 flex-none rounded-2xl bg-emerald-600/10 text-emerald-700 grid place-items-center"><CheckCircleIcon className="h-5 w-5" /></div>
                <div>
                  <p className="font-semibold text-emerald-900">Signup complete</p>
                  <p className="mt-1 text-[var(--muted)]">{successMessage}</p>
                </div>
              </div>
            </div>
          ) : null}

          {/* Replaced three numbered circles, a grey bar and "Step 1 of 3".
              See SignupJourney for why that framing was the wrong one to open
              an enrolment with. */}
          <SignupJourney
            milestones={milestones}
            current={step}
            ready={canAdvanceStep}
            errored={Boolean(error)}
          />

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
                        {/* The campuses need no explanation. The online
                            branch is its OWN cohort with its own tutors —
                            distinct from picking a campus and attending it
                            over video, which is the hybrid option below. */}
                        {isOnlineBranch(branch) ? `${branch.name} only — study from anywhere` : branch.name}
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
                    <option value="">Select your level</option>
                    <option value="A1">A1 Beginner — new learners starting from basics</option>
                    <option value="A2">A2 — upper beginners class</option>
                    <option value="B1">B1 — intermediate class</option>
                    <option value="B2">B2 — semi professional class</option>
                    <option value="C1">C1 — professional class</option>
                  </select>
                  <p className="mt-2 text-xs text-[var(--muted)]">Choose the level that best matches your current language confidence. A1/A2 are for beginners, B1/B2 are for learners moving into stronger communication, and C1 is for professional learners.</p>
                </div>
              </div>
              {/* How you attend. Only a campus branch has a decision to make:
                  the Online branch is online by definition, and the server
                  forces it there regardless of what this form sends. */}
              {selectedBranch && !isOnline ? (
                <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-5">
                  <p className="text-sm font-semibold text-[var(--foreground)]">How will you attend?</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {[
                      {
                        value: "physical",
                        title: "On campus",
                        blurb: `Attend your classes in person at the ${selectedBranch.name} branch.`,
                      },
                      {
                        value: "hybrid",
                        title: "Online / hybrid",
                        blurb: "Attend on campus when you can, and join the same class live over video when you cannot.",
                      },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setDeliveryMode(option.value)}
                        className={`rounded-2xl border p-4 text-left transition ${
                          deliveryMode === option.value
                            ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                            : "border-[var(--border)] bg-white hover:border-[var(--accent)]"
                        }`}
                      >
                        <p className="text-sm font-semibold text-[var(--foreground)]">{option.title}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">{option.blurb}</p>
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-[var(--muted)]">
                    {deliveryMode === "hybrid"
                      ? "You will have the live classroom in your portal as well as your campus timetable."
                      : "Your portal will show your campus timetable. Choose online/hybrid if you also want to join live over video."}
                  </p>
                </div>
              ) : null}

              {/* Private tuition. A separate question from the pathway, because
                  it changes the product rather than the destination: a private
                  student books their tutor's whole session instead of a seat in
                  it, and sits no group timetable at all. */}
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-5">
                <p className="text-sm font-semibold text-[var(--foreground)]">Group class or private tuition?</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {[
                    {
                      value: "group",
                      title: "Group class",
                      blurb: "Learn with your cohort on the school timetable. This is what most students choose.",
                    },
                    {
                      value: "private",
                      title: "Private (one-to-one)",
                      blurb: "Your own tutor, at times you agree between you. Priced higher than a group seat.",
                    },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setClassType(option.value)}
                      className={`rounded-2xl border p-4 text-left transition ${
                        classType === option.value
                          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                          : "border-[var(--border)] bg-white hover:border-[var(--accent)]"
                      }`}
                    >
                      <p className="text-sm font-semibold text-[var(--foreground)]">{option.title}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{option.blurb}</p>
                    </button>
                  ))}
                </div>
                {classType === "private" ? (
                  <p className="mt-3 text-xs text-[var(--accent)]">
                    The office will pair you with a tutor after you register, and you will be told who they are. Your
                    calendar fills in once your first sessions are booked.
                  </p>
                ) : null}
              </div>

              {/* A private student agrees their own times with their tutor, so
                  asking them to pick one of the house sittings would be asking
                  a question their answer cannot affect. */}
              <div className={`grid gap-4 md:grid-cols-1 ${classType === "private" ? "hidden" : ""}`}>
                <div>
                  <label htmlFor="sessionSlot" className="block text-sm font-semibold text-[var(--muted)]">Which session suits you?</label>
                  <select id="sessionSlot" name="sessionSlot" value={sessionSlot} onChange={(e) => setSessionSlot(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-[var(--surface-alt)]">
                    <option value="">Select a session</option>
                    {SESSION_SLOTS.map((slot) => (
                      <option key={slot.value} value={slot.value}>
                        {isOnline ? `${slot.label} WAT` : slot.label}
                      </option>
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
                    <span className="mt-0.5 grid h-10 w-10 flex-none place-items-center rounded-2xl bg-white/80 text-[var(--accent)] shadow-sm"><SignalIcon className="h-5 w-5" /></span>
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
                  {/* A real picker, not a text box. Typing dd/mm/yyyy by hand
                      is the single most-failed field on any signup form —
                      people write 1990-05-02, or 2/5/90, and get told off. */}
                  <input
                    id="dob"
                    name="dob"
                    type="date"
                    max={maxDob}
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    className="mt-1 w-full rounded-xl border px-3 py-2 bg-white"
                  />
                  {dob && !isDobValid(dob) ? (
                    <p className="mt-2 text-xs text-rose-600">Please check this date.</p>
                  ) : null}
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
                <label htmlFor="profession" className="block text-sm font-semibold text-[var(--muted)]">{isAusbildungPathway ? "Ausbildung focus" : "What is your current profession?"}</label>
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
          ) : step === 3 ? (
            <div className="space-y-6">
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-5">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-10 w-10 flex-none place-items-center rounded-2xl bg-white/80 text-[var(--accent)] shadow-sm">
                    <FamilyIcon className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold text-[var(--foreground)]">Add a parent or guardian?</h2>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      Entirely optional — most students skip this. If you are a parent registering for your child, or
                      you just want somebody kept in the loop, add their details below and we set up a separate,
                      linked account for them automatically. They get their own login by email once you finish.
                    </p>
                  </div>
                </div>

                <label className="mt-5 flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-white px-4 py-3">
                  <input
                    type="checkbox"
                    checked={parentEnabled}
                    onChange={(e) => setParentEnabled(e.target.checked)}
                    className="h-4 w-4 rounded border-[var(--border)] text-[var(--accent)]"
                  />
                  <span className="text-sm font-semibold text-[var(--foreground)]">
                    Set up a parent/guardian account for this student
                  </span>
                </label>

                {parentEnabled ? (
                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    <div>
                      <label htmlFor="parentName" className="block text-sm font-semibold text-[var(--muted)]">Parent/guardian name</label>
                      <input
                        id="parentName"
                        value={parentName}
                        onChange={(e) => setParentName(e.target.value)}
                        className="mt-1 w-full rounded-xl border px-3 py-2 bg-white"
                      />
                    </div>
                    <div>
                      <label htmlFor="parentEmail" className="block text-sm font-semibold text-[var(--muted)]">Parent/guardian email</label>
                      <input
                        id="parentEmail"
                        type="email"
                        value={parentEmail}
                        onChange={(e) => setParentEmail(e.target.value)}
                        className="mt-1 w-full rounded-xl border px-3 py-2 bg-white"
                      />
                      {parentEmail && !isValidEmail(parentEmail) ? (
                        <p className="mt-2 text-xs text-rose-600">Please check this email address.</p>
                      ) : parentEmail && parentEmail.trim().toLowerCase() === email.trim().toLowerCase() ? (
                        <p className="mt-2 text-xs text-rose-600">This must be different from the student's own email above.</p>
                      ) : null}
                    </div>
                    <div>
                      <label htmlFor="parentPhone" className="block text-sm font-semibold text-[var(--muted)]">Parent/guardian phone</label>
                      <input
                        id="parentPhone"
                        type="tel"
                        value={parentPhone}
                        onChange={(e) => setParentPhone(e.target.value)}
                        className="mt-1 w-full rounded-xl border px-3 py-2 bg-white"
                      />
                    </div>
                    <p className="text-xs text-[var(--muted)] md:col-span-3">
                      No password to set here — their login is generated automatically and emailed to them, with a
                      link to their own parent sign-in page. The school confirms the link to this student before
                      anything shows in their account.
                    </p>
                  </div>
                ) : null}
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
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    Attending: {isOnline ? "Online only" : deliveryMode === "hybrid" ? "Online / hybrid" : "On campus"}
                  </p>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    Class: {classType === "private" ? "Private (one-to-one)" : "Group class"}
                  </p>
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
                    <p className="mt-3 text-xs text-[var(--muted)]">You can change any of this later on your Profile — nothing here is locked in.</p>
                  </div>
                ) : null}
                {parentEnabled ? (
                  <div className="rounded-3xl border border-[var(--border)] bg-white p-4 md:col-span-2">
                    <h3 className="text-sm font-semibold text-[var(--foreground)]">Parent/guardian</h3>
                    <p className="mt-2 text-sm text-[var(--muted)]">Name: {parentName}</p>
                    <p className="mt-2 text-sm text-[var(--muted)]">Email: {parentEmail}</p>
                    <p className="mt-2 text-sm text-[var(--muted)]">Phone: {parentPhone || "Not specified"}</p>
                    <p className="mt-3 text-xs text-[var(--muted)]">
                      A separate account is created for them and their login is emailed to this address.
                    </p>
                  </div>
                ) : null}
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--muted)]">Your profile photo</label>
                {/* Was a bare file input with `capture="user"`, which on a
                    desktop is just a file picker and on a phone hands the
                    student off to the OS camera app and hopes they come back.
                    <PhotoCapture /> keeps them in the form either way. */}
                <div className="mt-2">
                  <PhotoCapture
                    disabled={uploadingPhoto}
                    onChange={handlePhotoSelected}
                  />
                </div>
                {uploadMessage ? (
                  <p className="mt-2 text-xs text-[var(--muted)]">{uploadMessage}</p>
                ) : uploadingPhoto ? (
                  <p className="mt-2 text-xs text-[var(--muted)]">Uploading photo…</p>
                ) : null}
              </div>
            </div>
          )}

          {/*
            THE FOOTER, REORDERED AROUND WHAT PEOPLE ACTUALLY TAP.

            Two things were wrong with it. The primary action sat on the LEFT
            beside Back — on a phone, in a column, that meant the first button
            under your thumb was the one that goes backwards. And "Cancel" was
            given equal visual weight to "Finish signup" on the last step, which
            is a strange thing to offer somebody 90 seconds into enrolling.

            Now: the way forward is full-width and first, Back is secondary
            beside it, and leaving is a quiet text link. The disabled state also
            says WHY it is disabled, because a greyed-out button with no
            explanation is the single most common reason a form is abandoned —
            the student cannot see which field they missed.
          */}
          <div className="space-y-3 border-t border-slate-200/70 pt-5">
            {!isLastStep && !canAdvanceStep ? (
              <p className="text-center text-xs text-[var(--muted)] sm:text-left">
                Fill in the highlighted fields above to carry on.
              </p>
            ) : null}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                {step > 1 ? (
                  <button
                    type="button"
                    onClick={() => setStep((current) => Math.max(1, current - 1))}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                  >
                    Back
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => router.push("/auth/signin")}
                  className="text-sm font-medium text-[var(--muted)] underline-offset-4 transition hover:text-[var(--foreground)] hover:underline"
                >
                  I already have an account
                </button>
              </div>

              {!isLastStep ? (
                <button
                  type="button"
                  onClick={() => canAdvanceStep && setStep((current) => Math.min(stepCount, current + 1))}
                  disabled={!canAdvanceStep}
                  className="w-full rounded-xl bg-gradient-to-r from-[#0D7C7E] to-[#FF6600] px-8 py-3.5 text-sm font-bold text-white shadow-lg shadow-[#FF6600]/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none sm:w-auto"
                >
                  {nextButtonLabel}
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={loading || uploadingPhoto}
                  className="w-full rounded-xl bg-gradient-to-r from-[#0D7C7E] to-[#FF6600] px-8 py-3.5 text-sm font-bold text-white shadow-lg shadow-[#FF6600]/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {loading ? "Enrolling you…" : uploadingPhoto ? "Uploading your photo…" : "Finish and enrol me"}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
