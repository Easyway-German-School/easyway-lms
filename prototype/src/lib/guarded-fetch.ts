/**
 * A `fetch` for the outside services this app cannot run without — the AI
 * providers and Paystack — that gives each one a DEADLINE and a CIRCUIT BREAKER.
 * (Patterns explained in lib/resilience.ts; where they sit is on the console's
 * Patterns tab.)
 *
 *   guardedFetch("paystack", url, init)   // same as fetch(url, init), but protected
 *
 * WHY A DEADLINE COMES FIRST. A breaker counts failures. A call that HANGS never
 * fails — it just sits there until the platform kills the whole function at 60
 * seconds, and the breaker never hears about it. None of these calls had a
 * timeout, so the failure mode that most needs a breaker (a provider that is slow,
 * not down) was invisible to one. Every call now has a deadline, so "too slow"
 * becomes an error the breaker can count.
 *
 * WHAT COUNTS AS THE PROVIDER FAILING — the rule that matters most for payments.
 *   counts:    a network error, a timeout, a 5xx, a 429 (throttled), a 408.
 *   does NOT:  any other 4xx — a bad request, an expired key, a declined card, a
 *              duplicate reference. Those mean the provider ANSWERED, correctly,
 *              about OUR request. If they tripped the breaker, a few customers
 *              typing a wrong email could switch off payments for everybody.
 *
 * SAME AS BEFORE, EXCEPT FAST. When the provider fails, callers get exactly what
 * they always did: a thrown error for network failures and timeouts, and the
 * ordinary Response object for a 5xx (so their `!response.ok` handling is
 * untouched). The only new thing they can see is `BreakerOpenError`, thrown
 * instantly while the circuit is open — and every call site already treats a
 * thrown fetch as "the provider is unreachable", which is exactly what it is.
 *
 * NEVER RETRIED HERE. A payment initialisation creates state on Paystack's side;
 * repeating one blindly is how a customer is charged twice. A breaker only
 * DECLINES to call; it never calls again.
 */

import { BreakerOpenError, createCircuitBreaker } from "@/lib/resilience";

export type Provider = "groq" | "anthropic" | "deepseek" | "openai" | "paystack";

const CONFIG: Record<Provider, { name: string; failureThreshold: number; resetAfterMs: number; deadlineMs: number }> = {
  // A student is watching a spinner, and the function is killed at 60s: a deadline
  // just under that turns a hang into an error while there is still time to answer.
  groq: { name: "ai-groq", failureThreshold: 5, resetAfterMs: 30_000, deadlineMs: 50_000 },
  anthropic: { name: "ai-anthropic", failureThreshold: 5, resetAfterMs: 30_000, deadlineMs: 50_000 },
  deepseek: { name: "ai-deepseek", failureThreshold: 5, resetAfterMs: 30_000, deadlineMs: 50_000 },
  openai: { name: "ai-openai", failureThreshold: 5, resetAfterMs: 30_000, deadlineMs: 50_000 },
  // Shorter on every axis: a customer is mid-checkout, so trip a little sooner and
  // recover a little faster — a payment page that says "try again in a moment" and
  // then works beats one that hangs, and one that stays shut for half a minute.
  paystack: { name: "paystack", failureThreshold: 4, resetAfterMs: 15_000, deadlineMs: 20_000 },
};

// Created up front so they all appear on the console at zero, not only once used.
const breakers = Object.fromEntries(
  (Object.keys(CONFIG) as Provider[]).map((provider) => [
    provider,
    createCircuitBreaker({
      name: CONFIG[provider].name,
      failureThreshold: CONFIG[provider].failureThreshold,
      resetAfterMs: CONFIG[provider].resetAfterMs,
    }),
  ]),
) as Record<Provider, ReturnType<typeof createCircuitBreaker>>;

/** The provider itself is struggling — as opposed to having answered a bad request. */
export const isProviderFailure = (status: number) => status >= 500 || status === 429 || status === 408;

/** Carries a failing Response through the breaker so the caller can still be handed it. */
class UpstreamFailure extends Error {
  constructor(readonly response: Response) {
    super(`upstream answered ${response.status}`);
  }
}

export type GuardedFetchOptions = {
  /** Override the provider's default deadline (a long transcription, say). */
  timeoutMs?: number;
};

export async function guardedFetch(
  provider: Provider,
  url: string | URL,
  init: RequestInit = {},
  options: GuardedFetchOptions = {},
): Promise<Response> {
  const deadline = AbortSignal.timeout(options.timeoutMs ?? CONFIG[provider].deadlineMs);
  // A caller's own cancel signal still works; the deadline is added, not substituted.
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;

  try {
    return await breakers[provider].run(async () => {
      const response = await fetch(url, { ...init, signal });
      if (isProviderFailure(response.status)) throw new UpstreamFailure(response);
      return response;
    });
  } catch (error) {
    // Counted against the breaker, but the caller gets the response it always got.
    if (error instanceof UpstreamFailure) return error.response;
    throw error;
  }
}

/** True when a call was refused because the provider's circuit is open. */
export const isCircuitOpen = (error: unknown): error is BreakerOpenError => error instanceof BreakerOpenError;

/**
 * What to say to a person when a payment provider's circuit is open. One sentence,
 * honest, and tells them what to do — not "something went wrong".
 */
export const PAYMENTS_PAUSED_MESSAGE =
  "Online payment is having trouble right now. Nothing has been charged. Please try again in a minute.";
