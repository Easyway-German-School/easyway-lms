"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshIcon, CheckIcon, HelpIcon } from "@/components/icons";

/**
 * ONE dashboard, two doors in — see /api/admin/influencer's GET comment.
 *
 *   mode="self"   the partner's own view, at /admin/influencer. Can edit
 *                 their own bank details and ask for help.
 *   mode="admin"  a payments-capability admin remote-viewing a specific
 *                 partner from /admin/influencer-program/[userId]/ — same
 *                 data, plus the approve/credit/pause/partner-type actions
 *                 that only the payments desk can take.
 *
 * Previously this screen's logic was duplicated: a read-only self-service
 * page here, and a second, differently-shaped admin table mixed into
 * /admin/referrals with no link between the two. One partner now has
 * exactly one dashboard; the admin view is that same dashboard with a few
 * more buttons, not a parallel build of it.
 */

type Payout = {
  id: string;
  amount: number;
  status: "pending" | "approved" | "credited";
  createdAt: string;
  creditedAt: string | null;
  creditedNote: string | null;
};

type Redemption = {
  id: string;
  createdAt: string;
  redeemedByStudent: { id: string; user: { name: string | null; email?: string } };
  payouts: Payout[];
};

type Code = {
  id: string;
  code: string;
  label: string | null;
  status: "active" | "paused" | "revoked";
  partnerType: "influencer" | "travel_agent" | "ambassador" | "other" | null;
  discountPercent: number | null;
  discountFlat: number | null;
  commissionPercent: number | null;
  commissionFlat: number | null;
  payoutBankName: string | null;
  payoutAccountNumber: string | null;
  payoutAccountName: string | null;
  createdAt: string;
  ownerUser: { id: string; name: string | null; email: string };
  redemptions: Redemption[];
};

const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;
const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
const firstName = (name: string | null) => (name ? name.trim().split(/\s+/)[0] : "Student");

const PARTNER_TYPE_LABEL: Record<string, string> = {
  influencer: "Influencer",
  travel_agent: "Travel agent",
  ambassador: "Easyway ambassador",
  other: "Partner",
};

function discountLabel(code: Code): string {
  const parts: string[] = [];
  if (code.discountPercent) parts.push(`${code.discountPercent}%`);
  if (code.discountFlat) parts.push(naira(code.discountFlat));
  return parts.length ? `${parts.join(" + ")} off for new students` : "No discount configured yet";
}

function commissionLabel(code: Code): string {
  const parts: string[] = [];
  if (code.commissionPercent) parts.push(`${code.commissionPercent}%`);
  if (code.commissionFlat) parts.push(naira(code.commissionFlat));
  return parts.length ? `You earn ${parts.join(" + ")} per paying sign-up` : "No commission configured yet";
}

function BankDetailsCard({ code, editable, onSave }: { code: Code; editable: boolean; onSave: (v: { payoutBankName: string; payoutAccountNumber: string; payoutAccountName: string }) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [bankName, setBankName] = useState(code.payoutBankName ?? "");
  const [accountNumber, setAccountNumber] = useState(code.payoutAccountNumber ?? "");
  const [accountName, setAccountName] = useState(code.payoutAccountName ?? "");
  const [saving, setSaving] = useState(false);

  const hasDetails = code.payoutBankName || code.payoutAccountNumber || code.payoutAccountName;

  if (!editing) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold">Where we pay you</p>
          {editable ? (
            <button type="button" onClick={() => setEditing(true)} className="text-xs font-semibold text-[var(--accent-ink)] hover:underline">
              {hasDetails ? "Edit" : "Add account details"}
            </button>
          ) : null}
        </div>
        {hasDetails ? (
          <p className="mt-1 text-sm text-[var(--muted)]">
            {code.payoutBankName} · {code.payoutAccountNumber} · {code.payoutAccountName}
          </p>
        ) : (
          <p className="mt-1 text-sm text-[var(--muted)]">No account details on file yet.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
      <p className="text-sm font-bold">Where we pay you</p>
      <input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Bank name" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
      <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="Account number" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
      <input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Account name" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await onSave({ payoutBankName: bankName, payoutAccountNumber: accountNumber, payoutAccountName: accountName });
            setSaving(false);
            setEditing(false);
          }}
          className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setEditing(false)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold">
          Cancel
        </button>
      </div>
    </div>
  );
}

