"use client";

import { useState } from "react";

import CommunityHub from "@/components/CommunityHub";
import { BookOpenIcon, CommunityIcon, HomeIcon, MapIcon } from "@/components/icons";

/**
 * THE UNDER-25 COMMUNITY, AS THEY SEE IT.
 *
 * Staff normally get the neutral room (no avatars, no phone chrome) because
 * they are moderating, not hanging out. This is the other window: the same
 * chats with cartoon avatars and the youth phone frame, watched without
 * announcing that the office is typing. Posts still go out as Office.
 */
export default function AdminYouthPreview() {
  const [pane, setPane] = useState<"chats" | "hint">("chats");

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--muted)]">
        This is the new look&apos;s chat — avatars, the phone frame, the same rooms. You are not in it: nobody sees you
        typing. Use the Campus tab next door for the street of rooms they walk. Open Rooms if you need the full
        staff tools without the youth chrome.
      </p>

      <div className="look-youth mx-auto w-full max-w-[28rem] overflow-hidden rounded-[2rem] border border-[var(--border)] bg-[var(--surface)] shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-[var(--accent)]">Watching · hidden</p>
          <p className="text-[11px] font-semibold text-[var(--muted)]">Under-25 display</p>
        </div>

        {pane === "chats" ? (
          <div className="p-2">
            <CommunityHub compact previewLook="youth" observe />
          </div>
        ) : (
          <div className="space-y-3 p-5">
            <p className="text-lg font-extrabold">Campus lives on its own tab</p>
            <p className="text-sm text-[var(--muted)]">
              The street of rooms (Library, Arena, who is online, avatars) is next to this one, labelled Campus. Age
              groups stay on separate streets there, the same way students never meet across them.
            </p>
          </div>
        )}

        <nav className="flex items-end border-t border-[var(--border)] bg-[var(--surface)] px-2 pb-2 pt-1">
          {([
            { id: "home", label: "Home", icon: <HomeIcon className="h-5 w-5" />, pane: null },
            { id: "campus", label: "Campus", icon: <MapIcon className="h-5 w-5" />, pane: "hint" as const },
            { id: "chats", label: "Chats", icon: <CommunityIcon className="h-5 w-5" />, pane: "chats" as const },
            { id: "learn", label: "Learn", icon: <BookOpenIcon className="h-5 w-5" />, pane: null },
          ]).map((tab) => {
            const active = tab.pane !== null && pane === tab.pane;
            return (
              <button
                key={tab.id}
                type="button"
                disabled={tab.pane === null}
                onClick={() => {
                  if (tab.pane) setPane(tab.pane);
                }}
                className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 py-1.5 text-[11px] font-semibold ${
                  active ? "text-[var(--accent)]" : "text-[var(--muted)]"
                } disabled:opacity-40`}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
