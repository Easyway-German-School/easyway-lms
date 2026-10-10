"use client";

import { useEffect, useMemo, useState } from "react";

import AdminShell from "@/components/AdminShell";
import { RefreshIcon } from "@/components/icons";

type Task = {
  id: string;
  kind: string;
  title: string;
  dueDate: string | null;
  priorityScore: number;
  autoAssigned: boolean;
  lead: { id: string; name: string; email: string; phone: string | null; status: string } | null;
};

type CommissionEntry = {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
  lead: { id: string; name: string; email: string };
};

type Lead = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  branchName: string | null;
  interestedLevel: string | null;
  source: string;
  status: string;
  assignedTo: { id: string; name: string | null; email: string } | null;
  createdAt: string;
};

const STAGES = ["new", "contacted", "qualified", "proposal_sent", "invited", "converted", "lost", "dropped"];

const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export default function GrowthDeskPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [commission, setCommission] = useState<CommissionEntry[]>([]);
  const [scope, setScope] = useState<"mine" | "team">("mine");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      fetch("/api/admin/growth/tasks", { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/admin/growth/leads?scope=${scope}`, { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/growth/commission", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([tasksBody, leadsBody, commissionBody]) => {
        if (!active) return;
        if (tasksBody.error) throw new Error(tasksBody.error);
        if (leadsBody.error) throw new Error(leadsBody.error);
        setTasks(tasksBody.tasks ?? []);
        setLeads(leadsBody.leads ?? []);
        setCommission(commissionBody.entries ?? []);
        setError("");
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load the Growth Desk.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [scope, refreshKey]);

  const refresh = () => {
    setNotice("");
    setError("");
    setRefreshKey((k) => k + 1);
  };

  async function completeTask(taskId: string, outcome: "done" | "skipped") {
    const res = await fetch("/api/admin/growth/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, outcome }),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error || "Could not update that task.");
      return;
    }
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setNotice(outcome === "done" ? "Task marked done." : "Task skipped.");
  }

  async function setStage(leadId: string, status: string) {
    const res = await fetch("/api/admin/growth/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId, action: "stage", status }),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error || "Could not update that lead.");
      return;
    }
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, status } : l)));
    setNotice("Stage updated.");
  }

  async function addNote(leadId: string) {
    const note = (noteDrafts[leadId] || "").trim();
    if (!note) return;
    const res = await fetch(`/api/admin/growth/leads/${leadId}/activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "note", note }),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error || "Could not save that note.");
      return;
    }
    setNoteDrafts((prev) => ({ ...prev, [leadId]: "" }));
    setNotice("Note saved to the lead's history.");
  }

  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => b.priorityScore - a.priorityScore),
    [tasks],
  );

  return (
    <AdminShell>
      <main className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">Growth Desk</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Your daily queue and pipeline. Every stage change and note lands in the lead's history —
              nothing here is edited in place.
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold disabled:opacity-50"
          >
            <RefreshIcon className="h-4 w-4" />
            Refresh
          </button>
        </header>

        {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p> : null}
        {notice ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{notice}</p> : null}

        <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div>
            <h2 className="text-lg font-bold">Today's queue</h2>
            <p className="text-sm text-[var(--muted)]">
              Ranked by priority. A task you don't touch stays here tomorrow — there is nothing you need to do
              to "carry it over".
            </p>
          </div>
          {loading ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">Loading…</p>
          ) : sortedTasks.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">Nothing pending. New leads will appear here as they come in.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {sortedTasks.map((task) => (
                <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-semibold">{task.title}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {task.kind} · {task.autoAssigned ? "auto-assigned" : "assigned by hand"}
                      {task.lead ? ` · ${task.lead.email}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void completeTask(task.id, "done")}
                      className="rounded-xl bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-white"
                    >
                      Done
                    </button>
                    <button
                      type="button"
                      onClick={() => void completeTask(task.id, "skipped")}
                      className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-sm font-semibold"
                    >
                      Skip
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Pipeline</h2>
              <p className="text-sm text-[var(--muted)]">Move a lead through its stage, or leave a note for whoever looks at it next.</p>
            </div>
            <div className="flex rounded-xl border border-[var(--border)] p-1 text-sm font-semibold">
              <button
                type="button"
                onClick={() => setScope("mine")}
                className={`rounded-lg px-3 py-1.5 ${scope === "mine" ? "bg-[var(--accent)] text-white" : ""}`}
              >
                My leads
              </button>
              <button
                type="button"
                onClick={() => setScope("team")}
                className={`rounded-lg px-3 py-1.5 ${scope === "team" ? "bg-[var(--accent)] text-white" : ""}`}
              >
                Team
              </button>
            </div>
          </div>

          {loading ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">Loading…</p>
          ) : leads.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">No leads in this view yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {leads.map((lead) => (
                <li key={lead.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{lead.name}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {lead.email} · {lead.branchName ?? "no branch"} · {lead.source}
                        {scope === "team" ? ` · ${lead.assignedTo?.name || lead.assignedTo?.email || "unassigned"}` : ""}
                      </p>
                      <p className="text-xs text-[var(--muted)]">Enquired {date(lead.createdAt)}</p>
                    </div>
                    <select
                      value={lead.status}
                      onChange={(e) => void setStage(lead.id, e.target.value)}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm capitalize"
                    >
                      {STAGES.map((stage) => (
                        <option key={stage} value={stage} className="capitalize">
                          {stage.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={noteDrafts[lead.id] ?? ""}
                      onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [lead.id]: e.target.value }))}
                      placeholder="Add a note (call outcome, next step…)"
                      className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => void addNote(lead.id)}
                      className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-sm font-semibold"
                    >
                      Save note
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div>
            <h2 className="text-lg font-bold">My commission</h2>
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              The rate shown here is a placeholder, not a confirmed payout policy. Nobody should be paid off
              these figures until the school sets the real commission rate.
            </p>
          </div>
          {commission.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--muted)]">No commission entries yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {commission.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-semibold">{entry.lead.name}</p>
                    <p className="text-xs text-[var(--muted)]">{date(entry.createdAt)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold tabular-nums">{entry.amount.toLocaleString()}</p>
                    <p className="text-xs capitalize text-[var(--muted)]">{entry.status}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </AdminShell>
  );
}
