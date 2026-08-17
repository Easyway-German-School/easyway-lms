"use client";

/**
 * The phone.
 *
 * ---------------------------------------------------------------------------
 * WHAT A STUDENT IS DOING WHILE THEY LOOK AT THIS
 * ---------------------------------------------------------------------------
 * Sitting in a classroom, phone in one hand, glancing between it and the board,
 * with fifteen seconds on the clock and thirty other people in the room. So:
 *
 *   - Buttons that fill the screen. A miss costs the round, and a thumb on a
 *     cracked screen in a hurry is not precise.
 *   - The question text is here as well as on the board. The board is at the
 *     far end of a bright room and these are German words being learned, half
 *     of them long. A student who cannot read the question does not lose
 *     because of their German, but it will look to everyone — including them —
 *     as though they did.
 *   - Nothing tells them whether they were right until the reveal. The phone
 *     next to theirs can be read, and a game where the answer appears the
 *     instant you tap it is a game that is over by question two.
 *   - No countdown number. Deliberate: the clock is on the board, and a second
 *     ticking clock six inches from their eyes is the thing that makes a
 *     nervous student panic and tap anything. They get a bar that drains.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import AnswerShape from "@/components/live-quiz/AnswerShape";
import { buzz } from "@/lib/live-quiz-sound";
import { CheckIcon, ClockIcon, CrossIcon, FlameIcon, SendIcon, TrophyIcon } from "@/components/icons";

type ViewOption = { index: number; text: string; shape: string; color: string; label: string };

type ViewQuestion = {
  index: number;
  count: number;
  type: string;
  prompt: string;
  points: number;
  options: ViewOption[];
  needsSubmit: boolean;
  imageUrl: string | null;
};

type Standing = {
  playerId: string;
  name: string;
  score: number;
  place: number;
  movement: number | null;
};

type PlayerView = {
  pollMs: number;
  serverNow: number;
  game: {
    id: string;
    pin: string;
    title: string;
    phase: "lobby" | "question" | "reveal" | "standings" | "ended";
    currentIndex: number;
    questionCount: number;
    secondsPerQuestion: number;
    speedBonus: boolean;
  };
  endsAt: number | null;
  question: ViewQuestion | null;
  me: {
    name: string;
    score: number;
    place: number | null;
    playerCount: number;
    streak: number;
    correct: number;
  };
  myAnswer: { submitted: boolean; value: unknown } | null;
  outcome: {
    correct: boolean;
    credit: number;
    points: number;
    correctIndexes: number[];
    correctText: string | null;
    missed: boolean;
  } | null;
  standings: Standing[] | null;
  myStanding: Standing | null;
};

export default function PlayerGame({ gameId, onLeave }: { gameId: string; onLeave: () => void }) {
  const [view, setView] = useState<PlayerView | null>(null);
  const [error, setError] = useState("");

  /** Optimistic: the tap has been sent but the poll has not come back yet. */
  const [sending, setSending] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [typed, setTyped] = useState("");

  const offsetRef = useRef(0);
  const lastIndexRef = useRef(-1);

  const load = useCallback(async () => {
    const res = await fetch(`/api/live-quiz/${gameId}`, { cache: "no-store" });
    if (!res.ok) {
      if (res.status === 403 || res.status === 404) setError("You are not in this game any more.");
      return;
    }
    const data: PlayerView = await res.json();
    offsetRef.current = data.serverNow - Date.now();
    setView(data);
  }, [gameId]);

  useEffect(() => {
    let cancelled = false;
    let timer: number;

    async function tick() {
      if (cancelled) return;
      await load();
      if (cancelled) return;
      timer = window.setTimeout(tick, view?.pollMs ?? 1500);
    }

    tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [load, view?.pollMs]);

  // A new question clears whatever was half-typed or half-ticked for the last
  // one. Without this, a checkbox left ticked from question three arrives as
  // the answer to question four the moment the student presses send.
  useEffect(() => {
    if (!view) return;
    if (view.game.currentIndex !== lastIndexRef.current) {
      lastIndexRef.current = view.game.currentIndex;
      setPicked([]);
      setTyped("");
      setSending(false);
    }
  }, [view]);

  /**
   * The verdict, in the pocket.
   *
   * Two short buzzes for right, one long for wrong — distinguishable without
   * looking, which matters because at the reveal every head in the room is up
   * at the board. Keyed on phase+index so the 1.5s poll cannot buzz a phone
   * continuously for the whole time the answer is on screen.
   */
  const verdictRef = useRef("");
  useEffect(() => {
    if (!view || view.game.phase !== "reveal" || !view.outcome) return;
    const key = `${view.game.currentIndex}`;
    if (verdictRef.current === key) return;
    verdictRef.current = key;
    // Nothing at all for a missed question. A student who ran out of time knows,
    // and buzzing at them about it is just a poke.
    if (view.outcome.missed) return;
    buzz(view.outcome.correct ? [26, 60, 26] : 150);
  }, [view]);

  /**
   * The draining bar, off the SERVER's clock.
   *
   * `offsetRef` is the difference between the server's `serverNow` and this
   * phone's idea of the time, refreshed on every poll. Subtracting it is what
   * makes the bar correct on a phone whose clock is wrong — which is not a
   * hypothetical in this codebase, where a four-hour skew once invalidated
   * every token the classroom minted.
   */
  const [fraction, setFraction] = useState(1);
  useEffect(() => {
    if (view?.game.phase !== "question" || !view.endsAt) {
      setFraction(1);
      return;
    }
    const endsAt = view.endsAt;
    const total = Math.max(1, view.game.secondsPerQuestion * 1000);
    const paint = () => {
      const left = endsAt - (Date.now() + offsetRef.current);
      setFraction(Math.max(0, Math.min(1, left / total)));
    };
    paint();
    const timer = window.setInterval(paint, 120);
    return () => window.clearInterval(timer);
  }, [view?.game.phase, view?.endsAt, view?.game.secondsPerQuestion]);

  const submit = useCallback(
    async (answer: unknown) => {
      if (!view?.question || sending) return;
      setSending(true);
      // The tap landed. Said with a buzz rather than a noise, because thirty
      // phones confirming out loud is not atmosphere — and because the student
      // is looking at the board, not at their own screen.
      buzz(18);
      try {
        await fetch(`/api/live-quiz/${gameId}/answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ index: view.question.index, answer }),
        });
        // Deliberately not reading the response for a verdict — the server does
        // not send one, and this is where a "correct!" would leak to the phone
        // next door.
        await load();
      } finally {
        setSending(false);
      }
    },
    [gameId, view, sending, load],
  );

  if (error) {
    return (
      <div className="pq-wrap">
        <style>{PLAYER_CSS}</style>
        <p className="pq-note">{error}</p>
        <button type="button" className="pq-ghost" onClick={onLeave}>
          Back
        </button>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="pq-wrap">
        <style>{PLAYER_CSS}</style>
        <p className="pq-note">Joining…</p>
      </div>
    );
  }

  const answered = Boolean(view.myAnswer?.submitted);

  return (
    <div className="pq-wrap">
      <style>{PLAYER_CSS}</style>

      <header className="pq-head">
        <div>
          <p className="pq-name">{view.me.name}</p>
          <p className="pq-sub">
            {view.game.title}
            {view.game.currentIndex >= 0
              ? ` · ${view.game.currentIndex + 1}/${view.game.questionCount}`
              : ""}
          </p>
        </div>
        <div className="pq-score">
          <strong>{view.me.score.toLocaleString()}</strong>
          {view.me.place ? <span>{ordinal(view.me.place)}</span> : null}
        </div>
      </header>

      {view.me.streak >= 2 && view.game.phase !== "ended" ? (
        <p className="pq-streak">
          <FlameIcon className="h-4 w-4" /> {view.me.streak} in a row
        </p>
      ) : null}

      {view.game.phase === "lobby" ? (
        <div className="pq-centre">
          <p className="pq-big">You&rsquo;re in</p>
          <p className="pq-note">Look up at the board. It starts in a moment.</p>
          <p className="pq-note pq-dim">
            {view.me.playerCount} {view.me.playerCount === 1 ? "player" : "players"} so far
          </p>
        </div>
      ) : null}

      {view.game.phase === "question" && view.question ? (
        <>
          <div className="pq-timer">
            <i style={{ width: `${fraction * 100}%` }} />
          </div>

          <p className="pq-prompt">{view.question.prompt}</p>

          {/* On the phone too, for the same reason the prompt is: the board is
              at the far end of a bright room. Hidden once they have answered —
              the buttons are gone by then and the picture would be pushing the
              "answer in" message off a small screen. */}
          {view.question.imageUrl && !answered ? (
            <img src={view.question.imageUrl} alt="" className="pq-image" />
          ) : null}

          {answered ? (
            <div className="pq-centre">
              <p className="pq-big">Answer in</p>
              {/* No verdict, and it says why in as few words as possible. A
                  student who thinks the app has hung will tap again. */}
              <p className="pq-note">Everyone finds out together on the board.</p>
            </div>
          ) : view.question.type === "short" ? (
            <form
              className="pq-typing"
              onSubmit={(event) => {
                event.preventDefault();
                if (typed.trim()) void submit(typed.trim());
              }}
            >
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="Type your answer"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                // Autocorrect off on all three counts: a German answer typed on
                // an English keyboard is exactly what a phone loves to "fix",
                // and a corrected word is a wrong answer the student watched
                // themselves type correctly.
                className="pq-input"
              />
              <button type="submit" className="pq-send" disabled={!typed.trim() || sending}>
                <SendIcon className="h-5 w-5" /> Send
              </button>
            </form>
          ) : (
            <>
              <div className={`pq-grid pq-grid-${view.question.options.length}`}>
                {view.question.options.map((option) => {
                  const isPicked = picked.includes(option.index);
                  return (
                    <button
                      key={option.index}
                      type="button"
                      disabled={sending}
                      onClick={() => {
                        if (view.question?.type === "multi") {
                          setPicked((current) =>
                            current.includes(option.index)
                              ? current.filter((index) => index !== option.index)
                              : [...current, option.index],
                          );
                          return;
                        }
                        void submit(option.index);
                      }}
                      className={`pq-opt ${isPicked ? "pq-opt-picked" : ""}`}
                      style={{ background: option.color }}
                      aria-label={`${option.label}: ${option.text}`}
                    >
                      <AnswerShape shape={option.shape} size={30} />
                      <span>{option.text}</span>
                      {isPicked ? <CheckIcon className="h-6 w-6" /> : null}
                    </button>
                  );
                })}
              </div>

              {view.question.type === "multi" ? (
                <button
                  type="button"
                  className="pq-send pq-send-wide"
                  disabled={picked.length === 0 || sending}
                  onClick={() => void submit(picked)}
                >
                  <SendIcon className="h-5 w-5" /> Send {picked.length || ""}
                </button>
              ) : null}
            </>
          )}
        </>
      ) : null}

      {view.game.phase === "question" && !view.question ? (
        <div className="pq-centre">
          <ClockIcon className="h-10 w-10 pq-dim" />
          <p className="pq-big">Time</p>
          <p className="pq-note">Eyes on the board.</p>
        </div>
      ) : null}

      {view.game.phase === "reveal" && view.outcome ? (
        <div className={`pq-verdict ${view.outcome.correct ? "pq-right" : "pq-wrong"}`}>
          {view.outcome.correct ? (
            <CheckIcon className="h-14 w-14" />
          ) : (
            <CrossIcon className="h-14 w-14" />
          )}
          <p className="pq-big">
            {view.outcome.correct
              ? "Correct"
              : view.outcome.missed
                ? "Out of time"
                : view.outcome.credit > 0
                  ? "Nearly"
                  : "Not this one"}
          </p>
          {view.outcome.points > 0 ? (
            <p className="pq-points">+{view.outcome.points.toLocaleString()}</p>
          ) : null}
          {!view.outcome.correct && view.outcome.correctText ? (
            <p className="pq-note">The answer was &ldquo;{view.outcome.correctText}&rdquo;</p>
          ) : null}
          {/* Encouragement that is true, and only when it is true. A student
              who has just dropped a five-question streak does not need to be
              told they are doing well. */}
          {!view.outcome.correct && view.me.correct > 0 ? (
            <p className="pq-note pq-dim">{view.me.correct} right so far.</p>
          ) : null}
        </div>
      ) : null}

      {/* THEIR game, before the league table.
          A leaderboard answers "who won", which for the twenty people who did
          not win is not the question they are asking. This answers theirs: how
          many did I get, and how did I place. It is also the only screen that
          survives the walk home, so it is the one that has to be about them. */}
      {view.game.phase === "ended" ? (
        <div className="pq-report">
          <p className="pq-report-score">
            {view.me.correct}
            <em>of {view.game.questionCount}</em>
          </p>
          <p className="pq-report-line">{scoreline(view.me.correct, view.game.questionCount)}</p>
          <div className="pq-report-meta">
            <span>
              <strong>{view.me.score.toLocaleString()}</strong> points
            </span>
            {view.myStanding ? (
              <span>
                <strong>{ordinal(view.myStanding.place)}</strong> of {view.me.playerCount}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {(view.game.phase === "standings" || view.game.phase === "ended") && view.standings ? (
        <div className="pq-table">
          <p className="pq-kicker">
            {view.game.phase === "ended" ? (
              <>
                <TrophyIcon className="h-5 w-5" /> Final
              </>
            ) : (
              "Standings"
            )}
          </p>
          <ol>
            {view.standings.map((row) => (
              <li key={row.playerId} className={row.playerId === view.myStanding?.playerId ? "pq-mine" : ""}>
                <span className="pq-place">{row.place}</span>
                <span className="pq-sname">{row.name}</span>
                <span className="pq-pts">{row.score.toLocaleString()}</span>
              </li>
            ))}
          </ol>

          {/* Their own row, always — including when they are 19th of 24. The
              alternative is a student who never appears on the screen at all,
              which is the clearest possible way to tell somebody the game was
              not for them. */}
          {view.myStanding && !view.standings.some((row) => row.playerId === view.myStanding?.playerId) ? (
            <ol className="pq-mine-only">
              <li className="pq-mine">
                <span className="pq-place">{view.myStanding.place}</span>
                <span className="pq-sname">{view.myStanding.name}</span>
                <span className="pq-pts">{view.myStanding.score.toLocaleString()}</span>
              </li>
            </ol>
          ) : null}

          {view.game.phase === "ended" ? (
            <button type="button" className="pq-ghost" onClick={onLeave}>
              Done
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One line about how it went, and it has to be honest.
 *
 * A student who got 2 of 10 knows they got 2 of 10, and "Great job!" over that
 * number is the moment they stop believing anything the app tells them. So the
 * bottom rungs point at the next thing instead of praising the last one — but
 * nothing here is ever unkind, because this is a German lesson and getting it
 * wrong is the method, not a failure.
 */
function scoreline(correct: number, total: number): string {
  if (total <= 0) return "That's the game.";
  const share = correct / total;
  if (correct === total) return "Every single one. Fehlerlos.";
  if (share >= 0.8) return "Strong round — that level is sticking.";
  if (share >= 0.6) return "Solid. The gaps are worth a second look.";
  if (share >= 0.4) return "Halfway there. Worth going over these in class.";
  if (correct > 0) return "A tricky set. These are the ones to revise.";
  return "None this time — so these are exactly what to study next.";
}

function ordinal(place: number): string {
  const suffix =
    place % 100 >= 11 && place % 100 <= 13
      ? "th"
      : place % 10 === 1
        ? "st"
        : place % 10 === 2
          ? "nd"
          : place % 10 === 3
            ? "rd"
            : "th";
  return `${place}${suffix}`;
}

const PLAYER_CSS = `
.pq-wrap{display:flex;flex-direction:column;gap:.9rem;min-height:100dvh;padding:1rem;
  background:radial-gradient(120% 70% at 50% 0%,#123b3d 0%,#0a1b1f 60%,#060f12 100%);
  color:#f4fbfa;font-family:var(--font-sans,system-ui)}
.pq-head{display:flex;align-items:center;justify-content:space-between;gap:1rem}
.pq-name{font-weight:700;font-size:1.05rem}
.pq-sub{font-size:.78rem;opacity:.6}
.pq-score{text-align:right;line-height:1.1}
.pq-score strong{display:block;font-size:1.5rem;font-variant-numeric:tabular-nums}
.pq-score span{font-size:.75rem;opacity:.6}
.pq-streak{display:inline-flex;align-items:center;gap:.4rem;align-self:flex-start;
  padding:.25rem .7rem;border-radius:999px;background:rgba(255,102,0,.2);color:#fdba74;font-size:.8rem}
.pq-timer{height:.5rem;border-radius:999px;background:rgba(255,255,255,.12);overflow:hidden}
.pq-timer i{display:block;height:100%;background:#2dd4bf;transition:width .12s linear}
.pq-prompt{font-size:1.15rem;font-weight:600;line-height:1.35;text-wrap:balance}
/* Height-capped, not width-capped: the answer buttons must stay reachable
   without scrolling, and a tall photo would push them under the fold. */
.pq-image{width:100%;max-height:22vh;object-fit:contain;border-radius:.7rem;
  background:rgba(255,255,255,.06)}
.pq-centre{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:.5rem;text-align:center}
.pq-big{font-size:1.6rem;font-weight:800}
.pq-note{opacity:.75;font-size:.9rem;text-align:center}
.pq-dim{opacity:.5}

.pq-grid{flex:1;display:grid;grid-template-columns:1fr 1fr;gap:.7rem;min-height:0}
.pq-grid-2{grid-template-columns:1fr;grid-template-rows:1fr 1fr}
.pq-grid-3,.pq-grid-5,.pq-grid-6{grid-template-columns:1fr 1fr}
.pq-opt{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.5rem;
  min-height:6.5rem;padding:.9rem;border:0;border-radius:1rem;color:#fff;font-size:1rem;
  font-weight:700;text-align:center;cursor:pointer;line-height:1.2;
  -webkit-tap-highlight-color:transparent}
.pq-opt:active{transform:scale(.97)}
.pq-opt-picked{outline:4px solid #fff;outline-offset:-4px}
.pq-opt:disabled{opacity:.6}

.pq-typing{display:flex;flex-direction:column;gap:.7rem;flex:1;justify-content:center}
.pq-input{padding:1rem;border-radius:1rem;border:2px solid rgba(255,255,255,.25);
  background:rgba(255,255,255,.08);color:#fff;font-size:1.2rem;text-align:center}
.pq-input::placeholder{color:rgba(255,255,255,.45)}
.pq-send{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;
  padding:1rem;border:0;border-radius:1rem;background:#FF6600;color:#fff;font-size:1.05rem;
  font-weight:700;cursor:pointer}
.pq-send:disabled{opacity:.45}
.pq-send-wide{width:100%}

.pq-verdict{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:.5rem;border-radius:1.2rem;padding:2rem 1rem}
.pq-right{background:rgba(45,212,191,.16);color:#5eead4}
.pq-wrong{background:rgba(251,113,133,.14);color:#fda4af}
.pq-points{font-size:2rem;font-weight:800;font-variant-numeric:tabular-nums}
.pq-verdict .pq-note{color:#f4fbfa}

.pq-report{text-align:center;padding:1.1rem .9rem 1.2rem;margin-bottom:.9rem;border-radius:1.1rem;
  background:linear-gradient(160deg,rgba(255,102,0,.22),rgba(255,255,255,.06));
  border:1px solid rgba(255,102,0,.35)}
.pq-report-score{font-size:3.4rem;font-weight:800;line-height:1;font-variant-numeric:tabular-nums}
.pq-report-score em{display:block;margin-top:.25rem;font-size:.95rem;font-weight:600;font-style:normal;opacity:.7}
.pq-report-line{margin-top:.7rem;font-size:1rem;font-weight:600;text-wrap:balance}
.pq-report-meta{display:flex;justify-content:center;gap:1.6rem;margin-top:.9rem;font-size:.85rem;opacity:.85}
.pq-report-meta strong{font-variant-numeric:tabular-nums}

.pq-table{flex:1;display:flex;flex-direction:column;gap:.6rem}
.pq-kicker{display:flex;align-items:center;justify-content:center;gap:.5rem;
  font-size:.75rem;letter-spacing:.15em;text-transform:uppercase;opacity:.65}
.pq-table ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.4rem}
.pq-table li{display:flex;align-items:center;gap:.7rem;padding:.6rem .8rem;border-radius:.7rem;
  background:rgba(255,255,255,.07)}
.pq-mine{background:rgba(255,102,0,.22)!important;outline:1px solid rgba(255,102,0,.45)}
.pq-mine-only{margin-top:.4rem}
.pq-place{display:grid;place-items:center;min-width:1.8rem;height:1.8rem;border-radius:.5rem;
  background:rgba(255,255,255,.14);font-weight:800;font-size:.85rem}
.pq-sname{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pq-pts{font-variant-numeric:tabular-nums;font-weight:800}
.pq-ghost{margin-top:auto;padding:.9rem;border-radius:1rem;border:1px solid rgba(255,255,255,.25);
  background:transparent;color:inherit;font-weight:600;cursor:pointer}
`;
