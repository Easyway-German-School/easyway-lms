import type { Cohort } from "@/components/admin/CohortResult";
import type { Proposal } from "@/components/admin/ActionProposal";

/**
 * The office assistant, talked to from more than one screen.
 *
 * The full page at /admin/assistant and the floating launcher that rides in
 * AdminShell ask the exact same questions of the exact same endpoint, and the
 * one genuinely fiddly part — reading the NDJSON stream back a frame at a time,
 * where a socket read can split a line down the middle — is the part you do not
 * want written twice and fixed once. So it lives here, behind a callback API,
 * and each surface wires the callbacks to its own state.
 *
 * See app/api/admin/assistant/route.ts for the frame vocabulary. In short:
 *   {type:"delta", text}            — more of the answer
 *   {type:"tool",  name}            — a lookup started (the silent stretch)
 *   {type:"proposal", proposal}     — the model wants to DO something
 *   {type:"done",  answer, briefing, cohort, toolsUsed, proposal, degraded}
 *   {type:"error", error}
 */

export type AssistantBriefing = {
  generatedAt: string;
  students?: {
    total: number;
    active: number;
    byLevel: Record<string, number>;
    byBranch: Record<string, number>;
    newThisWeek: number;
    newThisMonth: number;
  };
  money?: {
    collectedAllTime: number;
    collectedThisMonth: number;
    outstandingTotal: number;
    studentsOwing: number;
    fullyPaid: number;
    biggestBalances: Array<{ name: string; level: string; branch: string | null; owed: number }>;
  };
  enquiries?: { open: number; newThisWeek: number };
  exams?: { upcoming: number; registrationsUnpaid: number };
  attendance?: { sessionsLast7Days: number; averagePresentPercent: number | null };
  classes?: {
    total: number;
    studentsInClasses: number;
    averageSize: number;
    upcomingSessions7Days: number;
  };
  staff?: { tutors: number; active: number; onProbation: number; unassigned: number };
};

export type AssistantStatus = {
  provider: "claude" | "groq" | "ollama";
  model: string;
  ready: boolean;
  canAct: boolean;
  note: string;
  reason?: string;
};

export type AssistantTurn = { role: "user" | "assistant"; content: string };

export type AssistantDone = {
  answer: string;
  briefing?: AssistantBriefing;
  cohort: Cohort | null;
  toolsUsed: Array<{ name: string }>;
  proposal?: Proposal | null;
  degraded?: string;
};

export type AssistantHandlers = {
  /** The first delta has arrived — a stub assistant turn can be shown now. */
  onOpen?: () => void;
  /** The whole answer so far, cumulative — assign it, do not append. */
  onDelta: (fullText: string) => void;
  /** A lookup the model asked for, named as it happens. */
  onTool: (name: string) => void;
  /** The model has drafted an action awaiting a human. */
  onProposal: (proposal: Proposal) => void;
  /** The stream finished cleanly. */
  onDone: (result: AssistantDone) => void;
  /** Anything that went wrong, in words fit to show a person. */
  onError: (message: string) => void;
};

type Frame = {
  type?: string;
  text?: string;
  name?: string;
  error?: string;
  answer?: string;
  briefing?: AssistantBriefing;
  cohort?: Cohort | null;
  toolsUsed?: Array<{ name: string }>;
  proposal?: Proposal | null;
  degraded?: string;
};

/** GET the current brain status and briefing — what the page shows before any question. */
export async function loadAssistant(): Promise<{
  status: AssistantStatus | null;
  briefing: AssistantBriefing | null;
  capabilities: string[];
} | null> {
  try {
    const response = await fetch("/api/admin/assistant", { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json();
    return {
      status: data.status ?? null,
      briefing: data.briefing ?? null,
      capabilities: data.capabilities ?? [],
    };
  } catch {
    return null;
  }
}

/**
 * Ask one question and drive the callbacks until the stream closes.
 *
 * Never throws — every failure arrives through `onError`, the same way the
 * server's own mid-stream failures do.
 */
export async function askAssistant(
  question: string,
  history: AssistantTurn[],
  handlers: AssistantHandlers,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/admin/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, history }),
    });
  } catch {
    handlers.onError("Could not reach the server.");
    return;
  }

  // Auth and validation still fail as honest status codes, because they happen
  // before the stream opens. Everything after arrives as frames.
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    handlers.onError((data as { error?: string }).error ?? "The assistant could not answer.");
    return;
  }
  if (!response.body) {
    handlers.onError("The assistant returned nothing.");
    return;
  }

  let streamed = "";
  let opened = false;
  let failed = "";

  const handle = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let frame: Frame;
    try {
      frame = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (frame.type === "delta" && frame.text) {
      if (!opened) {
        opened = true;
        handlers.onOpen?.();
      }
      streamed += frame.text;
      handlers.onDelta(streamed);
    } else if (frame.type === "tool") {
      handlers.onTool(frame.name ?? "lookup");
    } else if (frame.type === "proposal") {
      if (frame.proposal) handlers.onProposal(frame.proposal);
    } else if (frame.type === "error") {
      failed = frame.error ?? "The assistant could not answer.";
    } else if (frame.type === "done") {
      const finalText = streamed || frame.answer || "";
      if (!opened) handlers.onOpen?.();
      handlers.onDone({
        answer: finalText || "(the model returned nothing)",
        briefing: frame.briefing,
        cohort: frame.cohort ?? null,
        toolsUsed: frame.toolsUsed ?? [],
        proposal: frame.proposal,
        degraded: frame.degraded,
      });
    }
  };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handle(line);
  }
  handle(buffer);

  if (failed) handlers.onError(failed);
}
