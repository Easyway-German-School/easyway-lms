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
  UsersIcon,
  UploadIcon,
  PhoneIcon,
  ChatBubbleIcon,
} from "@/components/icons";

/**
 * Nigerian-first phone normalisation for `tel:`/`wa.me` links, kept local
 * and tiny rather than imported from src/lib/sms.ts — that module pulls in
 * server-only SDKs, and this page is a client component. Importing it here
 * would risk the exact "server code bundled into the client" failure mode
 * already blocking the local dev server elsewhere in this app.
 */
function phoneDigits(raw: string | null): string | null {
  const digits = (raw ?? "").replace(/[^\d]/g, "");
  if (!digits) return null;
  if (digits.startsWith("234") && digits.length === 13) return digits;
  if (digits.startsWith("0") && digits.length === 11) return `234${digits.slice(1)}`;
  if (digits.length === 10) return `234${digits}`;
  return digits.length >= 10 ? digits : null;
}

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

type AiSignal = { urgency: string; objection: string | null; buyingSignal: string; summary: string };

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
  aiSignal: AiSignal | null;
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
  { key: "team", label: "Team", icon: UsersIcon },
  { key: "partners", label: "Partners", icon: BriefcaseIcon },
  { key: "funding", label: "Funding", icon: WalletIcon },
  { key: "commission", label: "Commission", icon: CoinIcon },
] as const;

type TabKey = (typeof TABS)[number]["key"];

type Me = { name: string | null; title: string; titleLabel: string };

type RepStat = {
  id: string;
  name: string | null;
  email: string;
  title: string;
  titleLabel: string;
  pendingTasks: number;
  doneToday: number;
  leadsAssigned: number;
  leadsConverted: number;
  reportedToday: boolean;
};

type SourceLearning = { source: string; rate: number; sampleSize: number; confident: boolean };
type RepLearning = { id: string; name: string | null; email: string; rate: number; sampleSize: number; confident: boolean };

/** Where each job's dashboard opens by default — the primary tool for that role. */
const DEFAULT_TAB: Record<string, TabKey> = {
  bdm: "partners",
  // "Ensures team performance" is its own duty in the handbook, separate
  // from driving sales — so the Teamlead's desk opens on who's keeping up,
  // not the pipeline itself.
  sales_lead: "team",
  rep: "today",
};

