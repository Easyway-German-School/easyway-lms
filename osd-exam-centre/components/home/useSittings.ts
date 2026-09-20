"use client";

import { useEffect, useState } from "react";

export type Sitting = {
  id: string;
  level: string;
  title: string;
  venueName: string;
  venueAddress: string;
  startDate: string;
  endDate: string;
  registrationDeadline: string;
  feeWholeExam: number;
  remaining: number;
  capacity: number;
};

export type SittingsState = { status: "loading" } | { status: "ready"; sittings: Sitting[] } | { status: "error" };

// The hero card and the departures board both need this — share one request
// per page load instead of fetching twice.
let inflight: Promise<Sitting[]> | null = null;

function load(): Promise<Sitting[]> {
  inflight ??= fetch("/api/sessions")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad response"))))
    .then((d) => (d.sessions ?? []) as Sitting[])
    .catch((e) => {
      inflight = null;
      throw e;
    });
  return inflight;
}

export function useSittings(): SittingsState {
  const [state, setState] = useState<SittingsState>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    load()
      .then((sittings) => alive && setState({ status: "ready", sittings }))
      .catch(() => alive && setState({ status: "error" }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** OPEN / FILLING / FULL — the wording an airport departures board would use. */
export function seatStatus(s: Pick<Sitting, "remaining" | "capacity">): { label: string; tone: "open" | "filling" | "full" } {
  if (s.remaining <= 0) return { label: "Full", tone: "full" };
  if (s.remaining / s.capacity <= 0.2) return { label: "Filling fast", tone: "filling" };
  return { label: "Boarding", tone: "open" };
}
