"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PlatformShell from "@/components/PlatformShell";
import {
  AlertIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  KeyIcon,
  PackageIcon,
  PaletteIcon,
  PlusIcon,
  RefreshIcon,
  SparklesIcon,
  TrashIcon,
  UsersIcon,
  WalletIcon,
} from "@/components/icons";
import {
  EXTERNAL_EXAM_BODIES,
  defaultFeatures,
  type ExternalExamBody,
  type TenantFeatures,
} from "@/lib/tenant/features";

const EXAM_BODY_LABEL: Record<ExternalExamBody, string> = { osd: "ÖSD", telc: "telc" };

/** EduPrime's own brand blue — what a new school's colour field starts on. */
const EDUPRIME_BLUE = "#2563EB";

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

/* -------------------------------------------------------------------------- */
/* Small presentational helpers — a shared vocabulary so the whole console    */
/* reads as one product rather than a stack of forms.                         */
/* -------------------------------------------------------------------------- */

const FIELD =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_28%,transparent)]";

function btnPrimary(extra = "") {
  return `inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 ${extra}`;
}
function btnGhost(extra = "") {
  return `inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3.5 py-2 text-sm font-semibold text-[var(--foreground-soft)] transition hover:border-[var(--border-strong)] hover:text-[var(--foreground)] ${extra}`;
}

function Labeled({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block space-y-1.5 ${className ?? ""}`}>
      <span className="block text-xs font-semibold text-[var(--muted)]">{label}</span>
      {children}
      {hint && <span className="block text-[11px] leading-4 text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

function Badge({ tone, children }: { tone: "amber" | "green" | "neutral" | "red"; children: React.ReactNode }) {
  const map = {
    amber: "bg-[var(--warning-soft)] text-[var(--warning)]",
    green: "bg-[var(--success-soft)] text-[var(--success)]",
    red: "bg-[var(--danger-soft)] text-[var(--danger)]",
    neutral: "bg-[var(--surface-alt)] text-[var(--muted)]",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${map[tone]}`}
    >
      {children}
    </span>
  );
}

function planTone(plan: string): "amber" | "green" | "neutral" {
  const p = plan.toLowerCase();
  if (p.includes("trial")) return "amber";
  if (p.includes("active") || p.includes("paid") || p.includes("pro")) return "green";
  return "neutral";
}

