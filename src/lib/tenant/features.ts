/**
 * What a tenant's platform can actually do.
 *
 * The isolation and billing layers landed first; this is the piece that was
 * still missing after them — EasyWay's own business rules (which exam bodies
 * are bookable, whether an online cohort's game needs a live class under it)
 * were global constants inside shared logic, so a second school would
 * silently inherit every one of them with no way to differ. This file is the
 * typed shape of what can now vary per tenant, and the safe way to read a
 * stored override back.
 *
 * Same split as branding.ts/branding-server.ts, and for the same reason:
 * this file imports nothing, so a "use client" component (the operator
 * console) can import the type and the defaults without pulling in
 * @/lib/prisma → tenant/context → node:async_hooks, which breaks `next build`
 * with an UnhandledSchemeError that `tsc --noEmit` does not catch. The Prisma
 * half lives next door in features-server.ts.
 */

export const FEATURES_KEY = "features";

/**
 * ASCII slugs, not the literal awarding-body strings stored on `Exam`.
 *
 * `Exam.examBody` holds `"ÖSD"` as written by whoever created the sitting —
 * possibly in NFC, possibly in NFD (Ö as one codepoint vs. O + a combining
 * diaeresis), depending on the OS or editor that typed it. Using that string
 * directly as a JSON object key means two visually identical values can fail
 * a `===` comparison, and a flag that silently reads as `false` looks
 * identical in every log to one that was actually turned off.
 * `externalBodySlug()` below is the one place that normalises.
 */
export const EXTERNAL_EXAM_BODIES = ["osd", "telc"] as const;
export type ExternalExamBody = (typeof EXTERNAL_EXAM_BODIES)[number];

export type TenantFeatures = {
  examCentre: {
    /** Whether a booking for this awarding body is actually live for this tenant. */
    externalBodies: Record<ExternalExamBody, boolean>;
    /** The outbound referral card on the exam pages. Null hides it entirely —
     *  a language school that isn't teaching German has no reason to send
     *  students to goethe.de. */
    goetheReferralUrl: string | null;
  };
  games: {
    /** EasyWay's rule that an online cohort can only start a live quiz from
     *  inside a live lesson (see live-quiz/route.ts). A tenant running games
     *  open to everyone, with no live-class concept, would want this off. */
    onlineCohortRequiresLiveClass: boolean;
  };
};

/**
 * EasyWay's actual live behaviour today, reproduced exactly — verified
 * against exam-centre.ts, MyExamsPanel.tsx and live-quiz/route.ts rather than
 * assumed. ÖSD/telc are `false` not because EasyWay chose that as a policy,
 * but because ExamBodyComingSoon.tsx documents two real gaps (no confirmed
 * fee, no certified booking link) that make turning them on today a lie. A
 * new tenant's onboarding form pre-checks whatever the platform can actually
 * deliver — the raw default here stays the current, working state.
 */
export const DEFAULT_FEATURES: TenantFeatures = {
  examCentre: {
    externalBodies: { osd: false, telc: false },
    goetheReferralUrl: "https://www.goethe.de/ins/ng/en/m/spr/prf/anm.html",
  },
  games: {
    onlineCohortRequiresLiveClass: true,
  },
};

/** A fresh, independently-mutable copy — callers merge into this, never into `DEFAULT_FEATURES` itself. */
export function defaultFeatures(): TenantFeatures {
  return {
    examCentre: {
      externalBodies: { ...DEFAULT_FEATURES.examCentre.externalBodies },
      goetheReferralUrl: DEFAULT_FEATURES.examCentre.goetheReferralUrl,
    },
    games: { ...DEFAULT_FEATURES.games },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a stored `SchoolSetting.value` back into a known shape.
 *
 * Two callers, opposite needs — same split as `parseSessionSettings` in
 * school-settings.ts. Reading from the database must never throw: a
 * hand-edited or half-migrated row should degrade to the defaults, not take
 * down every page that reads a feature flag. Accepting a PATCH body is the
 * moment to reject nonsense instead of storing it.
 *
 * The value is a PARTIAL override merged over the defaults, not a full
 * replacement — so a flag added in a later wave is inherited by every
 * tenant's existing stored row without a migration touching a single one.
 */
export function parseFeatures(value: unknown): TenantFeatures;
export function parseFeatures(value: unknown, options: { strict: true }): TenantFeatures | null;
export function parseFeatures(
  value: unknown,
  options?: { strict?: boolean },
): TenantFeatures | null {
  const strict = options?.strict === true;
  if (!isPlainObject(value)) return strict ? null : defaultFeatures();

  const result = defaultFeatures();

  const examCentre = value.examCentre;
  if (examCentre !== undefined) {
    if (!isPlainObject(examCentre)) {
      if (strict) return null;
    } else {
      const externalBodies = examCentre.externalBodies;
      if (externalBodies !== undefined) {
        if (!isPlainObject(externalBodies)) {
          if (strict) return null;
        } else {
          for (const body of EXTERNAL_EXAM_BODIES) {
            if (!(body in externalBodies)) continue;
            const raw = externalBodies[body];
            if (typeof raw !== "boolean") {
              if (strict) return null;
              continue;
            }
            result.examCentre.externalBodies[body] = raw;
          }
        }
      }

      if ("goetheReferralUrl" in examCentre) {
        const raw = examCentre.goetheReferralUrl;
        if (raw === null) {
          result.examCentre.goetheReferralUrl = null;
        } else if (typeof raw === "string" && raw.trim()) {
          result.examCentre.goetheReferralUrl = raw.trim();
        } else if (strict) {
          return null;
        }
      }
    }
  }

  const games = value.games;
  if (games !== undefined) {
    if (!isPlainObject(games)) {
      if (strict) return null;
    } else if ("onlineCohortRequiresLiveClass" in games) {
      const raw = games.onlineCohortRequiresLiveClass;
      if (typeof raw !== "boolean") {
        if (strict) return null;
      } else {
        result.games.onlineCohortRequiresLiveClass = raw;
      }
    }
  }

  return result;
}

/**
 * Normalise an `Exam.examBody` value to the flag key that governs it.
 * `null` for "internal" (always live, no flag needed) or anything unrecognised.
 */
export function externalBodySlug(examBody: string | null | undefined): ExternalExamBody | null {
  if (!examBody) return null;
  const normalized = examBody.normalize("NFC").trim().toLowerCase();
  if (normalized === "ösd" || normalized === "osd") return "osd";
  if (normalized === "telc") return "telc";
  return null;
}

/** Is this exam's awarding body actually bookable for this tenant right now? */
export function isExamBodyLive(
  features: TenantFeatures,
  examBody: string | null | undefined,
): boolean {
  const slug = externalBodySlug(examBody);
  if (!slug) return true;
  return features.examCentre.externalBodies[slug];
}
