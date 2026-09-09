"use client";

import { useState } from "react";
import AdminShell from "@/components/AdminShell";
import CommunityHub from "@/components/CommunityHub";
import RemovedMessagesLog from "@/components/admin/RemovedMessagesLog";

/**
 * The office's window on the community.
 *
 * A student sees exactly one room — their branch, their level, their sitting.
 * The office sees all of them, because the school told its students the space
 * is monitored and that promise needs somebody who can be in every room at
 * once.
 *
 * Two tabs:
 *   - "Rooms" is the real chat, the same one students and tutors use
 *     (CommunityHub). An admin resolves to every room in the school, posts land
 *     tagged "Office", and each message carries the moderator controls —
 *     remove, pin, mute — in the room where it was said.
 *   - "Removed" is the audit log: every message taken down anywhere in the
 *     school, with the reason and a way to put it back. Removal is always a
 *     hide, never a delete, so "what was actually said?" still has an answer.
 *
 * There is deliberately no way here to edit what somebody wrote. Staff able to
 * silently rewrite a student's words would make every transcript worthless the
 * moment one was needed.
 */

type Tab = "rooms" | "removed";

export default function AdminCommunityPage() {
  const [tab, setTab] = useState<Tab>("rooms");

  return (
    <AdminShell>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Community</h1>
          <p className="mt-1.5 text-sm text-[var(--muted)]">
            Every class group in the school. Post as the office, or take a message down — it is hidden from students
            and kept on the record.
          </p>
        </div>

        <div className="flex gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1 text-sm font-semibold">
          {([
            { value: "rooms", label: "Rooms" },
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

        {tab === "rooms" ? <CommunityHub /> : <RemovedMessagesLog />}
      </div>
    </AdminShell>
  );
}
