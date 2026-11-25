"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import AdminLoader from "@/components/AdminLoader";

type ReceiptRow = {
  id: string;
  referenceCode: string;
  fullName: string;
  email: string;
  phone: string;
  feeTotal: number;
  express: boolean;
  paymentStatus: string;
  status: string;
  transferProofUrl: string | null;
  transferReference: string | null;
  passportPhotoUrl: string | null;
  passportDataPageUrl: string | null;
  verifiedAt: string | null;
  paidOn: string | null;
  createdAt: string;
  session: { title: string; level: string; startDate: string };
};

type Kind = "slips" | "ids" | "all";

export default function AdminReceiptsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<Kind>("slips");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/bookings", { cache: "no-store" });
      if (res.status === 401) { router.push("/admin/login"); return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Unable to load records");
      setRows(data.bookings ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load records");
    } finally {
      setLoaded(true);
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const bank = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((b) => {
        if (kind === "slips") return Boolean(b.transferProofUrl);
        if (kind === "ids") return Boolean(b.passportPhotoUrl || b.passportDataPageUrl);
        return Boolean(b.transferProofUrl || b.passportPhotoUrl || b.passportDataPageUrl);
      })
      .filter((b) => !q || `${b.fullName} ${b.email} ${b.referenceCode} ${b.transferReference ?? ""}`.toLowerCase().includes(q));
  }, [rows, kind, query]);

  if (!loaded) return <AdminShell><AdminLoader /></AdminShell>;

  return (
    <AdminShell>
      <div className="mx-auto max-w-5xl">
        <h1 className="font-serif-display text-2xl font-semibold text-[var(--navy)]">Receipts bank</h1>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          Every payment slip and ID upload stays here permanently — opening a file never removes it from the record.
        </p>

        {error && <p className="mt-4 rounded-sm bg-[var(--red-soft)] px-4 py-3 text-sm text-[var(--red)]">{error}</p>}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {([
            { key: "slips" as const, label: "Payment slips" },
            { key: "ids" as const, label: "ID documents" },
            { key: "all" as const, label: "Everything" },
          ]).map((t) => (
            <button
              key={t.key}
              onClick={() => setKind(t.key)}
              className={`rounded-sm px-4 py-2 text-sm font-semibold ${kind === t.key ? "bg-[var(--navy)] text-white" : "border border-[var(--line)] text-[var(--ink-soft)]"}`}
            >
              {t.label}
            </button>
          ))}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, reference…"
            className="ml-auto w-full rounded-sm border border-[var(--line)] bg-white px-3 py-2 text-sm sm:w-64"
          />
        </div>

        <div className="mt-5 space-y-3">
          {bank.length === 0 && <p className="text-sm text-[var(--ink-soft)]">No uploaded files in this group yet.</p>}
          {bank.map((b) => (
            <div key={b.id} className="seal-border rounded-sm bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-[var(--navy)]">
                    {b.fullName}{" "}
                    <span className="font-mono text-xs font-normal text-[var(--ink-soft)]">{b.referenceCode}</span>
                  </p>
                  <p className="text-xs text-[var(--ink-soft)]">
                    {b.session.title} · {b.email} · {b.phone} · ₦{b.feeTotal.toLocaleString()}
                    {b.express ? " · Express" : ""}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[var(--ink-soft)]">
                    Registered {new Date(b.createdAt).toLocaleString("en-GB")}
                    {b.paidOn && <> · Paid {new Date(b.paidOn).toLocaleDateString("en-GB")}</>}
                    {b.transferReference && <> · Txn {b.transferReference}</>}
                    {" · "}
                    <span className="font-semibold uppercase">{b.paymentStatus}</span>
                    {" / "}
                    <span className="font-semibold uppercase">{b.status}</span>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {b.transferProofUrl && (
                    <a href={b.transferProofUrl} target="_blank" rel="noopener noreferrer" className="rounded-sm bg-[var(--navy)] px-3 py-1.5 text-xs font-semibold text-white">
                      Open payment slip
                    </a>
                  )}
                  {b.passportPhotoUrl && (
                    <a href={b.passportPhotoUrl} target="_blank" rel="noopener noreferrer" className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--navy)]">
                      Passport photo
                    </a>
                  )}
                  {b.passportDataPageUrl && (
                    <a href={b.passportDataPageUrl} target="_blank" rel="noopener noreferrer" className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--navy)]">
                      ID data page
                    </a>
                  )}
                  <a href={`/api/admin/bookings/${b.id}/invoice`} target="_blank" rel="noopener noreferrer" className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-soft)]">
                    {b.paymentStatus === "paid" ? "Receipt PDF" : "Invoice PDF"}
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminShell>
  );
}
