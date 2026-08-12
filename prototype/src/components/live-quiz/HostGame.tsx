"use client";

/**
 * The projector.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS LOOKED AT ON
 * ---------------------------------------------------------------------------
 * A wall, from up to eight metres away, in a branch classroom with the
 * afternoon sun in it. That single fact decides almost every choice in this
 * file, and it is why this is the one screen in the platform that does not
 * follow the theme.
 *
 *   - Fixed dark background, always. A light theme on a projector in a bright
 *     room is a grey rectangle; the contrast has to come from the screen
 *     because it will not come from the room.
 *   - Type sized in `vw`, not `rem`. The question has to be readable from the
 *     back row of a long room and from a laptop lid in a small one, and those
 *     are the same screen at different sizes.
 *   - No sidebar, no header, no theme toggle. It is rendered into `document.body`
 *     through a portal rather than nested in the tutor's shell — partly so
 *     nothing frames it, and partly because the shell's sidebar is a
 *     transformed element, and a fixed child of a transformed ancestor is
 *     positioned against the ancestor rather than the viewport. That bug has
 *     been paid for once in this codebase already.
 *
 * The clock is the server's. Every poll carries `serverNow`, the offset from
 * this machine is kept, and the countdown is drawn from `endsAt` minus the
 * corrected time — so a laptop whose clock is four hours out (which has also
 * happened here) still counts down correctly.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AnswerShape from "@/components/live-quiz/AnswerShape";
import { CheckIcon, CrossIcon, ExitIcon, ExpandIcon, TrophyIcon, UsersIcon } from "@/components/icons";

type ViewOption = { index: number; text: string; shape: string; color: string; label: string };

type ViewQuestion = {
  index: number;
  count: number;
  type: string;
  prompt: string;
  points: number;
  options: ViewOption[];
  needsSubmit: boolean;
};

type Standing = {
  playerId: string;
  name: string;
  score: number;
  correct: number;
  answered: number;
  streak: number;
  place: number;
  movement: number | null;
};

type HostView = {
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
  playerCount: number;
  answeredCount: number;
  lobby: Array<{ id: string; name: string }>;
  reveal: {
    correctIndexes: number[];
    correctText: string | null;
    distribution: number[];
    typed: Array<{ text: string; count: number; correct: boolean }>;
    correctCount: number;
    noAnswerCount: number;
  } | null;
  standings: Standing[] | null;
};

type Action = "start" | "lock" | "reveal" | "standings" | "next" | "end";

export default function HostGame({ gameId, onClose }: { gameId: string; onClose: () => void }) {
  const [view, setView] = useState<HostView | null>(null);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);

  /** serverNow minus this machine's clock, so the countdown is the server's. */
  const offsetRef = useRef(0);
  /**
   * The question index we have already auto-revealed. Without it, the timer
   * hitting zero and the last student answering — which can land in the same
   * half-second — would each fire `reveal`, and the second would be applied to
   * the following question.
   */
  const revealedRef = useRef(-1);

  useEffect(() => setMounted(true), []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/live-quiz/${gameId}`, { cache: "no-store" });
    if (!res.ok) return;
    const data: HostView = await res.json();
    offsetRef.current = data.serverNow - Date.now();
    setView(data);
  }, [gameId]);

  const act = useCallback(
    async (action: Action) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/live-quiz/${gameId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        if (res.ok) {
          const data: HostView = await res.json();
          offsetRef.current = data.serverNow - Date.now();
          setView(data);
        }
      } finally {
        setBusy(false);
      }
    },
    [gameId],
  );

  // --- polling -------------------------------------------------------------
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
    // Re-subscribing on pollMs is intentional: the interval is a property of
    // the phase, and the phase changes.
  }, [load, view?.pollMs]);

  // --- the countdown, redrawn locally at 10fps off the server's clock ------
  const [remainingMs, setRemainingMs] = useState(0);
  useEffect(() => {
    if (view?.game.phase !== "question" || !view.endsAt) {
      setRemainingMs(0);
      return;
    }
    const endsAt = view.endsAt;
    const paint = () => setRemainingMs(Math.max(0, endsAt - (Date.now() + offsetRef.current)));
    paint();
    const timer = window.setInterval(paint, 100);
    return () => window.clearInterval(timer);
  }, [view?.game.phase, view?.endsAt]);

  // --- auto-reveal ---------------------------------------------------------
  useEffect(() => {
    if (!view || view.game.phase !== "question" || busy) return;
    if (revealedRef.current === view.game.currentIndex) return;

    const everyoneIn = view.playerCount > 0 && view.answeredCount >= view.playerCount;
    const timeUp = remainingMs <= 0;
    if (!everyoneIn && !timeUp) return;

    revealedRef.current = view.game.currentIndex;
    // A held beat before the answer. Landing on the reveal the instant the last
    // student taps gives the room no moment to look up, and the moment of
    // looking up together is most of what the format is for.
    const timer = window.setTimeout(() => act("reveal"), everyoneIn ? 700 : 250);
    return () => window.clearTimeout(timer);
  }, [view, remainingMs, busy, act]);

  /** What the one big button does, given where we are. */
  const advance = useCallback(() => {
    if (!view || busy) return;
    switch (view.game.phase) {
      case "lobby":
        return void act("start");
      // Stops the clock rather than jumping to the answer. The auto-reveal
      // above then fires on the same path every question takes, so a tutor
      // cutting a question short and a question running out of time land the
      // room in exactly the same place.
      case "question":
        return void act("lock");
      case "reveal":
        return void act("standings");
      case "standings":
        return void act("next");
      default:
        return;
    }
  }, [view, busy, act]);

  // --- a presenter's clicker ----------------------------------------------
  /**
   * Space and the arrow keys advance, because a tutor running this is standing
   * at the front of the room holding a clicker, and every clicker on the market
   * sends PageUp/PageDown or the arrows. Walking back to the laptop to press a
   * button on screen between every question is how a game loses a class.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement) return;
      if ([" ", "ArrowRight", "PageDown", "Enter"].includes(event.key)) {
        event.preventDefault();
        advance();
      }
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, onClose]);

  // Floored at 1 so the bar widths never divide by zero on a question nobody
  // answered — which is exactly the question a tutor most wants to look at.
  const totalVotes = view?.reveal
    ? Math.max(1, view.reveal.distribution.reduce((sum, n) => sum + n, 0))
    : 0;

  if (!mounted) return null;

  const body = (
    <div className="lq-stage">
      <style>{STAGE_CSS}</style>

      {/* The PIN never leaves the screen. Students arrive late, phones drop off
          the wifi and rejoin, and a PIN that was only shown in the lobby means
          a hand goes up in the middle of every round. */}
      <header className="lq-bar">
        <div className="lq-pin">
          <span className="lq-pin-label">Game PIN</span>
          <strong>{view?.game.pin ?? "······"}</strong>
        </div>
        <div className="lq-bar-mid">
          <span className="lq-title">{view?.game.title ?? "Loading"}</span>
          {view && view.game.currentIndex >= 0 ? (
            <span className="lq-progress">
              Question {view.game.currentIndex + 1} of {view.game.questionCount}
            </span>
          ) : null}
        </div>
        <div className="lq-bar-right">
          <span className="lq-players">
            <UsersIcon className="h-5 w-5" />
            {view?.playerCount ?? 0}
          </span>
          <button type="button" className="lq-icon-btn" onClick={requestFullscreen} title="Full screen">
            <ExpandIcon className="h-5 w-5" />
          </button>
          <button type="button" className="lq-icon-btn" onClick={onClose} title="Leave the projector view">
            <ExitIcon className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div className="lq-body">
        {!view ? <p className="lq-muted">Setting up…</p> : null}

        {view?.game.phase === "lobby" ? <Lobby view={view} /> : null}
        {view?.game.phase === "question" ? (
          <QuestionStage view={view} remainingMs={remainingMs} />
        ) : null}
        {view?.game.phase === "reveal" && view.reveal ? (
          <RevealStage view={view} totalVotes={totalVotes} />
        ) : null}
        {view?.game.phase === "standings" ? <StandingsStage view={view} /> : null}
        {view?.game.phase === "ended" ? <FinalStage view={view} /> : null}
      </div>

      <footer className="lq-foot">
        <span className="lq-hint">
          Space or your clicker advances · Esc leaves
        </span>
        <div className="lq-foot-actions">
          {view && view.game.phase !== "ended" ? (
            <button type="button" className="lq-ghost" onClick={() => act("end")} disabled={busy}>
              End game
            </button>
          ) : null}
          <button
            type="button"
            className="lq-primary"
            onClick={advance}
            disabled={busy || !view || view.game.phase === "ended"}
          >
            {nextLabel(view)}
          </button>
        </div>
      </footer>
    </div>
  );

  return createPortal(body, document.body);
}

function nextLabel(view: HostView | null): string {
  switch (view?.game.phase) {
    case "lobby":
      return view.playerCount > 0 ? `Start with ${view.playerCount}` : "Start";
    case "question":
      return "Stop the clock";
    case "reveal":
      return "Show standings";
    case "standings":
      return view.game.currentIndex + 1 >= view.game.questionCount ? "Finish" : "Next question";
    case "ended":
      return "Finished";
    default:
      return "…";
  }
}

function requestFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement) void document.exitFullscreen();
  else void el.requestFullscreen?.().catch(() => {});
}

/* -------------------------------------------------------------------------- */
/* Stages                                                                     */
/* -------------------------------------------------------------------------- */

function Lobby({ view }: { view: HostView }) {
  return (
    <div className="lq-lobby">
      <div className="lq-lobby-join">
        <p className="lq-kicker">Join on your phone</p>
        {/* The path, not a full URL. Everyone in the room already has the
            portal open or bookmarked, and reading a domain letter by letter off
            a projector is the slowest ninety seconds of a lesson. */}
        <p className="lq-url">
          open the app <strong>→ Quiz game</strong>
        </p>
        <p className="lq-kicker">then enter</p>
        <p className="lq-bigpin">{view.game.pin}</p>
      </div>

      <div className="lq-lobby-players">
        <p className="lq-kicker">
          {view.playerCount === 0
            ? "Waiting for the first player"
            : `${view.playerCount} in the room`}
        </p>
        <div className="lq-names">
          {view.lobby.map((player) => (
            <span key={player.id} className="lq-name">
              {player.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function QuestionStage({ view, remainingMs }: { view: HostView; remainingMs: number }) {
  const question = view.question;
  if (!question) return null;

  const total = view.game.secondsPerQuestion * 1000;
  const fraction = total > 0 ? Math.max(0, Math.min(1, remainingMs / total)) : 0;
  const seconds = Math.ceil(remainingMs / 1000);

  return (
    <div className="lq-question">
      <p className="lq-prompt">{question.prompt}</p>

      <div className="lq-meta">
        <Countdown seconds={seconds} fraction={fraction} />
        <div className="lq-answered">
          <strong>{view.answeredCount}</strong>
          <span>
            of {view.playerCount} answered
          </span>
        </div>
      </div>

      {question.type === "short" ? (
        <p className="lq-typed-hint">Type your answer on your phone</p>
      ) : (
        <div className={`lq-options lq-options-${question.options.length}`}>
          {question.options.map((option) => (
            <div key={option.index} className="lq-option" style={{ background: option.color }}>
              <AnswerShape shape={option.shape} size={44} />
              <span>{option.text}</span>
            </div>
          ))}
        </div>
      )}

      {question.needsSubmit && question.type === "multi" ? (
        <p className="lq-typed-hint">Pick every correct one, then send</p>
      ) : null}
    </div>
  );
}

function Countdown({ seconds, fraction }: { seconds: number; fraction: number }) {
  const radius = 44;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="lq-clock">
      <svg viewBox="0 0 100 100" width="110" height="110">
        <circle cx="50" cy="50" r={radius} className="lq-clock-track" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          className={`lq-clock-fill ${fraction < 0.25 ? "lq-clock-urgent" : ""}`}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <span className={fraction < 0.25 ? "lq-clock-urgent-text" : ""}>{seconds}</span>
    </div>
  );
}

function RevealStage({ view, totalVotes }: { view: HostView; totalVotes: number }) {
  const question = view.question;
  const reveal = view.reveal;
  if (!question || !reveal) return null;

  return (
    <div className="lq-question">
      <p className="lq-prompt lq-prompt-small">{question.prompt}</p>

      {question.type === "short" ? (
        <div className="lq-typed">
          <p className="lq-answer-line">
            <CheckIcon className="h-8 w-8" /> {reveal.correctText}
          </p>
          <div className="lq-typed-list">
            {reveal.typed.map((entry) => (
              <span key={entry.text} className={entry.correct ? "lq-typed-ok" : "lq-typed-no"}>
                {entry.text} <em>×{entry.count}</em>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className={`lq-options lq-options-${question.options.length}`}>
          {question.options.map((option) => {
            const right = reveal.correctIndexes.includes(option.index);
            const votes = reveal.distribution[option.index] ?? 0;
            return (
              <div
                key={option.index}
                className={`lq-option ${right ? "lq-option-right" : "lq-option-wrong"}`}
                style={{ background: option.color }}
              >
                <AnswerShape shape={option.shape} size={40} />
                <span>{option.text}</span>
                <span className="lq-votes">
                  {right ? <CheckIcon className="h-6 w-6" /> : <CrossIcon className="h-6 w-6" />}
                  {votes}
                </span>
                {/* The bar is the point of this screen: a tutor learns more from
                    thirty people picking the same wrong option than from the
                    number who got it right. That is the misconception to teach
                    into, and it is invisible on a scoreboard. */}
                <i className="lq-bar-fill" style={{ width: `${(votes / totalVotes) * 100}%` }} />
              </div>
            );
          })}
        </div>
      )}

      <p className="lq-tally">
        <strong>{reveal.correctCount}</strong> correct
        {reveal.noAnswerCount > 0 ? (
          <>
            {" · "}
            <strong>{reveal.noAnswerCount}</strong> did not answer
          </>
        ) : null}
      </p>
    </div>
  );
}

function StandingsStage({ view }: { view: HostView }) {
  const rows = (view.standings ?? []).slice(0, 8);

  return (
    <div className="lq-standings">
      <p className="lq-kicker">Standings</p>
      <ol>
        {rows.map((row) => (
          <li key={row.playerId}>
            <span className="lq-place">{row.place}</span>
            <span className="lq-sname">{row.name}</span>
            {row.streak >= 2 ? <span className="lq-streak">{row.streak} in a row</span> : null}
            <span className={`lq-move ${movementClass(row.movement)}`}>{movementLabel(row.movement)}</span>
            <span className="lq-score">{row.score.toLocaleString()}</span>
          </li>
        ))}
      </ol>
      {rows.length === 0 ? <p className="lq-muted">Nobody has scored yet.</p> : null}
    </div>
  );
}

function movementLabel(movement: number | null): string {
  if (movement === null || movement === 0) return "";
  return movement > 0 ? `▲${movement}` : `▼${Math.abs(movement)}`;
}

function movementClass(movement: number | null): string {
  if (movement === null || movement === 0) return "";
  return movement > 0 ? "lq-move-up" : "lq-move-down";
}

function FinalStage({ view }: { view: HostView }) {
  const rows = view.standings ?? [];
  const podium = rows.slice(0, 3);
  const rest = rows.slice(3, 12);

  return (
    <div className="lq-final">
      <p className="lq-kicker">
        <TrophyIcon className="h-7 w-7" /> Final
      </p>

      <div className="lq-podium">
        {/* Second, first, third — the order a podium is actually built in, so
            the winner is in the middle where the room is already looking. */}
        {[podium[1], podium[0], podium[2]].map((row, slot) =>
          row ? (
            <div key={row.playerId} className={`lq-step lq-step-${slot}`}>
              <span className="lq-sname">{row.name}</span>
              <span className="lq-score">{row.score.toLocaleString()}</span>
              <span className="lq-place">{row.place}</span>
            </div>
          ) : (
            <div key={`empty-${slot}`} className="lq-step lq-step-empty" />
          ),
        )}
      </div>

      {rest.length > 0 ? (
        <ol className="lq-rest">
          {rest.map((row) => (
            <li key={row.playerId}>
              <span className="lq-place">{row.place}</span>
              <span className="lq-sname">{row.name}</span>
              <span className="lq-score">{row.score.toLocaleString()}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Scoped plain CSS rather than utilities.
 *
 * Everything here is sized in `vw` against the projector rather than in the
 * design system's steps, and clamping a dozen font sizes through arbitrary
 * Tailwind values would be less readable than the rule it replaces. This is
 * also the only surface in the app that deliberately ignores the theme, so
 * there are no tokens to reach for.
 */
const STAGE_CSS = `
.lq-stage{position:fixed;inset:0;z-index:120;display:flex;flex-direction:column;
  background:radial-gradient(120% 90% at 50% 0%,#123b3d 0%,#0a1b1f 55%,#060f12 100%);
  color:#f4fbfa;font-family:var(--font-sans,system-ui);overflow:hidden}
.lq-bar{display:flex;align-items:center;gap:1rem;padding:.9rem 1.4rem;border-bottom:1px solid rgba(255,255,255,.1)}
.lq-pin{display:flex;flex-direction:column;line-height:1.05}
.lq-pin-label{font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;opacity:.6}
.lq-pin strong{font-size:clamp(1.4rem,2.4vw,2.2rem);letter-spacing:.28em;font-variant-numeric:tabular-nums}
.lq-bar-mid{flex:1;text-align:center;display:flex;flex-direction:column;gap:.15rem;min-width:0}
.lq-title{font-size:clamp(1rem,1.6vw,1.4rem);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lq-progress{font-size:.85rem;opacity:.65}
.lq-bar-right{display:flex;align-items:center;gap:.6rem}
.lq-players{display:inline-flex;align-items:center;gap:.4rem;font-size:1.15rem;font-weight:700}
.lq-icon-btn{display:grid;place-items:center;width:2.4rem;height:2.4rem;border-radius:.7rem;
  border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:inherit;cursor:pointer}
.lq-icon-btn:hover{background:rgba(255,255,255,.14)}
.lq-body{flex:1;display:grid;place-items:center;padding:1.5rem 2vw;min-height:0;overflow:hidden}
.lq-foot{display:flex;align-items:center;justify-content:space-between;gap:1rem;
  padding:.8rem 1.4rem;border-top:1px solid rgba(255,255,255,.1)}
.lq-hint{font-size:.8rem;opacity:.5}
.lq-foot-actions{display:flex;gap:.6rem}
.lq-primary{padding:.7rem 1.6rem;border-radius:.8rem;border:0;background:#FF6600;color:#fff;
  font-size:1.05rem;font-weight:700;cursor:pointer}
.lq-primary:disabled{opacity:.45;cursor:default}
.lq-ghost{padding:.7rem 1.2rem;border-radius:.8rem;border:1px solid rgba(255,255,255,.22);
  background:transparent;color:inherit;cursor:pointer}
.lq-muted{opacity:.6}
.lq-kicker{display:flex;align-items:center;justify-content:center;gap:.5rem;
  font-size:.8rem;letter-spacing:.16em;text-transform:uppercase;opacity:.65;margin-bottom:.5rem}

.lq-lobby{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:3vw;
  align-items:center;width:100%;max-width:1500px}
.lq-lobby-join{text-align:center}
.lq-url{font-size:clamp(1rem,1.7vw,1.5rem);opacity:.85;margin-bottom:1rem}
.lq-bigpin{font-size:clamp(4rem,11vw,10rem);font-weight:800;letter-spacing:.1em;line-height:1;
  font-variant-numeric:tabular-nums;text-shadow:0 0 60px rgba(255,102,0,.35)}
.lq-names{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center;max-height:52vh;overflow:hidden}
.lq-name{padding:.45rem .9rem;border-radius:999px;background:rgba(255,255,255,.1);
  font-size:clamp(.9rem,1.3vw,1.3rem);font-weight:600;animation:lq-pop .3s ease}
@keyframes lq-pop{from{transform:scale(.7);opacity:0}to{transform:scale(1);opacity:1}}

.lq-question{width:100%;max-width:1500px;display:flex;flex-direction:column;gap:1.2rem;align-items:center}
.lq-prompt{font-size:clamp(1.6rem,3.6vw,3.4rem);font-weight:700;text-align:center;line-height:1.2;
  text-wrap:balance}
.lq-prompt-small{font-size:clamp(1.2rem,2.2vw,2rem);opacity:.8}
.lq-meta{display:flex;align-items:center;gap:2.5rem}
.lq-clock{position:relative;display:grid;place-items:center}
.lq-clock svg{transform:rotate(0deg)}
.lq-clock-track{fill:none;stroke:rgba(255,255,255,.12);stroke-width:9}
.lq-clock-fill{fill:none;stroke:#2dd4bf;stroke-width:9;stroke-linecap:round;transition:stroke-dashoffset .1s linear}
.lq-clock-urgent{stroke:#fb7185}
.lq-clock span{position:absolute;font-size:2.4rem;font-weight:800;font-variant-numeric:tabular-nums}
.lq-clock-urgent-text{color:#fb7185}
.lq-answered{display:flex;flex-direction:column;align-items:flex-start;line-height:1.1}
.lq-answered strong{font-size:3rem;font-variant-numeric:tabular-nums}
.lq-answered span{opacity:.7}
.lq-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;width:100%}
.lq-options-2{grid-template-columns:repeat(2,minmax(0,1fr))}
.lq-options-3,.lq-options-5,.lq-options-6{grid-template-columns:repeat(3,minmax(0,1fr))}
.lq-option{position:relative;display:flex;align-items:center;gap:1rem;padding:1.2rem 1.4rem;
  border-radius:1rem;color:#fff;font-size:clamp(1.1rem,2vw,1.9rem);font-weight:700;
  overflow:hidden;min-height:5.2rem}
.lq-option>span:first-of-type{flex:1;position:relative;z-index:1}
.lq-option>svg{position:relative;z-index:1}
.lq-option-wrong{opacity:.3}
.lq-option-right{outline:4px solid #fff;outline-offset:-4px}
.lq-votes{position:relative;z-index:1;display:inline-flex;align-items:center;gap:.35rem;
  font-variant-numeric:tabular-nums;background:rgba(0,0,0,.25);padding:.25rem .7rem;border-radius:999px}
.lq-bar-fill{position:absolute;left:0;bottom:0;height:.5rem;background:rgba(255,255,255,.85);
  transition:width .5s ease}
.lq-tally{font-size:1.3rem;opacity:.85}
.lq-typed-hint{font-size:1.2rem;opacity:.7}
.lq-typed{text-align:center}
.lq-answer-line{display:inline-flex;align-items:center;gap:.7rem;font-size:clamp(1.8rem,4vw,3.4rem);
  font-weight:800;color:#5eead4}
.lq-typed-list{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center;margin-top:1.2rem}
.lq-typed-list span{padding:.4rem .9rem;border-radius:999px;font-size:1.1rem;background:rgba(255,255,255,.1)}
.lq-typed-ok{color:#5eead4}
.lq-typed-no{color:#fda4af}
.lq-typed-list em{opacity:.6;font-style:normal}

.lq-standings,.lq-final{width:100%;max-width:1100px}
.lq-standings ol,.lq-rest{list-style:none;display:flex;flex-direction:column;gap:.5rem;margin:0;padding:0}
.lq-standings li,.lq-rest li{display:flex;align-items:center;gap:1rem;padding:.7rem 1.1rem;
  border-radius:.8rem;background:rgba(255,255,255,.07);font-size:clamp(1rem,1.8vw,1.6rem)}
.lq-place{display:grid;place-items:center;min-width:2.2rem;height:2.2rem;border-radius:.6rem;
  background:rgba(255,255,255,.14);font-weight:800;font-size:1.1rem}
.lq-sname{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lq-score{font-variant-numeric:tabular-nums;font-weight:800}
.lq-streak{font-size:.8rem;padding:.2rem .6rem;border-radius:999px;background:rgba(255,102,0,.25);color:#fdba74}
.lq-move{min-width:3rem;text-align:right;font-size:.95rem;opacity:0}
.lq-move-up{opacity:1;color:#5eead4}
.lq-move-down{opacity:1;color:#fda4af}

.lq-podium{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;align-items:end;margin-bottom:1.5rem}
.lq-step{display:flex;flex-direction:column;align-items:center;gap:.4rem;padding:1.2rem 1rem;
  border-radius:1rem 1rem 0 0;background:rgba(255,255,255,.1)}
.lq-step-0{height:11rem;background:rgba(148,163,184,.25)}
.lq-step-1{height:14rem;background:rgba(255,102,0,.3)}
.lq-step-2{height:9rem;background:rgba(180,83,9,.25)}
.lq-step-empty{background:transparent}
.lq-step .lq-sname{font-size:clamp(1rem,1.8vw,1.6rem);text-align:center;flex:0}
.lq-step .lq-score{font-size:clamp(1.2rem,2.4vw,2.2rem)}

@media (max-width:900px){
  .lq-lobby{grid-template-columns:1fr;gap:1.5rem}
  .lq-options,.lq-options-3,.lq-options-5,.lq-options-6{grid-template-columns:1fr}
  .lq-meta{gap:1.2rem}
}
`;
