# EduPrime as a multi-business engine — plan

Status: Slice 1 in progress (branch `feat/byo-paystack`). Written 2026-09-28.

## The idea in one paragraph

EasyWay is client #1. The same engine should run any business that trains people
and collects fees (bootcamps, driving schools, exam prep, academies). A business
starts **free in a sandbox**, sees a working setup, and is billed only when it
**goes live** (first real payment). Setup happens in WhatsApp chat with an AI, not
on a settings page. Money comes from four places, each with one job:

| Layer | Pays for | Basis |
|---|---|---|
| Base plan, **2 modules included** | The platform | Flat monthly |
| Extra modules (à la carte / bundles) | Optional capability | Flat monthly per module |
| Credits | AI, WhatsApp, email (our variable cost) | Prepaid wallet, marked up |
| Payments | Collecting fees | Either a % take (Paystack subaccount) **or** the "Own Paystack account" module, a flat fee by volume band |

The minimum is **disclosed** ("your plan includes 2 modules — pick your second"),
never hidden. Included-allowance framing converts better than a hidden floor and
does not cost trust in a market where owners compare notes in WhatsApp groups.

## Pricing guardrails ("we never lose")

- Every live business pays at least the base plan, which exceeds cost-to-serve.
- Own-Paystack flat fee is banded by monthly volume; each band's price is at or
  above what a 1.5% take would earn at the band's ceiling, so big businesses
  cannot pay less by switching.
- Sandbox has a hard credit stop at zero. Live businesses get a grace overdraft
  and a suspend-not-delete dunning path (read-only, data always exportable).
- Prepaid wallet only: we never bill usage after the fact.

## Build order

1. **Slice 1 — Own Paystack account (this branch).** Per-tenant Paystack key,
   encrypted; per-tenant webhook URL; checkout/verify/webhook use the tenant's
   key. A tenant with no key **fails closed** and never falls back to EasyWay's.
2. Price book merged (PR #124) and made tenant-aware; programs/cohorts replace
   hard-coded CEFR levels behind a "template".
3. Module registry (extends the feature registry) + entitlements + cart page +
   monthly invoice from the wallet.
4. Credit guard extended to student-facing AI/messaging; starter grant; real
   meter rates; hard stop (sandbox) vs soft landing (live).
5. Paystack subaccounts + take-rate split (the % option).
6. WhatsApp gateway (webhook in -> tenant+role by phone -> assistant -> reply),
   outbound template queue, confirm-before-money-actions.
7. Chat-based setup wizard, starter templates, self-serve signup, click-to-
   WhatsApp ads.

Before 5-7: onboard 3-5 real businesses by hand and re-run the revenue model on
their real numbers.

## Slice 1 design

**Storage.** A `SchoolSetting` row, key `payments.paystack`, per tenant (same
idiom as the feature flags, so no schema migration). The secret key is stored
AES-256-GCM encrypted via the existing `encryptSecret` (mfa.ts); it is never
returned to the browser again after saving. Only the last 4 characters are shown.

**Resolution rule** (`lib/paystack-account.ts`), in this order:
1. Tenant has an enabled account of its own -> use it.
2. Tenant is the platform tenant (EasyWay) -> `PAYSTACK_SECRET_KEY` from env.
   *EasyWay's behaviour is unchanged.*
3. Anything else -> **no account**. Checkout answers "payments aren't set up
   yet". It must never silently collect into the platform's Paystack.

**Webhook.** Paystack signs with the account's own secret, so a tenant needs its
own URL: `/api/paystack/webhook/<tenantId>`. That route only accepts the tenant's
own key's signature, then scopes the whole request to that tenant. The handler
moved from the route file into `lib/paystack-webhook.ts` (Next forbids extra
exports from route files) and is shared by the platform route and the tenant route.

**Hardening that comes with it** (a tenant's Paystack account is controlled by the
tenant, so its webhook payload is untrusted input):
- `metadata.kind === "platform_topup"` is **ignored** on tenant webhooks. Without
  this a business could send itself a "top-up" and mint free platform credit.
- Any student named in the metadata must belong to the tenant in the URL.
- The invalid-signature alert goes to that tenant's admins, not the platform's.

**UI.** `/admin/settings/payments` (behind the `payments` capability, which is
super-admin only): paste secret key -> we validate it against Paystack -> show the
webhook URL to paste into the Paystack dashboard -> connected / disconnect.

**Not in slice 1:** subaccounts and take rate, flat-fee billing, per-tenant
email branding on payment receipts, tenant custom-domain callback URLs.
