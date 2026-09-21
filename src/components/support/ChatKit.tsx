"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { ArrowLeftIcon, CameraIcon, CheckIcon, CrossCircleIcon, ImageIcon, SendIcon } from "@/components/icons";
import { TypingAvatars, TypingDots } from "@/components/typing/TypingUI";
import { MAX_ATTACHMENTS, type TicketAttachment } from "@/lib/support-copy";
import { describeTypers, type Typer } from "@/lib/typing";
import { useAttachmentUploader } from "@/components/support/TicketAttachments";

/**
 * THE HELP DESK, AS A CHAT.
 *
 * Every enquiry surface — the student's panel, the tutor's inbox, the office's
 * queue — used to draw its own stack of boxes. This is the one shared skin, and
 * it is modelled on the way support chats look in the apps people already live
 * in (Temu, WhatsApp): a grey conversation field, your words in a warm bubble
 * on the right, theirs in a white one on the left with an avatar and a name,
 * small centred timestamps, and a rounded "Type here…" bar with camera and
 * gallery buttons underneath.
 *
 * The point is not decoration. A student who is stuck on payment is already
 * anxious; a screen that looks like every other chat they have used tells them,
 * before they read a word, that a person is on the other end and that typing
 * is all it takes.
 *
 * Colours come from the theme variables, so the same markup is correct in Tag,
 * Nacht and Dämmerung.
 */

/* ------------------------------------------------------------------ avatars */

/** Warm orange for the answering side, teal for the asker — same as the chat this is modelled on. */
export function SupportAvatar({
  name,
  staff,
  size = 34,
}: {
  name: string;
  staff: boolean;
  size?: number;
}) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-bold text-white ${
        staff ? "bg-[var(--accent)]" : "bg-teal-600"
      }`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-hidden
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

/** "✓ Official support" — the green tag under the agent's name. */
export function OfficialPill({ label = "Official support" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-emerald-600 px-1.5 py-[1px] text-[10px] font-semibold leading-4 text-white">
      <CheckIcon className="h-2.5 w-2.5" strokeWidth={3.5} />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------- header */

export function ChatHeader({
  title,
  subtitle,
  onBack,
  right,
  fullScreen = false,
  backClassName = "",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onBack?: () => void;
  right?: ReactNode;
  /** Extra classes for the back arrow, e.g. `lg:hidden` when a desktop layout shows both panes. */
  backClassName?: string;
  /** True when this header is the top of the whole screen (phone), so it clears the notch. */
  fullScreen?: boolean;
}) {
  return (
    <header
      className={`flex shrink-0 items-center gap-1 border-b border-[var(--border)] bg-[var(--surface)] px-2 pb-2.5 ${
        fullScreen ? "pt-[max(0.625rem,env(safe-area-inset-top))]" : "pt-2.5"
      }`}
    >
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-[var(--foreground)] transition hover:bg-[var(--surface-alt)] active:scale-95 ${backClassName}`}
        >
          <ArrowLeftIcon className="h-5 w-5" />
        </button>
      ) : (
        <span className="w-2 shrink-0" />
      )}
      <div className="min-w-0 flex-1 text-center sm:text-left">
        <p className="truncate text-[15px] font-semibold leading-5 text-[var(--foreground)]">{title}</p>
        {subtitle ? <div className="mt-0.5 flex justify-center sm:justify-start">{subtitle}</div> : null}
      </div>
      <div className="flex min-w-10 shrink-0 items-center justify-end">{right}</div>
    </header>
  );
}

/* --------------------------------------------------------------- transcript */

/**
 * The scrolling conversation field. Opens scrolled to the newest message, and
 * follows new ones only if the reader was already at the bottom — yanking
 * somebody down while they scroll back through an earlier answer is the most
 * irritating thing a chat can do.
 */
