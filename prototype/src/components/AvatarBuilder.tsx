"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";

import Avatar from "@/components/Avatar";
import { CheckIcon, CrossIcon, ShuffleIcon } from "@/components/icons";
import {
  BACKGROUNDS,
  BROW_STYLES,
  EXTRAS,
  EYE_STYLES,
  HAIR_COLORS,
  HAIR_STYLES,
  MOUTH_STYLES,
  SKIN_TONES,
  TOP_COLORS,
  TOP_STYLES,
  avatarOrDefault,
  randomAvatar,
  type AvatarConfig,
} from "@/lib/avatar";

/**
 * The avatar maker — a bottom sheet on a phone, a centred card on a laptop.
 *
 * Every option is shown as a tiny avatar wearing it, rather than a name in a
 * list: "afro" and "twists" are not words anybody picks by, a face is. The big
 * preview at the top updates on every tap, and nothing is saved until the
 * student presses Save, so wandering around the options costs nothing.
 */

type TabKey = "skin" | "hair" | "face" | "style" | "extras" | "backdrop";

const TABS: { key: TabKey; label: string }[] = [
  { key: "skin", label: "Skin" },
  { key: "hair", label: "Hair" },
  { key: "face", label: "Face" },
  { key: "style", label: "Outfit" },
  { key: "extras", label: "Extras" },
  { key: "backdrop", label: "Colour" },
];

function Swatches({
  label,
  colors,
  value,
  onPick,
}: {
  label: string;
  colors: readonly string[];
  value: number;
  onPick: (index: number) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">{label}</p>
      <div className="flex flex-wrap gap-2.5">
        {colors.map((color, index) => (
          <button
            key={color}
            type="button"
            onClick={() => onPick(index)}
            aria-label={`${label} ${index + 1}`}
            aria-pressed={value === index}
            className={`grid h-10 w-10 place-items-center rounded-full border-2 transition active:scale-90 ${
              value === index ? "border-[var(--foreground)]" : "border-[var(--border-strong)]"
            }`}
            style={{ background: color }}
          >
            {value === index && (
              <CheckIcon className="h-4 w-4 text-white mix-blend-difference" strokeWidth={3} />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function Options<K extends string>({
  label,
  keys,
  value,
  make,
  onPick,
}: {
  label: string;
  keys: readonly K[];
  value: K;
  make: (key: K) => AvatarConfig;
  onPick: (key: K) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">{label}</p>
      <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-5">
        {keys.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onPick(key)}
            aria-label={`${label}: ${key}`}
            aria-pressed={value === key}
            className={`rounded-2xl border-2 p-1 transition active:scale-95 ${
              value === key ? "border-[var(--accent-strong)] bg-[var(--accent-strong)]/10" : "border-transparent"
            }`}
          >
            <Avatar config={make(key)} size="full" shape="squircle" />
          </button>
        ))}
      </div>
    </div>
  );
}

export default function AvatarBuilder({
  initial,
  seed,
  onSave,
  onClose,
}: {
  /** What they have now; null on the very first time, which starts from their default face. */
  initial: unknown;
  seed: string;
  onSave: (avatar: AvatarConfig) => Promise<unknown>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AvatarConfig>(() => avatarOrDefault(initial, seed));
  const [tab, setTab] = useState<TabKey>("hair");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // A sheet over the page must not let the page behind it scroll, and
  // Escape is how a keyboard user leaves.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const set = <K extends keyof AvatarConfig>(key: K, value: AvatarConfig[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  async function save() {
    setSaving(true);
    setError("");
    try {
      await onSave(draft);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your avatar. Try again.");
      setSaving(false);
    }
  }

  const panels: Record<TabKey, ReactNode> = {
    skin: <Swatches label="Skin tone" colors={SKIN_TONES} value={draft.skin} onPick={(i) => set("skin", i)} />,
    hair: (
      <div className="space-y-5">
        <Options label="Hairstyle" keys={HAIR_STYLES} value={draft.hair} make={(hair) => ({ ...draft, hair })} onPick={(k) => set("hair", k)} />
        <Swatches label={draft.hair === "headwrap" || draft.hair === "cap" ? "Colour" : "Hair colour"} colors={HAIR_COLORS} value={draft.hairColor} onPick={(i) => set("hairColor", i)} />
      </div>
    ),
    face: (
      <div className="space-y-5">
        <Options label="Eyes" keys={EYE_STYLES} value={draft.eyes} make={(eyes) => ({ ...draft, eyes })} onPick={(k) => set("eyes", k)} />
        <Options label="Eyebrows" keys={BROW_STYLES} value={draft.brows} make={(brows) => ({ ...draft, brows })} onPick={(k) => set("brows", k)} />
        <Options label="Mouth" keys={MOUTH_STYLES} value={draft.mouth} make={(mouth) => ({ ...draft, mouth })} onPick={(k) => set("mouth", k)} />
      </div>
    ),
    style: (
      <div className="space-y-5">
        <Options label="Top" keys={TOP_STYLES} value={draft.top} make={(top) => ({ ...draft, top })} onPick={(k) => set("top", k)} />
        <Swatches label="Top colour" colors={TOP_COLORS} value={draft.topColor} onPick={(i) => set("topColor", i)} />
      </div>
    ),
    extras: <Options label="Extras" keys={EXTRAS} value={draft.extra} make={(extra) => ({ ...draft, extra })} onPick={(k) => set("extra", k)} />,
    backdrop: <Swatches label="Backdrop" colors={BACKGROUNDS} value={draft.bg} onPick={(i) => set("bg", i)} />,
  };

  return (
    <AnimatePresence>
      <motion.div
        key="avatar-builder"
        className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Make your avatar"
          onClick={(event) => event.stopPropagation()}
          initial={{ y: 60, opacity: 0.6 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 340, damping: 32 }}
          className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[2rem] border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] shadow-2xl sm:rounded-[2rem]"
        >
          <div className="flex items-center justify-between px-5 pt-4">
            <h2 className="text-lg font-extrabold">Make your avatar</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-9 w-9 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--surface-alt)]"
            >
              <CrossIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="flex items-center justify-center gap-4 px-5 py-4">
            <Avatar config={draft} seed={seed} size={132} />
            <button
              type="button"
              onClick={() => setDraft(randomAvatar())}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border-strong)] px-4 py-2.5 text-sm font-bold text-[var(--foreground-soft)] transition active:scale-95"
            >
              <ShuffleIcon className="h-4 w-4" /> Surprise me
            </button>
          </div>

          <div role="tablist" aria-label="What to change" className="flex gap-1.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TABS.map((item) => (
              <button
                key={item.key}
                role="tab"
                type="button"
                aria-selected={tab === item.key}
                onClick={() => setTab(item.key)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold transition ${
                  tab === item.key
                    ? "bg-[var(--accent-strong)] text-white"
                    : "bg-[var(--surface-alt)] text-[var(--foreground-soft)]"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {panels[tab]}
          </div>

          <div className="border-t border-[var(--border)] px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            {error && <p className="mb-2 text-sm text-[var(--danger)]">{error}</p>}
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="w-full rounded-full bg-[var(--accent)] py-3.5 text-base font-extrabold text-white transition active:scale-[0.98] disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save avatar"}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
