"use client";

import { typerInitials, type Typer } from "@/lib/typing";

/**
 * The look of "somebody is typing", in one place so the class chat, the help
 * desk and the floating pill all read as the same thing.
 */

/** Saturated, white-text-safe colours, so an avatar is legible on every theme. */
const PALETTE = [
  "bg-orange-500",
  "bg-teal-600",
  "bg-violet-500",
  "bg-rose-500",
  "bg-sky-600",
  "bg-emerald-600",
  "bg-amber-600",
  "bg-fuchsia-600",
];

/** The same person always gets the same colour, in every room and every thread. */
export function avatarColour(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

/** Three dots that ripple. Purely visual — pair with text for screen readers. */
export function TypingDots({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[3px] ${className}`} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="ew-typing-dot inline-block h-[5px] w-[5px] rounded-full bg-current"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  );
}

/** A round initial. `live` adds the soft pulsing ring that says "active right now". */
export function TypingAvatar({
  id,
  name,
  size = 28,
  live = false,
}: {
  id: string;
  name: string;
  size?: number;
  live?: boolean;
}) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-bold text-white ring-2 ring-[var(--surface)] ${avatarColour(id)} ${
        live ? "ew-typing-ring" : ""
      }`}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.38)) }}
      aria-hidden
    >
      {typerInitials(name)}
    </span>
  );
}

/** Overlapping avatars for the people typing, capped so a busy room stays a badge. */
export function TypingAvatars({
  typers,
  size = 28,
  max = 3,
  live = true,
}: {
  typers: Typer[];
  size?: number;
  max?: number;
  live?: boolean;
}) {
  const shown = typers.slice(0, max);
  const extra = typers.length - shown.length;
  return (
    <span className="inline-flex shrink-0 items-center" aria-hidden>
      {shown.map((typer, index) => (
        <span key={typer.id} style={{ marginLeft: index === 0 ? 0 : -Math.round(size * 0.32) }}>
          <TypingAvatar id={typer.id} name={typer.name} size={size} live={live && index === 0} />
        </span>
      ))}
      {extra > 0 ? (
        <span
          className="grid shrink-0 place-items-center rounded-full bg-[var(--surface-alt)] font-bold text-[var(--muted)] ring-2 ring-[var(--surface)]"
          style={{
            width: size,
            height: size,
            marginLeft: -Math.round(size * 0.32),
            fontSize: Math.max(9, Math.round(size * 0.34)),
          }}
        >
          +{extra}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The "…" bubble that sits at the end of a conversation, exactly where the
 * message will appear when it lands — the way every chat app shows it.
 */
export function TypingBubble({ typers, label }: { typers: Typer[]; label?: string }) {
  if (typers.length === 0) return null;
  return (
    <div className="ew-msg-in flex items-end gap-2" role="status" aria-live="polite">
      <TypingAvatars typers={typers} size={28} />
      <span className="rounded-2xl rounded-bl-md bg-[var(--surface)] px-3.5 py-3 text-[var(--muted)] shadow-sm ring-1 ring-[var(--border)]">
        <TypingDots />
      </span>
      {label ? <span className="mb-1 min-w-0 truncate text-[11px] text-[var(--muted)]">{label}</span> : null}
    </div>
  );
}
