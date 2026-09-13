/**
 * Every HTML email in this app interpolates candidate-supplied text
 * (a name, a support message) directly into a template string — this is
 * what stops someone's booking name doubling as an HTML/script payload in
 * whatever renders that email. Shared here so every call site uses the same
 * one rather than each route inventing its own.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br/>");
}
