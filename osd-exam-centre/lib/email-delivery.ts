/**
 * SMTP "accepted" / "queued" is NOT inbox delivery.
 *
 * Rows from before support@ was correctly configured (or when exams@ was
 * wrongly used as Brevo From) may never have arrived. Brevo can still
 * soft-drop — we never tell the office a message "landed".
 *
 * IMPORTANT: "unconfirmed" (recent Brevo queue) is honesty on the candidate
 * card — it must NOT keep a row on Resend-all forever. Resend already works
 * (attemptCount climbs); putting unconfirmed on the action list made Resend
 * all look broken (121 → still 121).
 */

export function emailDeliveryTrustAfter(): Date {
  // Bump when From identity changes so prior accepts re-enter the action queue.
  // Anything accepted before the authenticated exams-domain From went live
  // was rejected by Brevo ("sender not valid") even when SMTP said OK.
  const raw = process.env.EMAIL_DELIVERY_TRUST_AFTER || "2026-11-28T07:05:00.000Z";
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date("2026-11-28T07:05:00.000Z") : d;
}

export const UNCONFIRMED_ATTENTION_HOURS = Number(process.env.EMAIL_UNCONFIRMED_HOURS || 48);

export type DeliveryLabel =
  | { kind: "queued"; label: string; tone: "warn" }
  | { kind: "failed"; label: string; tone: "bad" }
  | { kind: "unverified"; label: string; tone: "warn" }
  | { kind: "unconfirmed"; label: string; tone: "warn" }
  | { kind: "accepted"; label: string; tone: "ok" };

export function deliveryLabel(row: {
  status: string;
  sentAt: Date | string;
  messageId?: string | null;
  lastError?: string | null;
  provider?: string | null;
}): DeliveryLabel {
  const status = row.status || "accepted";
  const provider = row.provider || "brevo";
  if (status === "queued") {
    return { kind: "queued", label: "Stuck — claimed but not handed to any provider", tone: "warn" };
  }
  if (status === "failed") {
    return {
      kind: "failed",
      label: row.lastError ? `Failed — ${row.lastError}` : "Failed — SMTP rejected",
      tone: "bad",
    };
  }
  const sentAt = typeof row.sentAt === "string" ? new Date(row.sentAt) : row.sentAt;
  if (sentAt.getTime() < emailDeliveryTrustAfter().getTime()) {
    return {
      kind: "unverified",
      label: "Unverified — accepted before working From; likely never arrived",
      tone: "warn",
    };
  }
  // Normal success path: SMTP handoff worked. We cannot see their Gmail inbox
  // without provider webhooks — that is honesty, not a send failure.
  const who = provider.includes("zoho") ? provider : "Brevo";
  return {
    kind: "accepted",
    label: row.messageId
      ? `Sent via ${who} (SMTP OK) — ask them to check inbox + spam`
      : `Sent via ${who} (SMTP OK) — ask them to check inbox + spam`,
    tone: "ok",
  };
}

/** Actionable: failed / stuck / pre-fix unverified. NOT mere "unconfirmed". */
export function needsEmailAttention(row: {
  status: string;
  sentAt: Date | string;
  provider?: string | null;
}): boolean {
  const kind = deliveryLabel(row).kind;
  return kind === "queued" || kind === "failed" || kind === "unverified";
}

/** Money + admission emails we always want to see land. */
export const CRITICAL_JOURNEY_STEPS = [
  "booking_received",
  "payment_confirmed",
  "admission",
  "registration_link",
  "exam_guide",
] as const;

export function isCriticalJourneyStep(step: string): boolean {
  return (CRITICAL_JOURNEY_STEPS as readonly string[]).includes(step);
}
