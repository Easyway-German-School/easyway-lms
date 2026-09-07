"use client";

/**
 * The assistant conversation, held once and shared by every surface that shows
 * it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * The full page at /admin/assistant and the floating launcher in AdminShell
 * each used to keep the transcript in their own `useState`. That meant three
 * papercuts the office actually hit:
 *
 *   - navigate away from /admin/assistant and back, and the chat is gone;
 *   - ask something in the launcher, click "Open full view", and the full page
 *     opens blank — a different component, a different piece of state;
 *   - minimise the launcher and reopen it, same story on some route changes.
 *
 * A conversation is one thing, not one-per-widget. So it lives here: a module
 * singleton, mirrored into `sessionStorage` so it survives a route change and a
 * remount, and read through `useSyncExternalStore` so both surfaces re-render
 * from the same source.
 *
 * `sessionStorage`, not `localStorage`: a transcript can name students and fee
 * balances, and it should not outlive the tab. Closing the browser is "I'm
 * done"; a route change is not.
 *
 * The in-flight `thinking` / `error` / input-box text stay local to each
 * surface — they are about one keystroke-to-answer round, not the conversation,
 * and a spinner restored from storage after a reload would be a spinner that
 * never stops.
 */

import { useCallback, useSyncExternalStore } from "react";
import type { Cohort } from "@/components/admin/CohortResult";
import type { Proposal } from "@/components/admin/ActionProposal";
import type { AssistantTurn } from "@/lib/assistant-stream";

export type AssistantConversation = {
  turns: AssistantTurn[];
  /** The rows the last lookup returned — the table under the full-page chat. */
  cohort: Cohort | null;
  /** The action the last answer proposed, still awaiting a human. */
  proposal: Proposal | null;
  toolsUsed: Array<{ name: string }>;
};

const EMPTY: AssistantConversation = { turns: [], cohort: null, proposal: null, toolsUsed: [] };
const STORAGE_KEY = "easyway.admin.assistant.conversation.v1";

let state: AssistantConversation = EMPTY;
const listeners = new Set<() => void>();
let hydrated = false;

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<AssistantConversation> | null;
    if (parsed && Array.isArray(parsed.turns)) {
      state = {
        turns: parsed.turns,
        cohort: parsed.cohort ?? null,
        proposal: parsed.proposal ?? null,
        toolsUsed: Array.isArray(parsed.toolsUsed) ? parsed.toolsUsed : [],
      };
    }
  } catch {
    // A private window, cleared storage, a parse failure — start fresh.
  }
}

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Over quota or storage disabled: the in-memory store still works for the
    // life of the page, it just will not survive a remount.
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Merge a patch into the conversation. Accepts an updater so callers can grow
 * `turns` in place — `update((prev) => ({ turns: [...prev.turns, turn] }))` —
 * the same shape a `setState` updater takes.
 */
export function updateConversation(
  patch:
    | Partial<AssistantConversation>
    | ((prev: AssistantConversation) => Partial<AssistantConversation>),
): void {
  hydrate();
  const next = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...next };
  persist();
  emit();
}

/** Wipe it — the "New chat" button. */
export function resetConversation(): void {
  hydrate();
  state = EMPTY;
  persist();
  emit();
}

function subscribe(callback: () => void): () => void {
  hydrate();
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): AssistantConversation {
  return state;
}

function getServerSnapshot(): AssistantConversation {
  return EMPTY;
}

export function useAssistantConversation(): {
  convo: AssistantConversation;
  update: typeof updateConversation;
  reset: typeof resetConversation;
} {
  const convo = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const update = useCallback(updateConversation, []);
  const reset = useCallback(resetConversation, []);
  return { convo, update, reset };
}