function HelpCard() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function send() {
    if (!message.trim()) return;
    setSending(true);
    try {
      const res = await fetch("/api/admin/influencer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim() }),
      });
      if (res.ok) {
        setSent(true);
        setMessage("");
        setOpen(false);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-2 text-sm font-bold text-[var(--accent-ink)]">
          <HelpIcon className="h-4 w-4" />
          Need help? Talk to the school
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-bold">What's up?</p>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder="A payout looks wrong, a sign-up isn't showing, anything else…"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button type="button" disabled={sending || !message.trim()} onClick={() => void send()} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50">
              {sending ? "Sending…" : "Send"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold">
              Cancel
            </button>
          </div>
        </div>
      )}
      {sent ? <p className="mt-2 text-xs font-semibold text-emerald-700">Sent — the office will get back to you.</p> : null}
    </div>
  );
}

function GrowthCard({ isAmbassador }: { isAmbassador: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--accent)]/30 bg-gradient-to-br from-[var(--accent-soft)] to-[var(--surface-alt)] p-4">
      <p className="text-sm font-bold">{isAmbassador ? "Spread the word for EasyWay" : "Grow your side income with EasyWay"}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
        <li>Put your link where people are already deciding — your bio, your WhatsApp status, pinned on your page.</li>
        <li>Lead with the outcome, not the course: "I'm learning German to work in Germany" beats "German classes."</li>
        <li>A short story from one of your sign-ups (their progress, their excitement) converts better than a flyer.</li>
        {isAmbassador ? (
          <li>Every sign-up with your link is counted here — the school sees exactly who you've brought in.</li>
        ) : (
          <li>Every new sign-up compounds — the students you bring in today are commission on repeat for as long as they study here.</li>
        )}
      </ul>
    </div>
  );
}

