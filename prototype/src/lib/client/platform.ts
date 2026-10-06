/**
 * What device and browser is this, as far as installing and alerts go?
 *
 * Pure functions over a user-agent string so the tricky cases (Chrome on iPhone,
 * WhatsApp's in-app browser, iPadOS posing as a Mac) are unit-tested rather
 * than guessed. `InstallPrompt` used to inline a weaker version of this that
 * only recognised Safari — which silently hid the install card from every
 * iPhone running Chrome, Firefox or Edge, and from anyone who opened the link
 * inside WhatsApp or Facebook.
 *
 * THE iPHONE RULES THAT SHAPE EVERYTHING BELOW:
 *   1. No browser on iOS fires `beforeinstallprompt`. Installing is always the
 *      manual Share → "Add to Home Screen" route — instructions, never a button
 *      that installs.
 *   2. Web Push on iOS exists ONLY for a site opened from the Home Screen icon
 *      (iOS/iPadOS 16.4+). In a normal browser tab `PushManager` is simply not
 *      defined. So "install first" is not a nicety on an iPhone, it is the only
 *      route to alerts.
 *   3. Since 16.4, Chrome, Edge and Firefox on iOS can also Add to Home Screen —
 *      they are all WebKit underneath. Only in-app browsers (WhatsApp, Instagram,
 *      Facebook...) cannot.
 */

export type BrowserKind = "safari" | "chrome" | "firefox" | "edge" | "inapp" | "other";

export type InstallEnv = {
  ios: boolean;
  android: boolean;
  browser: BrowserKind;
  /** iOS older than 16.4 has no Web Push at all — installing will not help. */
  iosTooOldForPush: boolean;
};

/** Apps that embed a web view and offer no "Add to Home Screen". */
const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|Line\/|TikTok|musical_ly|Snapchat|Twitter|LinkedInApp|MicroMessenger|GSA\/|Telegram/i;

export function detectInstallEnv(ua: string, maxTouchPoints = 0): InstallEnv {
  // iPadOS 13+ reports a desktop Mac; the touch points give it away.
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  const android = /Android/i.test(ua);

  let browser: BrowserKind = "other";
  if (ios) {
    if (IN_APP.test(ua)) browser = "inapp";
    else if (/CriOS/.test(ua)) browser = "chrome";
    else if (/FxiOS/.test(ua)) browser = "firefox";
    else if (/EdgiOS/.test(ua)) browser = "edge";
    // A real Safari UA ends in "Safari/60x". A WKWebView embedded in someone's
    // app (WhatsApp, Gmail, Notion...) omits that token — and cannot install.
    else if (/Safari\//.test(ua)) browser = "safari";
    else browser = "inapp";
  } else if (android) {
    if (IN_APP.test(ua) || /; wv\)/.test(ua)) browser = "inapp";
    else if (/EdgA/.test(ua)) browser = "edge";
    else if (/Firefox/.test(ua)) browser = "firefox";
    else if (/Chrome|CriOS/.test(ua)) browser = "chrome";
  }

  // iPadOS in desktop mode does not report a version; treat "unknown" as new
  // enough — telling someone on a current iPad to update would be the worse error.
  const version = ios ? /OS (\d+)[_.](\d+)/.exec(ua) : null;
  const iosTooOldForPush = version
    ? Number(version[1]) < 16 || (Number(version[1]) === 16 && Number(version[2]) < 4)
    : false;

  return { ios, android, browser, iosTooOldForPush };
}

/** Browser-side convenience. Safe during SSR (returns a neutral "not iOS" answer). */
export function currentInstallEnv(): InstallEnv {
  if (typeof navigator === "undefined") return detectInstallEnv("");
  return detectInstallEnv(navigator.userAgent, navigator.maxTouchPoints);
}
