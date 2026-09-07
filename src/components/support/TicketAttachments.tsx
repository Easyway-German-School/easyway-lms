"use client";

/**
 * SCREENSHOTS ON THE HELP DESK.
 *
 * Half of "this isn't working" is a picture of what isn't working, and until
 * now the only place a student could put one was WhatsApp — the exact channel
 * the whole help desk exists to replace. Both sides get the same two pieces
 * here: `AttachmentPicker` for composing (student asking, office answering) and
 * `MessageAttachments` for a message that has already been sent.
 *
 * Images only, and they ride the same road as every other upload in the app —
 * lib/upload.ts straight to the bucket, HEIC converted on the way — so by the
 * time `onChange` fires the bytes already exist at a private `/api/files` URL
 * and only the metadata travels with the message. The server sanitises the
 * list again on the way in (see lib/support.ts), so nothing here is a trust
 * boundary; it just needs to not waste the office's time with a broken row.
 */

import { useRef, useState } from "react";
import { CrossCircleIcon, ImageIcon } from "@/components/icons";
import { uploadErrorMessage, uploadFile, validateImageFile } from "@/lib/upload";
import { MAX_ATTACHMENTS, type TicketAttachment } from "@/lib/support-copy";

export function AttachmentPicker({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: TicketAttachment[];
  onChange: (next: TicketAttachment[]) => void;
  disabled?: boolean;
  /** A single icon button rather than a labelled one — for the reply row. */
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const room = MAX_ATTACHMENTS - value.length;

  async function onFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    const files = Array.from(fileList).slice(0, Math.max(0, room));
    if (files.length === 0) {
      setError(`Up to ${MAX_ATTACHMENTS} images.`);
      return;
    }
    setBusy(true);
    try {
      const added: TicketAttachment[] = [];
      for (const file of files) {
        const bad = validateImageFile(file);
        if (bad) {
          setError(bad);
          continue;
        }
        try {
          const uploaded = await uploadFile(file, "files");
          added.push({
            url: uploaded.url,
            contentType: uploaded.contentType || file.type || "image/jpeg",
            name: uploaded.filename || file.name,
            size: uploaded.size || file.size,
          });
        } catch (uploadError) {
          setError(uploadErrorMessage(uploadError, "That image would not upload."));
        }
      }
      if (added.length) onChange([...value, ...added]);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className={compact ? "" : "space-y-2"}>
      {value.length > 0 ? (
        <div className={`flex flex-wrap gap-2 ${compact ? "mb-2" : ""}`}>
          {value.map((att, index) => (
            <div key={`${att.url}-${index}`} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={att.url}
                alt={att.name}
                className="h-16 w-16 rounded-lg border border-[var(--border)] object-cover"
              />
              <button
                type="button"
                onClick={() => onChange(value.filter((_, i) => i !== index))}
                aria-label={`Remove ${att.name}`}
                className="absolute -right-1.5 -top-1.5 rounded-full bg-[var(--surface)] text-[var(--muted)] shadow-[var(--shadow)] transition hover:text-rose-500"
              >
                <CrossCircleIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {error ? <p className="mb-1 text-[11px] font-medium text-rose-500">{error}</p> : null}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => onFiles(event.target.files)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || busy || room <= 0}
        aria-label="Attach an image"
        title={room <= 0 ? `Up to ${MAX_ATTACHMENTS} images` : "Attach a screenshot or photo"}
        className={
          compact
            ? "shrink-0 rounded-xl border border-[var(--border)] p-2.5 text-[var(--muted)] transition hover:bg-[var(--surface-alt)] hover:text-[var(--accent)] disabled:opacity-40"
            : "inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--foreground-soft)] transition hover:bg-[var(--surface-alt)] disabled:opacity-40"
        }
      >
        <ImageIcon className={compact ? "h-4 w-4" : "h-3.5 w-3.5"} />
        {compact ? null : busy ? "Adding…" : room <= 0 ? "Max images" : "Attach image"}
      </button>
    </div>
  );
}

/** The images on a message that has already been sent. */
export function MessageAttachments({
  attachments,
  align = "start",
}: {
  attachments: TicketAttachment[] | undefined | null;
  align?: "start" | "end";
}) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div
      className={`mt-1.5 flex flex-wrap gap-1.5 ${align === "end" ? "justify-end" : "justify-start"}`}
    >
      {attachments.map((att, index) => (
        <a
          key={`${att.url}-${index}`}
          href={att.url}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-alt)]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={att.url}
            alt={att.name}
            loading="lazy"
            className="max-h-52 w-auto max-w-[13rem] object-cover"
          />
        </a>
      ))}
    </div>
  );
}
