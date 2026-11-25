"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import AdminLoader from "@/components/AdminLoader";

type Message = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  status: string;
  createdAt: string;
  booking: {
    referenceCode: string;
    phone: string;
    fullName: string;
    email: string;
    status: string;
    paymentStatus: string;
    feeTotal: number;
    session: { title: string; level: string; startDate: string };
  } | null;
};

export default function AdminSupportPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [composeId, setComposeId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState("");

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
      await fetch(`/api/admin/support/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function sendReply(id: string, name: string) {
    setBusyId(id);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/admin/support/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reply: { subject, body } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not send that email");
      setNotice(`Email sent to ${name}.`);
      setComposeId(null);
      setSubject("");
      setBody("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send that email");
    } finally {
      setBusyId(null);
    }
  }

  if (!loaded) return <AdminShell><AdminLoader /></AdminShell>;

  const shown = filter === "open" ? messages.filter((m) => m.status === "open") : messages;

  return (
    <AdminShell>
      <div className="mx-auto max-w-3xl">
        <h1 className="font-serif-display text-2xl font-semibold text-[var(--navy)]">Help requests</h1>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">Click a name for context, then compose a reply without leaving this page.</p>

        {error && <p className="mt-4 rounded-sm bg-[var(--red-soft)] px-4 py-3 text-sm text-[var(--red)]">{error}</p>}
        {notice && <p className="mt-4 rounded-sm bg-[var(--green-soft)] px-4 py-3 text-sm text-[var(--green)]">{notice}</p>}

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
          {shown.map((m) => {
            const phone = m.phone || m.booking?.phone || null;
            const profileOpen = profileId === m.id;
            const composing = composeId === m.id;
            return (
              <div key={m.id} className="seal-border rounded-sm bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-[var(--navy)]">
                      <button
                        type="button"
                        onClick={() => setProfileId(profileOpen ? null : m.id)}
                        className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
                        title="Show contact context"
                      >
                        {m.name}
                      </button>{" "}
                      <span className="font-normal text-[var(--ink-soft)]">({m.email})</span>
                    </p>
                    {phone && <p className="text-xs font-semibold text-[var(--navy)]">Phone: {phone}</p>}
                    {m.booking && (
                      <p className="text-xs text-[var(--ink-soft)]">
                        {m.booking.session.title} · <span className="font-mono">{m.booking.referenceCode}</span>
                      </p>
                    )}
                    <p className="text-xs text-[var(--ink-soft)]">{new Date(m.createdAt).toLocaleString()}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setComposeId(composing ? null : m.id);
                        setSubject(`Re: your ÖSD exam centre message`);
                        setBody("");
                      }}
                      className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--navy)]"
                    >
                      Compose email
                    </button>
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
                </div>

                {profileOpen && (
                  <div className="mt-3 grid gap-px overflow-hidden rounded-sm border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2">
                    <InfoCell label="Email" value={m.email} />
                    <InfoCell label="Phone" value={phone} />
                    {m.booking ? (
                      <>
                        <InfoCell label="Booking" value={m.booking.referenceCode} />
                        <InfoCell label="Candidate on file" value={m.booking.fullName} />
                        <InfoCell label="Sitting" value={m.booking.session.title} />
                        <InfoCell label="Payment / status" value={`${m.booking.paymentStatus} / ${m.booking.status}`} />
                        <InfoCell label="Fee" value={`₦${m.booking.feeTotal.toLocaleString()}`} />
                        <InfoCell label="Exam date" value={new Date(m.booking.session.startDate).toLocaleDateString("en-GB")} />
                      </>
                    ) : (
                      <InfoCell label="Booking" value="No booking linked — they messaged before registering." />
                    )}
                  </div>
                )}

                <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--ink)]">{m.message}</p>

                {composing && (
                  <div className="mt-3 rounded-sm border border-[var(--line)] bg-[var(--paper)] p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-soft)]">Compose email to {m.name}</p>
                    <input
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="Subject"
                      className="mt-2 w-full rounded-sm border border-[var(--line)] bg-white px-3 py-2 text-xs"
                    />
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder="Your reply…"
                      rows={5}
                      className="mt-2 w-full rounded-sm border border-[var(--line)] bg-white px-3 py-2 text-xs"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        disabled={busyId === m.id || !subject.trim() || !body.trim()}
                        onClick={() => sendReply(m.id, m.name)}
                        className="rounded-sm bg-[var(--navy)] px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                      >
                        {busyId === m.id ? "Sending…" : "Send email"}
                      </button>
                      <button onClick={() => setComposeId(null)} className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-soft)]">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </AdminShell>
  );
}

function InfoCell({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="bg-white px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--ink-soft)]">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-[var(--navy)] break-words">{value}</p>
    </div>
  );
}
