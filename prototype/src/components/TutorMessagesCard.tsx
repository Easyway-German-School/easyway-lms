"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SendIcon } from "@/components/icons";

/**
 * The private-tier student's direct line to their tutor. Deliberately its
 * own thread rather than routed through Community — a coaching pair isn't a
 * room, and this is meant to feel like texting the person you hired, not
 * posting in a channel.
 *
 * Polls rather than sockets, same tradeoff as useLiveClass: cheap, and a
 * message arriving twenty seconds late in a DM (not a live call) costs
 * nothing.
 */

type Message = { id: string; body: string; isMine: boolean; createdAt: string };

const POLL_MS = 20_000;

export default function TutorMessagesCard({ tutorName }: { tutorName?: string | null }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [available, setAvailable] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/student/tutor-messages", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setAvailable(Boolean(data.available));
      setMessages(data.messages ?? []);
    } catch {
      // A missed poll leaves the last known thread alone.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft("");
    try {
      const res = await fetch("/api/student/tutor-messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev, data.message]);
      } else {
        setDraft(text);
      }
    } catch {
      setDraft(text);
    } finally {
      setSending(false);
    }
  }

  if (loaded && !available) return null;

  return (
    <div className="relative overflow-hidden rounded-[32px] border border-[#D4AF37]/25 bg-[radial-gradient(circle_at_15%_0%,_#1c1917_0%,_#0b0a09_60%,_#000000_100%)] p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#E8C766]">Message {tutorName || "your tutor"}</p>

      <div ref={listRef} className="relative mt-4 max-h-64 space-y-3 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-white/40">
            Say hello — this goes straight to {tutorName || "your tutor"}, nowhere else.
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.isMine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm leading-5 ${
                  m.isMine ? "bg-gradient-to-r from-[#D4AF37] to-[#E8C766] text-[#1c1508]" : "border border-white/10 bg-white/[0.04] text-white/80"
                }`}
              >
                {m.body}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="relative mt-4 flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Type a message…"
          className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-[#D4AF37]/50 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={!draft.trim() || sending}
          className="grid h-10 w-10 flex-none place-items-center rounded-full bg-gradient-to-r from-[#D4AF37] to-[#E8C766] text-[#1c1508] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Send"
        >
          <SendIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
