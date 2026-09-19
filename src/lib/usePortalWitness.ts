"use client";

import { useEffect } from "react";

import type { StudentAccess } from "@/lib/access";
import { renderedLockOf, type PortalVerdict } from "@/lib/portal-verdict";

type WitnessedAccess = StudentAccess & { hasPhoto: boolean; verdict?: PortalVerdict; computedAt?: number };

const STORAGE_KEY = "ew:portal-witness";
/** A locked student is re-reported this often, so a screen stuck on old data is noticed. */
const LOCKED_HEARTBEAT_MS = 5 * 60_000;
const OPEN_HEARTBEAT_MS = 30 * 60_000;

function readLast(): { key: string; at: number } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as { key: string; at: number }) : null;
  } catch {
    return null;
  }
}

function writeLast(value: { key: string; at: number }) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Private mode / blocked storage: worst case we report a little more often.
  }
}

/**
 * Tell the server what this student's screen actually showed.
 *
 * The server can compute what the portal SHOULD show; it cannot see what a
 * browser — possibly running old code, possibly reading an old cached response —
 * really put up. Reporting it is what turns "the student says it's locked but
 * the admin says it's open" from an argument into a recorded fact.
 *
 * Quiet by design: reports only when the (verdict, rendered) pair changes, plus a
 * slow heartbeat. It never throws and never blocks rendering.
 */
export function usePortalWitness(input: {
  access: WitnessedAccess | null;
  routeLocked: boolean;
  photoLocked: boolean;
  pathname: string;
}) {
  const { access, routeLocked, photoLocked, pathname } = input;
  const verdictKey = access?.verdict?.key;
  const computedAt = access?.computedAt;
  const lockReason = access?.lockReason ?? null;

  useEffect(() => {
    if (!access || !verdictKey || !computedAt) return;
    const rendered = renderedLockOf({ routeLocked, photoLocked, lockReason });
    const key = `${verdictKey}|${rendered}`;
    const last = readLast();
    const now = Date.now();
    const heartbeat = verdictKey === "open" ? OPEN_HEARTBEAT_MS : LOCKED_HEARTBEAT_MS;
    if (last && last.key === key && now - last.at < heartbeat) return;

    writeLast({ key, at: now });
    void fetch("/api/student/witness", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        receivedLocks: access.verdict?.locks.map((lock) => lock.code) ?? [],
        rendered,
        computedAt,
        path: pathname,
      }),
    }).catch(() => {
      // Observability must never be a way to break the page.
    });
    // `access` is intentionally not a dependency: its identity changes on every
    // refetch; what matters is the verdict, what was rendered, and how old the data is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verdictKey, computedAt, routeLocked, photoLocked, lockReason, pathname]);
}
