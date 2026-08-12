"use client";

/**
 * Getting into the game, from a phone, in a classroom.
 *
 * Six digits and a big button, or one tap when the game running is their own
 * class's. Nothing else is on this screen, because everything else on it would
 * be read while a countdown they can see on the wall is already running.
 *
 * The route is `/play` rather than something under `/student` for one reason:
 * it is the only path in this product a tutor ever says out loud.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import StudentShell from "@/components/StudentShell";
import PlayerGame from "@/components/live-quiz/PlayerGame";
import { AlertIcon, QuizIcon } from "@/components/icons";

type Offer = { id: string; title: string; phase: string; joined: boolean };

export default function PlayPage() {
  const { status } = useSession();
  const router = useRouter();

  const [pin, setPin] = useState("");
  const [gameId, setGameId] = useState<string | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const join = useCallback(
    async (body: { pin?: string; gameId?: string }) => {
      setJoining(true);
      setError("");
      try {
        const res = await fetch("/api/live-quiz/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Could not join");
        setGameId(data.game.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not join");
        setPin("");
      } finally {
        setJoining(false);
      }
    },
    [],
  );

  /**
   * Poll for a game their own class is playing.
   *
   * Only while they are on this screen and not yet in a game — the point is to
   * save a student typing a PIN they can see on the wall anyway, not to
   * interrupt them anywhere else in the portal. A tutor who has not started a
   * game costs one small query every four seconds from whoever is looking at
   * this page, which is nobody unless a game is about to happen.
   */
  useEffect(() => {
    if (status !== "authenticated" || gameId) return;
    let cancelled = false;

    async function look() {
      const res = await fetch("/api/live-quiz/join", { cache: "no-store" });
      if (!res.ok || cancelled) return;
      const data = await res.json();
      if (!cancelled) setOffer(data.game ?? null);
    }

    void look();
    const timer = window.setInterval(look, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [status, gameId]);

  // Straight back into a game they are already in. A phone that locked, or a
  // browser that reloaded, must not put a student back at a PIN box while the
  // question they are missing is on the board.
  useEffect(() => {
    if (offer?.joined && !gameId) setGameId(offer.id);
  }, [offer, gameId]);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin");
  }, [status, router]);

  useEffect(() => {
    if (!gameId) inputRef.current?.focus();
  }, [gameId]);

  if (gameId) {
    return (
      <PlayerGame
        gameId={gameId}
        onLeave={() => {
          setGameId(null);
          setOffer(null);
          setPin("");
        }}
      />
    );
  }

  return (
    <StudentShell>
      <div className="mx-auto w-full max-w-md px-4 py-10">
        <header className="mb-8 text-center">
          <QuizIcon className="mx-auto mb-3 h-10 w-10 text-[var(--accent)]" />
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Quiz game</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Your tutor will put a PIN on the board.
          </p>
        </header>

        {offer && !offer.joined ? (
          <button
            type="button"
            onClick={() => void join({ gameId: offer.id })}
            disabled={joining}
            className="mb-6 w-full rounded-2xl bg-[var(--accent)] px-5 py-4 text-left text-white disabled:opacity-60"
          >
            <span className="block text-xs uppercase tracking-widest opacity-80">
              Your class is playing
            </span>
            <span className="block text-lg font-bold">{offer.title}</span>
            <span className="block text-sm opacity-90">Tap to join</span>
          </button>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (pin.length >= 6) void join({ pin });
          }}
          className="space-y-4"
        >
          <input
            ref={inputRef}
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 7))}
            // Numeric keypad, not the full keyboard. Six digits typed in a
            // hurry by somebody who is also watching a countdown is the whole
            // interaction, and a letter keyboard costs three taps and a typo.
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            placeholder="Game PIN"
            className="w-full rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--surface)] px-4 py-5 text-center text-3xl font-bold tracking-[0.35em] text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
          />

          <button
            type="submit"
            disabled={pin.length < 6 || joining}
            className="w-full rounded-2xl bg-[var(--accent-strong)] px-6 py-4 text-lg font-bold text-white disabled:opacity-50"
          >
            {joining ? "Joining…" : "Enter"}
          </button>
        </form>

        {error ? (
          <p className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">
            <AlertIcon className="h-4 w-4" /> {error}
          </p>
        ) : null}

        <p className="mt-8 text-center text-xs text-[var(--muted)]">
          You play as yourself, so your tutor can see how the class did.
        </p>
      </div>
    </StudentShell>
  );
}
