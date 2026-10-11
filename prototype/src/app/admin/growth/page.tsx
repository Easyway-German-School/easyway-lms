"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import AdminShell from "@/components/AdminShell";
import {
  RefreshIcon,
  TargetIcon,
  ListIcon,
  BriefcaseIcon,
  WalletIcon,
  CoinIcon,
  CheckIcon,
  PlusIcon,
} from "@/components/icons";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Task = {
  id: string;
  kind: string;
  title: string;
  priorityScore: number;
  autoAssigned: boolean;
  lead: { id: string; name: string; email: string; phone: string | null; status: string } | null;
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

type CommissionEntry = {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
  lead: { id: string; name: string; email: string };
};

type Partner = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  type: string;
  status: string;
  owner: { id: string; name: string | null; email: string } | null;
  notes: string | null;
  lastContactedAt: string | null;
  createdAt: string;
  stale: boolean;
};

type FundRequest = {
  id: string;
  amount: number;
  purpose: string;
  category: string;
  status: string;
  requester: { id: string; name: string | null; email: string };
  approvedBy: { id: string; name: string | null; email: string } | null;
  decisionNote: string | null;
  createdAt: string;
  overdue: boolean;
  canDecide: boolean;
};

type TeamReport = {
  id: string;
  achievement: string;
  problemSolved: string | null;
  author: { id: string; name: string | null; email: string };
};

const STAGES = ["new", "contacted", "qualified", "proposal_sent", "invited", "converted", "lost", "dropped"];
const PARTNER_STATUSES = ["prospecting", "engaged", "cooperating", "dormant"];
const TABS = [
  { key: "today", label: "Today", icon: TargetIcon },
  { key: "pipeline", label: "Pipeline", icon: ListIcon },
  { key: "partners", label: "Partners", icon: BriefcaseIcon },
  { key: "funding", label: "Funding", icon: WalletIcon },
  { key: "commission", label: "Commission", icon: CoinIcon },
] as const;

type TabKey = (typeof TABS)[number]["key"];

type Me = { name: string | null; title: string; titleLabel: string };

/** Where each job's dashboard opens by default — the primary tool for that role. */
const DEFAULT_TAB: Record<string, TabKey> = {
  bdm: "partners",
  sales_lead: "pipeline",
  rep: "today",
};

const TITLE_GREETING: Record<string, string> = {
  bdm: "Your partners and field work, at a glance.",
  sales_lead: "Your team's pipeline and today's reports.",
  rep: "Your queue for today.",
};

const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

function Card({ children }: { children: ReactNode }) {
  return <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">{children}</section>;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-sm text-[var(--muted)]">{children}</p>;
}

