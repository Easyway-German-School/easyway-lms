/**
 * One doorway into "install the app".
 *
 * The install card is dismissible, and a dismissed card used to be gone for
 * good — a student who tapped × once, or simply didn't see it, had no other
 * way to install anywhere in the portal. Any button that wants to offer the
 * install (the profile page, the notification panel, the community launcher)
 * fires this event instead of importing the prompt's internals; `InstallPrompt`
 * is the single listener, so it decides whether the browser can install with
 * one tap (Android/desktop Chrome) or needs the step-by-step guide (every
 * iPhone).
 */
export const INSTALL_EVENT = "easyway:install";

export function requestInstall(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(INSTALL_EVENT));
}
