"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Message = {
  id: string;
  name: string;
  email: string;
  message: string;
  status: string;
  createdAt: string;
  booking: { referenceCode: string; session: { title: string } } | null;
};

export default function AdminSupportPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/support", { cache: "no-store" });
      if (res.status === 401) { router.push("/admin/login"); return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Unable to load messages");
      setMessages(data.messages ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load messages");
    } finally {
      setLoaded(true);
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  async function resolve(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/admin/support/${id}`, { method: "PATCH" });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (!loaded) return <div className="p-8 text-sm text-[var(--ink-soft)]">Loading…</div>;

  const shown = filter === "open" ? messages.filter((m) => m.status === "open") : messages;

  return (
    <div className="min-h-screen bg-[var(--paper)] p-6">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between">
          <h1 className="font-serif-display text-2xl font-semibold text-[var(--navy)]">Help requests</h1>
          <Link href="/admin" className="rounded-sm border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--navy)]">← Bookings</Link>
        </div>

        {error && <p className="mt-4 rounded-sm bg-[var(--red-soft)] px-4 py-3 text-sm text-[var(--red)]">{error}</p>}

        <div className="mt-4 flex gap-2">
          {(["open", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-sm px-4 py-2 text-sm font-semibold ${filter === f ? "bg-[var(--navy)] text-white" : "border border-[var(--line)] text-[var(--ink-soft)]"}`}
            >
              {f === "open" ? "Open" : "All"}
            </button>
          ))}
        </div>

        <div className="mt-6 space-y-3">
          {shown.length === 0 && <p className="text-sm text-[var(--ink-soft)]">Nothing here.</p>}
          {shown.map((m) => (
            <div key={m.id} className="seal-border rounded-sm bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-[var(--navy)]">
                    {m.name} <span className="font-normal text-[var(--ink-soft)]">({m.email})</span>
                  </p>
                  {m.booking && (
                    <p className="text-xs text-[var(--ink-soft)]">
                      {m.booking.session.title} · <span className="font-mono">{m.booking.referenceCode}</span>
                    </p>
                  )}
                  <p className="text-xs text-[var(--ink-soft)]">{new Date(m.createdAt).toLocaleString()}</p>
                </div>
                {m.status === "open" ? (
                  <button
                    onClick={() => resolve(m.id)}
                    disabled={busyId === m.id}
                    className="rounded-sm bg-[var(--green)] px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Mark resolved
                  </button>
                ) : (
                  <span className="rounded-sm bg-[var(--green-soft)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--green)]">Resolved</span>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--ink)]">{m.message}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
