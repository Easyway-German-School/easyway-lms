/**
 * Per-device chat personalization for the community room.
 *
 * Modelled on Instagram DMs more than WhatsApp: one named preset recolors the
 * wallpaper AND the outgoing bubble together, rather than two independent
 * pickers that can be combined into something illegible. Every wallpaper is
 * built from `color-mix()` against the CURRENT app theme's own
 * `--surface-alt`, not a literal light or dark hex — pick "Sunset" in Tag and
 * it is a warm tint on a light pane; pick it in Nacht and it is the same warm
 * tint on a dark one. That is what keeps this from becoming its own set of
 * "blending mistakes" on top of [[project-theme-system]].
 *
 * Bubble fills are fixed, saturated brand-adjacent colours (not derived from
 * the theme) for a simpler reason: the outgoing bubble always carries white
 * text, and a colour pulled from a theme variable could land light in Nacht
 * or Dämmerung and make that text illegible.
 */

export type ChatTheme = {
  id: string;
  label: string;
  /** Small round swatch shown in the picker. */
  swatch: string;
  /** Applied to the whole scrollable message pane, behind every bubble. */
  wallpaper: string;
  /** Applied to "my" outgoing bubbles only — incoming bubbles stay on --surface-alt. */
  bubble: string;
};

export const CHAT_THEMES: ChatTheme[] = [
  {
    id: "classic",
    label: "Classic",
    swatch: "var(--accent)",
    wallpaper: "var(--surface)",
    bubble: "var(--accent)",
  },
  {
    id: "sunset",
    label: "Sunset",
    swatch: "linear-gradient(135deg, #FF7A45, #E1306C)",
    wallpaper:
      "radial-gradient(circle at 12% 0%, color-mix(in srgb, #FF7A45 16%, var(--surface-alt)), var(--surface-alt) 62%)",
    bubble: "linear-gradient(135deg, #FF7A45, #E1306C)",
  },
  {
    id: "ocean",
    label: "Ocean",
    swatch: "linear-gradient(135deg, #0EA5E9, #6366F1)",
    wallpaper:
      "radial-gradient(circle at 88% 0%, color-mix(in srgb, #0EA5E9 16%, var(--surface-alt)), var(--surface-alt) 62%)",
    bubble: "linear-gradient(135deg, #0EA5E9, #6366F1)",
  },
  {
    id: "forest",
    label: "Forest",
    swatch: "linear-gradient(135deg, #16A34A, #0D9488)",
    wallpaper:
      "radial-gradient(circle at 12% 100%, color-mix(in srgb, #16A34A 16%, var(--surface-alt)), var(--surface-alt) 62%)",
    bubble: "linear-gradient(135deg, #16A34A, #0D9488)",
  },
  {
    id: "grape",
    label: "Grape",
    swatch: "linear-gradient(135deg, #9333EA, #DB2777)",
    wallpaper:
      "radial-gradient(circle at 88% 100%, color-mix(in srgb, #9333EA 16%, var(--surface-alt)), var(--surface-alt) 62%)",
    bubble: "linear-gradient(135deg, #9333EA, #DB2777)",
  },
  {
    id: "amber",
    label: "Amber",
    swatch: "linear-gradient(135deg, #D97706, #DC2626)",
    wallpaper:
      "radial-gradient(circle at 50% 0%, color-mix(in srgb, #D97706 16%, var(--surface-alt)), var(--surface-alt) 62%)",
    bubble: "linear-gradient(135deg, #D97706, #DC2626)",
  },
  {
    id: "dotted",
    label: "Dotted",
    swatch:
      "radial-gradient(circle, var(--accent) 30%, transparent 32%) 0 0 / 8px 8px, var(--accent-soft)",
    wallpaper:
      "radial-gradient(circle, color-mix(in srgb, var(--accent) 38%, transparent) 1.4px, transparent 1.6px) 0 0 / 20px 20px, var(--surface-alt)",
    bubble: "var(--accent)",
  },
];

export const DEFAULT_CHAT_THEME_ID = CHAT_THEMES[0].id;
export const CHAT_THEME_STORAGE_KEY = "easyway-chat-theme";

export function chatThemeById(id: string | null | undefined): ChatTheme {
  return CHAT_THEMES.find((theme) => theme.id === id) ?? CHAT_THEMES[0];
}
