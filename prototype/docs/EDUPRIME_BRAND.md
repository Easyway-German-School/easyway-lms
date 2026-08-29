# EduPrime — the platform brand

EasyWay is a **school**. EduPrime is the **platform** the school runs on — and
the one a second, third, tenth school runs on without ever seeing the first.
They are sold to different people and they look different on purpose.

This doc is the visual and verbal identity. The code that implements it:

| Thing | File |
|---|---|
| Name, taglines, copy, host test | `src/lib/platform/brand.ts` |
| Palette (CSS) | `src/app/eduprime.css` — the `.eduprime` scope |
| Logo (React) | `src/components/platform/EduPrimeLogo.tsx` |
| Logo / favicon / OG (static) | `public/platform/*.svg` |
| Marketing site | `src/app/platform/page.tsx` |
| Operator console | `src/app/platform/console/page.tsx` + `src/components/PlatformShell.tsx` |

---

## The name

**EduPrime.** Two readings, both intended:

- **Prime** — the foundational layer, first-class, primed and ready. The thing
  underneath. "Run your school like a company" — EduPrime is the company's
  infrastructure floor.
- **Prism** — one beam of raw capability (one codebase, one deployment) split
  cleanly into many branded, isolated schools. That is literally what the
  platform does, and it is the logo.

Tagline: **"Run your school like a company."**
Positioning line (small, in footers): **"The layer underneath your school."**

### Voice

Operator-to-operator. A school owner has heard every SaaS promise; the ones that
land are specific. So: "a query with no school in context *throws in
development*", not "enterprise-grade isolation". Name the mechanism. Admit the
edges (nothing is auto-suspended; rates are set during onboarding; no
self-service signup — all of that is on the marketing page in plain words).

---

## Colour

Cool where EasyWay is warm. EasyWay is a classroom: teal ground, orange reward.
EduPrime is a console: indigo competence, one bright beam, mint for
verified / paid / live.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--foreground` / ink | `#0B1020` | `#EEF0FB` | text |
| `--primary` | `#4338CA` | `#7C74FF` | buttons, links, the wordmark's "Prime" |
| `--eduprime-beam` | `#8B7CFF` | `#8B7CFF` | the one accent; CTA gradient endpoint |
| `--eduprime-mint` | `#10B981` | `#34D399` | success / paid / live |
| spectrum | `#4338CA → #8B7CFF → #22D3EE` | same | the prism's output; hairlines, the mark |

All of it is defined in `src/app/eduprime.css` on `.eduprime`, with a dark block
under `html.theme-dark .eduprime`. Nothing outside that scope is touched — a
student portal never loads a byte of it.

`--primary` is defined **here and only here**. The console markup already used
`var(--primary)` on its buttons and `globals.css` never defined it, so those
buttons rendered with no fill until this scope gave the token a value.

---

## Logo

A **prism**. A white beam (`currentColor`, so it adapts) enters the left face;
three coloured rays — indigo, periwinkle, cyan — leave the right.

```tsx
import EduPrimeLogo, { EduPrimeMark } from "@/components/platform/EduPrimeLogo";

<EduPrimeLogo markSize={30} />                 // mark + "EduPrime" wordmark
<EduPrimeLogo tone="inverse" />                // white text, for the indigo hero
<EduPrimeMark size={20} />                     // mark only
<EduPrimeMark size={48} withTile />            // mark on the rounded ink tile (favicon/avatar)
```

Static files for email, docs, social:

- `public/platform/eduprime-mark.svg` — glyph only
- `public/platform/eduprime-logo.svg` — horizontal lockup, dark text
- `public/platform/eduprime-logo-inverse.svg` — horizontal lockup, white text
- `public/platform/favicon.svg` — mark on the ink tile
- `public/platform/og.svg` — 1200×630 social card

**Rules.** The three output rays are fixed spectrum hex — they are the brand,
they do not re-theme. The incoming beam is `currentColor`. The wordmark is
`Edu` in ink + `Prime` in `--primary` (or `#B7B0FF` on inverse). Don't stretch,
recolour the rays, or add a drop shadow.

### Raster icons — still to generate

`favicon.svg` covers modern browsers and the PWA manifest. PNG fallbacks
(`favicon-32.png`, `apple-touch-icon.png`, maskable 192/512) are **not**
generated yet — `scripts/build-app-icons.mjs` builds EasyWay's from
`public/logo*.png`; an EduPrime pass needs a source raster of `favicon.svg` on
the ink tile. Low priority: SVG favicons work everywhere that matters.

---

## Domains & routing

`PLATFORM_HOSTS` (env, comma-separated) lists the hosts that ARE EduPrime.
Default: `eduprime.africa, www.eduprime.africa, eduprime.localhost,
platform.localhost`.

On an EduPrime host the edge proxy (`src/proxy.ts`) rewrites:

| URL | Serves |
|---|---|
| `/` | `src/app/platform/page.tsx` — the marketing site |
| `/console` | `src/app/platform/console/page.tsx` — the operator console |
| `/auth/admin`, `/api/**`, assets | unchanged |

On a **school** host, `/` is still that school's own page. `/platform` and
`/platform/console` also work everywhere directly (no host magic needed), which
is how it runs before DNS is pointed.

An unknown host is **never** EduPrime — it resolves to a school, matching
`resolveTenantId`'s own safe-direction bias.

### To go live

1. Register the domain (`eduprime.africa` or your pick) and add it to the Vercel
   project as an alias.
2. Set `PLATFORM_HOSTS` in Vercel to the real host(s). Redeploy of the env var
   alone is enough — no code change.
3. Optionally set `PLATFORM_ENQUIRY_WEBHOOK` to a Slack/Discord incoming webhook
   so "book a demo" submissions ping a channel. They are logged either way
   (`[eduprime.enquiry]` in the server log).
4. `NEXTAUTH_URL` stays the school deployment's URL — operators sign in through
   the existing `/auth/admin` flow; there is no separate auth realm.
