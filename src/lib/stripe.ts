export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): never {
  throw new Error(
    "Stripe is not configured on this deployment (STRIPE_SECRET_KEY is unset). " +
      "This school takes payment through Paystack — see /api/payments.",
  );
}
