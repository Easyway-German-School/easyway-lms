"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * "Hide the balance", the way a banking app does it.
 *
 * The admin dashboard is often open on a screen at a front desk with students,
 * parents and walk-ins on the other side of it. One tap blanks every figure on
 * the page — enrolment counts, fees collected, what is owed — to a row of dots,
 * and it stays blanked across reloads and navigation until it is tapped off.
 *
 * This is a shoulder-surfing shield, not a permission. The numbers are still in
 * the page and still in the network response; what changes is only what is
 * painted. Anyone who should not see this data at all is kept out by the admin
 * role gate, not by this.
 *
 * State lives in localStorage so it survives a reload, and a same-tab event
 * keeps every mounted copy of the hook — the toggle button, each masked figure
 * — agreeing with each other the instant it flips.
 */

const KEY = "easyway:hide-figures";
const EVENT = "easyway:hide-figures-changed";

function read(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    // Private mode, blocked storage — default to showing the figures.
    return false;
  }
}

export function usePrivacyMode(): { hidden: boolean; toggle: () => void; setHidden: (value: boolean) => void } {
  // Starts false on both server and first client render so hydration matches;
  // the effect below catches up to the stored value before the dashboard's
  // own data has finished loading, so in practice nothing flashes.
  const [hidden, setHiddenState] = useState(false);

  useEffect(() => {
    setHiddenState(read());

    const sync = () => setHiddenState(read());
    // `storage` fires in OTHER tabs; the custom event covers THIS one.
    window.addEventListener("storage", sync);
    window.addEventListener(EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(EVENT, sync);
    };
  }, []);

  const setHidden = useCallback((value: boolean) => {
    try {
      window.localStorage.setItem(KEY, value ? "1" : "0");
    } catch {
      /* Nothing persisted, but the in-memory flip below still works for this view. */
    }
    setHiddenState(value);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  const toggle = useCallback(() => setHidden(!read()), [setHidden]);

  return { hidden, toggle, setHidden };
}
