"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { PlusIcon, RefreshIcon, StarIcon } from "@/components/icons";

/**
 * The admin door into the Influencer Program: every partner (influencer,
 * travel agent, other), and a click-through into each one's own dashboard
 * — see src/components/InfluencerDashboard.tsx, rendered at
 * /admin/influencer-program/[userId] in admin mode. This used to be mixed
 * into /admin/referrals alongside student referral codes, with no way to
 * open an individual partner's view at all; that page is student referrals
 * only now (see src/app/admin/referrals/page.tsx).
 */

type Code = {
  id: string;
  code: string;
  type: "student_referral" | "influencer";
  status: "active" | "paused" | "revoked";
  partnerType: "influencer" | "travel_agent" | "ambassador" | "other" | null;
  label: string | null;
  ownerUser: { id: string; name: string | null; email: string } | null;
  ownerStudent: unknown;
  _count: { redemptions: number };
};

const PARTNER_TYPE_LABEL: Record<string, string> = {
  influencer: "Influencer",
  travel_agent: "Travel agent",
  ambassador: "Easyway ambassador",
  other: "Partner",
};
const PARTNER_TYPES = ["influencer", "travel_agent", "ambassador", "other"] as const;

export default function InfluencerProgramHubPage() {
  const [codes, setCodes] = useState<Code[] | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | (typeof PARTNER_TYPES)[number]>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState<{ email: string; password: string } | null>(null);

  const [form, setForm] = useState({
    ownerName: "",
    ownerEmail: "",
    code: "",
    label: "",
    partnerType: "influencer" as (typeof PARTNER_TYPES)[number],
    discountPercent: "",
    discountFlat: "",
    commissionPercent: "",
    commissionFlat: "",
  });

  function refresh(message?: string) {
    setLoading(true);
    setError("");
    if (message) setNotice(message);
    setRefreshKey((k) => k + 1);
  }

  useEffect(() => {
    let active = true;
    fetch("/api/admin/promo-codes", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Unable to load partners.");
        return body as { codes: Code[] };
      })
      .then((result) => {
        if (!active) return;
        setCodes(result.codes.filter((c) => c.type === "influencer"));
        setError("");
      })
      .catch((cause: unknown) => active && setError(cause instanceof Error ? cause.message : "Unable to load partners."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const filtered = useMemo(
    () => (codes ?? []).filter((c) => typeFilter === "all" || (c.partnerType ?? "influencer") === typeFilter),
    [codes, typeFilter],
  );

  async function createPartner(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setGeneratedPassword(null);
    try {
      const res = await fetch("/api/admin/promo-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code,
          label: form.label,
          ownerEmail: form.ownerEmail,
          ownerName: form.ownerName,
          partnerType: form.partnerType,
          discountPercent: form.discountPercent || null,
          discountFlat: form.discountFlat || null,
          commissionPercent: form.commissionPercent || null,
          commissionFlat: form.commissionFlat || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Unable to add this partner.");
      if (body.generatedPassword) {
        setGeneratedPassword({ email: form.ownerEmail.trim().toLowerCase(), password: body.generatedPassword });
      }
      setForm({ ownerName: "", ownerEmail: "", code: "", label: "", partnerType: "influencer", discountPercent: "", discountFlat: "", commissionPercent: "", commissionFlat: "" });
      setShowForm(false);
      refresh("Partner added.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to add this partner.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <main className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">Influencer Program</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Every influencer, travel agent, Easyway ambassador and other partner — click a name to open their own
              dashboard, exactly as they see it.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold disabled:opacity-50">
              <RefreshIcon className="h-4 w-4" />
              Refresh
            </button>
            <button type="button" onClick={() => setShowForm((v) => !v)} className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white">
              <PlusIcon className="h-4 w-4" />
              Add partner
            </button>
          </div>
        </header>

        {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p> : null}
        {notice ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{notice}</p> : null}
        {generatedPassword ? (
          <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-bold">Account created for {generatedPassword.email}.</p>
            <p className="mt-1">
              Temporary password: <span className="font-mono font-bold">{generatedPassword.password}</span> — share this with
              them directly; it won't be shown again.
            </p>
          </div>
        ) : null}

        {showForm ? (
          <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div>
              <h2 className="text-lg font-bold">Add a partner</h2>
              <p className="text-sm text-[var(--muted)]">
                One step: if nobody has an account at this email yet, it's created for you (adminRole Influencer) and
                linked to this code — no separate trip to /admin/staff.
              </p>
            </div>
            <form onSubmit={createPartner} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-sm font-semibold">
                Name
                <input required value={form.ownerName} onChange={(e) => setForm((f) => ({ ...f, ownerName: e.target.value }))} placeholder="John Okafor" className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
              </label>
              <label className="text-sm font-semibold">
                Email
                <input required type="email" value={form.ownerEmail} onChange={(e) => setForm((f) => ({ ...f, ownerEmail: e.target.value }))} placeholder="john@example.com" className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
              </label>
              <label className="text-sm font-semibold">
                Partner type
                <select value={form.partnerType} onChange={(e) => setForm((f) => ({ ...f, partnerType: e.target.value as (typeof PARTNER_TYPES)[number] }))} className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
                  <option value="influencer">Influencer</option>
                  <option value="travel_agent">Travel agent</option>
                  <option value="ambassador">Easyway ambassador</option>
                  <option value="other">Other partner</option>
                </select>
              </label>
              <label className="text-sm font-semibold">
                Code
                <input required value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="EASYWAY-JOHN" className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-mono" />
              </label>
              <label className="text-sm font-semibold">
                Display label (optional)
                <input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="John's audience" className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
              </label>
              <div />
              <label className="text-sm font-semibold">
                Student discount — %
                <input type="number" min={0} value={form.discountPercent} onChange={(e) => setForm((f) => ({ ...f, discountPercent: e.target.value }))} className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
              </label>
              <label className="text-sm font-semibold">
                Student discount — flat ₦
                <input type="number" min={0} value={form.discountFlat} onChange={(e) => setForm((f) => ({ ...f, discountFlat: e.target.value }))} className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
              </label>
              <label className="text-sm font-semibold">
                Their commission — %
                <input type="number" min={0} value={form.commissionPercent} onChange={(e) => setForm((f) => ({ ...f, commissionPercent: e.target.value }))} className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
              </label>
              <label className="text-sm font-semibold">
                Their commission — flat ₦
                <input type="number" min={0} value={form.commissionFlat} onChange={(e) => setForm((f) => ({ ...f, commissionFlat: e.target.value }))} className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
              </label>
              <div className="flex items-end">
                <button type="submit" disabled={busy} className="w-full rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                  {busy ? "Adding…" : "Add partner"}
                </button>
              </div>
            </form>
          </section>
        ) : null}

        <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex flex-wrap gap-2">
            {(["all", ...PARTNER_TYPES] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter(t)}
                className={`rounded-full px-3 py-1.5 text-xs font-bold ${typeFilter === t ? "bg-[var(--accent)] text-white" : "border border-[var(--border)]"}`}
              >
                {t === "all" ? "All" : PARTNER_TYPE_LABEL[t]}
              </button>
            ))}
          </div>

          {loading ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">No partners yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {filtered.map((c) => (
                <li key={c.id}>
                  {c.ownerUser ? (
                    <Link
                      href={`/admin/influencer-program/${c.ownerUser.id}`}
                      className="flex flex-wrap items-center justify-between gap-3 py-3.5 hover:bg-[var(--surface-alt)]"
                    >
                      <div>
                        <p className="font-semibold text-[var(--foreground)]">{c.ownerUser.name || c.ownerUser.email}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {c.ownerUser.email} · {c.code} {c.label ? `· ${c.label}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-100 to-amber-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-amber-800 ring-1 ring-inset ring-amber-300/70">
                          <StarIcon className="h-3 w-3" strokeWidth={1.8} />
                          {PARTNER_TYPE_LABEL[c.partnerType ?? "influencer"]}
                        </span>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${
                            c.status === "active" ? "bg-emerald-100 text-emerald-900" : c.status === "paused" ? "bg-amber-100 text-amber-900" : "bg-rose-100 text-rose-900"
                          }`}
                        >
                          {c.status}
                        </span>
                        <span className="text-sm tabular-nums text-[var(--muted)]">{c._count.redemptions} sign-ups</span>
                      </div>
                    </Link>
                  ) : (
                    <div className="py-3.5 text-sm text-[var(--muted)]">{c.code} — no linked account</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </AdminShell>
  );
}
