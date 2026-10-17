"use client";

import Link from "next/link";

import { BookOpenIcon, CommunityIcon, TargetIcon, UsersIcon } from "@/components/icons";
import { useCampusLive } from "@/lib/useCampus";

export default function CampusHomeCard({ showStudyGroups = true }: { showStudyGroups?: boolean }) {
  const { live, isPending, isError } = useCampusLive("lobby", true);
  const snapshot = live?.snapshot;
  const readOnly = live?.reason === "impersonation";
  const unavailable = live?.ok === false && !readOnly;

  return (
    <section
      aria-labelledby="campus-home-title"
      className="relative overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow)] sm:rounded-[32px] sm:p-7"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[var(--accent)]/10 blur-3xl"
      />
      <div className="relative">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Campus · from Home</p>
            <h2 id="campus-home-title" className="mt-1 text-xl font-extrabold text-[var(--foreground)]">
              Study and practise together
            </h2>
          </div>
          <Link href="/campus" className="text-sm font-bold text-[var(--accent)] underline-offset-4 hover:underline">
            Open Campus
          </Link>
        </div>

        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Drop into a shared study sprint, challenge a classmate, or continue the conversation with your class group.
        </p>

        <div className="mt-4 rounded-2xl bg-[var(--surface-alt)] px-4 py-3" aria-live="polite">
          {readOnly ? (
            <p className="text-sm font-semibold text-[var(--muted)]">
              Remote view is read-only. Use Admin → Community → Youth view to preview Campus.
            </p>
          ) : unavailable ? (
            <p className="text-sm font-semibold text-[var(--muted)]">
              {live?.reason === "off"
                ? "Campus is paused by the school right now."
                : live?.reason === "locked"
                  ? "Campus opens when your tuition access is active."
                  : "Campus is available to student accounts."}
            </p>
          ) : isError ? (
            <p className="text-sm font-semibold text-[var(--muted)]">
              Campus status is temporarily unavailable. You can still open a room below.
            </p>
          ) : snapshot ? (
            <p className="text-sm font-semibold text-[var(--foreground)]">
              {snapshot.online > 0
                ? `${snapshot.online} ${snapshot.online === 1 ? "student" : "students"} around · ${snapshot.studying} studying in the Library`
                : "It’s quiet right now. Start a study sprint and classmates can join when they arrive."}
            </p>
          ) : (
            <p className="text-sm font-semibold text-[var(--muted)]">
              {isPending ? "Checking who’s around…" : "Campus is ready when you are."}
            </p>
          )}
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Link
            href="/campus/library"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-extrabold text-white transition hover:brightness-110"
          >
            <BookOpenIcon className="h-4 w-4" />
            Start a study sprint
          </Link>
          <Link
            href="/campus/arena"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-bold text-[var(--foreground)] transition hover:border-[var(--accent)]/50"
          >
            <TargetIcon className="h-4 w-4" />
            Challenge a classmate
          </Link>
          <Link
            href={showStudyGroups ? "/campus/groups" : "/community"}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-bold text-[var(--foreground)] transition hover:border-[var(--accent)]/50"
          >
            <UsersIcon className="h-4 w-4" />
            {showStudyGroups ? "Find a study group" : "Open Community"}
          </Link>
          {showStudyGroups ? (
            <Link
              href="/community"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-bold text-[var(--foreground)] transition hover:border-[var(--accent)]/50"
            >
              <CommunityIcon className="h-4 w-4" />
              Open my class chat
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
