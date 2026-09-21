"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import AdminShell from "@/components/AdminShell";
import { WalletIcon } from "@/components/icons";
import {
  DEFAULT_PRICE_BOOK,
  FEE_TIERS,
  PRICE_LEVELS,
  defaultPriceBook,
  diffPriceBooks,
  type FeeTier,
  type PriceBook,
} from "@/lib/price-book";

/**
 * Prices & programs — what the school charges, editable without a deploy.
 *
 * Three price tables (group tuition by branch tier, private tuition by level,
 * the Travel Package) plus, underneath, the list of students whose tuition
 * charge no longer matches — because a charge freezes its fee when it is
 * raised, so saving a new price changes what NEW students pay and leaves
 * everyone already enrolled exactly where they were until an admin says
 * otherwise. See src/lib/finance/reprice.ts.
 */

type OutOfStepRow = {
  chargeId: string;
  studentName: string;
  studentCode: string | null;
  level: string;
  classType: string;
  branchName: string | null;
  currentAmount: number;
  newAmount: number;
  paid: number;
  owedAfter: number;
  overpaidBy: number;
};

const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;

const TIER_HEADINGS: Record<FeeTier, { title: string; hint: string }> = {
  standard: { title: "Standard campuses", hint: "Lagos, Port Harcourt, Ghana and any other campus" },
  premium: { title: "Abuja", hint: "Branches with “Abuja” in the name" },
  online: { title: "Online", hint: "Branches marked online" },
};

const clone = (book: PriceBook): PriceBook => JSON.parse(JSON.stringify(book));

function PriceInput({
  value,
  changed,
  label,
  onChange,
}: {
  value: number;
  changed: boolean;
  label: string;
  onChange: (next: number) => void;
}) {
  return (
    <div
      className={`flex items-center rounded-lg border bg-[var(--background)] px-3 py-2 ${
        changed ? "border-[var(--accent)] ring-1 ring-[var(--accent)]" : "border-[var(--border)]"
      }`}
    >
      <span className="mr-1 text-sm text-[var(--muted)]">₦</span>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        step={1000}
        aria-label={label}
        value={value || ""}
        onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) || 0)))}
        className="w-full min-w-[6rem] bg-transparent text-sm font-semibold text-[var(--foreground)] outline-none"
      />
    </div>
  );
}

