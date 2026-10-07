"use client";

import { useState } from "react";
import AdminShell from "@/components/AdminShell";
import CommunityHub from "@/components/CommunityHub";
import RemovedMessagesLog from "@/components/admin/RemovedMessagesLog";
import CommunityInsights from "@/components/admin/CommunityInsights";
import CommunityPeople from "@/components/admin/CommunityPeople";
import AdminYouthPreview from "@/components/admin/AdminYouthPreview";

/**
 * The office's window on the community.
 *
 * A student sees exactly one room — their branch, their level, their sitting.
 * The office sees all of them, because the school told its students the space
 * is monitored and that promise needs somebody who can be in every room at
 * once.
 *
 * Four tabs:
 *   - "Rooms" is the real chat, the same one students and tutors use
 *     (CommunityHub). An admin resolves to every room in the school, posts land
 *     tagged "Office", and each message carries the moderator controls —
 *     remove, pin, mute — in the room where it was said.
 *   - "Removed" is the audit log: every message taken down anywhere in the
 *     school, with the reason and a way to put it back. Removal is always a
 *     hide, never a delete, so "what was actually said?" still has an answer.
 *   - "Insights" is the two looks side by side: totals, invitation, what people
 *     tap, daily activity. Counts only.
 *   - "People" is the named roster — who is on which look, how they behave,
 *     and a link into their remote file.
 *   - "Youth view" opens their community full screen — chats and Campus, Leave
 *     always on screen, watched without typing pings.
 *   - "Campus" opens the same full-screen watch on the street of rooms.
 *
 * There is deliberately no way here to edit what somebody wrote. Staff able to
 * silently rewrite a student's words would make every transcript worthless the
 * moment one was needed.
 */

type Tab = "rooms" | "youth" | "campus" | "people" | "insights" | "removed";

export default function AdminCommunityPage() {
  const [tab, setTab] = useState<Tab>("rooms");

  return (
    <AdminShell>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Community</h1>
          <p className="mt-1.5 text-sm text-[var(--muted)]">
            Every class group in the school. Post as the office, take a message down, or see who is on each look and
            how they use it.
          </p>
        </div>

        <div className="flex gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1 text-sm font-semibold">
          {([
            { value: "rooms", label: "Rooms" },
            { value: "youth", label: "Youth view" },
            { value: "campus", label: "Campus" },
            { value: "people", label: "People" },
            { value: "insights", label: "Insights" },
            { value: "removed", label: "Removed messages" },
          ] as Array<{ value: Tab; label: string }>).map((option) => (
            <button
              key={option.value}
              onClick={() => setTab(option.value)}
              className={`rounded-full px-4 py-1.5 transition ${
                tab === option.value
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {tab === "rooms" ? (
          <CommunityHub />
        ) : tab === "youth" || tab === "campus" ? (
          <>
            <p className="text-sm text-[var(--muted)]">Opening their community…</p>
            <AdminYouthPreview start={tab === "campus" ? "campus" : "chats"} onLeave={() => setTab("rooms")} />
          </>
        ) : tab === "people" ? (
          <CommunityPeople />
        ) : tab === "insights" ? (
          <CommunityInsights />
        ) : (
          <RemovedMessagesLog />
        )}
      </div>
    </AdminShell>
  );
}
