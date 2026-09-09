# Flutterwave — international card payments

Paystack stays the primary, default gateway and is **unchanged**. Flutterwave is
an **opt-in** second option: a quiet "Pay with an international card (Visa ·
Mastercard)" link under the normal Paystack button on every checkout, for
students paying from outside Nigeria whose cards Paystack often declines.

The amount is the **same naira figure** — Flutterwave charges the card in NGN and
does its own FX. `Payment.currency` stays `"NGN"`, `Payment.method` is
`"flutterwave"`. Nothing in pricing, invoices, the paywall, or revenue reporting
changes.

## What it covers

| Flow | How it's reached |
| --- | --- |
| Tuition — full / deposit / custom part-pay | `TuitionCheckout` |
| Continue to next level | `NextLevelCheckout` |
| Private (one-to-one) class upgrade | `PremiumPrivateClasses` |
| Exam / ÖSD sitting fee | `MyExamsPanel` |

Platform credit top-ups (schools paying EduPrime) stay Paystack-only.

## Environment variables

All three are required together. If none are set, the international-card button
returns a friendly "temporarily unavailable" and Paystack is unaffected. If only
some are set, `scripts/check-launch.mjs` fails.

| Var | Where to get it | Notes |
| --- | --- | --- |
| `FLW_SECRET_KEY` | Flutterwave dashboard → Settings → API Keys | `FLWSECK_TEST-…` for testing, `FLWSECK-…` live. Server-only — never expose. |
| `FLW_PUBLIC_KEY` | same page | `FLWPUBK_TEST-…` / `FLWPUBK-…`. Not currently used by the hosted-redirect flow, but set it so the pair is complete and future inline checkout works. |
| `FLW_SECRET_HASH` | Flutterwave dashboard → Settings → Webhooks → "Secret hash" | **You invent this string** (any long random value), paste it into the dashboard, and set the env var to the exact same value. It authenticates the webhook. |

`NEXTAUTH_URL` must already be the real domain — it is the checkout redirect
target.

## How to get the keys (for Jason / whoever owns the money)

1. Create / log in to a Flutterwave account at <https://dashboard.flutterwave.com>.
2. Complete **business verification / KYC** and add a **settlement bank account**
   (NGN payout). Until this is done you only get test keys.
3. **Settings → API Keys** → copy the **Secret key** and **Public key**. Use the
   `*_TEST-*` pair first.
4. **Settings → Webhooks**:
   - **URL**: `https://easywayschoollms.com.ng/api/flutterwave/webhook`
   - **Secret hash**: paste a long random string you generate (e.g.
     `openssl rand -hex 32`). Save the same string as `FLW_SECRET_HASH`.
   - Enable it.
5. Put the three values into Vercel → Project → Settings → Environment Variables
   (Production, and Preview if testing there), then redeploy.
6. Verify with `node scripts/check-launch.mjs https://easywayschoollms.com.ng` —
   the Payments section should show `PASS Flutterwave`.

## Testing (test keys, before going live)

Flutterwave test cards: <https://developer.flutterwave.com/docs/test-cards>. A
successful non-3DS card is `5531 8866 5214 6008`, CVV `564`, expiry any future
date, PIN `3310`, OTP `12345`.

1. Deploy a **preview** with the `*_TEST-*` keys and a test `FLW_SECRET_HASH`.
2. Point the dashboard webhook (or a second test webhook) at the preview URL.
3. On the preview: student → tuition checkout → "Pay with an international card"
   → pay with a test card → land back on `/enrollment/success?source=flutterwave`
   → confirm the Payment row (`method: "flutterwave"`), the portal unlock, and
   the admin "₦… received (international card)" notification.
4. Repeat for a deposit, a private upgrade, and an exam fee.
5. Close the tab on Flutterwave's page mid-flow once — the webhook must still
   record it.

## Architecture (for the next developer)

```
client "Pay with an international card"  →  POST /api/flutterwave/initialize
   (same request body as the Paystack button; amount re-derived server-side)
        │
        ├─ tuition/next-level → resolveTuitionCheckout()  ← SHARED with Paystack,
        │                        src/lib/checkout-amount.ts   the one price source
        ├─ private_class_upgrade → flat PRIVATE_CLASS_UPGRADE_PRICE
        └─ exam_fee → resolvePayable() → Exam.fee (server-fixed)
        │
        ▼
   Flutterwave /v3/payments  →  hosted checkout  →  redirect_url
        │
        ├─ redirect: /enrollment/success?source=flutterwave&transaction_id=…
        │     server verifies + persists (happy path)
        └─ webhook: POST /api/flutterwave/webhook   ← authoritative recorder,
              verif-hash check, owns notifications + emails
        │
        ▼
   src/lib/flutterwave.ts
     verifyFlutterwaveTransaction()  → /v3/transactions/:id/verify
     persistFlutterwaveCharge()      → Invoice + Payment(method="flutterwave")
                                       + enrol + promote + Travel Package
                                       reconcile   (mirrors the Paystack webhook)
     persistFlutterwavePrivateUpgrade()
```

Idempotency: `Payment.stripeSessionId` holds Flutterwave's `tx_ref`. Webhook and
redirect can both land; the second early-returns. Same pattern as Paystack.

Flutterwave gotchas encoded in the lib:
- amounts are in **naira (major units)**, not kobo — no `/100`.
- webhook auth is a **static hash** in the `verif-hash` header, not an HMAC.
- verify is keyed on Flutterwave's **numeric transaction id** (`?transaction_id=`
  on the redirect, `data.id` in the webhook), not our `tx_ref`.

**Not shared with Paystack on purpose.** `persistFlutterwaveCharge` is a parallel
copy of the Paystack webhook's tuition branch rather than a refactor of it, so
adding this could not change how a Paystack payment is recorded. `resolveTuitionCheckout`
is the exception — price derivation is security-critical and must have exactly
one source; `/api/paystack/initialize` still carries its original inline copy and
a follow-up can switch it to the lib with no behaviour change.