export function ChatScroller({
  resetKey,
  watch,
  children,
  className = "",
}: {
  /** Changes when a different conversation opens: jump straight to the end. */
  resetKey: string | null;
  /** Anything whose change means "something new at the bottom" (message count, typers). */
  watch: unknown;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const openedFor = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (openedFor.current !== resetKey) {
      openedFor.current = resetKey;
      el.scrollTop = el.scrollHeight;
      return;
    }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 180;
    if (nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [resetKey, watch]);

  return (
    <div
      ref={ref}
      className={`min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[var(--surface-alt)] px-3 py-4 ${className}`}
    >
      {children}
    </div>
  );
}

/** "2:48 PM" today, "Mon 12 Sep, 2:48 PM" otherwise. */
export function stampLabel(iso: string): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true });
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return time;
  const day = date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
  return `${day}, ${time}`;
}

/** Whether to print a centred time stamp before this message (first, or after a 30-minute gap). */
export function needsStamp(previousIso: string | undefined, iso: string): boolean {
  if (!previousIso) return true;
  return new Date(iso).getTime() - new Date(previousIso).getTime() > 30 * 60_000;
}

export function ChatStamp({ children }: { children: ReactNode }) {
  return <p className="py-1 text-center text-xs text-[var(--muted)]">{children}</p>;
}

/** A line the conversation says about itself: "Sent from /payments", "Resolved". */
export function ChatNotice({ children }: { children: ReactNode }) {
  return (
    <p className="mx-auto max-w-[85%] rounded-full bg-[var(--surface)] px-3 py-1 text-center text-[11px] leading-4 text-[var(--muted)] ring-1 ring-[var(--border)]">
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ bubbles */

export function ChatBubbleRow({
  mine,
  authorName,
  staff,
  showAvatar = true,
  showName = true,
  edited,
  body,
  extras,
  footer,
}: {
  /** Which side of the screen: the person LOOKING at this screen is "mine". */
  mine: boolean;
  authorName: string;
  /** Whether the author is on the answering side (drives the avatar colour). */
  staff: boolean;
  showAvatar?: boolean;
  showName?: boolean;
  edited?: boolean;
  body: string;
  /** Attachments, an edit box, anything that hangs off the bubble. */
  extras?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className={`ew-msg-in flex items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}>
      <div className="w-[34px] shrink-0">
        {showAvatar ? <SupportAvatar name={authorName} staff={staff} /> : null}
      </div>
      <div className={`flex min-w-0 max-w-[78%] flex-col ${mine ? "items-end" : "items-start"}`}>
        {showName ? (
          <span className="mb-0.5 px-1 text-[11px] text-[var(--muted)]">
            {authorName}
            {edited ? <span className="italic"> · edited</span> : null}
          </span>
        ) : null}
        {body ? (
          <div
            className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[15px] leading-[1.45] text-[var(--foreground)] ${
              mine
                ? "rounded-br-md bg-[var(--accent-soft)]"
                : "rounded-bl-md bg-[var(--surface)] shadow-sm ring-1 ring-[var(--border)]"
            }`}
          >
            {body}
          </div>
        ) : null}
        {extras}
        {footer}
      </div>
    </div>
  );
}

