"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { ArrowRightIcon } from "@/components/icons";

const LENGTH = 6;

/**
 * Six boxes, not a text field.
 *
 * A student typing a code their tutor just read out is doing two things at once
 * — remembering and typing — and a single input gives them no help with either.
 * Separate cells show progress, make a mistyped character obvious at a glance,
 * and let a paste from WhatsApp fill the whole thing at once.
 *
 * Everything is uppercased and stripped as it is typed, because the code
 * alphabet has no lowercase and no punctuation, and silently fixing what
 * somebody meant beats telling them they got it wrong.
 */
export default function JoinByCode() {
  const router = useRouter();
  const [chars, setChars] = useState<string[]>(() => Array(LENGTH).fill(""));
  const [busy, setBusy] = useState(false);
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  const code = chars.join("");
  const complete = code.length === LENGTH;

  const submit = useCallback(
    (value: string) => {
      if (value.length !== LENGTH) return;
      setBusy(true);
      router.push(`/live?code=${value}`);
    },
    [router],
  );

  const setAt = useCallback(
    (index: number, raw: string) => {
      const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!clean) {
        setChars((current) => {
          const next = [...current];
          next[index] = "";
          return next;
        });
        return;
      }

      // A paste, or a phone keyboard delivering several characters at once,
      // fills forward from here rather than dropping everything but the first.
      setChars((current) => {
        const next = [...current];
        for (let i = 0; i < clean.length && index + i < LENGTH; i += 1) {
          next[index + i] = clean[i];
        }
        const landed = Math.min(index + clean.length, LENGTH - 1);
        refs.current[landed]?.focus();
        if (next.join("").length === LENGTH) submit(next.join(""));
        return next;
      });
    },
    [submit],
  );

  const onKeyDown = useCallback(
    (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
      // Backspace on an empty cell steps back and clears the previous one,
      // which is what every OTP field people have used already does.
      if (event.key === "Backspace" && !chars[index] && index > 0) {
        event.preventDefault();
        setChars((current) => {
          const next = [...current];
          next[index - 1] = "";
          return next;
        });
        refs.current[index - 1]?.focus();
      }
      if (event.key === "ArrowLeft" && index > 0) refs.current[index - 1]?.focus();
      if (event.key === "ArrowRight" && index < LENGTH - 1) refs.current[index + 1]?.focus();
    },
    [chars],
  );

  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 text-center sm:p-6">
      <h2 className="text-base font-semibold text-[var(--foreground)]">Have a class code?</h2>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-[var(--muted)]">
        If your tutor read out a code — for a catch-up, a make-up class, or a one-to-one — enter it here.
      </p>

      <div className="mt-5 flex justify-center gap-1.5 sm:gap-2">
        {chars.map((char, index) => (
          <input
            key={index}
            ref={(element) => {
              refs.current[index] = element;
            }}
            value={char}
            onChange={(event) => setAt(index, event.target.value)}
            onKeyDown={(event) => onKeyDown(index, event)}
            onFocus={(event) => event.target.select()}
            // `text` with these hints, not `number`: the code is alphanumeric,
            // and a numeric keypad on a phone would make half of it untypable.
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={LENGTH}
            aria-label={`Code character ${index + 1}`}
            className="h-12 w-10 rounded-xl border-2 border-[var(--border)] bg-[var(--surface-alt)] text-center font-mono text-xl font-bold uppercase text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:bg-[var(--surface)] sm:h-14 sm:w-12 sm:text-2xl"
          />
        ))}
      </div>

      <button
        onClick={() => submit(code)}
        disabled={!complete || busy}
        className="mt-5 inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
      >
        {busy ? "Opening…" : "Join with code"}
        {!busy && <ArrowRightIcon className="h-4 w-4" />}
      </button>
    </div>
  );
}
