"use client";

/**
 * Which tutorials a student has already watched, on this browser. Client-only
 * — a missing "Watched" badge on a new device costs nothing worth a server
 * round trip or a schema change for.
 */

const KEY = "easyway:tutorials-completed";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function getCompletedTutorialIds(): string[] {
  return read();
}

export function isTutorialCompleted(id: string): boolean {
  return read().includes(id);
}

export function markTutorialCompleted(id: string) {
  if (typeof window === "undefined") return;
  const current = read();
  if (current.includes(id)) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...current, id]));
  } catch {
    /* Storage full or blocked — a missing badge is not worth surfacing. */
  }
}