const TITLE_GREETING: Record<string, string> = {
  bdm: "Your partners and field work, at a glance.",
  sales_lead: "Your team, and whether today's moving.",
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
  const [teamStats, setTeamStats] = useState<RepStat[]>([]);
  const [sourceLearning, setSourceLearning] = useState<SourceLearning[]>([]);
  const [repLearning, setRepLearning] = useState<RepLearning[]>([]);
  const [leadScope, setLeadScope] = useState<"mine" | "team">("mine");
  // Null means "not the super admin, or not loaded yet" — the toggle card
  // simply does not render. Fetched separately from the main Promise.all
  // because a 403 here is the EXPECTED, ordinary case for almost every
  // viewer, not a load failure the page should show an error for.
  const [aiSettings, setAiSettings] = useState<{ enabled: boolean; keyConfigured: boolean } | null>(null);
  const [autoAssign, setAutoAssign] = useState<{ enabled: boolean; unassigned: number } | null>(null);
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
      fetch("/api/admin/growth/team", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/growth/intelligence", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/growth/auto-assign", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([meBody, tasksBody, leadsBody, commissionBody, partnersBody, fundBody, reportsBody, teamBody, intelBody, autoAssignBody]) => {
        if (!active) return;
        for (const body of [meBody, tasksBody, leadsBody, commissionBody, partnersBody, fundBody, reportsBody, teamBody, intelBody, autoAssignBody]) {
          if (body?.error) throw new Error(body.error);
        }
        setMe(meBody);
        setTeamStats(teamBody.reps ?? []);
        setSourceLearning(intelBody.sources ?? []);
        setRepLearning(intelBody.reps ?? []);
        setAutoAssign({ enabled: autoAssignBody.enabled, unassigned: autoAssignBody.unassigned ?? 0 });
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

  useEffect(() => {
    let active = true;
    fetch("/api/admin/growth/ai-settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (active && body && !body.error) setAiSettings({ enabled: body.enabled, keyConfigured: body.keyConfigured });
      })
      .catch(() => {
        /* Not the super admin — the card just stays hidden. */
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const refresh = (message?: string) => {
    setError("");
    if (message) setNotice(message);
    setRefreshKey((k) => k + 1);
  };

  /**
   * A note, a call, or a stage change can silently auto-complete a task on
   * Today (see autoCompleteTasksForLeadActivity) — this pulls the queue back
   * in sync so a cleared task doesn't keep sitting there until the next full
   * refresh.
   */
  const refreshTasks = async () => {
    const body = await fetch("/api/admin/growth/tasks", { cache: "no-store" }).then((r) => r.json());
    if (!body?.error) setTasks(body.tasks ?? []);
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
            canReassign={me?.title === "sales_lead"}
            reps={teamStats}
            onReassign={async (leadId, assignedToId) => {
              const res = await fetch("/api/admin/growth/leads", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leadId, action: "reassign", assignedToId }),
              });
              const body = await res.json();
              if (!res.ok) return setError(body.error || "Could not reassign that lead.");
              setLeads((prev) =>
                prev.map((l) =>
                  l.id === leadId
                    ? { ...l, assignedTo: teamStats.find((r) => r.id === assignedToId) ?? l.assignedTo }
                    : l,
                ),
              );
              setNotice("Lead reassigned — they'll get a push.");
            }}
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
              void refreshTasks();
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
              void refreshTasks();
            }}
            onImport={async (csv) => {
              const res = await fetch("/api/admin/growth/leads", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ csv }),
              });
              const body = await res.json();
              if (!res.ok) throw new Error(body.error || "Import failed");
              refresh(`Imported ${body.created} new lead${body.created === 1 ? "" : "s"}, updated ${body.updated}${body.skipped?.length ? `, skipped ${body.skipped.length}` : ""} — scored and assigned automatically.`);
              return body;
            }}
          />
        ) : tab === "team" ? (
          <TeamTab
            reps={teamStats}
            sourceLearning={sourceLearning}
            repLearning={repLearning}
            aiSettings={aiSettings}
            onToggleAi={async (enabled) => {
              const res = await fetch("/api/admin/growth/ai-settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled }),
              });
              const body = await res.json();
              if (!res.ok) return setError(body.error || "Could not change that setting.");
              setAiSettings({ enabled: body.enabled, keyConfigured: body.keyConfigured });
              setNotice(enabled ? "Growth Desk AI turned on." : "Growth Desk AI turned off.");
            }}
            autoAssign={autoAssign}
            canManageAutoAssign={me?.title === "sales_lead"}
            onToggleAutoAssign={async (enabled) => {
              const res = await fetch("/api/admin/growth/auto-assign", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled }),
              });
              const body = await res.json();
              if (!res.ok) return setError(body.error || "Could not change that setting.");
              setAutoAssign({ enabled: body.enabled, unassigned: body.unassigned ?? 0 });
              setNotice(enabled ? "Auto-assign turned on — new leads route themselves again." : "Auto-assign turned off — new leads will wait for you to hand them out.");
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
              {next.lead ? (
                <p className="mt-3 text-xs text-[var(--muted)]">
                  Call them, log a note, or move their stage in Pipeline — this clears itself the moment you do.
                  Nothing to click here to claim it done.
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                {next.lead?.phone && phoneDigits(next.lead.phone)
                  ? (() => {
                      const digits = phoneDigits(next.lead!.phone)!;
                      return (
                        <>
                          <a
                            href={`tel:+${digits}`}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
                          >
                            <PhoneIcon className="h-4 w-4" />
                            Call now
                          </a>
                          <a
                            href={`https://wa.me/${digits}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold"
                          >
                            <ChatBubbleIcon className="h-4 w-4" />
                            WhatsApp
                          </a>
                        </>
                      );
                    })()
                  : null}
                {!next.lead ? (
                  <button
                    type="button"
                    onClick={() => onTaskDone(next.id, "done")}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
                  >
                    <CheckIcon className="h-4 w-4" />
                    Done
                  </button>
                ) : null}
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
                    {task.lead ? (
                      <span className="text-xs text-[var(--muted)]">clears on contact</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onTaskDone(task.id, "done")}
                        className="text-xs font-semibold text-[var(--accent-ink)] hover:underline"
                      >
                        Mark done
                      </button>
                    )}
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
  onImport,
  canReassign,
  reps,
  onReassign,
}: {
  leads: Lead[];
  scope: "mine" | "team";
  onScopeChange: (scope: "mine" | "team") => void;
  onStage: (leadId: string, status: string) => void;
  onNote: (leadId: string, note: string) => void;
  onImport: (csv: string) => Promise<{ created: number; updated: number; skipped: Array<{ row: number; reason: string }> }>;
  canReassign: boolean;
  reps: RepStat[];
  onReassign: (leadId: string, assignedToId: string) => void;
}) {
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [showImport, setShowImport] = useState(false);
  const [csv, setCsv] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);

  const unassignedCount = scope === "team" ? leads.filter((l) => !l.assignedTo).length : 0;
  const visibleLeads = scope === "team" && onlyUnassigned ? leads.filter((l) => !l.assignedTo) : leads;

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(setCsv);
  }

  async function runImport() {
    if (!csv.trim() || importing) return;
    setImporting(true);
    setImportError("");
    try {
      await onImport(csv);
      setCsv("");
      setShowImport(false);
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Pipeline</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowImport((s) => !s)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-1.5 text-sm font-semibold hover:bg-[var(--surface-alt)]"
          >
            <UploadIcon className="h-4 w-4" />
            Import sheet
          </button>
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
          {scope === "team" && canReassign && unassignedCount > 0 ? (
            <button
              type="button"
              onClick={() => setOnlyUnassigned((s) => !s)}
              className={`rounded-xl px-3 py-1.5 text-sm font-semibold ${
                onlyUnassigned ? "bg-amber-500 text-white" : "bg-amber-100 text-amber-900"
              }`}
            >
              {unassignedCount} unassigned{onlyUnassigned ? " · showing" : ""}
            </button>
          ) : null}
        </div>
      </div>

      {showImport && (
        <div className="space-y-2.5 rounded-xl bg-[var(--surface-alt)] p-4">
          <p className="text-sm text-[var(--muted)]">
            Bring in your Google Sheet directly — paste it below or upload the CSV. A <strong>name</strong> and{" "}
            <strong>email</strong> column are required; phone, level, session and notes are picked up too if
            they're there. Every row is scored and assigned the same way a lead coming in one at a time is —
            nothing to sort by hand afterward.
          </p>
          {importError && <p className="rounded-lg bg-red-50 p-2 text-xs font-semibold text-red-700">{importError}</p>}
          <input type="file" accept=".csv,text/csv" onChange={handleFile} className="text-sm" />
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={5}
            placeholder="name,email,phone,level,session,notes"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs"
          />
          <button
            type="button"
            onClick={() => void runImport()}
            disabled={!csv.trim() || importing}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {importing ? "Importing…" : "Import"}
          </button>
        </div>
      )}

      {visibleLeads.length === 0 ? (
        <Empty>{onlyUnassigned ? "Nothing unassigned — everything's been handed out." : "No leads in this view yet."}</Empty>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {visibleLeads.map((lead) => (
            <li key={lead.id} className="space-y-2.5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{lead.name}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {lead.email} · {lead.branchName ?? "no branch"}
                    {scope === "team" ? ` · ${lead.assignedTo?.name || lead.assignedTo?.email || "unassigned"}` : ""}
                  </p>
                  {(() => {
                    const digits = phoneDigits(lead.phone);
                    if (!digits) return null;
                    return (
                      <p className="mt-1.5 flex items-center gap-3">
                        <a
                          href={`tel:+${digits}`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent-ink)]"
                        >
                          <PhoneIcon className="h-3.5 w-3.5" />
                          Call
                        </a>
                        <a
                          href={`https://wa.me/${digits}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent-ink)]"
                        >
                          <ChatBubbleIcon className="h-3.5 w-3.5" />
                          WhatsApp
                        </a>
                      </p>
                    );
                  })()}
                  {lead.aiSignal && (
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      <Pill tone={lead.aiSignal.urgency === "high" ? "warn" : lead.aiSignal.buyingSignal === "strong" ? "good" : "default"}>
                        AI: {lead.aiSignal.urgency} urgency · {lead.aiSignal.buyingSignal} signal
                      </Pill>
                      <span className="text-[var(--muted)]">{lead.aiSignal.summary}</span>
                    </p>
                  )}
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
              {scope === "team" && canReassign ? (
                <select
                  value={lead.assignedTo?.id ?? ""}
                  onChange={(e) => e.target.value && onReassign(lead.id, e.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm"
                  aria-label={`Reassign ${lead.name}`}
                >
                  <option value="" disabled>
                    {lead.assignedTo ? "Reassign to…" : "Assign to…"}
                  </option>
                  {reps.map((rep) => (
                    <option key={rep.id} value={rep.id}>
                      {rep.name || rep.email}
                    </option>
                  ))}
                </select>
              ) : null}
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
// Team
// ---------------------------------------------------------------------------

/** One learned rate, with a small fill bar — the one chart this page gets, deliberately plain. */
function LearningRow({ label, rate, confident, sampleSize }: { label: string; rate: number; confident: boolean; sampleSize: number }) {
  const pct = Math.round(rate * 100);
  return (
    <li>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm capitalize">{label}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="text-base font-bold tabular-nums text-[var(--foreground)]">{pct}%</span>
          {!confident && <Pill tone="warn">learning · {sampleSize}</Pill>}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]">
        <div
          className={`h-full rounded-full ${confident ? "bg-[var(--accent)]" : "bg-[var(--accent)]/40"}`}
          style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
        />
      </div>
    </li>
  );
}

function TeamTab({
  reps,
  sourceLearning,
  repLearning,
  aiSettings,
  onToggleAi,
  autoAssign,
  canManageAutoAssign,
  onToggleAutoAssign,
}: {
  reps: RepStat[];
  sourceLearning: SourceLearning[];
  repLearning: RepLearning[];
  aiSettings: { enabled: boolean; keyConfigured: boolean } | null;
  onToggleAi: (enabled: boolean) => void;
  autoAssign: { enabled: boolean; unassigned: number } | null;
  canManageAutoAssign: boolean;
  onToggleAutoAssign: (enabled: boolean) => void;
}) {
  return (
    <div className="space-y-5">
      {autoAssign && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Auto-assign new leads</h2>
              <p className="text-sm text-[var(--muted)]">
                When on, a new lead is routed to a rep the moment it lands — same as always. Turn it off to hold
                everything in an unassigned pool and hand leads out yourself, e.g. for a campaign you want to route by
                hand.
              </p>
              {!autoAssign.enabled && autoAssign.unassigned > 0 ? (
                <p className="mt-1 text-xs font-semibold text-amber-700">
                  {autoAssign.unassigned} lead{autoAssign.unassigned === 1 ? "" : "s"} waiting, unassigned — reassign
                  them from the Pipeline tab.
                </p>
              ) : null}
            </div>
            {canManageAutoAssign ? (
              <button
                type="button"
                onClick={() => onToggleAutoAssign(!autoAssign.enabled)}
                className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold ${
                  autoAssign.enabled ? "bg-[var(--accent)] text-white" : "border border-[var(--border)]"
                }`}
              >
                {autoAssign.enabled ? "On — turn off" : "Off — turn on"}
              </button>
            ) : (
              <Pill tone={autoAssign.enabled ? "good" : "warn"}>{autoAssign.enabled ? "On" : "Off"}</Pill>
            )}
          </div>
        </Card>
      )}

      {aiSettings && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Growth Desk AI</h2>
              <p className="text-sm text-[var(--muted)]">
                When on, Claude reads a lead's notes after a rep saves one and adds an urgency/objection read to the
                queue — see the Pipeline tab. The built-in scoring above never depends on this; it's an addition, not
                a replacement.
              </p>
              {!aiSettings.keyConfigured && (
                <p className="mt-1 text-xs text-amber-700">No API key is configured yet — this stays off either way until one is added.</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onToggleAi(!aiSettings.enabled)}
              disabled={!aiSettings.keyConfigured}
              className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                aiSettings.enabled ? "bg-[var(--accent)] text-white" : "border border-[var(--border)]"
              }`}
            >
              {aiSettings.enabled ? "On — turn off" : "Off — turn on"}
            </button>
          </div>
        </Card>
      )}

      <Card>
        <div>
          <h2 className="text-lg font-bold">Team</h2>
          <p className="text-sm text-[var(--muted)]">
            What's on everyone's plate right now, and what actually moved today.
          </p>
        </div>

        {reps.length === 0 ? (
          <Empty>Nobody's been given a Growth Desk job yet.</Empty>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {reps.map((rep) => (
              <li key={rep.id} className="flex flex-wrap items-center justify-between gap-3 py-3.5">
                <div>
                  <p className="font-semibold">{rep.name || rep.email}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {rep.titleLabel} · {rep.leadsAssigned} leads · {rep.leadsConverted} converted
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Pill tone={rep.doneToday > 0 ? "good" : "default"}>{rep.doneToday} done today</Pill>
                  <Pill tone={rep.pendingTasks > 5 ? "warn" : "default"}>{rep.pendingTasks} pending</Pill>
                  <Pill tone={rep.reportedToday ? "good" : "warn"}>
                    {rep.reportedToday ? "reported" : "no report yet"}
                  </Pill>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <div>
          <h2 className="text-lg font-bold">What the algorithm has learned</h2>
          <p className="text-sm text-[var(--muted)]">
            New leads are routed and ranked off these numbers — a weighted pick, not always the top name, so
            everyone keeps getting a fair shot and the numbers keep improving. Rates with little real data yet
            lean on a sensible starting guess, flagged below.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">By lead source</p>
            <ul className="mt-2.5 space-y-2.5">
              {sourceLearning.length === 0 ? (
                <li className="text-sm text-[var(--muted)]">No leads yet.</li>
              ) : (
                sourceLearning.map((s) => <LearningRow key={s.source} label={s.source.replace("_", " ")} rate={s.rate} confident={s.confident} sampleSize={s.sampleSize} />)
              )}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">By rep</p>
            <ul className="mt-2.5 space-y-2.5">
              {repLearning.length === 0 ? (
                <li className="text-sm text-[var(--muted)]">Nobody assigned yet.</li>
              ) : (
                repLearning.map((r) => <LearningRow key={r.id} label={r.name || r.email} rate={r.rate} confident={r.confident} sampleSize={r.sampleSize} />)
              )}
            </ul>
          </div>
        </div>
      </Card>
    </div>
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
