"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import EmailBlockEditor from "@/components/EmailBlockEditor";
import { LEVELS } from "@/lib/levels";
import { newBlock, type EmailBlock } from "@/lib/email-blocks";

/**
 * The composer, and the queue dashboard beneath it.
 *
 * Two things changed here and both matter more than they look.
 *
 * The message is BLOCKS, not a `<textarea>` of raw HTML. What went out before
 * was whatever an admin typed, unbranded and one unclosed tag away from
 * arriving broken, with no way to see it first. Now the design is the
 * renderer's job and the preview is the real message.
 *
 * And Send reaches the BELL AND THE PHONE, not only the inbox. It goes through
 * notify() now, so an announcement lands wherever each person actually looks —
 * and can be addressed to tutors, which was previously impossible.
 *
 * Sending to a few hundred people cannot be undone, so Send stays disabled
 * until the audience has actually been previewed.
 */

type Recipient = { name: string | null; email: string; level: string; role: string; studentCode: string | null };
type Engine = { id: "auto" | "claude" | "local"; label: string; available: boolean; detail: string };
type Message = {
  id: string; to: string; subject: string; type: string; status: string;
  attempts: number; lastError: string | null; sentAt: string | null; createdAt: string;
};
type Suppression = { id: string; email: string; reason: string; createdAt: string };

const STATUS_TONE: Record<string, string> = {
  sent: "bg-emerald-100 text-emerald-700",
  queued: "bg-slate-100 text-slate-700",
  sending: "bg-blue-100 text-blue-700",
  failed: "bg-red-100 text-red-700",
  suppressed: "bg-amber-100 text-amber-700",
  // Deliberately held back rather than failed — see the queue's "cancelled"
  // status. Grey, because nothing went wrong and nobody needs to act.
  cancelled: "bg-slate-100 text-slate-500",
};