/** Somebody on the other side is typing: their avatar and the three dots. */
export function ChatTypingRow({ typers }: { typers: Typer[] }) {
  if (typers.length === 0) return null;
  const staff = typers.some((t) => t.role === "admin" || t.role === "lecturer");
  return (
    <div className="ew-msg-in flex items-end gap-2" role="status" aria-live="polite">
      <div className="w-[34px] shrink-0">
        {typers.length === 1 ? (
          <SupportAvatar name={typers[0].name} staff={staff} />
        ) : (
          <TypingAvatars typers={typers} size={26} live={false} />
        )}
      </div>
      <div className="min-w-0">
        <span className="mb-0.5 block truncate px-1 text-[11px] text-[var(--muted)]">
          {describeTypers(typers.map((t) => t.name))}
        </span>
        <span className="inline-flex rounded-2xl rounded-bl-md bg-[var(--surface)] px-4 py-3 text-[var(--muted)] shadow-sm ring-1 ring-[var(--border)]">
          <TypingDots />
        </span>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- composer */

export function ChatComposer({
  value,
  onChange,
  onSend,
  busy,
  files,
  onFilesChange,
  placeholder = "Type here…",
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  onSend: () => void;
  busy?: boolean;
  files: TicketAttachment[];
  onFilesChange: (next: TicketAttachment[]) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const { busy: uploading, error, room, onFiles } = useAttachmentUploader(files, onFilesChange);

  const canSend = (value.trim().length > 0 || files.length > 0) && !busy && !uploading;

  // Grow with the text up to four lines, then scroll.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value]);

  async function pick(list: FileList | null, input: HTMLInputElement | null) {
    await onFiles(list);
    if (input) input.value = "";
  }

  return (
    <div className="shrink-0 border-t border-[var(--border)] bg-[var(--surface)] px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {files.length > 0 ? (
        <div className="mb-2 flex gap-2 overflow-x-auto px-1 pt-1">
          {files.map((att, index) => (
            <div key={`${att.url}-${index}`} className="relative shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={att.url}
                alt={att.name}
                className="h-16 w-16 rounded-xl border border-[var(--border)] object-cover"
              />
              <button
                type="button"
                onClick={() => onFilesChange(files.filter((_, i) => i !== index))}
                aria-label={`Remove ${att.name}`}
                className="absolute -right-1.5 -top-1.5 rounded-full bg-[var(--surface)] text-[var(--muted)] shadow-[var(--shadow)] transition hover:text-rose-500"
              >
                <CrossCircleIcon className="h-5 w-5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {error ? <p className="mb-1 px-2 text-[11px] font-medium text-rose-500">{error}</p> : null}
      {uploading ? <p className="mb-1 px-2 text-[11px] text-[var(--muted)]">Adding your picture…</p> : null}

      <div className="flex items-end gap-1">
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(event) => void pick(event.target.files, cameraRef.current)}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => void pick(event.target.files, galleryRef.current)}
        />
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          disabled={busy || uploading || room <= 0}
          aria-label="Take a photo"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[var(--muted)] transition hover:bg-[var(--surface-alt)] hover:text-[var(--accent)] active:scale-95 disabled:opacity-40"
        >
          <CameraIcon className="h-6 w-6" />
        </button>
        <button
          type="button"
          onClick={() => galleryRef.current?.click()}
          disabled={busy || uploading || room <= 0}
          aria-label={room <= 0 ? `Up to ${MAX_ATTACHMENTS} images` : "Attach a picture"}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[var(--muted)] transition hover:bg-[var(--surface-alt)] hover:text-[var(--accent)] active:scale-95 disabled:opacity-40"
        >
          <ImageIcon className="h-6 w-6" />
        </button>

        <textarea
          ref={textRef}
          value={value}
          onChange={(event) => onChange(event.target.value.slice(0, 4000))}
          onKeyDown={(event) => {
            // Enter sends on a keyboard; on a phone Enter must stay a new line.
            if (event.key === "Enter" && !event.shiftKey && window.innerWidth >= 640) {
              event.preventDefault();
              if (canSend) onSend();
            }
          }}
          rows={1}
          autoFocus={autoFocus}
          placeholder={placeholder}
          // 16px on a phone: anything smaller makes iOS zoom the page on focus.
          className="mx-1 max-h-[120px] min-h-[2.75rem] min-w-0 flex-1 resize-none rounded-3xl bg-[var(--surface-alt)] px-4 py-[0.7rem] text-base leading-5 text-[var(--foreground)] outline-none ring-1 ring-transparent transition placeholder:text-[var(--muted)] focus:ring-[var(--accent)] sm:text-sm"
        />

        {canSend ? (
          <button
            key="send"
            type="button"
            onClick={onSend}
            aria-label="Send"
            className="ew-pop grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-white shadow-md transition active:scale-90"
          >
            <SendIcon className="h-5 w-5" />
          </button>
        ) : (
          <span className="h-11 w-1 shrink-0" />
        )}
      </div>
    </div>
  );
}
