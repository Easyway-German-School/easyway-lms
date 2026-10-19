import { sessionDurationMonths } from "@/lib/levels";

export type AutoProgressionDecision =
  | { eligible: true; completedAt: Date }
  | { eligible: false; reason: "unconfirmed_start" | "invalid_start" | "not_due" };

export function autoProgressionDecision(input: {
  startedAt: Date | string | null;
  confirmedVia: string | null;
  sessionSlot?: string | null;
  now?: Date;
}): AutoProgressionDecision {
  if (!input.startedAt) return { eligible: false, reason: "unconfirmed_start" };
  const startedAt = input.startedAt instanceof Date ? input.startedAt : new Date(input.startedAt);
  if (Number.isNaN(startedAt.getTime()) || input.confirmedVia === "promotion") {
    return { eligible: false, reason: input.confirmedVia === "promotion" ? "unconfirmed_start" : "invalid_start" };
  }
  const completedAt = new Date(startedAt);
  completedAt.setUTCHours(0, 0, 0, 0);
  completedAt.setUTCMonth(completedAt.getUTCMonth() + sessionDurationMonths(input.sessionSlot));
  if (completedAt.getTime() > (input.now ?? new Date()).getTime()) {
    return { eligible: false, reason: "not_due" };
  }
  return { eligible: true, completedAt };
}
