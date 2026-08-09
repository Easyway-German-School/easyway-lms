"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { AlertIcon, RefreshIcon, WalletIcon } from "@/components/icons";

/**
 * What the school owes the platform, and why.
 *
 * Deliberately built around the itemised lines rather than the total. A bill
 * that says "₦48,000, platform fee" cannot be checked by the person paying it,
 * and an unverifiable invoice is the thing that makes a bursar distrust a
 * vendor. Every line here names a meter, a quantity and a rate, and the
 * quantities come from things the school did.
 */

type Line = {
  meter: string;
  label: string;
  unit: string;
  per: number;
  rateKobo: number;
  quantity: number;
  costKobo: number;
};

type Summary = {
  tenant: { name: string; plan: string; trialEndsAt: string | null } | null;
  credit: {
    balanceKobo: string;
    lowBalanceKobo: string;
    runwayDays: number | null;
  };
  month: { from: string; costKobo: number; lines: Line[] };
  statement: Array<{
    kind: string;
    amountKobo: string;
    balanceAfterKobo: string;
    reference: string | null;
    note: string | null;
    createdAt: string;
  }>;
  ratesArePlaceholders: boolean;
};

function naira(kobo: number | string): string {
  const value = Number(kobo) / 100;
  return value.toLocaleString("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 2,
  });
}

const PRESETS = [10_000, 25_000, 50_000, 100_000];

export default function BillingPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState(25_000);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/billing/summary");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load the bill.");
      setSummary(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the bill.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function topUp() {
    setBusy(true);
    try {
      const response = await fetch("/api/billing/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountNaira: amount }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not start the payment.");
      window.location.href = data.authorization_url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the payment.");
      setBusy(false);
    }
  }

  const balance = Number(summary?.credit.balanceKobo ?? 0);
  const low = Number(summary?.credit.lowBalanceKobo ?? 0);
  const runway = summary?.credit.runwayDays ?? null;

  return (
    <AdminShell>
      <div className="min-w-0 space-y-8">
        <header>
          <h1 className="flex items-center gap-3 text-3xl font-bold">
            <WalletIcon className="h-7 w-7" />
            Platform billing
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
            What this school uses of the platform, and what it costs. Separate from
            student fees — this is the account the school holds with us.
          </p>
        </header>

        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950/30">
            <AlertIcon className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="min-w-0">{error}</p>
          </div>
        )}

        {summary?.ratesArePlaceholders && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm dark:bg-amber-950/20">
            <p className="font-semibold">These rates are placeholders.</p>
            <p className="mt-1 text-[var(--muted)]">
              They stand in until the real provider invoices and the margin decision
              land. Nothing here should be quoted to a customer.
            </p>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-[var(--muted)]">Loading…</p>
        ) : (
          <>
            <section className="grid gap-4 md:grid-cols-3">
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <p className="text-sm text-[var(--muted)]">Balance</p>
                <p
                  className={`mt-1 text-3xl font-bold ${
                    balance < 0 ? "text-red-600" : balance < low ? "text-amber-600" : ""
                  }`}
                >
                  {naira(balance)}
                </p>
                {balance < 0 && (
                  <p className="mt-1 text-xs text-red-600">
                    Owing. Top up to bring the account back into credit.
                  </p>
                )}
              </div>

              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <p className="text-sm text-[var(--muted)]">This month</p>
                <p className="mt-1 text-3xl font-bold">{naira(summary?.month.costKobo ?? 0)}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">since {summary?.month.from}</p>
              </div>

              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <p className="text-sm text-[var(--muted)]">Runway</p>
                <p className="mt-1 text-3xl font-bold">
                  {runway === null ? "—" : `${runway} days`}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {runway === null
                    ? "no usage yet to estimate from"
                    : "at the last 30 days' rate"}
                </p>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">What it went on</h2>
                <button
                  type="button"
                  onClick={load}
                  className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-1.5 text-xs font-semibold"
                >
                  <RefreshIcon className="h-4 w-4" />
                  Refresh
                </button>
              </div>

              {summary?.month.lines.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className="text-xs text-[var(--muted)]">
                      <tr>
                        <th className="py-2 pr-4">Item</th>
                        <th className="py-2 pr-4">Used</th>
                        <th className="py-2 pr-4">Rate</th>
                        <th className="py-2 pr-4 text-right">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.month.lines.map((line) => (
                        <tr key={line.meter} className="border-t border-[var(--border)]">
                          <td className="py-2 pr-4 font-medium">{line.label}</td>
                          <td className="py-2 pr-4">
                            {line.quantity.toLocaleString()} {line.unit}
                            {line.quantity === 1 ? "" : "s"}
                          </td>
                          <td className="py-2 pr-4 text-xs text-[var(--muted)]">
                            {naira(line.rateKobo)} per{" "}
                            {line.per === 1 ? line.unit : `${line.per.toLocaleString()} ${line.unit}s`}
                          </td>
                          <td className="py-2 pr-4 text-right font-semibold">
                            {naira(line.costKobo)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-[var(--muted)]">
                  Nothing metered this month yet. Usage is folded in nightly, so
                  today&apos;s activity appears tomorrow.
                </p>
              )}
            </section>

            <section className="space-y-3 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <h2 className="text-lg font-semibold">Top up</h2>
              <p className="text-sm text-[var(--muted)]">
                Credit is prepaid. Pay by card, bank transfer or USSD through Paystack —
                nothing is stored and nothing recurs.
              </p>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAmount(preset)}
                    className={`rounded-full border px-4 py-1.5 text-sm font-semibold ${
                      amount === preset
                        ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                        : "border-[var(--border)]"
                    }`}
                  >
                    {naira(preset * 100)}
                  </button>
                ))}
                <input
                  type="number"
                  value={amount}
                  min={5000}
                  step={1000}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  className="w-36 rounded-full border border-[var(--border)] px-4 py-1.5 text-sm"
                />
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={topUp}
                className="rounded-full bg-[var(--primary)] px-6 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Opening Paystack…" : `Pay ${naira(amount * 100)}`}
              </button>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Statement</h2>
              {summary?.statement.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className="text-xs text-[var(--muted)]">
                      <tr>
                        <th className="py-2 pr-4">When</th>
                        <th className="py-2 pr-4">What</th>
                        <th className="py-2 pr-4 text-right">Amount</th>
                        <th className="py-2 pr-4 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.statement.map((row, index) => (
                        <tr key={`${row.reference}-${index}`} className="border-t border-[var(--border)]">
                          <td className="py-2 pr-4 text-xs text-[var(--muted)]">
                            {new Date(row.createdAt).toLocaleDateString()}
                          </td>
                          <td className="py-2 pr-4">{row.note ?? row.kind}</td>
                          <td
                            className={`py-2 pr-4 text-right font-medium ${
                              Number(row.amountKobo) < 0 ? "" : "text-green-700"
                            }`}
                          >
                            {naira(row.amountKobo)}
                          </td>
                          <td className="py-2 pr-4 text-right text-[var(--muted)]">
                            {naira(row.balanceAfterKobo)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-[var(--muted)]">No movements yet.</p>
              )}
            </section>
          </>
        )}
      </div>
    </AdminShell>
  );
}
