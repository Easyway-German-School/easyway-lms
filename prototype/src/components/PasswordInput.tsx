"use client";

import { useState } from "react";
import { CheckIcon } from "@/components/icons";
import { passwordProblem } from "@/lib/password-rules";

/**
 * Password field with a show/hide toggle.
 *
 * Typing a password blind is the single biggest cause of failed sign-ups —
 * especially on phones, where autocorrect and the shift key conspire against
 * you. Every password field in the app should use this rather than a bare
 * <input type="password">.
 *
 * Accepts the same props as a normal input so it can drop straight in.
 */

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.6 6.2A9.9 9.9 0 0 1 12 6c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.05" />
      <path d="M6.2 6.4A17.4 17.4 0 0 0 2 13s3.6 7 10 7a9.7 9.7 0 0 0 4.2-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m3 3 18 18" />
    </svg>
  );
}

type Props = {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
  id?: string;
  name?: string;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  disabled?: boolean;
  /**
   * Show a live "at least 8 characters" guide under the field, ticking green
   * the moment the rule is met. Off by default — a sign-in field has nothing
   * to validate, and turning this on everywhere this component is used would
   * put a length counter under a password an admin is merely re-typing to
   * confirm. Reads `passwordProblem` from lib/password-rules.ts, the same
   * rule the signup API itself enforces, so the hint can never promise a
   * password the server then rejects.
   */
  showRequirements?: boolean;
};

export default function PasswordInput({ className = "", showRequirements = false, value, ...props }: Props) {
  const [visible, setVisible] = useState(false);
  const problem = showRequirements ? passwordProblem(value) : null;
  const met = showRequirements && value.length > 0 && !problem;

  return (
    <div>
      <div className="relative">
        <input
          {...props}
          value={value}
          type={visible ? "text" : "password"}
          // Room on the right so the toggle never sits on top of the text.
          className={`${className} pr-11`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          // Not a tab stop: keyboard users move straight from password to submit.
          tabIndex={-1}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-[var(--muted)] transition hover:text-[var(--foreground-soft)]"
        >
          {visible ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
        </button>
      </div>
      {showRequirements ? (
        <p className={`mt-1.5 flex items-center gap-1.5 text-xs transition-colors ${met ? "text-emerald-600" : "text-[var(--muted)]"}`}>
          {met ? <CheckIcon className="h-3.5 w-3.5 shrink-0" /> : <span aria-hidden="true" className="inline-block h-1 w-1 shrink-0 rounded-full bg-current" />}
          {met ? "Good — that's a valid password" : `At least 8 characters (${value.length}/8 so far)`}
        </p>
      ) : null}
    </div>
  );
}
