"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { buildApiUrl } from "@/lib/api";
import Interactive3DCharacterLoader from "@/components/Interactive3DCharacterLoader";
import { countries, nigerianStates, packageOptions, professionOptions } from "@/app/auth/signup/options";

type BranchOption = { id: string; name: string; location?: string | null };

type SignUpFormClientProps = { pageTitle?: string; initialBranchName?: string };

const branchGuidanceMap: Record<string, string> = {
  Lagos: "Lagos branch students get access to weekday group classes and Lagos campus support.",
  Abuja: "Abuja branch students get access to capital city study plans and local visa guidance.",
  "Port Harcourt": "Port Harcourt branch students get local cohort support plus flexible evening sessions.",
};

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
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const stepCount = 3;
  const stepTitles = ["Program", "Profile", "Launch"];
  const stepIntroText = {
    1: "Pick your branch, pathway, and account details.",
    2: "Tell us about yourself so we can tailor your plan.",
    3: "Review and finish your signup quickly.",
  }[step] as string;
  const isLastStep = step === stepCount;
  const isDobValid = (value: string) => /^(0[1-9]|[12][0-9]|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/.test(value.trim());
  const isAusbildungPathway = pathway === "Ausbildung (vocational training)";
  const canAdvanceStep =
    step === 1
      ? name.trim() !== "" && email.trim() !== "" && password.length >= 8 && branchId !== "" && pathway.trim() !== "" && batch !== ""
      : step === 2
      ? phone.trim() !== "" && city.trim() !== "" && address.trim() !== "" && stateField.trim() !== "" && gender.trim() !== "" && dob.trim() !== "" && isDobValid(dob) && (!isAusbildungPathway || profession.trim() !== "")
      : true;
  const nextButtonLabel = !isLastStep ? "Next" : "Finish signup";
  const router = useRouter();
  const selectedBranch = branches.find((branch) => branch.id === branchId) || null;
  const branchHint = selectedBranch
    ? branchGuidanceMap[selectedBranch.name] || `You are signing up for the ${selectedBranch.name} branch.`
    : "Select Lagos, Abuja, or Port Harcourt to see branch-specific guidance.";

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

  // Returns the uploaded URL so callers can use it immediately — React state
  // updates (setPhotoUrl) are async and would still be stale in the same tick.
  const uploadFile = async (file: File): Promise<string> => {
    setUploadingPhoto(true);
    setError("");
    setPhotoFileName(file.name);

    try {
      const reader = new FileReader();
      const result = await new Promise<string | ArrayBuffer | null>((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });

      if (!result || typeof result !== "string") {
        throw new Error("Unable to read file");
      }

      const base64 = result.split(",")[1];
      const res = await fetch("/api/media/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type, data: base64 }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || "Upload failed");
      }

      const uploadedUrl = json.url || "";
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
    return <Interactive3DCharacterLoader />;
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
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>{branch.name}</option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs text-[var(--muted)]">{branchHint}</p>
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
                  <input id="password" name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-white" />
                </div>
              </div>
            </div>
          ) : step === 2 ? (
            <div className="space-y-6">
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
                  <label htmlFor="state" className="block text-sm font-semibold text-[var(--muted)]">State</label>
                  <select id="state" name="state" value={stateField} onChange={(e) => setStateField(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-white">
                    <option value="">Select state</option>
                    {nigerianStates.map((state) => (
                      <option key={state} value={state}>{state}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="country" className="block text-sm font-semibold text-[var(--muted)]">Country</label>
                  <select id="country" name="country" value={country} onChange={(e) => setCountry(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-white">
                    <option value="Nigeria">Nigeria</option>
                    {countries.filter((countryName) => countryName !== "Nigeria").map((countryName) => (
                      <option key={countryName} value={countryName}>{countryName}</option>
                    ))}
                  </select>
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
                  <p className="mt-2 text-sm text-[var(--muted)]">Branch: {selectedBranch?.name || "Not selected"}</p>
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
