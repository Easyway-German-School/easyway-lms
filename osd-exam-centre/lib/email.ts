import nodemailer from "nodemailer";
import { OFFICE } from "@/lib/config";

/**
 * Dual-provider outbound mail.
 *
 * Primary = Brevo SMTP (SMTP_*). OSD From is support@easywaylanguageschool.com
 * (NOT the LMS no-reply@). support@ must be a verified Brevo sender on an
 * authenticated domain, or Brevo returns 250 queued and nothing arrives.
 * Reply-To stays exams@ (Zoho desk). LMS no-reply@ is for the LMS only.
 *
 * Fallback = Zoho ZeptoMail / CPaaS SMTP (ZOHO_SMTP_*). Ordinary Zoho Mail
 * mailbox SMTP is not for transactional volume — use ZeptoMail/CPaaS.
 *
 * Order: Brevo → Zoho on hard failure; dual-send when Zoho is configured.
 */

export type EmailProvider = "brevo" | "zoho" | "local";

type TransportConfig = {
  id: EmailProvider;
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
};

/** OSD automated From — support@. Never LMS no-reply@. */
const BREVO_FROM =
  process.env.SMTP_FROM || "Easyway ÖSD Exam Centre <support@easywaylanguageschool.com>";

/** Zoho/Zepto From — same support@ identity once the domain is verified there. */
const ZOHO_FROM =
  process.env.ZOHO_SMTP_FROM ||
  process.env.ZEPTO_SMTP_FROM ||
  "Easyway ÖSD Exam Centre <support@easywaylanguageschool.com>";

const transporters = new Map<string, ReturnType<typeof nodemailer.createTransport>>();

function brevoConfig(): TransportConfig | null {
  if (!process.env.SMTP_HOST) return null;
  return {
    id: "brevo",
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER || undefined,
    pass: process.env.SMTP_PASS || undefined,
    from: BREVO_FROM,
  };
}

function zohoConfig(): TransportConfig | null {
  const host =
    process.env.ZOHO_SMTP_HOST ||
    process.env.ZEPTO_SMTP_HOST ||
    "";
  const pass = process.env.ZOHO_SMTP_PASS || process.env.ZEPTO_SMTP_PASS || "";
  if (!host || !pass) return null;
  return {
    id: "zoho",
    host,
    // ZeptoMail: smtp.zeptomail.com ; Zoho org mailbox (not recommended): smtppro.zoho.com
    port: Number(process.env.ZOHO_SMTP_PORT || process.env.ZEPTO_SMTP_PORT || 587),
    secure: (process.env.ZOHO_SMTP_SECURE || process.env.ZEPTO_SMTP_SECURE || "false") === "true",
    user: process.env.ZOHO_SMTP_USER || process.env.ZEPTO_SMTP_USER || "emailapikey",
    pass,
    from: ZOHO_FROM,
  };
}

function getTransport(cfg: TransportConfig) {
  const key = `${cfg.id}:${cfg.host}:${cfg.port}:${cfg.user ?? ""}`;
  let t = transporters.get(key);
  if (!t) {
    t = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
      connectionTimeout: 8_000,
      greetingTimeout: 5_000,
      socketTimeout: 20_000,
    });
    transporters.set(key, t);
  }
  return t;
}

/** Providers available right now, primary first. */
export function configuredEmailProviders(): EmailProvider[] {
  const out: EmailProvider[] = [];
  if (brevoConfig()) out.push("brevo");
  if (zohoConfig()) out.push("zoho");
  return out;
}

export function zohoFallbackConfigured(): boolean {
  return zohoConfig() !== null;
}

export type EmailAttachment = { filename: string; content: Uint8Array; contentType: string };

export type SendEmailResult =
  | { ok: true; messageId: string | null; provider: EmailProvider; tried: EmailProvider[] }
  | { ok: false; error: string; provider: EmailProvider | null; tried: EmailProvider[] };

async function sendVia(
  cfg: TransportConfig,
  input: {
    to: string;
    subject: string;
    html: string;
    attachments?: EmailAttachment[];
  },
): Promise<SendEmailResult> {
  try {
    const info = await getTransport(cfg).sendMail({
      from: cfg.from,
      replyTo: OFFICE.email,
      to: input.to,
      subject: input.subject,
      html: input.html,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content),
        contentType: a.contentType,
      })),
    });
    const rejected = (info as { rejected?: string[] }).rejected ?? [];
    if (rejected.length > 0) {
      console.error(`sendEmail[${cfg.id}] rejected:`, rejected);
      return {
        ok: false,
        error: `Rejected by ${cfg.id}: ${rejected.join(", ")}`,
        provider: cfg.id,
        tried: [cfg.id],
      };
    }
    return {
      ok: true,
      messageId: typeof info.messageId === "string" ? info.messageId : null,
      provider: cfg.id,
      tried: [cfg.id],
    };
  } catch (error) {
    console.error(`sendEmail[${cfg.id}] failed:`, error);
    const message = error instanceof Error ? error.message : "SMTP send failed";
    return { ok: false, error: `${cfg.id}: ${message}`.slice(0, 400), provider: cfg.id, tried: [cfg.id] };
  }
}

/**
 * Send through the provider chain.
 * - default: Brevo, then Zoho/Zepto on hard failure
 * - prefer: "zoho" tries Zoho first when configured
 * - dual: attempt both; ok if either succeeds (use for critical journey mail
 *   once Zoho is wired — silent Brevo drops won't strand the candidate)
 */
export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
  prefer?: EmailProvider;
  dual?: boolean;
}): Promise<SendEmailResult> {
  const brevo = brevoConfig();
  const zoho = zohoConfig();

  if (!brevo && !zoho) {
    console.log(
      `[email:not-configured] to=${input.to} subject="${input.subject}"${
        input.attachments?.length ? ` attachments=${input.attachments.map((a) => a.filename).join(",")}` : ""
      }`,
    );
    return { ok: true, messageId: "local-dev", provider: "local", tried: ["local"] };
  }

  const order: TransportConfig[] = [];
  if (input.prefer === "zoho" && zoho) {
    order.push(zoho);
    if (brevo) order.push(brevo);
  } else {
    if (brevo) order.push(brevo);
    if (zoho) order.push(zoho);
  }

  if (input.dual && order.length > 1) {
    const results = await Promise.all(order.map((cfg) => sendVia(cfg, input)));
    const tried = results.flatMap((r) => r.tried);
    const ok = results.find((r) => r.ok);
    if (ok && ok.ok) {
      return { ok: true, messageId: ok.messageId, provider: ok.provider, tried };
    }
    return {
      ok: false,
      error: results.map((r) => (!r.ok ? r.error : "")).filter(Boolean).join(" | "),
      provider: null,
      tried,
    };
  }

  const tried: EmailProvider[] = [];
  let lastError = "No provider succeeded";
  for (const cfg of order) {
    const result = await sendVia(cfg, input);
    tried.push(...result.tried);
    if (result.ok) {
      return { ok: true, messageId: result.messageId, provider: result.provider, tried };
    }
    lastError = result.error;
  }
  return { ok: false, error: lastError, provider: null, tried };
}
