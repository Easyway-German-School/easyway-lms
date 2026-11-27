/**
 * SMTP "accepted" is not inbox delivery. Before support@ was the Brevo From,
 * exams@ was silently dropped after SMTP accept — those rows still look "sent".
 * Anything accepted before this instant is treated as unverified until force-resent.
 */
export function emailDeliveryTrustAfter(): Date {
  const raw = process.env.EMAIL_DELIVERY_TRUST_AFTER || "2026-11-27T11:00:00.000Z";
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date("2026-11-27T11:00:00.000Z") : d;
}

export type JourneyMailStatus = "queued" | "accepted" | "failed";

export type DeliveryLabel =
  | { kind: "queued"; label: string; tone: "warn" }
  | { kind: "failed"; label: string; tone: "bad" }
  | { kind: "unverified"; label: string; tone: "warn" }
  | { kind: "accepted"; label: string; tone: "ok" };

export function deliveryLabel(row: {
  status: string;
  sentAt: Date | string;
  messageId?: string | null;
  lastError?: string | null;
}): DeliveryLabel {
  const status = row.status || "accepted";
  if (status === "queued") {
    return { kind: "queued", label: "Stuck — claimed but not handed to Brevo", tone: "warn" };
  }
  if (status === "failed") {
    return {
      kind: "failed",
      label: row.lastError ? `Failed — ${row.lastError}` : "Failed — Brevo/SMTP rejected",
      tone: "bad",
    };
  }
  const sentAt = typeof row.sentAt === "string" ? new Date(row.sentAt) : row.sentAt;
  if (sentAt.getTime() < emailDeliveryTrustAfter().getTime()) {
    return {
      kind: "unverified",
      label: "Unverified — accepted before support@ fix; may never have arrived",
      tone: "warn",
    };
  }
  return {
    kind: "accepted",
    label: row.messageId
      ? `Handed to Brevo (${row.messageId.slice(0, 18)}…)`
      : "Handed to Brevo (SMTP accepted — not inbox proof)",
    tone: "ok",
  };
}

export function needsEmailAttention(row: {
  status: string;
  sentAt: Date | string;
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
