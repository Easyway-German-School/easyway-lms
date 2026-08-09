"use client";

import { useMemo, useRef, useState } from "react";
import {
  BLOCK_PALETTE,
  newBlock,
  renderEmailBlocks,
  type EmailBlock,
  type EmailBlockType,
} from "@/lib/email-blocks";

/**
 * The drag-and-drop email composer.
 *
 * NATIVE HTML5 DRAG EVENTS, NOT A LIBRARY. dnd-kit or react-beautiful-dnd
 * would each add a dependency and a bundle for one screen that reorders a
 * handful of rows. The native API is enough for a vertical list — and the one
 * thing it is genuinely bad at, touch, is handled by the up/down buttons on
 * every block. That is not a consolation prize: reordering by dragging is
 * unusable one-handed on a phone anyway, and half this school's admin work
 * happens on one.
 *
 * THE PREVIEW IS THE REAL THING. It renders with `renderEmailBlocks` — the
 * exact function the server sends with — into an iframe via srcDoc. Not a CSS
 * approximation of an email: the actual bytes, in a document of their own so
 * the email's table layout and the admin portal's stylesheet cannot reach into
 * one another.
 */

type Props = {
  blocks: EmailBlock[];
  onChange: (blocks: EmailBlock[]) => void;
  subject: string;
  senderName: string;
  footer: string;
};