function formatKobo(kobo: string | null | undefined) {
  if (kobo == null) return { text: "—", tone: "neutral" as const };
  const value = Number(BigInt(kobo)) / 100;
  const abs = Math.abs(value).toLocaleString("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  });
  if (value < 0) return { text: `−${abs}`, tone: "red" as const };
  if (value === 0) return { text: abs, tone: "neutral" as const };
  return { text: abs, tone: "green" as const };
}

function MoneyChip({ kobo }: { kobo: string | null | undefined }) {
  const { text, tone } = formatKobo(kobo);
  const cls =
    tone === "red"
      ? "bg-[var(--danger-soft)] text-[var(--danger)]"
      : tone === "green"
        ? "bg-[var(--success-soft)] text-[var(--success)]"
        : "text-[var(--muted)]";
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold tabular-nums ${cls}`}>
      {text}
    </span>
  );
}

function initialsOf(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  danger,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  danger?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-center gap-2 text-[var(--muted)]">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p
        className={`mt-2 text-2xl font-bold tabular-nums ${
          danger ? "text-[var(--danger)]" : "text-[var(--foreground)]"
        }`}
      >
        {value}
      </p>
    </div>
  );
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

  const chip = (on: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
      on
        ? "border-[var(--primary)] bg-[var(--primary)] text-white"
        : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--border-strong)]"
    }`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {EXTERNAL_EXAM_BODIES.map((body) => {
          const on = features.examCentre.externalBodies[body];
          return (
            <button key={body} type="button" onClick={() => toggleBody(body)} className={chip(on)}>
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
          className={chip(features.games.onlineCohortRequiresLiveClass)}
        >
          {features.games.onlineCohortRequiresLiveClass && <CheckCircleIcon className="h-3.5 w-3.5" />}
          Online cohort games require a live class
        </button>
      </div>
      <p className="text-[11px] leading-4 text-[var(--muted)]">
        ÖSD / telc booking is only worth turning on once this school actually has a confirmed fee and a
        real booking link with that awarding body. EasyWay&apos;s own are off for exactly that reason.
      </p>
      <Labeled label="Goethe referral link" hint="Leave blank to hide the Goethe card entirely.">
        <input
          value={features.examCentre.goetheReferralUrl ?? ""}
          onChange={(e) =>
            onChange({
              ...features,
              examCentre: { ...features.examCentre, goetheReferralUrl: e.target.value.trim() || null },
            })
          }
          placeholder="https://…"
          className={`${FIELD} font-mono text-xs`}
        />
      </Labeled>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export default function PlatformConsolePage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [onboardOpen, setOnboardOpen] = useState(false);

  /**
   * Held in state and shown until dismissed, because it exists exactly once.
   * A key that scrolls away, or that a re-render clears, is a key the operator
   * has to revoke and re-issue.
   */
  const [freshKey, setFreshKey] = useState<{ plaintext: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

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
      setOnboardOpen(false);
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
      setCopied(false);
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

  const totals = useMemo(() => {
    const students = tenants.reduce((n, t) => n + (t._count?.students ?? 0), 0);
    const apiKeys = tenants.reduce((n, t) => n + (t._count?.apiKeys ?? 0), 0);
    const balance = tenants.reduce(
      (n, t) => n + (t.credit?.balanceKobo ? Number(BigInt(t.credit.balanceKobo)) : 0),
      0,
    );
    return { students, apiKeys, balance };
  }, [tenants]);

  return (
    <PlatformShell label="Console">
      <div className="min-w-0 space-y-6">
        {/* Page header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Console</h1>
            <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">
              Every school on the platform, their usage, and the API keys their engineers integrate
              with. Nothing here reaches a student record.
            </p>
          </div>
          <button type="button" onClick={loadTenants} className={btnGhost("shrink-0")}>
            <RefreshIcon className="h-4 w-4" />
            Refresh
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]">
            <AlertIcon className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="min-w-0">{error}</p>
          </div>
        )}

        {/* KPI row */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={PackageIcon} label="Schools" value={tenants.length} />
          <Stat icon={UsersIcon} label="Students" value={totals.students.toLocaleString()} />
          <Stat icon={KeyIcon} label="API keys" value={totals.apiKeys} />
          <Stat
            icon={WalletIcon}
            label="Platform balance"
            value={formatKobo(String(totals.balance)).text}
            danger={totals.balance < 0}
          />
        </div>

        {/* One-time key reveal */}
        {freshKey && (
          <div className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--warning-soft)] p-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
              <KeyIcon className="h-5 w-5" />
              {freshKey.name} — copy this now
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Stored as a hash. This is the only time it can be shown, by design.
            </p>
            <code className="mt-3 block overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs text-[var(--foreground)]">
              {freshKey.plaintext}
            </code>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(freshKey.plaintext);
                  setCopied(true);
                }}
                className={btnPrimary("px-4 py-1.5 text-xs")}
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={() => setFreshKey(null)}
                className={btnGhost("px-4 py-1.5 text-xs")}
              >
                I have it
              </button>
            </div>
          </div>
        )}

        {/* Schools */}
        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">Schools</h2>
              <p className="text-xs text-[var(--muted)]">
                {loading ? "Loading…" : `${tenants.length} on the platform`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOnboardOpen((v) => !v)}
              className={onboardOpen ? btnGhost() : btnPrimary()}
            >
              <PlusIcon className="h-4 w-4" />
              {onboardOpen ? "Cancel" : "Onboard school"}
            </button>
          </div>

          {/* Onboard form — inline, above the table */}
          {onboardOpen && (
            <div className="space-y-5 border-b border-[var(--border)] bg-[var(--surface-alt)] p-5">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Labeled label="School name">
                  <input
                    value={newTenant.name}
                    onChange={(e) => setNewTenant({ ...newTenant, name: e.target.value })}
                    placeholder="Bright Futures Academy"
                    className={FIELD}
                  />
                </Labeled>
                <Labeled label="Slug" hint="Lowercase, hyphens. Used in URLs and key prefixes.">
                  <input
                    value={newTenant.slug}
                    onChange={(e) => setNewTenant({ ...newTenant, slug: e.target.value })}
                    placeholder="bright-futures"
                    className={`${FIELD} font-mono`}
                  />
                </Labeled>
                <Labeled label="Domain" hint="Optional. Point a CNAME here later.">
                  <input
                    value={newTenant.domain}
                    onChange={(e) => setNewTenant({ ...newTenant, domain: e.target.value })}
                    placeholder="lms.brightfutures.ng"
                    className={`${FIELD} font-mono`}
                  />
                </Labeled>
                <Labeled label="Display name" hint="Optional. What students see, if different.">
                  <input
                    value={newTenant.brandName}
                    onChange={(e) => setNewTenant({ ...newTenant, brandName: e.target.value })}
                    placeholder="Bright Futures"
                    className={FIELD}
                  />
                </Labeled>
                <Labeled label="Logo URL" hint="Optional. https:// only.">
                  <input
                    value={newTenant.logoUrl}
                    onChange={(e) => setNewTenant({ ...newTenant, logoUrl: e.target.value })}
                    placeholder="https://…"
                    className={`${FIELD} font-mono`}
                  />
                </Labeled>
                <Labeled label="Brand colour" hint="Optional. Hex.">
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={newTenant.primaryColor || EDUPRIME_BLUE}
                      onChange={(e) => setNewTenant({ ...newTenant, primaryColor: e.target.value })}
                      className="h-9 w-11 shrink-0 cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--surface)]"
                      aria-label="Brand colour"
                    />
                    <input
                      value={newTenant.primaryColor}
                      onChange={(e) => setNewTenant({ ...newTenant, primaryColor: e.target.value })}
                      placeholder={EDUPRIME_BLUE}
                      className={`${FIELD} font-mono`}
                    />
                  </div>
                </Labeled>
              </div>

              <div className="space-y-2 border-t border-[var(--border)] pt-4">
                <p className="text-xs font-semibold text-[var(--muted)]">
                  What they start with — everything the platform can deliver, on by default.
                </p>
                <FeatureToggleList features={newTenantFeatures} onChange={setNewTenantFeatures} />
              </div>

              <button
                type="button"
                disabled={busy || !newTenant.name || !newTenant.slug}
                onClick={createTenant}
                className={btnPrimary()}
              >
                {busy ? "Creating…" : "Create school"}
              </button>
            </div>
          )}

          {/* Table */}
          {loading ? (
            <div className="divide-y divide-[var(--border)]">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <div className="h-4 w-40 animate-pulse rounded bg-[var(--surface-alt)]" />
                  <div className="ml-auto h-4 w-16 animate-pulse rounded bg-[var(--surface-alt)]" />
                </div>
              ))}
            </div>
          ) : tenants.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <PackageIcon className="mx-auto h-8 w-8 text-[var(--muted)]" />
              <p className="mt-3 text-sm font-semibold">No schools yet</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Onboard the first one to start metering usage.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
                    <th className="px-5 py-2.5 font-semibold">School</th>
                    <th className="px-3 py-2.5 font-semibold">Plan</th>
                    <th className="px-3 py-2.5 font-semibold">Domain</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Students</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Keys</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Balance</th>
                    <th className="w-8 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((tenant) => {
                    const isSel = tenant.id === selected;
                    return (
                      <tr
                        key={tenant.id}
                        onClick={() => setSelected(isSel ? null : tenant.id)}
                        className={`cursor-pointer border-t border-[var(--border)] transition ${
                          isSel
                            ? "bg-[var(--accent-soft)]"
                            : "hover:bg-[var(--surface-alt)]"
                        }`}
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <span
                              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[11px] font-bold"
                              style={{
                                background: "color-mix(in srgb, var(--primary) 14%, transparent)",
                                color: "var(--primary)",
                              }}
                            >
                              {initialsOf(tenant.name)}
                            </span>
                            <div className="min-w-0">
                              <div className="truncate font-semibold">{tenant.name}</div>
                              <div className="truncate font-mono text-[11px] text-[var(--muted)]">
                                {tenant.slug}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone={planTone(tenant.plan)}>{tenant.plan}</Badge>
                        </td>
                        <td className="px-3 py-3 text-xs text-[var(--muted)]">
                          {tenant.domain ?? "—"}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{tenant._count.students}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{tenant._count.apiKeys}</td>
                        <td className="px-3 py-3 text-right">
                          <MoneyChip kobo={tenant.credit?.balanceKobo} />
                        </td>
                        <td className="px-3 py-3">
                          <ChevronRightIcon
                            className={`h-4 w-4 text-[var(--muted)] transition ${
                              isSel ? "rotate-90" : ""
                            }`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Selected school */}
        {current && (
          <div className="overflow-hidden rounded-2xl border-2 border-[color-mix(in_srgb,var(--primary)_40%,var(--border))] bg-[var(--surface)]">
            <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-alt)] px-5 py-4">
              <span
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-bold"
                style={{
                  background: "color-mix(in srgb, var(--primary) 14%, transparent)",
                  color: "var(--primary)",
                }}
              >
                {initialsOf(current.name)}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-base font-semibold">{current.name}</h2>
                <p className="flex items-center gap-2 text-xs text-[var(--muted)]">
                  <span className="font-mono">{current.slug}</span>
                  <Badge tone={planTone(current.plan)}>{current.plan}</Badge>
                </p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className={btnGhost("px-3 py-1.5 text-xs")}>
                Close
              </button>
            </div>

            <div className="space-y-5 p-5">
              {/* Branding */}
              <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <PaletteIcon className="h-4 w-4" />
                  How {current.name} looks
                </h3>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Applied to everyone on this school&apos;s own domain. Blank fields fall back to the
                  standard presentation.
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Labeled label="Display name" hint="What students see. The name above is what invoices say.">
                    <input
                      value={brand.brandName}
                      onChange={(e) => setBrand({ ...brand, brandName: e.target.value })}
                      placeholder={current.name}
                      className={FIELD}
                    />
                  </Labeled>
                  <Labeled label="Domain" hint="Nothing below applies until they point this at us.">
                    <input
                      value={brand.domain}
                      onChange={(e) => setBrand({ ...brand, domain: e.target.value })}
                      placeholder="lms.theirschool.com"
                      className={`${FIELD} font-mono`}
                    />
                  </Labeled>
                  <Labeled
                    label="Logo URL"
                    className="sm:col-span-2"
                    hint="A horizontal lockup, https only. The square emblem stays ours."
                  >
                    <input
                      value={brand.logoUrl}
                      onChange={(e) => setBrand({ ...brand, logoUrl: e.target.value })}
                      placeholder="https://… or /uploads/…"
                      className={`${FIELD} font-mono`}
                    />
                  </Labeled>
                  <Labeled label="Brand colour" hint="One colour. The pairing colour stays fixed.">
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={brand.primaryColor || EDUPRIME_BLUE}
                        onChange={(e) => setBrand({ ...brand, primaryColor: e.target.value })}
                        className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--surface)]"
                        aria-label="Brand colour"
                      />
                      <input
                        value={brand.primaryColor}
                        onChange={(e) => setBrand({ ...brand, primaryColor: e.target.value })}
                        placeholder={EDUPRIME_BLUE}
                        className={`${FIELD} font-mono`}
                      />
                    </div>
                  </Labeled>
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <button type="button" disabled={busy} onClick={saveBranding} className={btnPrimary()}>
                    Save branding
                  </button>
                  {brandSaved && (
                    <span className="flex items-center gap-1 text-xs font-semibold text-[var(--success)]">
                      <CheckCircleIcon className="h-4 w-4" />
                      Saved — live within the minute.
                    </span>
                  )}
                </div>
              </section>

              {/* Capabilities */}
              {features && (
                <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <SparklesIcon className="h-4 w-4" />
                    What {current.name} can do
                  </h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Switched on or off for this school specifically. An operator sets these, from a
                    request.
                  </p>
                  <div className="mt-4">
                    <FeatureToggleList
                      features={features}
                      onChange={(next) => {
                        setFeatures(next);
                        setFeaturesSaved(false);
                      }}
                    />
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <button type="button" disabled={busy} onClick={saveFeatures} className={btnPrimary()}>
                      Save capabilities
                    </button>
                    {featuresSaved && (
                      <span className="flex items-center gap-1 text-xs font-semibold text-[var(--success)]">
                        <CheckCircleIcon className="h-4 w-4" />
                        Saved — takes effect within the minute.
                      </span>
                    )}
                  </div>
                </section>
              )}

              {/* API keys */}
              <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <KeyIcon className="h-4 w-4" />
                  API keys
                </h3>

                {keys.length === 0 ? (
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    No keys yet. Nobody can call the API on this school&apos;s behalf.
                  </p>
                ) : (
                  <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                    <table className="w-full min-w-[560px] text-left text-sm">
                      <thead>
                        <tr className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
                          <th className="px-4 py-2.5 font-semibold">Name</th>
                          <th className="px-3 py-2.5 font-semibold">Prefix</th>
                          <th className="px-3 py-2.5 font-semibold">Env</th>
                          <th className="px-3 py-2.5 font-semibold">Last used</th>
                          <th className="px-3 py-2.5" />
                        </tr>
                      </thead>
                      <tbody>
                        {keys.map((key) => (
                          <tr key={key.id} className="border-t border-[var(--border)]">
                            <td className="px-4 py-2.5 font-medium">
                              {key.name}
                              {key.revokedAt && (
                                <span className="ml-2 text-[11px] font-semibold text-[var(--danger)]">
                                  revoked
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 font-mono text-xs text-[var(--muted)]">
                              ewk_{key.environment}_{key.prefix}
                            </td>
                            <td className="px-3 py-2.5">
                              <Badge tone={key.environment === "live" ? "green" : "neutral"}>
                                {key.environment}
                              </Badge>
                            </td>
                            <td className="px-3 py-2.5 text-xs text-[var(--muted)]">
                              {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : "never"}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              {!key.revokedAt && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => revokeKey(key.id)}
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--danger)] transition hover:opacity-80"
                                >
                                  <TrashIcon className="h-3.5 w-3.5" />
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

                <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
                  <p className="text-xs font-semibold text-[var(--muted)]">Issue a key</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Labeled label="What is it for?">
                      <input
                        value={newKey.name}
                        onChange={(e) => setNewKey({ ...newKey, name: e.target.value })}
                        placeholder="e.g. Student portal sync"
                        className={FIELD}
                      />
                    </Labeled>
                    <Labeled label="Environment">
                      <select
                        value={newKey.environment}
                        onChange={(e) => setNewKey({ ...newKey, environment: e.target.value })}
                        className={FIELD}
                      >
                        <option value="test">test — safe to make mistakes in</option>
                        <option value="live">live — real students, real money</option>
                      </select>
                    </Labeled>
                  </div>
                  <div>
                    <span className="mb-1.5 block text-xs font-semibold text-[var(--muted)]">Scopes</span>
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
                            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 font-mono text-[11px] font-medium transition ${
                              on
                                ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                                : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--border-strong)]"
                            }`}
                          >
                            {on && <CheckCircleIcon className="h-3 w-3" />}
                            {scope}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <button type="button" disabled={busy} onClick={issueKey} className={btnPrimary()}>
                    {busy ? "Issuing…" : "Issue key"}
                  </button>
                </div>
              </section>
            </div>
          </div>
        )}
      </div>
    </PlatformShell>
  );
}
