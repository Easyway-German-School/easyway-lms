"use client";

import { useCallback, useEffect, useRef } from "react";
import { TYPING_PING_EVERY_MS } from "@/lib/typing";

/**
 * The "I am typing" half of a typing indicator, for any composer.
 *
 * Call `onDraftChange(value)` from the input's change handler. While the draft
 * has text it tells the server at most once every TYPING_PING_EVERY_MS — the
 * value being sent is "somebody is composing", not a keystroke log, so a
 * throttle costs nothing and saves a request per letter. When the draft is
 * emptied, the conversation changes, or the component unmounts mid-sentence, it
 * says "stopped", so the other side's dots go out at once instead of ageing out
 * over seven seconds.
 *
 * Sending the message ends it on the server by itself (both send routes clear
 * the sender's ping), so `stop()` after a send mostly exists to reset the local
 * throttle for the next message.
 *
 * `conversationKey` names WHAT is being typed into (a channel id, a ticket id;
 * `null` when there is nothing to type into). `send(true|false)` does the
 * request — a parameter so this serves a community channel and a help-desk
 * ticket alike. Failures are ignored: a missed ping is dots a beat late.
 */
export function useTypingSender(
  conversationKey: string | null,
  send: (typing: boolean) => Promise<unknown>,
) {
  const sendRef = useRef(send);
  // Always call the latest `send` without making it a dependency. Declared
  // before the conversation effect below so it has already run when that one
  // captures `sendRef.current`.
  useEffect(() => {
    sendRef.current = send;
  });

  const lastStampRef = useRef(0);
  const activeRef = useRef(false);

  const fire = useCallback((typing: boolean) => {
    void Promise.resolve(sendRef.current(typing)).catch(() => {});
  }, []);

  const onDraftChange = useCallback(
    (value: string) => {
      if (!conversationKey) return;
      if (value.trim()) {
        const now = Date.now();
        if (now - lastStampRef.current < TYPING_PING_EVERY_MS) return;
        lastStampRef.current = now;
        activeRef.current = true;
        fire(true);
      } else if (activeRef.current) {
        activeRef.current = false;
        lastStampRef.current = 0;
        fire(false);
      }
    },
    [conversationKey, fire],
  );

  const stop = useCallback(() => {
    if (activeRef.current) fire(false);
    activeRef.current = false;
    lastStampRef.current = 0;
  }, [fire]);

  // Leaving the conversation — switching rooms, closing the panel, navigating
  // away — mid-sentence is "stopped typing". The cleanup uses the `send` that
  // belonged to THIS conversation, captured when the effect ran, so it cannot
  // clear the wrong room's ping after the key has already moved on.
  useEffect(() => {
    lastStampRef.current = 0;
    activeRef.current = false;
    const sendForThisConversation = sendRef.current;
    return () => {
      if (activeRef.current) void Promise.resolve(sendForThisConversation(false)).catch(() => {});
      activeRef.current = false;
    };
  }, [conversationKey]);

  return { onDraftChange, stop };
}