export default function EmailBlockEditor({ blocks, onChange, subject, senderName, footer }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [device, setDevice] = useState<"phone" | "desktop">("phone");
  // The block being dragged. A ref rather than state: dragover fires many
  // times a second and re-rendering the whole list on each one makes the
  // drop target flicker and jump away from the cursor.
  const draggingId = useRef<string | null>(null);

  const update = (id: string, patch: Partial<EmailBlock>) =>
    onChange(blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as EmailBlock) : b)));

  const remove = (id: string) => {
    onChange(blocks.filter((b) => b.id !== id));
    if (selected === id) setSelected(null);
  };

  const add = (type: EmailBlockType) => {
    const block = newBlock(type);
    onChange([...blocks, block]);
    setSelected(block.id);
  };

  /** Move by index, for the buttons and for the drop handler alike. */
  const moveTo = (from: number, to: number) => {
    if (from === to || to < 0 || to >= blocks.length) return;
    const next = [...blocks];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  const onDrop = (targetId: string) => {
    const fromId = draggingId.current;
    draggingId.current = null;
    setDragOver(null);
    if (!fromId || fromId === targetId) return;
    moveTo(
      blocks.findIndex((b) => b.id === fromId),
      blocks.findIndex((b) => b.id === targetId),
    );
  };

  /**
   * Rendered with a sample name so merge fields are visible as VALUES rather
   * than as `{{name}}`. An admin checking their work should see what a student
   * sees, and "Hallo {{name}}," in a preview is how a send goes out with the
   * placeholder still in it.
   */
  const previewHtml = useMemo(
    () =>
      renderEmailBlocks({
        blocks,
        subject: subject || "(no subject yet)",
        senderName,
        footer,
        greetingName: "Chidinma",
        baseUrl: typeof window !== "undefined" ? window.location.origin : undefined,
      })
        .replace(/\{\{\s*name\s*\}\}/g, "Chidinma")
        .replace(/\{\{\s*level\s*\}\}/g, "A2"),
    [blocks, subject, senderName, footer],
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
      <div className="min-w-0">
        {/* The palette. Click to append — dragging FROM here into a specific
            slot is a nicety that costs a second drag model, and every block is
            movable the moment it exists. */}
        <div className="flex flex-wrap gap-2">
          {BLOCK_PALETTE.map((item) => (
            <button
              key={item.type}
              type="button"
              onClick={() => add(item.type)}
              title={item.hint}
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 py-1.5 text-xs font-semibold text-[var(--foreground-soft)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              + {item.label}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-2">
          {blocks.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted)]">
              Empty. Add a block above, or let the assistant draft the whole thing.
            </p>
          ) : null}

          {blocks.map((block, index) => {
            const isSelected = selected === block.id;
            return (
              <div
                key={block.id}
                draggable
                onDragStart={() => { draggingId.current = block.id; }}
                onDragEnd={() => { draggingId.current = null; setDragOver(null); }}
                // preventDefault is what makes an element a valid drop target.
                // Without it the browser refuses the drop and nothing moves.
                onDragOver={(e) => { e.preventDefault(); setDragOver(block.id); }}
                onDragLeave={() => setDragOver((current) => (current === block.id ? null : current))}
                onDrop={() => onDrop(block.id)}
                onClick={() => setSelected(block.id)}
                className={`rounded-2xl border bg-[var(--surface)] p-3 transition ${
                  dragOver === block.id
                    ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/30"
                    : isSelected
                      ? "border-[var(--accent)]"
                      : "border-[var(--border)]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="cursor-grab select-none text-[var(--muted)]" title="Drag to reorder">⠿</span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    {BLOCK_PALETTE.find((p) => p.type === block.type)?.label ?? block.type}
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    {/* The touch path. Dragging is fine with a mouse and
                        hopeless with a thumb. */}
                    <button type="button" aria-label="Move up" disabled={index === 0}
                      onClick={(e) => { e.stopPropagation(); moveTo(index, index - 1); }}
                      className="rounded-lg px-2 py-1 text-xs text-[var(--muted)] transition hover:bg-[var(--surface-alt)] disabled:opacity-30">↑</button>
                    <button type="button" aria-label="Move down" disabled={index === blocks.length - 1}
                      onClick={(e) => { e.stopPropagation(); moveTo(index, index + 1); }}
                      className="rounded-lg px-2 py-1 text-xs text-[var(--muted)] transition hover:bg-[var(--surface-alt)] disabled:opacity-30">↓</button>
                    <button type="button" aria-label="Delete block"
                      onClick={(e) => { e.stopPropagation(); remove(block.id); }}
                      className="rounded-lg px-2 py-1 text-xs text-rose-600 transition hover:bg-rose-50">✕</button>
                  </div>
                </div>

                <div className="mt-2">
                  <BlockFields block={block} onPatch={(patch) => update(block.id, patch)} />
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-3 text-xs text-[var(--muted)]">
          Use <code className="rounded bg-[var(--surface-alt)] px-1">{"{{name}}"}</code> and{" "}
          <code className="rounded bg-[var(--surface-alt)] px-1">{"{{level}}"}</code> anywhere — each person gets their own.
        </p>
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Preview</p>
          <div className="ml-auto flex gap-1">
            {(["phone", "desktop"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDevice(option)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  device === option ? "bg-[var(--accent)] text-white" : "text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {option === "phone" ? "Phone" : "Desktop"}
              </button>
            ))}
          </div>
        </div>

        {/*
          sandbox="" with no allow-scripts: the preview must never execute
          anything. It is also what stops a pasted image URL or link from
          navigating the admin portal out from under whoever is composing.
        */}
        <div className="mt-2 overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
          <iframe
            title="Email preview"
            sandbox=""
            srcDoc={previewHtml}
            className="block h-[560px] border-0 bg-white"
            style={{ width: device === "phone" ? 390 : 720, maxWidth: "100%" }}
          />
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">
          This is the real message, rendered by the same code that sends it — not an impression of it.
        </p>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent)]";

/** The fields for one block. Split out to keep the list above readable. */
function BlockFields({ block, onPatch }: { block: EmailBlock; onPatch: (patch: Partial<EmailBlock>) => void }) {
  switch (block.type) {
    case "heading":
    case "callout":
      return (
        <input
          value={block.text}
          onChange={(e) => onPatch({ text: e.target.value } as Partial<EmailBlock>)}
          className={inputClass}
        />
      );

    case "text":
      return (
        <textarea
          value={block.text}
          onChange={(e) => onPatch({ text: e.target.value } as Partial<EmailBlock>)}
          rows={4}
          className={`${inputClass} resize-y`}
        />
      );

    case "button":
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={block.label}
            onChange={(e) => onPatch({ label: e.target.value } as Partial<EmailBlock>)}
            placeholder="Button text"
            className={inputClass}
          />
          <input
            value={block.href}
            onChange={(e) => onPatch({ href: e.target.value } as Partial<EmailBlock>)}
            placeholder="/dashboard or https://…"
            className={inputClass}
          />
        </div>
      );

    case "image":
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={block.src}
            onChange={(e) => onPatch({ src: e.target.value } as Partial<EmailBlock>)}
            placeholder="Image URL"
            className={inputClass}
          />
          <input
            value={block.alt}
            onChange={(e) => onPatch({ alt: e.target.value } as Partial<EmailBlock>)}
            // Not optional politeness: most clients block images by default,
            // so for many readers the alt text IS the image.
            placeholder="Describe it — shown when images are blocked"
            className={inputClass}
          />
        </div>
      );

    case "divider":
      return <p className="text-xs text-[var(--muted)]">A horizontal line. Nothing to configure.</p>;
  }
}