export default function InfluencerDashboard({ mode, targetUserId }: { mode: "self" | "admin"; targetUserId?: string }) {
  const [codes, setCodes] = useState<Code[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creditingId, setCreditingId] = useState<string | null>(null);
  const [creditNote, setCreditNote] = useState("");

  const url = mode === "admin" && targetUserId ? `/api/admin/influencer?userId=${encodeURIComponent(targetUserId)}` : "/api/admin/influencer";

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Unable to load this dashboard.");
        return body as { codes: Code[] };
      })
      .then((result) => {
        if (!active) return;
        setCodes(result.codes);
        setError("");
      })
      .catch((cause: unknown) => active && setError(cause instanceof Error ? cause.message : "Unable to load this dashboard."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, refreshKey]);

  function refresh(message?: string) {
    setError("");
    if (message) setNotice(message);
    setRefreshKey((k) => k + 1);
  }

  const totals = useMemo(() => {
    const all = codes ?? [];
    const redemptions = all.flatMap((c) => c.redemptions);
    const payouts = redemptions.flatMap((r) => r.payouts);
    return {
      signups: redemptions.length,
      pendingToPay: redemptions.filter((r) => r.payouts.length === 0).length,
      paid: redemptions.filter((r) => r.payouts.length > 0).length,
      pendingAmount: payouts.filter((p) => p.status === "pending").reduce((s, p) => s + p.amount, 0),
      approvedAmount: payouts.filter((p) => p.status === "approved").reduce((s, p) => s + p.amount, 0),
      creditedAmount: payouts.filter((p) => p.status === "credited").reduce((s, p) => s + p.amount, 0),
    };
  }, [codes]);

  // Ambassadors are unpaid: no commission, no bank details, no payout
  // tracking — just their link and who signed up with it. A partner mixing
  // an ambassador code with a paid one still gets the full money view.
  const allAmbassador = !!codes?.length && codes.every((c) => (c.partnerType ?? "influencer") === "ambassador");

  async function copyLink(code: string) {
    const link = `${window.location.origin}/auth/signup?promo=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(link);
      refresh(`Signup link copied for ${code}.`);
    } catch {
      setError("Could not copy the link. Check your browser's clipboard permission.");
    }
  }

  async function saveBankDetails(codeId: string, v: { payoutBankName: string; payoutAccountNumber: string; payoutAccountName: string }) {
    const res = await fetch("/api/admin/influencer", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ promoCodeId: codeId, ...v }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error || "Could not save those details.");
    refresh("Account details saved.");
  }

  async function setStatus(codeId: string, status: "active" | "paused") {
    setBusyId(codeId);
    try {
      const res = await fetch(`/api/admin/promo-codes/${codeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setError(body.error || "Could not update status.");
      refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function setPartnerType(codeId: string, partnerType: string) {
    setBusyId(codeId);
    try {
      const res = await fetch(`/api/admin/promo-codes/${codeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerType }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setError(body.error || "Could not update partner type.");
      refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function approvePayout(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/promo-payouts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setError(body.error || "Could not approve this payout.");
      refresh("Payout approved.");
    } finally {
      setBusyId(null);
    }
  }

  async function creditPayout(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/promo-payouts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "credit", note: creditNote.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setError(body.error || "Could not credit this payout.");
      setCreditingId(null);
      setCreditNote("");
      refresh("Payout credited.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">
            {mode === "admin" ? (codes?.[0]?.ownerUser.name || "Partner") + "'s dashboard" : "Your dashboard"}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {mode === "admin"
              ? `Viewing as the admin desk — ${codes?.[0]?.ownerUser.email ?? ""}`
              : allAmbassador
                ? "Your code, and who signed up with it."
                : "Your code, who signed up with it, and what you've earned."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => refresh()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold disabled:opacity-50"
        >
          <RefreshIcon className="h-4 w-4" />
          Refresh
        </button>
      </header>

      {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p> : null}
      {notice ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{notice}</p> : null}

      <section className={allAmbassador ? "grid gap-3 sm:max-w-xs" : "grid gap-3 sm:grid-cols-4"}>
        {(allAmbassador
          ? [{ label: "Sign-ups", value: totals.signups.toLocaleString() }]
          : [
              { label: "Sign-ups", value: totals.signups.toLocaleString() },
              { label: "Pending to pay", value: totals.pendingToPay.toLocaleString() },
              { label: "Paid", value: totals.paid.toLocaleString() },
              { label: "Credit earned (paid only)", value: naira(totals.pendingAmount + totals.approvedAmount + totals.creditedAmount) },
            ]
        ).map((m) => (
          <div key={m.label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="text-sm text-[var(--muted)]">{m.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{loading ? "…" : m.value}</p>
          </div>
        ))}
      </section>

      {loading ? (
        <p className="py-8 text-center text-sm text-[var(--muted)]">Loading…</p>
      ) : !codes?.length ? (
        <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--muted)]">
          {mode === "admin" ? "This partner has no code yet." : "You don't have a code yet. Ask the school office to set one up."}
        </p>
      ) : (
        codes.map((code) => {
          const isAmbassador = (code.partnerType ?? "influencer") === "ambassador";
          const pending = code.redemptions.filter((r) => r.payouts.length === 0);
          const paid = code.redemptions.filter((r) => r.payouts.length > 0);
          return (
            <section key={code.id} className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-2xl font-black tracking-wide text-[var(--accent-ink)]">{code.code}</p>
                    <span className="rounded-full bg-[var(--surface-alt)] px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                      {PARTNER_TYPE_LABEL[code.partnerType ?? "influencer"]}
                    </span>
                  </div>
                  {code.label ? <p className="text-sm text-[var(--muted)]">{code.label}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-wide ${
                      code.status === "active" ? "bg-emerald-100 text-emerald-900" : "bg-rose-100 text-rose-900"
                    }`}
                  >
                    {code.status}
                  </span>
                  <button type="button" onClick={() => void copyLink(code.code)} className="rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-bold text-white">
                    Copy signup link
                  </button>
                  {mode === "admin" ? (
                    <>
                      <select
                        value={code.partnerType ?? "influencer"}
                        onChange={(e) => void setPartnerType(code.id, e.target.value)}
                        disabled={busyId === code.id}
                        className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-xs font-semibold"
                      >
                        <option value="influencer">Influencer</option>
                        <option value="travel_agent">Travel agent</option>
                        <option value="ambassador">Easyway ambassador</option>
                        <option value="other">Other partner</option>
                      </select>
                      <button
                        type="button"
                        disabled={busyId === code.id}
                        onClick={() => void setStatus(code.id, code.status === "active" ? "paused" : "active")}
                        className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-bold disabled:opacity-50"
                      >
                        {code.status === "active" ? "Pause" : "Activate"}
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              {isAmbassador ? (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
                  <p className="text-sm font-bold">For your audience</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">{discountLabel(code)}</p>
                </div>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
                      <p className="text-sm font-bold">For your audience</p>
                      <p className="mt-1 text-sm text-[var(--muted)]">{discountLabel(code)}</p>
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
                      <p className="text-sm font-bold">For you</p>
                      <p className="mt-1 text-sm text-[var(--muted)]">{commissionLabel(code)}</p>
                    </div>
                  </div>

                  <BankDetailsCard code={code} editable onSave={(v) => saveBankDetails(code.id, v)} />
                </>
              )}

              {isAmbassador ? (
                <div>
                  <h3 className="text-sm font-bold text-[var(--foreground)]">Sign-ups ({code.redemptions.length})</h3>
                  {!code.redemptions.length ? (
                    <p className="py-3 text-sm text-[var(--muted)]">Nobody has signed up with this link yet.</p>
                  ) : (
                    <ul className="mt-2 divide-y divide-[var(--border)] text-sm">
                      {code.redemptions.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                          <span>{mode === "admin" ? r.redeemedByStudent.user.name || "Student" : firstName(r.redeemedByStudent.user.name)}</span>
                          <span className="text-xs text-[var(--muted)]">signed up {date(r.createdAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <>
                  <div>
                    <h3 className="text-sm font-bold text-amber-700">Pending — waiting to pay ({pending.length})</h3>
                    {!pending.length ? (
                      <p className="py-3 text-sm text-[var(--muted)]">Nobody waiting right now.</p>
                    ) : (
                      <ul className="mt-2 divide-y divide-[var(--border)] text-sm">
                        {pending.map((r) => (
                          <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                            <span>{mode === "admin" ? r.redeemedByStudent.user.name || "Student" : firstName(r.redeemedByStudent.user.name)}</span>
                            <span className="text-xs text-[var(--muted)]">signed up {date(r.createdAt)} — no credit yet</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <h3 className="text-sm font-bold text-emerald-700">Paid ({paid.length})</h3>
                    {!paid.length ? (
                      <p className="py-3 text-sm text-[var(--muted)]">Nobody's paid yet — credit only counts once they do.</p>
                    ) : (
                      <ul className="mt-2 divide-y divide-[var(--border)] text-sm">
                        {paid.map((r) => {
                          const payout = r.payouts[0];
                          return (
                            <li key={r.id} className="space-y-1.5 py-2.5">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-semibold">{mode === "admin" ? r.redeemedByStudent.user.name || "Student" : firstName(r.redeemedByStudent.user.name)}</span>
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold tabular-nums">{naira(payout.amount)}</span>
                                  <span
                                    className={`rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${
                                      payout.status === "credited" ? "bg-emerald-100 text-emerald-900" : payout.status === "approved" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"
                                    }`}
                                  >
                                    {payout.status}
                                  </span>
                                  {mode === "admin" && payout.status === "pending" ? (
                                    <button type="button" disabled={busyId === payout.id} onClick={() => void approvePayout(payout.id)} className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-bold disabled:opacity-50">
                                      Approve
                                    </button>
                                  ) : null}
                                  {mode === "admin" && payout.status === "approved" ? (
                                    <button
                                      type="button"
                                      disabled={busyId === payout.id}
                                      onClick={() => {
                                        setCreditingId(creditingId === payout.id ? null : payout.id);
                                        setCreditNote("");
                                      }}
                                      className="rounded-lg bg-emerald-700 px-2.5 py-1 text-xs font-bold text-white disabled:opacity-50"
                                    >
                                      Credit
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                              {mode === "admin" && creditingId === payout.id ? (
                                <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[var(--surface-alt)] p-3">
                                  <input
                                    value={creditNote}
                                    onChange={(e) => setCreditNote(e.target.value)}
                                    placeholder="How was this paid out, e.g. bank transfer 12 Oct"
                                    className="min-w-[14rem] flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm"
                                  />
                                  <button type="button" disabled={busyId === payout.id} onClick={() => void creditPayout(payout.id)} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50">
                                    <CheckIcon className="h-4 w-4" />
                                    Mark credited
                                  </button>
                                </div>
                              ) : null}
                              {payout.creditedNote ? <p className="text-xs text-[var(--muted)]">{payout.creditedNote}</p> : null}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </section>
          );
        })
      )}

      {mode === "self" ? (
        <>
          <HelpCard />
          <GrowthCard isAmbassador={allAmbassador} />
        </>
      ) : null}
    </main>
  );
}
