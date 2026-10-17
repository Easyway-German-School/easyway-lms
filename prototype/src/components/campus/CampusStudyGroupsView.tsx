"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { CampusHeader } from "@/components/campus/CampusParts";
import { YouthBlobs } from "@/components/youth/YouthMotion";
import { STUDY_GROUP_FOCI } from "@/lib/study-groups";
import type { StudyGroupFocus } from "@/lib/study-groups";

type StudyGroup = {
  id: string;
  name: string;
  focus: StudyGroupFocus;
  startsAt: string;
  expiresAt: string;
  ownerName: string;
  isOwner: boolean;
  isMember: boolean;
  memberCount: number;
  members: Array<{ name: string; role: string }>;
};

function localDateTime(value: Date): string {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function sessionTime(group: StudyGroup, now: number): string {
  const startsAt = new Date(group.startsAt);
  if (startsAt.getTime() <= now) return "In progress · ends";
  return `Starts ${startsAt.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
}

export default function CampusStudyGroupsView() {
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [level, setLevel] = useState("your level");
  const [focus, setFocus] = useState<StudyGroupFocus>("vocabulary");
  const [scheduledAt, setScheduledAt] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadGroups = useCallback(async () => {
    try {
      const response = await fetch("/api/campus/study-groups", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        groups?: StudyGroup[];
        cohort?: { level?: string };
      };
      if (!response.ok) throw new Error(data.error || "Could not load study groups.");
      setGroups(Array.isArray(data.groups) ? data.groups : []);
      setLevel(data.cohort?.level || "your level");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load study groups.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGroups();
    const refresh = window.setInterval(() => {
      setNow(Date.now());
      void loadGroups();
    }, 30_000);
    return () => window.clearInterval(refresh);
  }, [loadGroups]);

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("create");
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/campus/study-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          focus,
          ...(scheduledAt ? { startsAt: new Date(scheduledAt).toISOString() } : {}),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not start the study session.");
      setScheduledAt("");
      setNotice("Your study session is open to classmates in your cohort.");
      await loadGroups();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the study session.");
    } finally {
      setBusy(null);
    }
  }

  async function updateMembership(group: StudyGroup, action: "join" | "leave") {
    setBusy(`${action}:${group.id}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/campus/study-groups/${group.id}/${action}`, {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; closed?: boolean };
      if (!response.ok) throw new Error(data.error || `Could not ${action} that study group.`);
      setNotice(data.closed ? "You were the last member, so the group has closed." : action === "join" ? "You joined the study session." : "You left the study session.");
      await loadGroups();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not ${action} that study group.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative isolate mx-auto max-w-3xl px-4 pb-10 pt-5 sm:px-6">
      <YouthBlobs />
      <div className="relative">
        <CampusHeader title="Study groups" subtitle="Meet classmates for a short, focused German session" back="/campus" />

        <section className="mt-5 rounded-[2rem] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow)] sm:p-7">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Start something together</p>
          <h2 className="mt-1 text-xl font-extrabold">Create an {level} study session</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Choose a focus and start now, or pick a time up to seven days ahead. Sessions run for 90 minutes and fit up to eight classmates.
          </p>
          <form onSubmit={createGroup} className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="grid gap-1.5 text-sm font-bold">
              What should you work on?
              <select
                value={focus}
                onChange={(event) => setFocus(event.target.value as StudyGroupFocus)}
                className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[var(--foreground)]"
              >
                {STUDY_GROUP_FOCI.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-bold">
              Schedule (optional)
              <input
                type="datetime-local"
                value={scheduledAt}
                min={localDateTime(new Date(now + 5 * 60_000))}
                max={localDateTime(new Date(now + 7 * 24 * 60 * 60_000))}
                onChange={(event) => setScheduledAt(event.target.value)}
                className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[var(--foreground)]"
              />
            </label>
            <button
              type="submit"
              disabled={busy !== null}
              className="min-h-11 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-extrabold text-white disabled:opacity-60"
            >
              {busy === "create" ? "Starting…" : scheduledAt ? "Schedule group" : "Start now"}
            </button>
          </form>
        </section>

        <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/80 px-4 py-3 text-sm text-[var(--muted)]">
          Only students in your same branch, level, sitting, intake batch, and Campus age band can see or join these groups. Use your{" "}
          <Link href="/community" className="font-bold text-[var(--accent)] underline-offset-4 hover:underline">class chat</Link>{" "}
          to coordinate; groups do not create private chat rooms.
        </div>

        {error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{error}</p> : null}
        {notice ? <p role="status" className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">{notice}</p> : null}

        <section className="mt-7">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Your classmates</p>
              <h2 className="mt-1 text-xl font-extrabold">Open study sessions</h2>
            </div>
            <span className="text-xs font-semibold text-[var(--muted)]">{groups.length} open</span>
          </div>

          {loading ? (
            <p className="mt-4 text-sm text-[var(--muted)]">Finding sessions in your cohort…</p>
          ) : groups.length === 0 ? (
            <div className="mt-4 rounded-[2rem] border border-dashed border-[var(--border-strong)] p-6 text-center">
              <p className="font-extrabold">No open sessions yet</p>
              <p className="mt-1 text-sm text-[var(--muted)]">Start one now. Classmates in your cohort will see it here and can join.</p>
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {groups.map((group) => {
                const full = group.memberCount >= 8;
                const expired = new Date(group.expiresAt).getTime() <= now;
                return (
                  <li key={group.id} className="rounded-[1.75rem] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-extrabold">{group.name}</h3>
                        <p className="mt-1 text-xs font-semibold text-[var(--accent)]">{sessionTime(group, now)} · hosted by {group.ownerName}</p>
                      </div>
                      <span className="rounded-full bg-[var(--surface-alt)] px-3 py-1 text-xs font-bold text-[var(--muted)]">
                        {group.memberCount}/8 classmates
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {group.members.map((member, index) => (
                        <span key={`${group.id}:${index}`} className="rounded-full bg-[var(--surface-alt)] px-3 py-1 text-xs font-semibold">
                          {member.name}{member.role === "owner" ? " · host" : ""}
                        </span>
                      ))}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {!group.isMember && !full && !expired ? (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void updateMembership(group, "join")}
                          className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-extrabold text-white disabled:opacity-60"
                        >
                          {busy === `join:${group.id}` ? "Joining…" : "Join session"}
                        </button>
                      ) : null}
                      {group.isMember ? (
                        <>
                          <Link href="/community" className="rounded-full bg-[var(--accent-soft)] px-4 py-2 text-sm font-bold text-[var(--accent-ink)]">
                            Open class chat
                          </Link>
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => void updateMembership(group, "leave")}
                            className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold text-[var(--muted)] disabled:opacity-60"
                          >
                            {busy === `leave:${group.id}` ? "Leaving…" : group.isOwner ? "Leave & hand over host" : "Leave group"}
                          </button>
                        </>
                      ) : full ? (
                        <span className="text-sm font-semibold text-[var(--muted)]">This session is full.</span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
