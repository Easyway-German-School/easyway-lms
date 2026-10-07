"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { motion } from "framer-motion";

import { youthSpring } from "@/components/youth/YouthMotion";

import Avatar from "@/components/Avatar";
import { BookOpenIcon, BroadcastIcon, CommunityIcon, HomeIcon, MapIcon } from "@/components/icons";
import type { AvatarConfig } from "@/lib/avatar";

/**
 * The phone's bottom bar — the new look's whole navigation idea.
 *
 * Four places a student actually goes, each one thumb-tap from anywhere:
 * Home, Chats, Learn (everything the old 17-row sidebar held, as a tile grid)
 * and Me. When a class is on, a fifth, centre button appears — and only then,
 * the same rule the sidebar's pulse follows: the one thing that is true right
 * now and stops being true.
 *
 * Phones and small tablets only (`lg:hidden`). On a laptop the sidebar is
 * already a permanent column and a bottom bar would be the wrong tool.
 */

type Tab = { href: string; label: string; match: (path: string) => boolean; icon: ReactNode };

const HOME_PATHS = ["/dashboard"];
const LEARN_PATHS = [
  "/learn",
  "/materials",
  "/notes",
  "/tutorials",
  "/games",
  "/assignment",
  "/play",
  "/results",
  "/attendance",
  "/certificates",
  "/exam-centre",
  "/calendar",
  "/payments",
  "/notifications",
  "/lesson",
  "/course",
  "/tandem",
];

const under = (path: string, bases: string[]) => bases.some((b) => path === b || path.startsWith(`${b}/`));

export default function YouthTabBar({
  unreadChats,
  campusIncoming = 0,
  liveNow,
  avatar,
  name,
}: {
  unreadChats: number;
  /** Waves and challenges waiting on Campus. */
  campusIncoming?: number;
  liveNow: boolean;
  avatar: AvatarConfig | null;
  name: string | null;
}) {
  const pathname = usePathname() ?? "";

  const tabs: Tab[] = [
    { href: "/dashboard", label: "Home", match: (p) => under(p, HOME_PATHS), icon: <HomeIcon className="h-6 w-6" /> },
    { href: "/campus", label: "Campus", match: (p) => under(p, ["/campus"]), icon: <MapIcon className="h-6 w-6" /> },
    { href: "/community", label: "Chats", match: (p) => under(p, ["/community"]), icon: <CommunityIcon className="h-6 w-6" /> },
    { href: "/learn", label: "Learn", match: (p) => under(p, LEARN_PATHS), icon: <BookOpenIcon className="h-6 w-6" /> },
  ];

  const meActive = under(pathname, ["/profile"]);

  const renderTab = (tab: Tab) => {
    const active = tab.match(pathname);
    return (
      <Link
        key={tab.href}
        href={tab.href}
        aria-current={active ? "page" : undefined}
        data-tour={`tab:${tab.href}`}
        className="flex min-w-0 flex-1 flex-col items-center gap-0.5 pb-1 pt-1.5 text-[11px] font-semibold"
      >
        <span
          className={`relative grid h-8 w-14 place-items-center rounded-full transition-colors ${
            active ? "text-[var(--accent-strong)]" : "text-[var(--muted)]"
          }`}
        >
          {active ? (
            <motion.span
              layoutId="youth-tab-pill"
              className="absolute inset-0 rounded-full bg-[var(--accent-strong)]/15"
              transition={youthSpring}
            />
          ) : null}
          <span className="relative">{tab.icon}</span>
          {tab.href === "/community" && unreadChats > 0 && !active && (
            <span className="absolute right-2 top-0 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold text-white ring-2 ring-[var(--surface)]">
              {unreadChats > 99 ? "99+" : unreadChats}
            </span>
          )}
          {tab.href === "/campus" && campusIncoming > 0 && !active && (
            <span className="absolute right-2 top-0 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold text-white ring-2 ring-[var(--surface)]">
              {campusIncoming > 9 ? "9+" : campusIncoming}
            </span>
          )}
        </span>
        <span className={active ? "text-[var(--foreground)]" : "text-[var(--muted)]"}>{tab.label}</span>
      </Link>
    );
  };

  return (
    <nav
      aria-label="Main"
      className="youth-tabbar fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--surface)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
    >
      <div className="mx-auto flex max-w-xl items-end px-2">
        {renderTab(tabs[0])}
        {renderTab(tabs[1])}
        {renderTab(tabs[2])}

        {liveNow && (
          <Link
            href="/live"
            aria-label="Join the live class"
            className="relative -mt-5 flex shrink-0 flex-col items-center gap-0.5 px-1 pb-1 text-[11px] font-bold text-[var(--accent)]"
          >
            <span className="relative grid h-14 w-14 place-items-center rounded-full bg-[var(--accent)] text-white shadow-lg shadow-[var(--accent)]/40">
              <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent)] opacity-30" />
              <BroadcastIcon className="relative h-6 w-6" />
            </span>
            Live
          </Link>
        )}

        {renderTab(tabs[3])}

        <Link
          href="/profile"
          aria-current={meActive ? "page" : undefined}
          data-tour="tab:/profile"
          className="flex min-w-0 flex-1 flex-col items-center gap-0.5 pb-1 pt-1.5 text-[11px] font-semibold"
        >
          <span className="grid h-8 w-14 place-items-center">
            <span
              className={`rounded-full p-[2px] transition-colors ${
                meActive ? "bg-[var(--accent-strong)]" : "bg-transparent"
              }`}
            >
              <Avatar config={avatar} seed={name ?? ""} size={26} className="ring-2 ring-[var(--surface)] rounded-full" />
            </span>
          </span>
          <span className={meActive ? "text-[var(--foreground)]" : "text-[var(--muted)]"}>Me</span>
        </Link>
      </div>
    </nav>
  );
}
