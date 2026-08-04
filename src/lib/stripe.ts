export function stripeConfigured(): boolean {
  return false;
}

export function getStripe(): never {
  throw new Error(
    "Stripe is not enabled or configured on this deployment. This app uses Paystack for payments."
  );
}
