"use client";

/**
 * Start a story, then leave it alone.
 *
 * A tutor sets one up in about twenty seconds and then has nothing to do — the
 * turns rotate on their own and the deadline job keeps them moving. That is the
 * point: a feature the tutor has to shepherd is a feature that runs for two
 * weeks and stops.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import LecturerShell from "@/components/LecturerShell";
import { AlertIcon, ChainIcon, PlayIcon } from "@/components/icons";

type Space = { id: string; name: string };
type Match = {
  id: string;
  title: string;
  status: string;
  targetTurns: number;
  turnCount: number;
};

/**
 * Starters, not a blank box.
 *
 * A tutor facing an empty "title" field at 7am picks nothing and the feature
 * goes unused. These are openings that force a story somewhere rather than
 * prompts about German — the grammar is carried by the per-turn rules.
 */
const STARTERS = [
  {
    title: "Der verlorene Koffer",
    prompt: "Am Bahnhof steht ein Koffer. Niemand weiß, wem er gehört.",
  },
  {
    title: "Der erste Tag in Berlin",
    prompt: "Du kommst in Berlin an. Es regnet, und dein Handy ist leer.",
  },
  {
    title: "Das Vorstellungsgespräch",
    prompt: "Morgen ist das Gespräch. Heute geht alles schief.",
  },
];

const LENGTHS = [8, 12, 16, 20];

export default function StoriesPage() {
  const { status } = useSession();
  const router = useRouter();

  const [spaces, setSpaces] = useState<Space[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [spaceId, setSpaceId] = useState("");
  const [title, setTitle] = useState(STARTERS[0].title);
  const [prompt, setPrompt] = useState(STARTERS[0].prompt);
  const [targetTurns, setTargetTurns] = useState(12);
  const [rule, setRule] = useState("");
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [gamesRes, spacesRes] = await Promise.all([
        fetch("/api/games", { cache: "no-store" }),
        fetch("/api/community/spaces", { cache: "no-store" }),
      ]);

      if (gamesRes.ok) {
        const data = await gamesRes.json();
        setMatches(data.matches ?? []);
      }
      if (spacesRes.ok) {
        const data = await spacesRes.json();
        const list: Space[] = (data.spaces ?? []).map((space: { id: string; name: string }) => ({
          id: space.id,
          name: space.name,
        }));
        setSpaces(list);
        setSpaceId((current) => current || list[0]?.id || "");
      }
    } catch {
      setError("Could not load your classes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/lecturer/signin");
    if (status === "authenticated") void load();
  }, [status, router, load]);

  async function start() {
    if (!spaceId || !title.trim() || starting) return;
    setStarting(true);
    setError("");
    try {
      const res = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spaceId,
          title: title.trim(),
          prompt: prompt.trim() || null,
          targetTurns,
          // One rule, applied to every turn. Kept deliberately simple: a deck
          // editor is a screen a tutor has to learn, and the feature has to
          // earn that before it asks for it.
          constraints: rule.trim() ? [{ rule: "grammar", label: rule.trim() }] : [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Could not start the story");
      await load();
      router.push(`/games/${data.match.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the story");
    } finally {
      setStarting(false);
    }
  }

  const active = matches.filter((match) => match.status === "active");

  return (
    <LecturerShell>
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <h1 className="flex items-center gap-3 text-2xl font-bold text-[var(--foreground)] sm:text-3xl">
            <ChainIcon className="h-7 w-7 text-[var(--accent)]" />
            Story chain
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            Your class writes one story together, a sentence each. Everyone gets a turn and
            a day to take it; if they miss it, it opens to the rest of the class rather than
            stopping. You will have a page of their own German to read back in class.
          </p>
        </header>

        {error ? (
          <p className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">
            <AlertIcon className="h-4 w-4" /> {error}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-[var(--muted)]">Loading…</p>
        ) : (
          <div className="space-y-5">
            {active.length > 0 ? (
              <section className="rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-alt)] p-5">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Already running
                </h2>
                <div className="space-y-2">
                  {active.map((match) => (
                    <button
                      key={match.id}
                      type="button"
                      onClick={() => router.push(`/games/${match.id}`)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl bg-[var(--surface)] px-4 py-3 text-left"
                    >
                      <span className="truncate text-sm font-semibold text-[var(--foreground)]">
                        {match.title}
                      </span>
                      <span className="shrink-0 text-xs text-[var(--muted)]">
                        {Math.min(match.turnCount, match.targetTurns)}/{match.targetTurns}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                Which class
              </h2>
              {spaces.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">
                  You have no class groups yet. A story is written in a class&rsquo;s own
                  group, so one has to exist first.
                </p>
              ) : (
                <div className="space-y-2">
                  {spaces.map((space) => (
                    <label
                      key={space.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition ${
                        spaceId === space.id
                          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                          : "border-[var(--border)] hover:border-[var(--border-strong)]"
                      }`}
                    >
                      <input
                        type="radio"
                        name="space"
                        value={space.id}
                        checked={spaceId === space.id}
                        onChange={() => setSpaceId(space.id)}
                        className="accent-[var(--accent)]"
                      />
                      <span className="text-sm font-semibold text-[var(--foreground)]">
                        {space.name}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                The story
              </h2>

              <div className="mb-4 flex flex-wrap gap-2">
                {STARTERS.map((starter) => (
                  <button
                    key={starter.title}
                    type="button"
                    onClick={() => {
                      setTitle(starter.title);
                      setPrompt(starter.prompt);
                    }}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      title === starter.title
                        ? "bg-[var(--accent-strong)] text-white"
                        : "border border-[var(--border)] text-[var(--foreground)]"
                    }`}
                  >
                    {starter.title}
                  </button>
                ))}
              </div>

              <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">
                Title
              </label>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={80}
                className="mb-4 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
              />

              <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">
                Opening — sets the scene, nobody writes it
              </label>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={2}
                maxLength={240}
                className="mb-4 w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
              />

              <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">
                A rule for every turn (optional)
              </label>
              <input
                value={rule}
                onChange={(event) => setRule(event.target.value)}
                maxLength={80}
                placeholder="e.g. Use the perfect tense"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
              />
              {/* Said out loud because a tutor who thinks the app is marking
                  this will not read the story, and the whole value of the
                  exercise is in them reading it. */}
              <p className="mt-1.5 text-xs text-[var(--muted)]">
                Shown to each student as their instruction. The app does not check grammar —
                you will see every sentence when you read the story back.
              </p>

              <div className="mt-4">
                <p className="mb-2 text-sm font-medium text-[var(--foreground)]">
                  How many sentences
                </p>
                <div className="flex flex-wrap gap-2">
                  {LENGTHS.map((length) => (
                    <button
                      key={length}
                      type="button"
                      onClick={() => setTargetTurns(length)}
                      className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                        targetTurns === length
                          ? "bg-[var(--accent-strong)] text-white"
                          : "border border-[var(--border)] text-[var(--foreground)]"
                      }`}
                    >
                      {length}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <button
              type="button"
              onClick={() => void start()}
              disabled={!spaceId || !title.trim() || starting}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-6 py-4 text-lg font-bold text-white disabled:opacity-50"
            >
              <PlayIcon className="h-5 w-5" />
              {starting ? "Starting…" : "Start the story"}
            </button>

            <p className="text-center text-xs text-[var(--muted)]">
              The first student gets their turn straight away, with a notification.
            </p>
          </div>
        )}
      </div>
    </LecturerShell>
  );
}
