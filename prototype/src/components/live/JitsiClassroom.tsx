"use client";

import { useEffect, useRef, useState } from "react";

type JitsiClassroomProps = {
  roomName: string;
  displayName: string;
  participantName: string;
  /** Start with video off entirely — the right default on a weak connection. */
  audioFirst?: boolean;
  onLeave: () => void;
};

declare global {
  interface Window {
    JitsiMeetExternalAPI?: new (domain: string, options: Record<string, unknown>) => {
      dispose: () => void;
      addEventListener: (event: string, handler: (...args: unknown[]) => void) => void;
      executeCommand: (command: string, ...args: unknown[]) => void;
    };
  }
}

const JITSI_DOMAIN = "meet.jit.si";

/**
 * The fallback classroom, used until LIVEKIT_URL / LIVEKIT_API_KEY /
 * LIVEKIT_API_SECRET are set.
 *
 * This is the provider the school was already on. It is kept — rather than
 * showing an error page — so an unconfigured deployment can still hold a class.
 * The config below is not the old default: it is tuned hard for the networks
 * our students actually have, because meet.jit.si's stock settings assume an
 * office connection.
 */
export default function JitsiClassroom({
  roomName,
  displayName,
  participantName,
  audioFirst = false,
  onLeave,
}: JitsiClassroomProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let disposed = false;
    let api: InstanceType<NonNullable<typeof window.JitsiMeetExternalAPI>> | null = null;

    function start() {
      if (disposed || !containerRef.current || !window.JitsiMeetExternalAPI) return;

      api = new window.JitsiMeetExternalAPI(JITSI_DOMAIN, {
        roomName,
        parentNode: containerRef.current,
        width: "100%",
        height: 560,
        userInfo: { displayName: participantName },
        configOverwrite: {
          subject: displayName,
          // Cameras start off. On a class of thirty, everyone's camera coming
          // up at once is the single biggest cause of the first-minute freeze.
          startWithVideoMuted: true,
          startAudioOnly: audioFirst,
          // Receive at most four video streams regardless of class size. The
          // rest stay audio, which is what a language class needs anyway.
          channelLastN: 4,
          // Stop sending high layers nobody is watching — the Jitsi equivalent
          // of dynacast, and the closest this provider gets to it.
          enableLayerSuspension: true,
          disableSimulcast: false,
          resolution: 360,
          constraints: { video: { height: { ideal: 360, max: 360, min: 180 } } },
          enableWelcomePage: false,
          prejoinPageEnabled: false,
          disableDeepLinking: true,
        },
        interfaceConfigOverwrite: {
          TOOLBAR_BUTTONS: [
            "microphone", "camera", "desktop", "fullscreen", "hangup", "chat",
            "raisehand", "videoquality", "tileview", "settings",
          ],
          SHOW_WATERMARK: false,
          SHOW_JITSI_WATERMARK: false,
          MOBILE_APP_PROMO: false,
        },
      });

      api.addEventListener("videoConferenceLeft", onLeave);
      api.addEventListener("readyToClose", onLeave);
      setStatus("ready");
    }

    if (window.JitsiMeetExternalAPI) {
      start();
    } else {
      const script = document.createElement("script");
      script.src = `https://${JITSI_DOMAIN}/external_api.js`;
      script.async = true;
      script.onload = start;
      script.onerror = () => setStatus("failed");
      document.body.appendChild(script);
    }

    return () => {
      disposed = true;
      // The old page emptied innerHTML instead of disposing, which left the
      // conference running — and the microphone live — after leaving.
      api?.dispose();
    };
  }, [roomName, displayName, participantName, audioFirst, onLeave]);

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-5 py-3 text-xs leading-5 text-amber-900">
        <span className="font-semibold">Running on the backup provider.</span> Set <code>LIVEKIT_URL</code>,{" "}
        <code>LIVEKIT_API_KEY</code> and <code>LIVEKIT_API_SECRET</code> to switch this cohort onto the low-latency classroom —
        no other change is needed.
      </div>

      {status === "failed" ? (
        <div className="rounded-2xl border border-rose-300 bg-rose-50 p-6 text-sm text-rose-800">
          <p className="font-semibold">The video service could not be reached</p>
          <p className="mt-2">Check your connection and reload the page.</p>
        </div>
      ) : null}

      <div ref={containerRef} className="overflow-hidden rounded-3xl bg-slate-900" />
    </div>
  );
}
