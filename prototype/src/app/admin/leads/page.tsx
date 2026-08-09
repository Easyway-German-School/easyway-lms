"use client";

import { EmptyIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AdminShell from "@/components/AdminShell";

/**
 * The enquiry list.
 *
 * Registrants live here, not in the student roster, so a campaign that brings
 * in thousands of names cannot distort class sizes or branch revenue. The
 * office invites the real ones; inviting emails them a prefilled signup link
 * and they become students by completing it themselves.
 */

type Lead = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  branchName: string | null;
  interestedLevel: string | null;
  sessionSlot: string | null;
  classType: string;
  source: string;
  status: string;
  invitedAt: string | null;
  createdAt: string;
};

type Branch = { id: string; name: string };

const STATUS_TONE: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  invited: "bg-amber-100 text-amber-700",
  converted: "bg-emerald-100 text-emerald-700",
  dropped: "bg-slate-100 text-slate-500",
};

const STATUSES = ["new", "invited", "converted", "dropped"];

function LeadsBoard() {
  const params = useSearchParams();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [branches, setBranches] = useState<Branch[]>([]);
  // Seeded from the URL so the dashboard's "Enquiries to invite" tile lands on
  // the new leads rather than on whatever tab happened to be the default.
  const [status, setStatus] = useState(() => {
    const requested = params.get("status");
    return requested && STATUSES.includes(requested) ? requested : "new";
  });
  const [branchId, setBranchId] = useState(params.get("branchId") ?? "");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [csv, setCsv] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/branches", { cache: "no-store" });
        const data = await res.json();
        setBranches(data.branches ?? []);
      } catch {
        /* The filter stays empty; the list still loads. */
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (branchId) params.set("branchId", branchId);
      if (query.trim()) params.set("q", query.trim());

      const res = await fetch(`/api/admin/leads?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Unable to load enquiries");

      const data = await res.json();
      setLeads(data.leads ?? []);
      setCounts(data.counts ?? {});
      // Stale ticks must not survive a reload, or a later action would hit
      // enquiries the admin can no longer see.
      setSelected({});
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [status, branchId, query]);

  useEffect(() => { load(); }, [load]);

  const selectedIds = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
  const actionable = leads.filter((l) => l.status !== "converted");

  async function act(action: "invite" | "drop") {
    if (selectedIds.length === 0) return;
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/admin/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, leadIds: selectedIds }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not complete that");

      const result = await res.json();
      setNotice(
        action === "invite"
          ? `Enrolment link emailed to ${result.invited.length} ${result.invited.length === 1 ? "person" : "people"}.`
          : `${result.dropped} enquir${result.dropped === 1 ? "y" : "ies"} marked as dropped.`,
      );
      setError("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete that");
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!csv.trim()) return;
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/admin/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "import", csv, branchId: branchId || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Import failed");

      const result = await res.json();
      const skipped = result.skipped?.length ?? 0;
      setNotice(
        `Imported ${result.created} new and updated ${result.updated} existing enquir${result.updated === 1 ? "y" : "ies"}.` +
        (skipped > 0 ? ` ${skipped} row${skipped === 1 ? "" : "s"} skipped.` : ""),
      );
      setError("");
      setCsv("");
      setShowImport(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Enquiries</h1>
          <p className="mt-1 text-sm text-slate-500">
            Registrants live here until they enrol, so campaign numbers never distort the student
            roster. Inviting someone emails a prefilled signup link — they choose their own password,
            and their account starts with tuition pending.
          </p>
        </div>

        <div className="mb-6 flex flex-wrap gap-3">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-full px-4 py-2 text-sm font-medium capitalize transition ${
                status === s ? "bg-slate-900 text-white" : "border bg-white hover:bg-slate-50"
              }`}
            >
              {s} {counts[s] ? `(${counts[s]})` : ""}
            </button>
          ))}
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or email"
            className="rounded-lg border px-3 py-2 text-sm"
          />
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="rounded-lg border px-3 py-2 text-sm">
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>

          <button
            onClick={() => act("invite")}
            disabled={busy || selectedIds.length === 0}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? "Working…" : `Invite ${selectedIds.length || ""} to enrol`}
          </button>
          <button
            onClick={() => act("drop")}
            disabled={busy || selectedIds.length === 0}
            className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
          >
            Mark dropped
          </button>
          <button
            onClick={() => setShowImport(!showImport)}
            className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-slate-50"
          >
            {showImport ? "Close import" : "Import CSV"}
          </button>
        </div>

        {showImport && (
          <div className="mb-6 rounded-xl border bg-white p-6">
            <h2 className="font-semibold">Import registrants</h2>
            <p className="mt-1 text-sm text-slate-500">
              Paste CSV including a header row. A <strong>name</strong> and <strong>email</strong> column
              are required; <strong>phone</strong>, <strong>level</strong>, <strong>session</strong> and{" "}
              <strong>notes</strong> are used when present. Existing enquiries are updated, not duplicated.
            </p>
            <textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={8}
              placeholder={"name,email,phone,level\nAda Obi,ada@example.com,08012345678,A1"}
              className="mt-3 w-full rounded-lg border p-3 font-mono text-xs"
            />
            <div className="mt-3 flex items-center gap-3">
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) setCsv(await file.text());
                }}
                className="text-sm"
              />
              <button
                onClick={runImport}
                disabled={busy || !csv.trim()}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {busy ? "Importing…" : "Import"}
              </button>
            </div>
          </div>
        )}

        {error && <div className="mb-4 rounded bg-red-100 p-4 text-red-700">{error}</div>}
        {notice && <div className="mb-4 rounded bg-emerald-100 p-4 text-emerald-800">{notice}</div>}

        {loading ? (
          <div className="py-12 text-center text-slate-500">Loading…</div>
        ) : leads.length === 0 ? (
          <div className="py-12 text-center">
            <EmptyIcon className="mx-auto h-9 w-9 text-slate-400" />
            <p className="mt-2 font-semibold">Nothing here</p>
            <p className="mt-1 text-sm text-slate-500">No enquiry matches these filters.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-white">
            <table className="w-full">
              <thead className="border-b bg-slate-50 text-left text-sm">
                <tr>
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select every actionable enquiry"
                      checked={actionable.length > 0 && selectedIds.length === actionable.length}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? Object.fromEntries(actionable.map((l) => [l.id, true]))
                            : {},
                        )
                      }
                    />
                  </th>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Contact</th>
                  <th className="px-4 py-3 font-semibold">Wants</th>
                  <th className="px-4 py-3 font-semibold">Source</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} className="border-b text-sm hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${l.name}`}
                        disabled={l.status === "converted"}
                        checked={Boolean(selected[l.id])}
                        onChange={(e) => setSelected({ ...selected, [l.id]: e.target.checked })}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{l.name}</p>
                      <p className="text-xs text-slate-500">
                        {new Date(l.createdAt).toLocaleDateString()}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-slate-700">{l.email}</p>
                      {l.phone && <p className="text-xs text-slate-500">{l.phone}</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {l.interestedLevel ?? "—"}
                      {l.sessionSlot && <span className="capitalize"> · {l.sessionSlot}</span>}
                      {l.classType === "private" && (
                        <span className="ml-2 rounded bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">
                          Private
                        </span>
                      )}
                      {l.branchName && <p className="text-xs text-slate-500">{l.branchName}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{l.source}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold capitalize ${STATUS_TONE[l.status] ?? STATUS_TONE.new}`}>
                        {l.status}
                      </span>
                      {l.invitedAt && l.status === "invited" && (
                        <p className="mt-1 text-xs text-slate-500">
                          {new Date(l.invitedAt).toLocaleDateString()}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

export default function AdminLeadsPage() {
  // useSearchParams needs a Suspense boundary above it.
  return (
    <Suspense
      fallback={
        <AdminShell>
          <p className="p-6 text-sm text-[var(--muted)]">Loading enquiries…</p>
        </AdminShell>
      }
    >
      <LeadsBoard />
    </Suspense>
  );
}
