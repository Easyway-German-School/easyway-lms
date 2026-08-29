"use client";

import { useCallback, useEffect, useState } from "react";
import PlatformShell from "@/components/PlatformShell";
import {
  AlertIcon,
  CheckCircleIcon,
  KeyIcon,
  PaletteIcon,
  PlusIcon,
  RefreshIcon,
  ShieldIcon,
  SparklesIcon,
  TrashIcon,
} from "@/components/icons";
import {
  EXTERNAL_EXAM_BODIES,
  defaultFeatures,
  type ExternalExamBody,
  type TenantFeatures,
} from "@/lib/tenant/features";

const EXAM_BODY_LABEL: Record<ExternalExamBody, string> = { osd: "ÖSD", telc: "telc" };

/**
 * The platform console — the schools on the system, and the keys they hold.
 *
 * Reachable only by a platform operator, and the API behind it answers 404
 * rather than 403 to everybody else, so a school's own super admin who guesses
 * the URL is told there is nothing here rather than that there is something
 * they may not have.
 *
 * Lives at `/platform` (EduPrime), not `/admin/platform`: this screen manages
 * every school on the system, EasyWay included, so it does not wear EasyWay's
 * own admin chrome — it wears EduPrime's, the platform's own brand. Billing is
 * the sibling screen at `/platform/billing`. See PlatformShell.
 */

type Tenant = {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  domain: string | null;
  brandName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  trialEndsAt: string | null;
  createdAt: string;
  credit: { balanceKobo: string; lowBalanceKobo: string } | null;
  _count: { users: number; students: number; apiKeys: number };
};

type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  environment: string;
  scopes: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

const SCOPES = [
  "students:read",
  "students:write",
  "enrolments:read",
  "enrolments:write",
  "payments:read",
  "classes:read",
  "attendance:read",
  "attendance:write",
  "usage:read",
];

