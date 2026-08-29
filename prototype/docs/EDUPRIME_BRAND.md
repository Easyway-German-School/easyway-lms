# EduPrime — the platform brand

EasyWay is a **school**. EduPrime is the **platform** the school runs on — and
the one a second, third, tenth school runs on without ever seeing the first.
Different people run them, so they look different on purpose.

EduPrime is two screens, both moved out of the EasyWay admin sidebar:

- **Operator console** — `/platform` — the schools on the system and the API
  keys they hold (`src/app/platform/page.tsx`).
- **Billing** — `/platform/billing` — what a school owes for running on the
  platform, itemised by meter, plus top-up (`src/app/platform/billing/page.tsx`;
  `/admin/billing` now redirects here).

There is deliberately **no marketing/landing page**. EduPrime is an internal
product surface, not a site that sells itself.

The code that implements the identity:

| Thing | File |
|---|---|
| Name, copy, colours, host test | `src/lib/platform/brand.ts` |
| Palette (CSS) | `src/app/eduprime.css` — the `.eduprime` scope |
| Logo (React) | `src/components/platform/EduPrimeLogo.tsx` |
| Logo / favicon / OG (static) | `public/platform/*.svg` |
| Shell (header, nav, theme) | `src/components/PlatformShell.tsx` |
| Metadata + `.eduprime` wrapper | `src/app/platform/layout.tsx` |

---

## The name

**EduPrime.** Two readings, both intended:

- **Prime** — the foundational layer, first-class, primed and ready. The thing
  underneath.
- **Prism** — one beam of light split cleanly into many separated schools. That
  is literally what the platform does, and it is the logo.

### Voice

Operator-to-operator. Specific over grand: "a query with no school in context
*throws in development*", not "enterprise-grade isolation". Name the mechanism.

---

## Colour

The brief, from the people who own it: **blue and purple** for the core — trust,
depth, "this is infrastructure"; **yellow into orange** for the accent —
excitement, energy, the feeling of ease.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--foreground` / ink | `#0d1220` | `#eef1fb` | text |
| `--primary` | `#2563EB` (blue) | `#60A5FA` | buttons, links |
| `--eduprime-purple` | `#7C3AED` | `#A78BFA` | the wordmark's "Prime", CTA gradient end, spectrum middle |
| `--accent` | `#F97316` (orange) | `#FB923C` | the warm accent — fills, `--accent-soft` |
| `--accent-strong` | `#FACC15` (yellow) | `#FDE047` | the bright partner in gradients / glows |
| `--eduprime-beam` | `#FACC15` | `#FDE047` | the light entering the prism |
| spectrum | `#2563EB → #7C3AED → #F97316` | brighter equivalents | the prism's output; the header hairline |

All of it is defined in `src/app/eduprime.css` on `.eduprime`, with a dark block
under `html.theme-dark .eduprime`. Nothing outside that scope is touched — a
student portal never loads a byte of it.

`--primary` is defined **here and only here**. The console markup already used
`var(--primary)` on its buttons and `globals.css` never defined it, so those
buttons rendered with no fill until this scope gave the token a value.

---

## Logo

A **prism**. A yellow beam (`currentColor` in the React component, so it adapts)
enters the left face; three rays — **blue, purple, orange** — leave the right.

```tsx
import EduPrimeLogo, { EduPrimeMark } from "@/components/platform/EduPrimeLogo";

<EduPrimeLogo markSize={30} />                 // mark + "EduPrime" wordmark
<EduPrimeLogo tone="inverse" />                // white text, for a dark header
<EduPrimeMark size={20} />                     // mark only
<EduPrimeMark size={48} withTile />            // mark on the rounded ink tile (favicon/avatar)
```

Static files for email, docs, social:

- `public/platform/eduprime-mark.svg` — glyph only
- `public/platform/eduprime-logo.svg` — horizontal lockup, dark text
- `public/platform/eduprime-logo-inverse.svg` — horizontal lockup, white text
- `public/platform/favicon.svg` — mark on the ink tile
- `public/platform/og.svg` — 1200×630 card

**Rules.** The three output rays are fixed hex (blue `#2563EB`, purple `#7C3AED`,
orange `#F97316`) — they are the brand, they do not re-theme. The prism body is a
blue→purple gradient. The wordmark is `Edu` in ink + `Prime` in
`--eduprime-purple` (or `#C4B5FD` on inverse). Don't stretch, recolour the rays,
or add a drop shadow.

### Raster icons — still to generate

`favicon.svg` covers modern browsers and the PWA manifest. PNG fallbacks
(`favicon-32.png`, `apple-touch-icon.png`, maskable 192/512) are **not**
generated — `scripts/build-app-icons.mjs` builds EasyWay's from `public/logo*.png`;
an EduPrime pass needs a source raster of `favicon.svg` on the ink tile. Low
priority: SVG favicons work everywhere that matters.

---

## Domains & routing

`PLATFORM_HOSTS` (env, comma-separated) lists the hosts that ARE EduPrime.
Default: `eduprime.africa, www.eduprime.africa, eduprime.localhost,
platform.localhost`.

On an EduPrime host the edge proxy (`src/proxy.ts`) rewrites so the short URLs
stay in the address bar:

| URL on an EduPrime host | Serves |
|---|---|
| `/` | `src/app/platform/page.tsx` — the operator console |
| `/billing` | `src/app/platform/billing/page.tsx` — the billing view |
| `/auth/admin`, `/api/**`, assets | unchanged |

On a **school** host, `/` is still that school's own page. `/platform` and
`/platform/billing` also work everywhere directly (no host magic needed), which
is how it runs before DNS is pointed. An unknown host is **never** EduPrime.

### Access

The proxy gates `/platform/**` on the coarse `admin` role. That is deliberate:
`/platform/billing` is a school's own bill and a school admin must reach it. The
console (`/platform`) and every `/api/platform/**` route additionally call
`requirePlatformOperator()`, which checks the real `platformRole` column and
404s a non-operator admin.

### To go live

1. Register the domain (`eduprime.africa` or your pick) and add it to the Vercel
   project as an alias.
2. Set `PLATFORM_HOSTS` in Vercel to the real host(s). Redeploy of the env var
   alone is enough — no code change.
3. `NEXTAUTH_URL` stays the school deployment's URL — operators sign in through
   the existing `/auth/admin` flow; there is no separate auth realm.
