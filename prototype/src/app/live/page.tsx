"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

export default function LiveRoom() {
  const jitsiContainerRef = useRef<HTMLDivElement>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [userName, setUserName] = useState("Student");

  function startSession() {
    if (!jitsiContainerRef.current) return;

    // Initialize Jitsi Meet
    const options = {
      roomName: "EasywayGermanClass",
      width: "100%",
      height: 600,
      parentNode: jitsiContainerRef.current,
      configOverwrite: {
        startAudioOnly: true,
        enableWelcomePage: false,
        disableAudioLevels: false,
      },
      interfaceConfigOverwrite: {
        TOOLBAR_BUTTONS: [
          'microphone', 'camera', 'closedcaptions', 'desktop', 'fullscreen',
          'fodeviceselection', 'hangup', 'profile', 'chat', 'recording',
          'livestream', 'etherpad', 'sharedvideo', 'settings', 'raisehand',
          'videoquality', 'filmstrip', 'invite', 'feedback', 'stats', 'shortcuts',
          'tileview', 'download', 'help', 'mute-everyone', 'e2ee'
        ],
        SHOW_WATERMARK: false,
      },
      userInfo: {
        displayName: userName,
      },
    };

    // Load Jitsi script
    const script = document.createElement("script");
    script.src = "https://meet.jit.si/external_api.js";
    script.async = true;
    script.onload = () => {
      // @ts-ignore
      const api = new window.JitsiMeetExternalAPI("meet.jit.si", options);
      setSessionActive(true);

      return () => {
        api?.dispose();
        setSessionActive(false);
      };
    };
    document.body.appendChild(script);
  }

  function endSession() {
    setSessionActive(false);
    if (jitsiContainerRef.current) {
      jitsiContainerRef.current.innerHTML = "";
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: "easeOut" }}
      className="min-h-screen bg-[var(--surface-alt)] py-10 text-[var(--foreground)]"
    >
      <div className="mx-auto max-w-6xl space-y-8 px-6 md:px-10">
        <header className="rounded-3xl bg-[var(--surface)] p-8 shadow-2xl ring-1 ring-white/10">
          <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">Live Classroom</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-[var(--foreground)]">Real-time German coaching with video</h1>
          <p className="mt-4 text-[var(--muted)]">
            Connect with instructors and peers for live German conversation practice and group lessons using Jitsi Meet.
          </p>
        </header>

        {!sessionActive ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-3xl bg-[var(--surface)] p-6 shadow-2xl transition-transform duration-300 hover:-translate-y-1 ring-1 ring-white/10">
              <h2 className="text-2xl font-semibold text-[var(--foreground)]">Join live session</h2>
              <p className="mt-4 text-[var(--muted)]">
                Connect with other students and instructors for real-time practice. Your camera and microphone will be enabled.
              </p>
              <div className="mt-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--foreground)]">Your name</label>
                  <input
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder="Enter your name"
                    className="mt-2 w-full rounded-lg border border-[rgba(148,163,184,0.25)] bg-[var(--surface-alt)] px-4 py-2 text-[var(--foreground)] placeholder-slate-400 focus:border-[var(--accent)] focus:outline-none"
                  />
                </div>
                <button
                  onClick={startSession}
                  className="w-full rounded-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-600"
                >
                  Start live session
                </button>
              </div>
              <div className="mt-6 space-y-3 rounded-3xl border border-dashed border-[rgba(148,163,184,0.25)] bg-[var(--surface-alt)] p-5 text-sm text-[var(--foreground)]">
                <p className="font-semibold text-[var(--foreground)]">What you can do:</p>
                <p>• Video and audio conversation with peers</p>
                <p>• Screen sharing for collaborative activities</p>
                <p>• Live chat during sessions</p>
                <p>• German roleplay scenarios with instructors</p>
              </div>
            </div>

            <div className="rounded-3xl bg-slate-950 p-6 text-slate-50 shadow-2xl ring-1 ring-white/10">
              <h2 className="text-2xl font-semibold">Session details</h2>
              <p className="mt-4 text-slate-300">
                Your live classroom sessions are powered by Jitsi Meet, an open-source video conferencing platform.
              </p>
              <div className="mt-6 rounded-3xl bg-slate-900 p-5">
                <div className="space-y-4">
                  <div className="rounded-lg bg-slate-800 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Current session</p>
                    <p className="mt-2 text-sm font-semibold text-emerald-400">EasywayGermanClass</p>
                  </div>
                  <div className="rounded-lg bg-slate-800 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Technology</p>
                    <p className="mt-2 text-sm text-slate-200">Jitsi Meet (WebRTC) - P2P encrypted</p>
                  </div>
                  <div className="rounded-lg bg-slate-800 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Features</p>
                    <p className="mt-2 text-sm text-slate-300">Video • Audio • Screen Share • Chat • Recording</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-3xl bg-[var(--surface)] p-6 shadow-sm ring-1 ring-white/10">
            <div ref={jitsiContainerRef} className="rounded-2xl overflow-hidden bg-[var(--surface)]" />
            <button
              onClick={endSession}
              className="mt-6 rounded-full bg-red-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-red-600"
            >
              End session
            </button>
          </div>
        )}

        <div className="rounded-3xl bg-[var(--surface)] p-6 shadow-sm ring-1 ring-white/10">
          <Link href="/" className="inline-flex rounded-full bg-[var(--foreground)] px-5 py-3 text-sm font-semibold text-[var(--surface)] transition hover:brightness-110">
            Back to dashboard
          </Link>
        </div>
      </div>
    </motion.div>
  );
}
