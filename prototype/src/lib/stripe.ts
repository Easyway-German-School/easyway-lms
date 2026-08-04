import Stripe from "stripe";

/**
 * The Stripe client, built on first use rather than on import.
 *
 * WHY THIS IS LAZY, AND WHY IT BROKE A DEPLOY.
 *
 * This module used to be one line:
 *
 *     export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
 *
 * The `|| ""` looks like a safe default and is the opposite of one. Stripe's
 * constructor rejects an empty key with "Neither apiKey nor config.authenticator
 * provided" — at MODULE LOAD, before any request exists. Next imports every
 * route module during `next build` to collect page data, so the whole build
 * failed with `Failed to collect page data for /api/stripe/webhook` on any
 * deployment that had not configured Stripe.
 *
 * This school takes payment through Paystack. Stripe is a leftover from the
 * original template and is not configured in production, so the effect was
 * that an unused integration blocked the deploy of everything else.
 *
 * A getter fixes it properly: the module imports cleanly with no key, and the
 * error — if anyone ever actually calls a Stripe route — arrives at request
 * time, names the missing variable, and takes down one endpoint instead of the
 * entire build.
 */

let client: Stripe | null = null;

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error(
      "Stripe is not configured on this deployment (STRIPE_SECRET_KEY is unset). " +
        "This school takes payment through Paystack — see /api/payments.",
    );
  }
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY);
  return client;
}
