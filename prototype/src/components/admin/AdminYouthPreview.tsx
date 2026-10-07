"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import AdminCampusWatch from "@/components/admin/AdminCampusWatch";
import Avatar from "@/components/Avatar";
import CommunityHub from "@/components/CommunityHub";
import { CommunityIcon, CrossIcon, MapIcon } from "@/components/icons";

/**
 * THE UNDER-25 COMMUNITY, AS THEY SEE IT — full screen, not a toy phone.
 *
 * Staff normally get the neutral room because they are moderating, not hanging
 * out. This is the other window: the same chats and Campus street, edge to
 * edge, watched without announcing that the office is typing. Leave is always
 * on screen. Posts still go out as Office.
 */

type Pane = "chats" | "campus";

type LiveFace = {
  userId: string;
  name: string;
  avatar: unknown;
  room: string;
};

function useWatchFaces() {
  const [faces, setFaces] = useState<LiveFace[]>([]);

  useEffect(() => {
    let active = true;
    const load = () => {
      fetch("/api/admin/campus/observe", { cache: "no-store" })
        .then((res) => res.json())
        .then((body) => {
          if (!active || !body?.bands) return;
          const seen = new Set<string>();
          const next: LiveFace[] = [];
          for (const band of Object.values(body.bands) as Array<{ rooms?: Record<string, { people?: LiveFace[] }> }>) {
            for (const room of Object.values(band.rooms ?? {})) {
              for (const person of room.people ?? []) {
                if (seen.has(person.userId)) continue;
                seen.add(person.userId);
                next.push(person);
              }
            }
          }
          setFaces(next);
        })
        .catch(() => {
          /* A missed strip is fine; the rooms still load. */
        });
    };
    load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return faces;
}

export default function AdminYouthPreview({
  start = "chats",
  onLeave,
}: {
  start?: Pane;
  onLeave: () => void;
}) {
  const [pane, setPane] = useState<Pane>(start);
  const [ready, setReady] = useState(false);
  const faces = useWatchFaces();

  useEffect(() => setPane(start), [start]);
  useEffect(() => setReady(true), []);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onLeave();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onLeave]);

  if (!ready) return null;

  return createPortal(
    <div className="look-youth app-canvas fixed inset-0 z-[80] flex flex-col text-[var(--foreground)]">
      <header className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)]/90 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="flex items-center gap-3 px-3 py-2.5 sm:px-5">
          <button
            type="button"
            onClick={onLeave}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--surface-alt)] py-2 pl-2 pr-3.5 text-sm font-extrabold text-[var(--foreground)] shadow-sm transition active:scale-95"
          >
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--foreground)] text-[var(--surface)]">
              <CrossIcon className="h-4 w-4" />
            </span>
            Leave
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-extrabold uppercase tracking-[0.18em] text-[var(--accent)]">
              Watching · hidden
            </p>
            <p className="truncate text-sm font-bold">Their community</p>
          </div>

          <div className="flex rounded-full bg-[var(--surface-alt)] p-1">
            {(
              [
                { id: "chats" as const, label: "Chats", icon: <CommunityIcon className="h-4 w-4" /> },
                { id: "campus" as const, label: "Campus", icon: <MapIcon className="h-4 w-4" /> },
              ]
            ).map((tab) => {
              const active = pane === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPane(tab.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-extrabold transition ${
                    active ? "bg-[var(--accent)] text-white" : "text-[var(--muted)]"
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {faces.length > 0 ? (
          <div className="flex gap-3 overflow-x-auto px-4 pb-3 pt-1 [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden">
            {faces.map((person) => (
              <button
                key={person.userId}
                type="button"
                onClick={() => setPane("campus")}
                className="flex w-14 shrink-0 flex-col items-center gap-1"
              >
                <span className="rounded-full bg-[linear-gradient(135deg,#FF6600,#0D7C7E)] p-[2px]">
                  <span className="block rounded-full bg-[var(--surface)] p-[2px]">
                    <Avatar config={person.avatar} seed={person.name} size={48} className="rounded-full" />
                  </span>
                </span>
                <span className="w-full truncate text-center text-[10px] font-bold text-[var(--muted)]">
                  {person.name.split(" ")[0]}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <div className="min-h-0 flex-1">
        {pane === "chats" ? (
          <CommunityHub fill previewLook="youth" observe />
        ) : (
          <div className="h-full overflow-y-auto">
            <AdminCampusWatch immersive />
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
