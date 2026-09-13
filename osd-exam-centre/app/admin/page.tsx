"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Booking = {
  id: string;
  referenceCode: string;
  fullName: string;
  email: string;
  feeTotal: number;
  paymentStatus: string;
  transferProofUrl: string | null;
  transferReference: string | null;
  passportPhotoUrl: string | null;
  passportDataPageUrl: string | null;
  documentStatus: string;
  seatNumber: number | null;
  createdAt: string;
  session: { title: string; level: string; startDate: string };
};

type Filter = "review" | "all";

export default function AdminDashboard() {
  const router = useRouter();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>("review");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/bookings", { cache: "no-store" });
      if (res.status === 401) {
        router.push("/admin/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Unable to load bookings");
      setBookings(data.bookings ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load bookings");
    } finally {
      setLoaded(true);
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  async function act(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    try {
      await fetch(`/api/admin/bookings/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
  }

  if (!loaded) return <div className="p-8 text-sm text-[var(--ink-soft)]">Loading…</div>;

  const shown = filter === "all" ? bookings : bookings.filter((b) => b.paymentStatus === "pending_verification" || (b.passportPhotoUrl && b.passportDataPageUrl && b.documentStatus === "pending"));

  return (
    <div className="min-h-screen bg-[var(--paper)] p-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between">
          <h1 className="font-serif-display text-2xl font-semibold text-[var(--navy)]">Bookings</h1>
          <div className="flex gap-3">
            <Link href="/admin/sessions" className="rounded-sm border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--navy)]">Manage sittings</Link>
            <button onClick={logout} className="rounded-sm border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--ink-soft)]">Sign out</button>
          </div>
        </div>

        {error && <p className="mt-4 rounded-sm bg-[var(--red-soft)] px-4 py-3 text-sm text-[var(--red)]">{error}</p>}

        <div className="mt-4 flex gap-2">
          {(["review", "all"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-sm px-4 py-2 text-sm font-semibold ${filter === f ? "bg-[var(--navy)] text-white" : "border border-[var(--line)] text-[var(--ink-soft)]"}`}
            >
              {f === "review" ? "Needs review" : "All bookings"}
            </button>
          ))}
        </div>

        <div className="mt-6 space-y-3">
          {shown.length === 0 && <p className="text-sm text-[var(--ink-soft)]">Nothing here.</p>}
          {shown.map((b) => (
            <div key={b.id} className="seal-border rounded-sm bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-[var(--navy)]">{b.fullName} <span className="font-mono text-xs text-[var(--ink-soft)]">{b.referenceCode}</span></p>
                  <p className="text-xs text-[var(--ink-soft)]">{b.session.title} · {b.email} · ₦{b.feeTotal.toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-sm px-2 py-0.5 text-[10px] font-bold uppercase ${b.paymentStatus === "paid" ? "bg-[var(--green-soft)] text-[var(--green)]" : "bg-[var(--red-soft)] text-[var(--red)]"}`}>
                    {b.paymentStatus}
                  </span>
                  {b.seatNumber !== null && <span className="rounded-sm bg-[var(--gold-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--navy)]">SEAT {b.seatNumber}</span>}
                </div>
              </div>

              {b.paymentStatus === "pending_verification" && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-sm bg-[var(--gold-soft)]/40 p-2.5">
                  {b.transferProofUrl && <a href={b.transferProofUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-[var(--navy)] underline">View slip</a>}
                  {b.transferReference && <span className="text-xs text-[var(--ink-soft)]">Ref: {b.transferReference}</span>}
                  <button disabled={busyId === b.id} onClick={() => act(b.id, { transferAction: "verify" })} className="rounded-sm bg-[var(--green)] px-3 py-1.5 text-xs font-semibold text-white">
                    Verify &amp; confirm seat
                  </button>
                  <button
                    disabled={busyId === b.id}
                    onClick={() => { const reason = window.prompt("Why is this transfer being rejected?"); if (reason !== null) act(b.id, { transferAction: "reject", transferRejectReason: reason }); }}
                    className="rounded-sm border border-[var(--red)] px-3 py-1.5 text-xs font-semibold text-[var(--red)]"
                  >
                    Reject
                  </button>
                </div>
              )}

              {b.passportPhotoUrl && b.passportDataPageUrl && b.documentStatus === "pending" && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-sm bg-blue-50 p-2.5">
                  <a href={b.passportPhotoUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-blue-700 underline">Photo</a>
                  <a href={b.passportDataPageUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-blue-700 underline">Data page</a>
                  <button disabled={busyId === b.id} onClick={() => act(b.id, { documentAction: "approved" })} className="rounded-sm bg-[var(--green)] px-3 py-1.5 text-xs font-semibold text-white">
                    Approve
                  </button>
                  <button
                    disabled={busyId === b.id}
                    onClick={() => { const reason = window.prompt("What's wrong with the documents?"); if (reason !== null) act(b.id, { documentAction: "rejected", documentRejectReason: reason }); }}
                    className="rounded-sm border border-[var(--red)] px-3 py-1.5 text-xs font-semibold text-[var(--red)]"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