function Pill({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "warn" | "good" }) {
  const toneClass =
    tone === "warn"
      ? "bg-amber-100 text-amber-900"
      : tone === "good"
        ? "bg-emerald-100 text-emerald-900"
        : "bg-[var(--surface-alt)] text-[var(--muted)]";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${toneClass}`}>{children}</span>;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function GrowthDeskPage() {
  const [tab, setTab] = useState<TabKey>("today");
  const [me, setMe] = useState<Me | null>(null);
  const tabWasAutoSet = useRef(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [commission, setCommission] = useState<CommissionEntry[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [fundRequests, setFundRequests] = useState<FundRequest[]>([]);
  const [teamReports, setTeamReports] = useState<TeamReport[]>([]);
  const [myReport, setMyReport] = useState<TeamReport | null>(null);
  const [leadScope, setLeadScope] = useState<"mine" | "team">("mine");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      fetch("/api/admin/growth/me", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/growth/tasks", { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/admin/growth/leads?scope=${leadScope}`, { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/growth/commission", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/growth/partners", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/growth/fund-requests", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/growth/reports", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([meBody, tasksBody, leadsBody, commissionBody, partnersBody, fundBody, reportsBody]) => {
        if (!active) return;
        for (const body of [meBody, tasksBody, leadsBody, commissionBody, partnersBody, fundBody, reportsBody]) {
          if (body?.error) throw new Error(body.error);
        }
        setMe(meBody);
        // Only ever auto-picks the tab once, on the first load — after that
        // it's the person's own navigation, not something to override out
        // from under them on every refresh.
        if (!tabWasAutoSet.current) {
          tabWasAutoSet.current = true;
          setTab(DEFAULT_TAB[meBody.title] ?? "today");
        }
        setTasks(tasksBody.tasks ?? []);
        setLeads(leadsBody.leads ?? []);
        setCommission(commissionBody.entries ?? []);
        setPartners(partnersBody.partners ?? []);
        setFundRequests(fundBody.requests ?? []);
        setTeamReports(reportsBody.reports ?? []);
        setMyReport(reportsBody.mine ?? null);
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
  }, [leadScope, refreshKey]);

  const refresh = (message?: string) => {
    setError("");
    if (message) setNotice(message);
    setRefreshKey((k) => k + 1);
  };

  const sortedTasks = useMemo(() => [...tasks].sort((a, b) => b.priorityScore - a.priorityScore), [tasks]);

  return (
    <AdminShell>
      <main className="mx-auto max-w-3xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">
              {greeting()}{me?.name ? `, ${me.name.split(" ")[0]}` : ""}
            </h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {me ? (
                <>
                  <span className="font-semibold text-[var(--foreground)]">{me.titleLabel}</span>
                  {" — "}
                  {TITLE_GREETING[me.title] ?? TITLE_GREETING.rep}
                </>
              ) : (
                "Your Growth Desk."
              )}
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

        <nav className="flex gap-1 overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                tab === key ? "bg-[var(--accent)] text-white" : "text-[var(--muted)] hover:bg-[var(--surface-alt)]"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>

        {loading ? (
          <Card>
            <Empty>Loading…</Empty>
          </Card>
        ) : tab === "today" ? (
          <TodayTab
            tasks={sortedTasks}
            myReport={myReport}
            teamReports={teamReports}
            onTaskDone={async (taskId, outcome) => {
              const res = await fetch("/api/admin/growth/tasks", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ taskId, outcome }),
              });
              const body = await res.json();
              if (!res.ok) return setError(body.error || "Could not update that task.");
              setTasks((prev) => prev.filter((t) => t.id !== taskId));
              setNotice(outcome === "done" ? "Nice — marked done." : "Skipped for now.");
            }}
            onSubmitReport={async (achievement, problemSolved) => {
              const res = await fetch("/api/admin/growth/reports", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ achievement, problemSolved }),
              });
              const body = await res.json();
              if (!res.ok) return setError(body.error || "Could not save today's report.");
              refresh("Today's report saved.");
            }}
          />
        ) : tab === "pipeline" ? (
          <PipelineTab
            leads={leads}
            scope={leadScope}
            onScopeChange={setLeadScope}
            onStage={async (leadId, status) => {
              const res = await fetch("/api/admin/growth/leads", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leadId, action: "stage", status }),
              });
              const body = await res.json();
              if (!res.ok) return setError(body.error || "Could not update that lead.");
              setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, status } : l)));
              setNotice("Stage updated.");
            }}
            onNote={async (leadId, note) => {
              const res = await fetch(`/api/admin/growth/leads/${leadId}/activity`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type: "note", note }),
              });
              const body = await res.json();
              if (!res.ok) return setError(body.error || "Could not save that note.");
              setNotice("Note saved to the lead's history.");
            }}
          />
        ) : tab === "partners" ? (
          <PartnersTab
            partners={partners}
            onAdd={async (data) => {
              const res = await fetch("/api/admin/growth/partners", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
              });
              const body = await res.json();
              if (!res.ok) return setError(body.error || "Could not add that partner.");
              refresh("Partner added.");
            }}
            onLogContact={async (partnerId) => {
              const res = await fetch(`/api/admin/growth/partners/${partnerId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "log-contact" }),
              });
              const body = await res.json();
              if (!res.ok) return setError(body.error || "Could not log that contact.");
              refresh("Logged — this partner is up to date.");
            }}
            onStatus={async (partnerId, status) => {
              const res = await fetch(`/api/admin/growth/partners/${partnerId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "status", status }),
              });
              const body = await res.json();
              if (!res.ok) return setError(body.error || "Could not update that partner.");
              setPartners((prev) => prev.map((p) => (p.id === partnerId ? { ...p, status } : p)));
            }}
          />
        ) : tab === "funding" ? (
          <FundingTab
            requests={fundRequests}
            onRequest={async (data) => {
              const res = await fetch("/api/admin/growth/fund-requests", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
              });
              const body = await res.json();
              if (!res.ok) return setError(body.error || "Could not send that request.");
              refresh("Request sent to the COO.");
            }}
            onDecide={async (id, decision) => {
              const res = await fetch(`/api/admin/growth/fund-requests/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ decision }),
              });
              const body = await res.json();
              if (!res.ok) return setError(body.error || "Could not record that decision.");
              refresh(decision === "approved" ? "Approved." : "Rejected.");
            }}
          />
        ) : (
          <CommissionTab entries={commission} />
        )}
      </main>
    </AdminShell>
  );
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

function TodayTab({
  tasks,
  myReport,
  teamReports,
  onTaskDone,
  onSubmitReport,
}: {
  tasks: Task[];
  myReport: TeamReport | null;
  teamReports: TeamReport[];
  onTaskDone: (taskId: string, outcome: "done" | "skipped") => void;
  onSubmitReport: (achievement: string, problemSolved: string) => void;
}) {
  const [achievement, setAchievement] = useState("");
  const [problemSolved, setProblemSolved] = useState("");
  const [next, ...rest] = tasks;

  return (
    <div className="space-y-5">
      <Card>
        <div>
          <h2 className="text-lg font-bold">Up next</h2>
          <p className="text-sm text-[var(--muted)]">
            One thing at a time. Whatever you don't get to today is still here tomorrow — nothing to carry over by hand.
          </p>
        </div>

        {!next ? (
          <Empty>You're clear. New leads will show up here as they come in.</Empty>
        ) : (
          <>
            <div className="rounded-2xl bg-[var(--surface-alt)] p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                {next.autoAssigned ? "Assigned automatically" : "Assigned to you"}
              </p>
              <p className="mt-1 text-xl font-bold">{next.title}</p>
              {next.lead ? <p className="mt-1 text-sm text-[var(--muted)]">{next.lead.email}</p> : null}
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => onTaskDone(next.id, "done")}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
                >
                  <CheckIcon className="h-4 w-4" />
                  Done
                </button>
                <button
                  type="button"
                  onClick={() => onTaskDone(next.id, "skipped")}
                  className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold"
                >
                  Not now
                </button>
              </div>
            </div>

            {rest.length > 0 ? (
              <ul className="divide-y divide-[var(--border)]">
                {rest.map((task) => (
                  <li key={task.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span>{task.title}</span>
                    <button
                      type="button"
                      onClick={() => onTaskDone(task.id, "done")}
                      className="text-xs font-semibold text-[var(--accent-ink)] hover:underline"
                    >
                      Mark done
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-bold">End of day</h2>
        {myReport ? (
          <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="font-semibold">Logged for today.</p>
            <p className="mt-1">{myReport.achievement}</p>
            {myReport.problemSolved ? <p className="mt-1 text-emerald-800">Solved: {myReport.problemSolved}</p> : null}
          </div>
        ) : (
          <div className="space-y-3">
            <input
              value={achievement}
              onChange={(e) => setAchievement(e.target.value)}
              placeholder="What moved today?"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
            <input
              value={problemSolved}
              onChange={(e) => setProblemSolved(e.target.value)}
              placeholder="A problem you solved or flagged (optional)"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={!achievement.trim()}
              onClick={() => onSubmitReport(achievement.trim(), problemSolved.trim())}
              className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Save today's report
            </button>
          </div>
        )}

        {teamReports.length > 0 ? (
          <div className="border-t border-[var(--border)] pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Team today</p>
            <ul className="mt-2 space-y-2">
              {teamReports.map((r) => (
                <li key={r.id} className="text-sm">
                  <span className="font-semibold">{r.author.name || r.author.email}:</span> {r.achievement}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

function PipelineTab({
  leads,
  scope,
  onScopeChange,
  onStage,
  onNote,
}: {
  leads: Lead[];
  scope: "mine" | "team";
  onScopeChange: (scope: "mine" | "team") => void;
  onStage: (leadId: string, status: string) => void;
  onNote: (leadId: string, note: string) => void;
}) {
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Pipeline</h2>
        <div className="flex rounded-xl border border-[var(--border)] p-1 text-sm font-semibold">
          <button
            type="button"
            onClick={() => onScopeChange("mine")}
            className={`rounded-lg px-3 py-1.5 ${scope === "mine" ? "bg-[var(--accent)] text-white" : ""}`}
          >
            Mine
          </button>
          <button
            type="button"
            onClick={() => onScopeChange("team")}
            className={`rounded-lg px-3 py-1.5 ${scope === "team" ? "bg-[var(--accent)] text-white" : ""}`}
          >
            Team
          </button>
        </div>
      </div>

      {leads.length === 0 ? (
        <Empty>No leads in this view yet.</Empty>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {leads.map((lead) => (
            <li key={lead.id} className="space-y-2.5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{lead.name}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {lead.email} · {lead.branchName ?? "no branch"}
                    {scope === "team" ? ` · ${lead.assignedTo?.name || lead.assignedTo?.email || "unassigned"}` : ""}
                  </p>
                </div>
                <select
                  value={lead.status}
                  onChange={(e) => onStage(lead.id, e.target.value)}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm capitalize"
                >
                  {STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <input
                  value={noteDrafts[lead.id] ?? ""}
                  onChange={(e) => setNoteDrafts((p) => ({ ...p, [lead.id]: e.target.value }))}
                  placeholder="Add a note…"
                  className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => {
                    const note = (noteDrafts[lead.id] || "").trim();
                    if (!note) return;
                    onNote(lead.id, note);
                    setNoteDrafts((p) => ({ ...p, [lead.id]: "" }));
                  }}
                  className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-sm font-semibold"
                >
                  Save
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Partners
// ---------------------------------------------------------------------------

function PartnersTab({
  partners,
  onAdd,
  onLogContact,
  onStatus,
}: {
  partners: Partner[];
  onAdd: (data: { name: string; contactName: string; email: string; phone: string; type: string }) => void;
  onLogContact: (partnerId: string) => void;
  onStatus: (partnerId: string, status: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [type, setType] = useState("partner");
  const staleCount = partners.filter((p) => p.stale).length;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Partners</h2>
            <p className="text-sm text-[var(--muted)]">Corporate relationships and cooperation partners — not prospective students.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((s) => !s)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white"
          >
            <PlusIcon className="h-4 w-4" />
            Add partner
          </button>
        </div>

        {staleCount > 0 ? (
          <Pill tone="warn">{staleCount} haven't been contacted in 30+ days — worth a seasonal note</Pill>
        ) : null}

        {showForm ? (
          <div className="grid gap-2 rounded-xl bg-[var(--surface-alt)] p-4 sm:grid-cols-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Organisation name" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm sm:col-span-2" />
            <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Contact person" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
            <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
              <option value="partner">Cooperation partner</option>
              <option value="corporate">Corporate client</option>
            </select>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
            <button
              type="button"
              disabled={!name.trim()}
              onClick={() => {
                onAdd({ name: name.trim(), contactName, email, phone, type });
                setName(""); setContactName(""); setEmail(""); setPhone(""); setType("partner"); setShowForm(false);
              }}
              className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2"
            >
              Save partner
            </button>
          </div>
        ) : null}

        {partners.length === 0 ? (
          <Empty>No partners yet. Field work and cooperation leads land here.</Empty>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {partners.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3.5">
                <div>
                  <p className="font-semibold">
                    {p.name} {p.stale ? <Pill tone="warn">stale</Pill> : null}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {p.contactName ?? "no contact"} · {p.email ?? "no email"} · {p.type}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={p.status}
                    onChange={(e) => onStatus(p.id, e.target.value)}
                    className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs capitalize"
                  >
                    {PARTNER_STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => onLogContact(p.id)}
                    className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
                  >
                    Log contact
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Funding
// ---------------------------------------------------------------------------

function FundingTab({
  requests,
  onRequest,
  onDecide,
}: {
  requests: FundRequest[];
  onRequest: (data: { amount: number; purpose: string; category: string }) => void;
  onDecide: (id: string, decision: "approved" | "rejected") => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [category, setCategory] = useState("marketing");

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Funding requests</h2>
          <p className="text-sm text-[var(--muted)]">Goes to the COO. Unanswered past an hour, Accounting can decide.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((s) => !s)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white"
        >
          <PlusIcon className="h-4 w-4" />
          New request
        </button>
      </div>

      {showForm ? (
        <div className="grid gap-2 rounded-xl bg-[var(--surface-alt)] p-4 sm:grid-cols-2">
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" placeholder="Amount" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
            <option value="marketing">Marketing</option>
            <option value="mobility">Mobility</option>
            <option value="other">Other</option>
          </select>
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="What's it for?" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm sm:col-span-2" />
          <button
            type="button"
            disabled={!amount || !purpose.trim()}
            onClick={() => {
              onRequest({ amount: Number(amount), purpose: purpose.trim(), category });
              setAmount(""); setPurpose(""); setCategory("marketing"); setShowForm(false);
            }}
            className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2"
          >
            Send to COO
          </button>
        </div>
      ) : null}

      {requests.length === 0 ? (
        <Empty>No requests yet.</Empty>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {requests.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3.5">
              <div>
                <p className="font-semibold">
                  {r.amount.toLocaleString()} <span className="font-normal text-[var(--muted)]">· {r.purpose}</span>
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {r.requester.name || r.requester.email} · {date(r.createdAt)} · {r.category}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {r.status === "pending" && r.overdue ? <Pill tone="warn">past 1hr — Accounting can decide</Pill> : null}
                {r.status !== "pending" ? (
                  <Pill tone={r.status === "approved" ? "good" : "default"}>{r.status}</Pill>
                ) : r.canDecide ? (
                  <>
                    <button type="button" onClick={() => onDecide(r.id, "approved")} className="rounded-xl bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white">
                      Approve
                    </button>
                    <button type="button" onClick={() => onDecide(r.id, "rejected")} className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold">
                      Reject
                    </button>
                  </>
                ) : (
                  <Pill>pending</Pill>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Commission
// ---------------------------------------------------------------------------

function CommissionTab({ entries }: { entries: CommissionEntry[] }) {
  return (
    <Card>
      <div>
        <h2 className="text-lg font-bold">My commission</h2>
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          The rate shown here is a placeholder, not a confirmed payout policy. Nobody should be paid off these figures
          until the school sets the real commission rate.
        </p>
      </div>
      {entries.length === 0 ? (
        <Empty>No commission entries yet.</Empty>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {entries.map((entry) => (
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
    </Card>
  );
}
