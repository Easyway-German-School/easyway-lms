import { NextResponse } from "next/server";

/**
 * The shape of every public API response.
 *
 * Fixed early and changed rarely, because a response envelope is the part of
 * an API that every partner's error handling is written against. The internal
 * routes in this app return `{ error: "..." }` in some places and
 * `{ message: "..." }` in others, with the status carrying the real meaning —
 * fine when the only caller is our own React app and we can change both sides
 * at once, unworkable when the caller is a school's engineer who deployed six
 * months ago.
 */

/**
 * Machine-readable codes. The `message` is for humans and may be reworded at
 * any time; the `code` is a contract and may not.
 */
export type ApiErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "idempotency_conflict"
  | "rate_limited"
  | "internal_error";

const STATUS_FOR: Record<ApiErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_request: 400,
  idempotency_conflict: 409,
  rate_limited: 429,
  internal_error: 500,
};

export function apiError(
  code: ApiErrorCode,
  message: string,
  extra: { headers?: Record<string, string>; details?: unknown } = {},
) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(extra.details ? { details: extra.details } : {}),
      },
    },
    { status: STATUS_FOR[code], headers: extra.headers },
  );
}

export function apiOk<T>(data: T, init: { status?: number; headers?: Record<string, string> } = {}) {
  return NextResponse.json({ data }, { status: init.status ?? 200, headers: init.headers });
}

/**
 * A page of results.
 *
 * Cursor-based, not offset-based. Offsets look simpler and are wrong under
 * writes: a partner paging through students while the office enrols one
 * shifts every subsequent page by one, so rows get skipped or repeated with
 * no error anywhere. A cursor is stable against inserts.
 *
 * `hasMore` is returned rather than a total count, because counting the whole
 * matching set on every page is a table scan the caller usually does not want
 * to pay for. A partner who genuinely needs a total can ask for one.
 */
export function apiPage<T>(items: T[], opts: { limit: number; cursorOf: (item: T) => string }) {
  const hasMore = items.length > opts.limit;
  const page = hasMore ? items.slice(0, opts.limit) : items;

  return apiOk({
    items: page,
    hasMore,
    nextCursor: hasMore && page.length ? opts.cursorOf(page[page.length - 1]!) : null,
  });
}

/**
 * Clamped, because an unbounded `limit` is a way for one caller to ask for
 * every row in the table and take the database down for everybody. Requesting
 * over the maximum quietly gets the maximum rather than an error — a partner
 * asking for too much wants as much as they can have.
 */
export function parseLimit(value: string | null, { fallback = 25, max = 100 } = {}): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}
