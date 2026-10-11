/**
 * The handbook rule: a fund request goes to the COO; if nobody answers
 * within an hour, the requester can go straight to Accounting. There is no
 * background job sending that escalation notice yet — building a reliable
 * cron path safely was not something to rush tonight. What exists instead
 * is honest: `isOverdue` is a plain computed read, so the UI can show
 * "past the 1-hour window — go to Accounting" the moment it's true, without
 * claiming an automated notification was sent when none was.
 */
export const ESCALATION_WINDOW_MS = 60 * 60 * 1000;

export function isOverdue(request: { status: string; createdAt: Date }): boolean {
  return request.status === "pending" && Date.now() - request.createdAt.getTime() > ESCALATION_WINDOW_MS;
}