export default function PricingSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<PriceBook>(() => defaultPriceBook());
  const [draft, setDraft] = useState<PriceBook>(() => defaultPriceBook());
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const [rows, setRows] = useState<OutOfStepRow[]>([]);
  const [rowsTotal, setRowsTotal] = useState(0);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [applyMessage, setApplyMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const changes = useMemo(() => diffPriceBooks(saved, draft), [saved, draft]);
  const dirty = changes.length > 0;

  const loadRows = useCallback(async () => {
    setRowsLoading(true);
    try {
      const res = await fetch("/api/admin/settings/pricing/charges", { cache: "no-store" });
      if (!res.ok) throw new Error("load failed");
      const data = await res.json();
      setRows(data.rows ?? []);
      setRowsTotal(data.total ?? 0);
      setSelected(new Set());
    } catch {
      setApplyMessage({ tone: "error", text: "Could not load the list of students on an old price." });
    } finally {
      setRowsLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/settings/pricing", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMessage({ tone: "error", text: data?.error || "Could not load the price list." });
        } else {
          setSaved(data.book);
          setDraft(clone(data.book));
          setSavedAt(data.savedAt ?? null);
        }
      } catch {
        setMessage({ tone: "error", text: "Could not load the price list." });
      } finally {
        setLoading(false);
      }
      await loadRows();
    })();
  }, [loadRows]);

  function setGroup(tier: FeeTier, level: string, value: number) {
    setDraft((prev) => ({ ...prev, group: { ...prev.group, [tier]: { ...prev.group[tier], [level]: value } } }));
  }
  function setPrivate(level: string, value: number) {
    setDraft((prev) => ({ ...prev, private: { ...prev.private, [level]: value } }));
  }
  function setTravel(field: "price" | "minFirstPayment", value: number) {
    setDraft((prev) => ({ ...prev, travelPackage: { ...prev.travelPackage, [field]: value } }));
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/settings/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book: draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ tone: "error", text: data?.error || "Could not save the price list." });
        return;
      }
      setSaved(data.book);
      setDraft(clone(data.book));
      setSavedAt(new Date().toISOString());
      const n = (data.changes ?? []).length;
      setMessage({
        tone: "ok",
        text: n
          ? `Saved — ${n} price${n === 1 ? "" : "s"} changed and live now. Students already enrolled keep their current bill until you update them below.`
          : "Nothing to save — the prices are unchanged.",
      });
      void loadRows();
    } catch {
      setMessage({ tone: "error", text: "Could not save the price list." });
    } finally {
      setSaving(false);
    }
  }

  function resetToDefaults() {
    if (!window.confirm("Put every price back to the school's original figures? You still have to press Save for it to take effect.")) return;
    setDraft(clone(DEFAULT_PRICE_BOOK));
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyReprice() {
    const ids = [...selected];
    if (!ids.length) return;
    const picked = rows.filter((r) => selected.has(r.chargeId));
    const raises = picked.filter((r) => r.newAmount > r.currentAmount).length;
    const prompt =
      `Update ${ids.length} student${ids.length === 1 ? "" : "s"} to the price list?` +
      (raises ? `\n\n${raises} of them will owe MORE than they do now.` : "") +
      "\n\nTheir new bill takes effect immediately and this is recorded in the audit trail.";
    if (!window.confirm(prompt)) return;

    setApplying(true);
    setApplyMessage(null);
    try {
      const res = await fetch("/api/admin/settings/pricing/charges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chargeIds: ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setApplyMessage({ tone: "error", text: data?.error || "Could not update those students." });
        return;
      }
      const done = (data.updated ?? []) as Array<{ studentName: string; from: number; to: number }>;
      const skipped = (data.skipped ?? []).length;
      setApplyMessage({
        tone: "ok",
        text:
          (done.length
            ? `Updated ${done.length} student${done.length === 1 ? "" : "s"}: ${done
                .slice(0, 5)
                .map((d) => `${d.studentName} ${naira(d.from)} → ${naira(d.to)}`)
                .join("; ")}${done.length > 5 ? "; …" : ""}.`
            : "Nothing was updated.") +
          (skipped ? ` ${skipped} skipped — already fixed or no longer eligible.` : ""),
      });
      await loadRows();
    } catch {
      setApplyMessage({ tone: "error", text: "Could not update those students." });
    } finally {
      setApplying(false);
    }
  }

  if (loading) {
    return (
      <AdminShell>
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-[var(--muted)]">Loading the price list…</p>
        </div>
      </AdminShell>
    );
  }

  const cardClass = "rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm";
  const th = "px-3 py-2 text-left text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]";

  return (
    <AdminShell>
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <WalletIcon className="h-8 w-8 text-[var(--accent)]" />
            <h1 className="text-3xl font-bold text-[var(--foreground)]">Prices &amp; programs</h1>
          </div>
          <p className="text-[var(--muted)]">
            What the school charges for each class and programme. Changes go live within seconds — no deploy needed.
          </p>
          <p className="text-xs text-[var(--muted)]">
            {savedAt ? `Last saved ${new Date(savedAt).toLocaleString("en-NG")}.` : "Never edited — showing the school's original prices."}{" "}
            <Link href="/admin/settings" className="underline">
              Back to general settings
            </Link>
          </p>
        </div>

        {message && (
          <div
            role="status"
            className={`rounded-lg px-4 py-3 text-sm font-medium ${
              message.tone === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Group tuition */}
        <section className={cardClass}>
          <h2 className="text-lg font-bold text-[var(--foreground)]">Group class tuition</h2>
          <p className="mb-4 mt-1 text-sm text-[var(--muted)]">
            The price of a level in the group class, by the kind of branch the student joins.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-separate border-spacing-y-1">
              <thead>
                <tr>
                  <th className={th}>Level</th>
                  {FEE_TIERS.map((tier) => (
                    <th key={tier} className={th}>
                      {TIER_HEADINGS[tier].title}
                      <span className="block text-[10px] font-normal normal-case tracking-normal">{TIER_HEADINGS[tier].hint}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PRICE_LEVELS.map((level) => (
                  <tr key={level}>
                    <td className="px-3 py-1 text-sm font-bold text-[var(--foreground)]">{level}</td>
                    {FEE_TIERS.map((tier) => (
                      <td key={tier} className="px-3 py-1">
                        <PriceInput
                          value={draft.group[tier][level]}
                          changed={draft.group[tier][level] !== saved.group[tier][level]}
                          label={`${TIER_HEADINGS[tier].title} ${level} group tuition in naira`}
                          onChange={(v) => setGroup(tier, level, v)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Private tuition */}
        <section className={cardClass}>
          <h2 className="text-lg font-bold text-[var(--foreground)]">Private (one-to-one) tuition</h2>
          <p className="mb-4 mt-1 text-sm text-[var(--muted)]">
            One price per level, the same at every branch. This is what the upgrade card, the checkout and a new private student&apos;s bill all use.
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {PRICE_LEVELS.map((level) => (
              <label key={level} className="flex flex-col gap-1.5 text-sm font-bold text-[var(--foreground)]">
                {level}
                <PriceInput
                  value={draft.private[level]}
                  changed={draft.private[level] !== saved.private[level]}
                  label={`Private ${level} tuition in naira`}
                  onChange={(v) => setPrivate(level, v)}
                />
              </label>
            ))}
          </div>
        </section>

        {/* Travel Package */}
        <section className={cardClass}>
          <h2 className="text-lg font-bold text-[var(--foreground)]">Travel Package</h2>
          <p className="mb-4 mt-1 text-sm text-[var(--muted)]">
            One flat price for the whole programme, in place of the per-level fees. The minimum first payment is what opens the portal.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-bold text-[var(--foreground)]">
              Package price
              <PriceInput
                value={draft.travelPackage.price}
                changed={draft.travelPackage.price !== saved.travelPackage.price}
                label="Travel Package price in naira"
                onChange={(v) => setTravel("price", v)}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-bold text-[var(--foreground)]">
              Minimum first payment
              <PriceInput
                value={draft.travelPackage.minFirstPayment}
                changed={draft.travelPackage.minFirstPayment !== saved.travelPackage.minFirstPayment}
                label="Travel Package minimum first payment in naira"
                onChange={(v) => setTravel("minFirstPayment", v)}
              />
            </label>
          </div>
        </section>

        {/* Save bar */}
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <p className="mr-auto text-sm text-[var(--muted)]">
              {dirty
                ? `${changes.length} unsaved change${changes.length === 1 ? "" : "s"}: ${changes
                    .slice(0, 3)
                    .map((c) => `${c.label} ${naira(c.from)} → ${naira(c.to)}`)
                    .join("; ")}${changes.length > 3 ? "; …" : ""}`
                : "No unsaved changes."}
            </p>
            <button
              onClick={resetToDefaults}
              disabled={saving}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground)] disabled:opacity-50"
            >
              Original prices
            </button>
            <button
              onClick={() => setDraft(clone(saved))}
              disabled={!dirty || saving}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground)] disabled:opacity-50"
            >
              Discard
            </button>
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="rounded-lg bg-[var(--accent)] px-6 py-2.5 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save prices"}
            </button>
          </div>
        </div>

        {/* Students on an old price */}
        <section className={cardClass}>
          <h2 className="text-lg font-bold text-[var(--foreground)]">Students billed at a different price</h2>
          <p className="mb-4 mt-1 text-sm text-[var(--muted)]">
            A student&apos;s tuition is fixed when they are billed, so changing a price above does not change anyone already enrolled.
            These are students who still owe on a charge that no longer matches the price list. Tick the ones to bring in line —
            nothing changes until you press Update, and a price rise is never applied on its own.
          </p>
          {dirty && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              You have unsaved price changes. This list compares against the <strong>saved</strong> prices — save first.
            </p>
          )}
          {applyMessage && (
            <div
              role="status"
              className={`mb-3 rounded-lg px-4 py-3 text-sm font-medium ${
                applyMessage.tone === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
              }`}
            >
              {applyMessage.text}
            </div>
          )}

          {rowsLoading ? (
            <p className="text-sm text-[var(--muted)]">Checking…</p>
          ) : rows.length === 0 ? (
            <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
              Every open charge matches the price list.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[46rem] text-sm">
                  <thead>
                    <tr>
                      <th className={`${th} w-10`}>
                        <input
                          type="checkbox"
                          aria-label="Select all students"
                          checked={selected.size === rows.length}
                          onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.chargeId)) : new Set())}
                        />
                      </th>
                      <th className={th}>Student</th>
                      <th className={th}>Class</th>
                      <th className={th}>Billed now</th>
                      <th className={th}>Price list</th>
                      <th className={th}>Paid</th>
                      <th className={th}>Will owe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const down = row.newAmount < row.currentAmount;
                      return (
                        <tr key={row.chargeId} className="border-t border-[var(--border)]">
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              aria-label={`Select ${row.studentName}`}
                              checked={selected.has(row.chargeId)}
                              onChange={() => toggle(row.chargeId)}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <span className="font-semibold text-[var(--foreground)]">{row.studentName}</span>
                            {row.studentCode && <span className="ml-2 text-xs text-[var(--muted)]">{row.studentCode}</span>}
                          </td>
                          <td className="px-3 py-2 text-[var(--muted)]">
                            {row.level} · {row.classType === "private" ? "Private" : "Group"}
                            {row.branchName ? ` · ${row.branchName}` : ""}
                          </td>
                          <td className="px-3 py-2 text-[var(--foreground)]">{naira(row.currentAmount)}</td>
                          <td className="px-3 py-2">
                            <span className={`font-semibold ${down ? "text-emerald-700" : "text-red-700"}`}>
                              {naira(row.newAmount)}
                            </span>
                            <span className="ml-1 text-xs text-[var(--muted)]">
                              ({down ? "−" : "+"}
                              {naira(Math.abs(row.newAmount - row.currentAmount))})
                            </span>
                          </td>
                          <td className="px-3 py-2 text-[var(--foreground)]">{naira(row.paid)}</td>
                          <td className="px-3 py-2 text-[var(--foreground)]">
                            {naira(row.owedAfter)}
                            {row.overpaidBy > 0 && (
                              <span className="block text-xs font-medium text-amber-700">
                                Paid {naira(row.overpaidBy)} over — check for a credit or refund
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {rowsTotal > rows.length && (
                <p className="mt-2 text-xs text-[var(--muted)]">Showing the first {rows.length} of {rowsTotal}.</p>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  onClick={applyReprice}
                  disabled={applying || selected.size === 0}
                  className="rounded-lg bg-[var(--accent)] px-6 py-2.5 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {applying ? "Updating…" : `Update ${selected.size || ""} selected`.replace("  ", " ")}
                </button>
                <span className="text-xs text-[var(--muted)]">
                  Each change is written to the audit trail with the old and new amount.
                </span>
              </div>
            </>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