function naira(kobo: string | null | undefined): string {
  if (kobo == null) return "—";
  const value = Number(BigInt(kobo)) / 100;
  return value.toLocaleString("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
}

/**
 * The toggle set, shared between "what a new school starts with" and "what
 * this school can do right now" — one place so the two forms can't drift
 * apart on what a flag is called or what it does.
 */
function FeatureToggleList({
  features,
  onChange,
}: {
  features: TenantFeatures;
  onChange: (next: TenantFeatures) => void;
}) {
  function toggleBody(body: ExternalExamBody) {
    onChange({
      ...features,
      examCentre: {
        ...features.examCentre,
        externalBodies: {
          ...features.examCentre.externalBodies,
          [body]: !features.examCentre.externalBodies[body],
        },
      },
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {EXTERNAL_EXAM_BODIES.map((body) => {
          const on = features.examCentre.externalBodies[body];
          return (
            <button
              key={body}
              type="button"
              onClick={() => toggleBody(body)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                on ? "border-[var(--primary)] bg-[var(--primary)] text-white" : "border-[var(--border)] text-[var(--muted)]"
              }`}
            >
              {on && <CheckCircleIcon className="h-3.5 w-3.5" />}
              {EXAM_BODY_LABEL[body]} exam booking
            </button>
          );
        })}
        <button
          type="button"
          onClick={() =>
            onChange({
              ...features,
              games: {
                ...features.games,
                onlineCohortRequiresLiveClass: !features.games.onlineCohortRequiresLiveClass,
              },
            })
          }
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
            features.games.onlineCohortRequiresLiveClass
              ? "border-[var(--primary)] bg-[var(--primary)] text-white"
              : "border-[var(--border)] text-[var(--muted)]"
          }`}
        >
          {features.games.onlineCohortRequiresLiveClass && <CheckCircleIcon className="h-3.5 w-3.5" />}
          Online cohort games require a live class
        </button>
      </div>
      <p className="text-[11px] text-[var(--muted)]">
        ÖSD/telc booking is only worth turning on once this school actually has a confirmed fee and a real
        booking link with that awarding body — see the checklist on the student-facing exam centre. EasyWay&apos;s
        own are off for exactly that reason.
      </p>
      <label className="block space-y-1">
        <span className="text-xs font-semibold text-[var(--muted)]">Goethe referral link</span>
        <input
          value={features.examCentre.goetheReferralUrl ?? ""}
          onChange={(e) =>
            onChange({
              ...features,
              examCentre: { ...features.examCentre, goetheReferralUrl: e.target.value.trim() || null },
            })
          }
          placeholder="Leave blank to hide the Goethe card entirely"
          className="w-full rounded-xl border border-[var(--border)] px-3 py-2 font-mono text-xs"
        />
      </label>
    </div>
  );
}

export default function PlatformConsolePage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);

  /**
   * Held in state and shown until dismissed, because it exists exactly once.
   * A key that scrolls away, or that a re-render clears, is a key the operator
   * has to revoke and re-issue.
   */
  const [freshKey, setFreshKey] = useState<{ plaintext: string; name: string } | null>(null);

  const [newTenant, setNewTenant] = useState({
    name: "",
    slug: "",
    domain: "",
    brandName: "",
    logoUrl: "",
    primaryColor: "",
  });
  const [newTenantFeatures, setNewTenantFeatures] = useState<TenantFeatures>(defaultFeatures());
  /**
   * The selected tenant's feature toggles, held separately from `brand` below
   * for the same reason the two save to separate routes: they write a
   * different table with different validation, and letting one form own both
   * risks a colour save clobbering an in-progress feature edit.
   */
  const [features, setFeatures] = useState<TenantFeatures | null>(null);
  const [featuresSaved, setFeaturesSaved] = useState(false);
  const [newKey, setNewKey] = useState<{ name: string; environment: string; scopes: string[] }>({
    name: "",
    environment: "test",
    scopes: [],
  });
  const [busy, setBusy] = useState(false);

  const loadTenants = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/platform/tenants");
      if (response.status === 404) {
        setError("This console is for platform operators. Your account is not one.");
        return;
      }
      if (!response.ok) throw new Error(`Failed with ${response.status}`);
      const data = await response.json();
      setTenants(data.tenants ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the schools.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadKeys = useCallback(async (tenantId: string) => {
    const response = await fetch(`/api/platform/tenants/${tenantId}/keys`);
    if (!response.ok) return;
    const data = await response.json();
    setKeys(data.keys ?? []);
  }, []);

  const loadFeatures = useCallback(async (tenantId: string) => {
    const response = await fetch(`/api/platform/tenants/${tenantId}/features`);
    if (!response.ok) return;
    const data = await response.json();
    setFeatures(data.features ?? defaultFeatures());
    setFeaturesSaved(false);
  }, []);

  useEffect(() => {
    loadTenants();
  }, [loadTenants]);

  useEffect(() => {
    if (selected) {
      loadKeys(selected);
      loadFeatures(selected);
    } else {
      setKeys([]);
      setFeatures(null);
    }
  }, [selected, loadKeys, loadFeatures]);

  async function createTenant() {
    setBusy(true);
    try {
      const response = await fetch("/api/platform/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newTenant, features: newTenantFeatures }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not create the school.");
      setNewTenant({ name: "", slug: "", domain: "", brandName: "", logoUrl: "", primaryColor: "" });
      setNewTenantFeatures(defaultFeatures());
      await loadTenants();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the school.");
    } finally {
      setBusy(false);
    }
  }

  async function issueKey() {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/platform/tenants/${selected}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newKey),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not issue the key.");
      setFreshKey({ plaintext: data.plaintext, name: data.key.name });
      setNewKey({ name: "", environment: "test", scopes: [] });
      await loadKeys(selected);
      await loadTenants();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not issue the key.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(keyId: string) {
    setBusy(true);
    try {
      await fetch(`/api/platform/keys/${keyId}`, { method: "DELETE" });
      if (selected) await loadKeys(selected);
    } finally {
      setBusy(false);
    }
  }

  /**
   * The branding form is seeded from the selected school and then owned by the
   * form, not re-derived on every render. Re-deriving would overwrite whatever
   * the operator was halfway through typing each time `loadTenants` returned.
   */
  const [brand, setBrand] = useState({ brandName: "", logoUrl: "", primaryColor: "", domain: "" });
  const [brandSaved, setBrandSaved] = useState(false);

  useEffect(() => {
    const tenant = tenants.find((t) => t.id === selected);
    if (!tenant) return;
    setBrand({
      brandName: tenant.brandName ?? "",
      logoUrl: tenant.logoUrl ?? "",
      primaryColor: tenant.primaryColor ?? "",
      domain: tenant.domain ?? "",
    });
    setBrandSaved(false);
    // Seeding is keyed on WHICH school is selected, not on the tenants array —
    // adding `tenants` here would re-seed (and so discard) the form on every
    // background refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  async function saveBranding() {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/platform/tenants/${selected}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(brand),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save.");
      setBrandSaved(true);
      setError(null);
      await loadTenants();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function saveFeatures() {
    if (!selected || !features) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/platform/tenants/${selected}/features`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(features),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save.");
      setFeaturesSaved(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  const current = tenants.find((t) => t.id === selected) ?? null;

  return (
    <PlatformShell label="Console">
      <div className="min-w-0 space-y-8">
        <header>
          <h1 className="flex items-center gap-3 text-3xl font-bold">
            <ShieldIcon className="h-7 w-7" />
            Platform
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
            The schools running on this system, and the keys their engineers integrate with.
            Separate from running any one school: nothing here reaches a student record.
          </p>
        </header>

        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950/30">
            <AlertIcon className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="min-w-0">{error}</p>
          </div>
        )}

        {freshKey && (
          <div className="rounded-3xl border-2 border-amber-400 bg-amber-50 p-5 dark:bg-amber-950/20">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <KeyIcon className="h-5 w-5" />
              {freshKey.name} — copy this now
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Stored as a hash. This is the only time it can be shown, by design.
            </p>
            <code className="mt-3 block overflow-x-auto rounded-xl bg-[var(--surface)] p-3 font-mono text-xs">
              {freshKey.plaintext}
            </code>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(freshKey.plaintext)}
                className="rounded-full border border-[var(--border)] px-4 py-1.5 text-xs font-semibold"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() => setFreshKey(null)}
                className="rounded-full px-4 py-1.5 text-xs font-semibold text-[var(--muted)]"
              >
                I have it
              </button>
            </div>
          </div>
        )}

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Schools</h2>
            <button
              type="button"
              onClick={loadTenants}
              className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-1.5 text-xs font-semibold"
            >
              <RefreshIcon className="h-4 w-4" />
              Refresh
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-[var(--muted)]">Loading…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-xs text-[var(--muted)]">
                  <tr>
                    <th className="py-2 pr-4">School</th>
                    <th className="py-2 pr-4">Domain</th>
                    <th className="py-2 pr-4">Plan</th>
                    <th className="py-2 pr-4">Students</th>
                    <th className="py-2 pr-4">Keys</th>
                    <th className="py-2 pr-4">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((tenant) => (
                    <tr
                      key={tenant.id}
                      onClick={() => setSelected(tenant.id === selected ? null : tenant.id)}
                      className={`cursor-pointer border-t border-[var(--border)] ${
                        tenant.id === selected ? "bg-[var(--surface)]" : ""
                      }`}
                    >
                      <td className="py-2 pr-4">
                        <span className="font-semibold">{tenant.name}</span>
                        <span className="ml-2 text-xs text-[var(--muted)]">{tenant.slug}</span>
                      </td>
                      <td className="py-2 pr-4 text-xs text-[var(--muted)]">
                        {tenant.domain ?? "—"}
                      </td>
                      <td className="py-2 pr-4">{tenant.plan}</td>
                      <td className="py-2 pr-4">{tenant._count.students}</td>
                      <td className="py-2 pr-4">{tenant._count.apiKeys}</td>
                      <td className="py-2 pr-4">{naira(tenant.credit?.balanceKobo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <PlusIcon className="h-5 w-5" />
            Onboard a school
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <input
              value={newTenant.name}
              onChange={(e) => setNewTenant({ ...newTenant, name: e.target.value })}
              placeholder="Name"
              className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
            />
            <input
              value={newTenant.slug}
              onChange={(e) => setNewTenant({ ...newTenant, slug: e.target.value })}
              placeholder="slug (lowercase-hyphens)"
              className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
            />
            <input
              value={newTenant.domain}
              onChange={(e) => setNewTenant({ ...newTenant, domain: e.target.value })}
              placeholder="domain (optional)"
              className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
            />
            <input
              value={newTenant.brandName}
              onChange={(e) => setNewTenant({ ...newTenant, brandName: e.target.value })}
              placeholder="Display name (optional)"
              className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
            />
            <input
              value={newTenant.logoUrl}
              onChange={(e) => setNewTenant({ ...newTenant, logoUrl: e.target.value })}
              placeholder="Logo URL (optional)"
              className="rounded-xl border border-[var(--border)] px-3 py-2 font-mono text-sm"
            />
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={newTenant.primaryColor || "#FF6600"}
                onChange={(e) => setNewTenant({ ...newTenant, primaryColor: e.target.value })}
                className="h-10 w-12 shrink-0 cursor-pointer rounded-xl border border-[var(--border)]"
              />
              <input
                value={newTenant.primaryColor}
                onChange={(e) => setNewTenant({ ...newTenant, primaryColor: e.target.value })}
                placeholder="Brand colour (optional)"
                className="w-full rounded-xl border border-[var(--border)] px-3 py-2 font-mono text-sm"
              />
            </div>
          </div>

          <div className="space-y-2 border-t border-[var(--border)] pt-4">
            <p className="text-xs font-semibold text-[var(--muted)]">
              What they start with — everything the platform can actually deliver, checked by default.
            </p>
            <FeatureToggleList features={newTenantFeatures} onChange={setNewTenantFeatures} />
          </div>

          <button
            type="button"
            disabled={busy || !newTenant.name || !newTenant.slug}
            onClick={createTenant}
            className="rounded-full bg-[var(--primary)] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Create
          </button>
        </section>

        {current && (
          <section className="space-y-4 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <PaletteIcon className="h-5 w-5" />
              How {current.name} looks
            </h2>
            <p className="text-sm text-[var(--muted)]">
              Applied to everyone arriving on this school&apos;s own domain. Leave any of it blank
              and they get the standard EasyWay presentation.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-semibold text-[var(--muted)]">Display name</span>
                <input
                  value={brand.brandName}
                  onChange={(e) => setBrand({ ...brand, brandName: e.target.value })}
                  placeholder={current.name}
                  className="w-full rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
                />
                <span className="block text-xs text-[var(--muted)]">
                  What students see. The name above is what invoices say.
                </span>
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold text-[var(--muted)]">Domain</span>
                <input
                  value={brand.domain}
                  onChange={(e) => setBrand({ ...brand, domain: e.target.value })}
                  placeholder="lms.theirschool.com"
                  className="w-full rounded-xl border border-[var(--border)] px-3 py-2 font-mono text-sm"
                />
                <span className="block text-xs text-[var(--muted)]">
                  Nothing below applies until they point this at us.
                </span>
              </label>

              <label className="space-y-1 sm:col-span-2">
                <span className="text-xs font-semibold text-[var(--muted)]">Logo URL</span>
                <input
                  value={brand.logoUrl}
                  onChange={(e) => setBrand({ ...brand, logoUrl: e.target.value })}
                  placeholder="https://… or /uploads/…"
                  className="w-full rounded-xl border border-[var(--border)] px-3 py-2 font-mono text-sm"
                />
                <span className="block text-xs text-[var(--muted)]">
                  A horizontal lockup. Must be https — plain http is blocked as mixed content and
                  would simply never appear. The square emblem stays ours.
                </span>
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold text-[var(--muted)]">Brand colour</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={brand.primaryColor || "#FF6600"}
                    onChange={(e) => setBrand({ ...brand, primaryColor: e.target.value })}
                    className="h-10 w-14 shrink-0 cursor-pointer rounded-xl border border-[var(--border)]"
                  />
                  <input
                    value={brand.primaryColor}
                    onChange={(e) => setBrand({ ...brand, primaryColor: e.target.value })}
                    placeholder="#FF6600"
                    className="w-full rounded-xl border border-[var(--border)] px-3 py-2 font-mono text-sm"
                  />
                </div>
                <span className="block text-xs text-[var(--muted)]">
                  One colour. The teal it pairs with stays fixed — deriving a second colour from
                  one picked value is what makes a product look generated.
                </span>
              </label>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={saveBranding}
                className="rounded-full bg-[var(--primary)] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Save
              </button>
              {brandSaved && (
                <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700">
                  <CheckCircleIcon className="h-4 w-4" />
                  Saved. Their users see it within the minute.
                </span>
              )}
            </div>
          </section>
        )}

        {current && features && (
          <section className="space-y-4 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <SparklesIcon className="h-5 w-5" />
              What {current.name} can do
            </h2>
            <p className="text-sm text-[var(--muted)]">
              What we built for EasyWay, switched on or off for this school specifically. They don&apos;t set
              these themselves — an operator does, from a request.
            </p>

            <FeatureToggleList
              features={features}
              onChange={(next) => {
                setFeatures(next);
                setFeaturesSaved(false);
              }}
            />

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={saveFeatures}
                className="rounded-full bg-[var(--primary)] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Save
              </button>
              {featuresSaved && (
                <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700">
                  <CheckCircleIcon className="h-4 w-4" />
                  Saved. Takes effect within the minute.
                </span>
              )}
            </div>
          </section>
        )}

        {current && (
          <section className="space-y-4 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <KeyIcon className="h-5 w-5" />
              API keys — {current.name}
            </h2>

            {keys.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                No keys yet. Nobody can call the API on this school&apos;s behalf.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="text-xs text-[var(--muted)]">
                    <tr>
                      <th className="py-2 pr-4">Name</th>
                      <th className="py-2 pr-4">Prefix</th>
                      <th className="py-2 pr-4">Env</th>
                      <th className="py-2 pr-4">Last used</th>
                      <th className="py-2 pr-4"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((key) => (
                      <tr key={key.id} className="border-t border-[var(--border)]">
                        <td className="py-2 pr-4">
                          {key.name}
                          {key.revokedAt && (
                            <span className="ml-2 text-xs text-red-600">revoked</span>
                          )}
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs">ewk_{key.environment}_{key.prefix}</td>
                        <td className="py-2 pr-4">{key.environment}</td>
                        <td className="py-2 pr-4 text-xs text-[var(--muted)]">
                          {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : "never"}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {!key.revokedAt && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => revokeKey(key.id)}
                              className="flex items-center gap-1 text-xs font-semibold text-red-600"
                            >
                              <TrashIcon className="h-4 w-4" />
                              Revoke
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="space-y-3 border-t border-[var(--border)] pt-4">
              <p className="text-sm font-semibold">Issue a key</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  value={newKey.name}
                  onChange={(e) => setNewKey({ ...newKey, name: e.target.value })}
                  placeholder="What is it for? e.g. Student portal sync"
                  className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
                />
                <select
                  value={newKey.environment}
                  onChange={(e) => setNewKey({ ...newKey, environment: e.target.value })}
                  className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
                >
                  <option value="test">test — safe to make mistakes in</option>
                  <option value="live">live — real students, real money</option>
                </select>
              </div>
              <div className="flex flex-wrap gap-2">
                {SCOPES.map((scope) => {
                  const on = newKey.scopes.includes(scope);
                  return (
                    <button
                      key={scope}
                      type="button"
                      onClick={() =>
                        setNewKey({
                          ...newKey,
                          scopes: on
                            ? newKey.scopes.filter((s) => s !== scope)
                            : [...newKey.scopes, scope],
                        })
                      }
                      className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
                        on
                          ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                          : "border-[var(--border)]"
                      }`}
                    >
                      {on && <CheckCircleIcon className="h-3 w-3" />}
                      {scope}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={issueKey}
                className="rounded-full bg-[var(--primary)] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Issue
              </button>
            </div>
          </section>
        )}
      </div>
    </PlatformShell>
  );
}
