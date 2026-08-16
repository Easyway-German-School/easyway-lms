"use client";

/**
 * One story, and the box you write your sentence in.
 *
 * The story reads top to bottom like a page of prose rather than a chat log,
 * because it IS a piece of writing and the class should want to read it back.
 * Author names sit under each line rather than beside it — present enough to
 * take credit, quiet enough not to turn the page into a scoreboard.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import StudentShell from "@/components/StudentShell";
import { AlertIcon, ChainIcon, ChevronLeftIcon } from "@/components/icons";
import { MAX_SENTENCE_CHARS } from "@/lib/satzkette";

type Sentence = {
  position: number;
  sentence: string;
  authorId: string;
  authorName: string;
  constraintLabel: string | null;
};

type CurrentTurn = {
  id: string;
  position: number;
  state: "pending" | "open" | "submitted";
  assignedToName: string;
  isMine: boolean;
  canPlay: boolean;
  deadline: string;
  rule: string | null;
  ruleChecked: boolean;
};

type Match = {
  id: string;
  title: string;
  prompt: string | null;
  status: string;
  targetTurns: number;
  completedAt: string | null;
};

export default function StoryPage() {
  const { status } = useSession();
  const router = useRouter();
  const params = useParams<{ matchId: string }>();
  const matchId = params?.matchId;

  const [match, setMatch] = useState<Match | null>(null);
  const [story, setStory] = useState<Sentence[]>([]);
  const [turn, setTurn] = useState<CurrentTurn | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState("");

  const load = useCallback(async () => {
    if (!matchId) return;
    try {
      const res = await fetch(`/api/games/${matchId}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Could not open that story");
      setMatch(data.match);
      setStory(data.story ?? []);
      setTurn(data.currentTurn ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin");
    if (status === "authenticated") void load();
  }, [status, router, load]);

  async function submit() {
    if (!turn || sending || draft.trim() === "") return;
    setSending(true);
    setProblem("");
    try {
      const res = await fetch(`/api/games/${matchId}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnId: turn.id, sentence: draft }),
      });
      const data = await res.json();
      if (!res.ok) {
        setProblem(data?.error ?? "That did not go through");
        // A lost race is not a broken draft — reload so they see the sentence
        // that beat them rather than staring at a rejected box.
        if (res.status === 409) {
          setDraft("");
          await load();
        }
        return;
      }
      setDraft("");
      await load();
    } catch {
      setProblem("That did not go through. Try again.");
    } finally {
      setSending(false);
    }
  }

  const remaining = MAX_SENTENCE_CHARS - draft.length;

  return (
    <StudentShell>
      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
        <button
          type="button"
          onClick={() => router.push("/games")}
          className="mb-4 flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
        >
          <ChevronLeftIcon className="h-4 w-4" /> All games
        </button>

        {error ? (
          <p className="flex items-center gap-2 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">
            <AlertIcon className="h-4 w-4" /> {error}
          </p>
        ) : loading ? (
          <p className="text-sm text-[var(--muted)]">Loading…</p>
        ) : match ? (
          <>
            <header className="mb-6">
              <h1 className="flex items-center gap-3 text-2xl font-bold text-[var(--foreground)]">
                <ChainIcon className="h-6 w-6 text-[var(--accent)]" />
                {match.title}
              </h1>
              {match.prompt ? (
                <p className="mt-2 text-sm text-[var(--muted)]">{match.prompt}</p>
              ) : null}
            </header>

            {match.status === "completed" ? (
              <div className="mb-6 rounded-2xl border border-[var(--accent)] bg-[var(--accent-soft)] px-5 py-4">
                <p className="text-sm font-semibold text-[var(--foreground)]">
                  Your class finished this one.
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {story.length} sentences, written by {new Set(story.map((s) => s.authorId)).size}{" "}
                  of you.
                </p>
              </div>
            ) : null}

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
              {story.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">
                  Nobody has written anything yet. The first sentence is the hardest — and
                  it decides what this story is about.
                </p>
              ) : (
                <div className="space-y-4">
                  {story.map((line) => (
                    <div key={line.position}>
                      <p className="text-base leading-relaxed text-[var(--foreground)]">
                        {line.sentence}
                      </p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {line.authorName}
                        {line.constraintLabel ? ` · ${line.constraintLabel}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {turn ? (
              <section className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                {turn.canPlay ? (
                  <>
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                      {turn.isMine
                        ? `Your turn — sentence ${turn.position}`
                        : `Sentence ${turn.position} is open to anyone`}
                    </p>

                    {turn.rule ? (
                      <p className="mt-2 rounded-lg bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)]">
                        {turn.rule}
                        {/* Honest about what the app can and cannot check. A rule
                            we claim to enforce and do not is worse than one we
                            openly leave to the tutor. */}
                        {turn.ruleChecked ? null : (
                          <span className="mt-1 block text-xs text-[var(--muted)]">
                            Your tutor checks this one when they read the story back.
                          </span>
                        )}
                      </p>
                    ) : null}

                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      rows={3}
                      maxLength={MAX_SENTENCE_CHARS}
                      placeholder="One sentence in German…"
                      className="mt-3 w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-base text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
                    />

                    {problem ? (
                      <p className="mt-2 text-sm text-[var(--danger)]">{problem}</p>
                    ) : null}

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span className="text-xs text-[var(--muted)]">
                        {remaining < 60 ? `${remaining} characters left` : "One sentence"}
                      </span>
                      <button
                        type="button"
                        onClick={() => void submit()}
                        disabled={sending || draft.trim() === ""}
                        className="rounded-xl bg-[var(--accent)] px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                      >
                        {sending ? "Sending…" : "Add my sentence"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                      Waiting on {turn.assignedToName}
                    </p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      Sentence {turn.position} is theirs for a day. If they do not take it,
                      it opens to the whole class and you will be told.
                    </p>
                  </>
                )}
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </StudentShell>
  );
}
