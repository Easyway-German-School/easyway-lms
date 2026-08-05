/**
 * MailerLite and MailerSend.
 *
 * These are two products from the same company and they do different jobs, so
 * the LMS uses each for what it is actually for:
 *
 *   MailerLite  (connect.mailerlite.com) — marketing. Subscribers, groups and
 *               campaigns. Use it to keep the school's list in sync and to send
 *               a newsletter to "Abuja A2 students with an outstanding balance".
 *               It has NO endpoint for sending one arbitrary email to one
 *               person, so it cannot carry a fee receipt.
 *
 *   MailerSend  (api.mailersend.com) — transactional. One message to one
 *               recipient, which is exactly what receipts, exam confirmations
 *               and payment warnings are.
 *
 * They take SEPARATE keys from separate dashboards. A MailerLite key will not
 * authenticate against MailerSend and vice versa — both answer 401
 * "Unauthenticated", which reads like a bad key rather than the wrong product.
 */

const MAILERLITE_BASE = "https://connect.mailerlite.com/api";
const MAILERSEND_BASE = "https://api.mailersend.com/v1";

export function mailerliteToken() {
  return process.env.MAILERLITE_API_KEY?.trim() || null;
}

export function mailersendToken() {
  return process.env.MAILERSEND_API_KEY?.trim() || null;
}

export type ProbeResult = {
  configured: boolean;
  ok: boolean;
  status?: number;
  detail?: string;
};

async function probe(base: string, path: string, token: string | null): Promise<ProbeResult> {
  if (!token) return { configured: false, ok: false, detail: "No API key set" };

  try {
    const res = await fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });

    if (res.ok) return { configured: true, ok: true, status: res.status };

    const detail =
      res.status === 401
        ? "Key rejected. Check it is the key for THIS product — MailerLite and MailerSend keys are not interchangeable."
        : `HTTP ${res.status}`;

    return { configured: true, ok: false, status: res.status, detail };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      detail: error instanceof Error ? error.message : "Network error",
    };
  }
}

export function checkMailerLite() {
  return probe(MAILERLITE_BASE, "/groups?limit=1", mailerliteToken());
}

export function checkMailerSend() {
  return probe(MAILERSEND_BASE, "/domains", mailersendToken());
}

/* -------------------------------------------------------------------------- */
/* Transactional: one message, one recipient                                  */
/* -------------------------------------------------------------------------- */

export type SendResult = { ok: boolean; error?: string; id?: string };

export async function sendViaMailerSend(input: {
  to: string;
  subject: string;
  html: string;
  fromEmail: string;
  fromName?: string;
}): Promise<SendResult> {
  const token = mailersendToken();
  if (!token) return { ok: false, error: "MailerSend is not configured" };

  try {
    const res = await fetch(`${MAILERSEND_BASE}/email`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        from: { email: input.fromEmail, name: input.fromName ?? "Easyway German Language School" },
        to: [{ email: input.to }],
        subject: input.subject,
        html: input.html,
      }),
    });

    // A successful send returns 202 with no body.
    if (res.status === 202) {
      return { ok: true, id: res.headers.get("x-message-id") ?? undefined };
    }

    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body?.message ?? detail;
      // Sending from an unverified domain is the usual first-run failure.
      if (body?.errors) detail += ` — ${JSON.stringify(body.errors).slice(0, 200)}`;
    } catch {
      /* keep the status-only detail */
    }

    return { ok: false, error: detail };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Network error" };
  }
}

/* -------------------------------------------------------------------------- */
/* Marketing: keep the school's list in sync                                  */
/* -------------------------------------------------------------------------- */

export type SubscriberFields = {
  name?: string | null;
  level?: string | null;
  branch?: string | null;
  studentCode?: string | null;
  paymentStatus?: string | null;
};

/**
 * Create or update one subscriber. MailerLite treats this as an upsert keyed
 * on the email, so it is safe to re-run for the whole roster.
 */
export async function upsertSubscriber(
  email: string,
  fields: SubscriberFields,
  groupIds: string[] = [],
): Promise<SendResult> {
  const token = mailerliteToken();
  if (!token) return { ok: false, error: "MailerLite is not configured" };

  try {
    const res = await fetch(`${MAILERLITE_BASE}/subscribers`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        fields: {
          name: fields.name ?? undefined,
          level: fields.level ?? undefined,
          branch: fields.branch ?? undefined,
          student_code: fields.studentCode ?? undefined,
          payment_status: fields.paymentStatus ?? undefined,
        },
        ...(groupIds.length ? { groups: groupIds } : {}),
      }),
    });

    if (res.ok) return { ok: true };

    let detail = `HTTP ${res.status}`;
    try { detail = (await res.json())?.message ?? detail; } catch { /* status only */ }
    return { ok: false, error: detail };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Network error" };
  }
}

export type MailerLiteGroup = { id: string; name: string; subscribers: number };

export type ListGroupsResult =
  | { ok: true; groups: MailerLiteGroup[]; error?: undefined }
  | { ok: false; groups: MailerLiteGroup[]; error: string };

/** Groups on the account, so the admin UI can offer real names rather than ids. */
export async function listGroups(): Promise<ListGroupsResult> {
  const token = mailerliteToken();
  if (!token) return { ok: false as const, error: "MailerLite is not configured", groups: [] };

  try {
    const res = await fetch(`${MAILERLITE_BASE}/groups?limit=100`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) {
      return { ok: false as const, error: `HTTP ${res.status}`, groups: [] };
    }
    const body = await res.json();
    return {
      ok: true as const,
      groups: (body.data ?? []).map((g: any) => ({
        id: String(g.id),
        name: String(g.name),
        subscribers: Number(g.active_count ?? 0),
      })),
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Network error",
      groups: [],
    };
  }
}