export default function AdminEmailComposePage() {
  const [subject, setSubject] = useState("");
  const [blocks, setBlocks] = useState<EmailBlock[]>(() => [newBlock("heading"), newBlock("text")]);
  const [branchId, setBranchId] = useState("");
  const [level, setLevel] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("all");
  const [group, setGroup] = useState("students");
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);

  // AI drafting
  const [brief, setBrief] = useState("");
  const [engine, setEngine] = useState<Engine["id"]>("auto");
  const [engines, setEngines] = useState<Engine[]>([]);
  const [drafting, setDrafting] = useState(false);

  const [preview, setPreview] = useState<{ count: number; students: number; tutors: number; sample: Recipient[] } | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [recent, setRecent] = useState<Message[]>([]);
  const [suppressions, setSuppressions] = useState<Suppression[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const [dash, br, ai] = await Promise.all([
        fetch("/api/admin/emails/bulk", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/branches", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/admin/emails/draft", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
      ]);
      if (dash.error) throw new Error(dash.error);
      setCounts(dash.counts ?? {});
      setRecent(dash.recent ?? []);
      setSuppressions(dash.suppressions ?? []);
      setBranches(br.branches ?? []);
      if (Array.isArray(ai.engines)) {
        setEngines(ai.engines);
        // Land on something that can actually answer, so the first click does
        // not return "no engine reachable".
        const usable = (ai.engines as Engine[]).find((e) => e.available);
        if (usable) setEngine(usable.id);
      }
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const audience = { branchId: branchId || null, level: level || null, paymentStatus, group };

  /** Draft the whole thing, into blocks the editor can then edit. */
  async function draft() {
    if (brief.trim().length < 10 || drafting) return;
    setDrafting(true);
    setError("");
    try {
      const res = await fetch("/api/admin/emails/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brief: brief.trim(),
          engine,
          // Tells the model who it is writing to, so a note to tutors does not
          // come back addressed to students.
          audience:
            group === "tutors"
              ? "the school's tutors"
              : group === "both"
                ? "students and tutors at the school"
                : `students${level ? ` at level ${level}` : ""}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not draft that");

      setSubject(data.draft.subject);
      // The model returns typed blocks without ids; the editor needs them.
      setBlocks(
        (data.draft.blocks as Array<Record<string, string>>).map((b) => ({
          ...newBlock(b.type as EmailBlock["type"]),
          ...b,
        })) as EmailBlock[],
      );
      setNotice(`Drafted with ${data.draft.engine}. Read it over and edit before sending.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not draft that");
    } finally {
      setDrafting(false);
    }
  }

  async function runPreview() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/emails/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ audience, preview: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Preview failed");
      setPreview(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!preview) return;
    // Names all three channels, because this now reaches more than a mailbox
    // and an admin should know that before pressing the button.
    if (!confirm(`Send to ${preview.count} ${preview.count === 1 ? "person" : "people"}?\n\nEach gets it in their portal, as a push notification, and by email.`)) return;

    setBusy(true);
    try {
      const res = await fetch("/api/admin/emails/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject, blocks, audience }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Send failed");

      setNotice(
        `Sent to ${data.recipients} (${data.students} student${data.students === 1 ? "" : "s"}, ${data.tutors} tutor${data.tutors === 1 ? "" : "s"}) — ` +
        `${data.notified} in their portal, ${data.pushed} device${data.pushed === 1 ? "" : "s"} buzzed, ${data.queued} email${data.queued === 1 ? "" : "s"} on the way.`,
      );
      setSubject(""); setBlocks([newBlock("heading"), newBlock("text")]); setPreview(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  async function drain() {
    setBusy(true);
    try {
      const res = await fetch("/api/cron/email-queue?limit=50", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Drain failed");
      setNotice(
        data.skipped && !data.processed
          ? `Nothing sent — email is not configured yet. ${data.skipped} message(s) still waiting.`
          : `Processed ${data.processed}: ${data.sent} sent, ${data.retrying} retrying, ${data.failed} failed.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Drain failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <div className="p-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Compose email</h1>
            <p className="mt-1 text-sm text-slate-500">
              Everything is queued and delivered by the worker, never sent inline.
            </p>
          </div>
          <button onClick={drain} disabled={busy} className="rounded-full border px-4 py-2 text-sm font-semibold disabled:opacity-60">
            Send queued now
          </button>
        </div>

        {error && <div className="mb-4 rounded bg-red-100 p-4 text-red-700">{error}</div>}
        {notice && <div className="mb-4 rounded bg-blue-50 p-4 text-blue-800">{notice}</div>}

        <div className="mb-6 grid gap-3 sm:grid-cols-5">
          {["queued", "sent", "failed", "suppressed", "sending"].map((k) => (
            <div key={k} className="rounded-xl border bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">{k}</p>
              <p className="mt-1 text-2xl font-bold">{counts[k] ?? 0}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl border bg-white p-6">
          {/* WHO. Group first, because it changes what the other three mean —
              payment status is meaningless for a tutor. */}
          <div className="grid gap-3 sm:grid-cols-4">
            <select value={group} onChange={(e) => { setGroup(e.target.value); setPreview(null); }} className="rounded-lg border px-3 py-2 text-sm">
              <option value="students">Students</option>
              <option value="tutors">Tutors</option>
              <option value="both">Students and tutors</option>
            </select>
            <select value={branchId} onChange={(e) => { setBranchId(e.target.value); setPreview(null); }} className="rounded-lg border px-3 py-2 text-sm">
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select value={level} onChange={(e) => { setLevel(e.target.value); setPreview(null); }} disabled={group === "tutors"} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">
              <option value="">All levels</option>
              {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <select value={paymentStatus} onChange={(e) => { setPaymentStatus(e.target.value); setPreview(null); }} disabled={group === "tutors"} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">
              <option value="all">Everyone</option>
              <option value="unpaid">Outstanding balance</option>
              <option value="paid">Fully paid</option>
            </select>
          </div>

          {/* WRITE IT FOR ME. Optional, above the real fields, exactly as on
              the tutors' announcements page — one pattern, two portals. */}
          <div className="mt-4 rounded-xl border border-dashed bg-slate-50 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Write it for me — optional</p>
              <div className="ml-auto flex flex-wrap items-center gap-1">
                {engines.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    disabled={!option.available}
                    onClick={() => setEngine(option.id)}
                    title={option.detail}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      engine === option.id ? "bg-slate-900 text-white" : "border text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={2}
              placeholder="fees due friday, 50% minimum to keep your seat, pay from the portal"
              className="mt-2 w-full rounded-lg border px-3 py-2 text-sm"
            />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
                onClick={draft}
                disabled={drafting || brief.trim().length < 10}
                className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
              >
                {drafting ? "Writing…" : "Draft this for me"}
              </button>
              <p className="text-xs text-slate-500">
                {engines.find((e) => e.id === engine)?.detail ?? "Replaces the blocks below. Nothing is sent."}
              </p>
            </div>
          </div>

          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="mt-4 w-full rounded-lg border px-3 py-2 text-sm"
          />

          <div className="mt-4">
            <EmailBlockEditor
              blocks={blocks}
              onChange={setBlocks}
              subject={subject}
              senderName="Easyway Language School"
              footer="Reply to this email and the office will see it."
            />
          </div>

          <p className="mt-3 text-xs text-slate-500">
            Everyone gets this in their portal, as a push notification, and by email. An unsubscribe footer is added to
            the email automatically — bulk mail without one gets filtered as spam.
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            <button onClick={runPreview} disabled={busy} className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-60">
              Preview audience
            </button>
            <button
              onClick={send}
              disabled={busy || !preview || !subject.trim() || blocks.length === 0}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {preview ? `Send to ${preview.count}` : "Preview first"}
            </button>
          </div>

          {preview && (
            <div className="mt-4 rounded-lg bg-slate-50 p-4">
              <p className="text-sm font-semibold">{preview.count} recipient{preview.count === 1 ? "" : "s"}</p>
              <div className="mt-2 max-h-40 overflow-y-auto text-xs text-slate-600">
                {preview.sample.map((r) => (
                  <div key={r.email}>{r.name} · {r.email} · {r.level}</div>
                ))}
                {preview.count > preview.sample.length && (
                  <p className="mt-1 italic">…and {preview.count - preview.sample.length} more</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div className="overflow-hidden rounded-xl border bg-white">
            <div className="border-b px-4 py-3"><h2 className="font-semibold">Recent messages</h2></div>
            <div className="max-h-96 overflow-y-auto">
              {recent.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">Nothing queued yet.</p>
              ) : recent.map((m) => (
                <div key={m.id} className="flex items-start justify-between gap-3 border-b px-4 py-3 last:border-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{m.subject}</p>
                    <p className="text-xs text-slate-500">{m.to} · {m.type}</p>
                    {m.lastError && <p className="mt-0.5 text-xs text-red-600">{m.lastError}</p>}
                  </div>
                  <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_TONE[m.status] ?? ""}`}>
                    {m.status}{m.attempts > 1 ? ` x${m.attempts}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border bg-white">
            <div className="border-b px-4 py-3">
              <h2 className="font-semibold">Suppressed</h2>
              <p className="text-xs text-slate-500">Never emailed again</p>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {suppressions.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">Nobody suppressed.</p>
              ) : suppressions.map((s) => (
                <div key={s.id} className="border-b px-4 py-3 last:border-0">
                  <p className="truncate text-sm">{s.email}</p>
                  <p className="text-xs text-slate-500">{s.reason}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
