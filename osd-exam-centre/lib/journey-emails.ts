import { OFFICE } from "@/lib/config";
import { escapeHtml } from "@/lib/html";
import { formatNaira } from "@/lib/money";

/**
 * The candidate's whole email journey, as pure functions: context in, subject +
 * HTML out. No database, no sending — lib/journey.ts decides WHEN each one goes.
 *
 * The wording is the school's own candidate document pack (Documents A–M),
 * kept as close to verbatim as an email allows, because those texts were
 * written to be safe: nothing here promises a result, an admission or a refund
 * (Operations Manual §41, §15, §12). Subjects follow §47 —
 * "[Easyway ÖSD] <what> – <reference>" — and every email carries the fields §46
 * requires: name, reference, level, date, the action needed, and a contact channel.
 */

export type JourneyStep =
  | "booking_received" // Document A — with the invoice attached
  | "payment_reminder"
  | "payment_confirmed" // Document B — with the receipt attached
  | "info_check" // Document C
  | "prep_invite" // the one soft prep-class note
  | "admission" // Document D
  | "exam_guide" // Documents E + F
  | "reminder_7day" // Document I
  | "reminder_24h" // Document J
  | "result_pending" // Document L
  | "result_released" // Document K
  | "certificate_ready"; // Document M

/** Every step, in the order a candidate meets them. */
export const JOURNEY_ORDER: JourneyStep[] = [
  "booking_received", "payment_reminder", "payment_confirmed", "info_check", "prep_invite",
  "admission", "exam_guide", "reminder_7day", "reminder_24h", "result_pending", "result_released", "certificate_ready",
];

export type EmailContext = {
  fullName: string;
  email: string;
  referenceCode: string;
  invoiceNumber: string;
  level: string;
  modulesLabel: string;
  express: boolean;
  expressFee: number;
  feeTotal: number;
  amountReceived: number | null;
  examDate: string; // "Thursday, 29 October 2026"
  venueName: string;
  venueAddress: string;
  arrivalTime: string | null;
  startTime: string | null;
  seatNumber: number | null;
  registrationDeadline: string | null; // formatted; null once it has passed
  bank: { bankName: string; accountName: string; accountNumber: string };
  paymentReference: string;
  bookingUrl: string;
  prepUrl: string;
  termsUrl: string;
  /** Details still blank that admission cannot go ahead without ("ID number", ...). */
  missingFields: string[];
  idUploaded: boolean;
  daysToExam: number;
  certificateCollection: string | null;
  candidateDetails: { label: string; value: string }[];
};

export type RenderedEmail = {
  subject: string;
  html: string;
  /** Which PDF rides along: the pending invoice, or the paid receipt. */
  attach: "invoice" | "receipt" | null;
};

const NAVY = "#0b1f3a";
const GOLD = "#b8912f";
const INK = "#10203f";
const SOFT = "#3c4a68";
const LINE = "#dcdcd2";

const TITLES = new Set(["dr", "dr.", "mr", "mr.", "mrs", "mrs.", "ms", "ms.", "miss", "prof", "prof.", "engr", "engr.", "chief", "pastor", "rev", "rev."]);

export function firstNameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const named = parts.filter((p) => !TITLES.has(p.toLowerCase()));
  return named[0] ?? parts[0] ?? "Candidate";
}

const subject = (what: string, ctx: EmailContext) => `[Easyway ÖSD] ${what} – ${ctx.referenceCode}`;
const examName = (ctx: EmailContext) => `ÖSD Zertifikat ${ctx.level}`;

// ---------------------------------------------------------------- building blocks

const p = (html: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${INK}">${html}</p>`;
const e = escapeHtml;

function ul(items: string[]): string {
  return `<ul style="margin:0 0 14px;padding-left:20px;font-size:15px;line-height:1.7;color:${INK}">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
}

function heading(text: string): string {
  return `<p style="margin:22px 0 8px;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${GOLD}">${e(text)}</p>`;
}

function rows(items: { label: string; value: string }[]): string {
  const body = items
    .filter((r) => r.value)
    .map((r) => `<tr><td style="padding:7px 12px;border-bottom:1px solid ${LINE};font-size:13px;color:${SOFT};width:38%">${e(r.label)}</td><td style="padding:7px 12px;border-bottom:1px solid ${LINE};font-size:14px;font-weight:600;color:${INK}">${e(r.value)}</td></tr>`)
    .join("");
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 16px;border:1px solid ${LINE};border-radius:6px;border-collapse:separate">${body}</table>`;
}

function statusBanner(text: string, tone: "wait" | "good" = "wait"): string {
  const bg = tone === "good" ? "#e9f5ee" : "#f4ecd8";
  const fg = tone === "good" ? "#1f6f4a" : NAVY;
  return `<p style="margin:0 0 16px;padding:11px 14px;background:${bg};color:${fg};font-size:13px;font-weight:700;letter-spacing:.06em;border-radius:6px">${e(text)}</p>`;
}

function button(label: string, href: string, kind: "primary" | "quiet" = "primary"): string {
  const style = kind === "primary"
    ? `background:${NAVY};color:#ffffff;border:1px solid ${NAVY}`
    : `background:#ffffff;color:${NAVY};border:1px solid ${NAVY}`;
  return `<p style="margin:6px 0 18px"><a href="${e(href)}" style="display:inline-block;padding:11px 20px;border-radius:6px;font-size:14px;font-weight:700;text-decoration:none;${style}">${e(label)}</a></p>`;
}

function referenceBlock(ctx: EmailContext): string {
  return rows([
    { label: "Candidate", value: ctx.fullName },
    { label: "Examination reference", value: ctx.referenceCode },
    { label: "Examination", value: examName(ctx) },
    { label: "Examination date", value: ctx.examDate },
  ]);
}

function layout(preheader: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:0;background:#f3f1ea">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${e(preheader)}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f1ea"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;font-family:Helvetica,Arial,sans-serif">
<tr><td style="background:${NAVY};padding:18px 26px">
  <div style="color:#ffffff;font-size:15px;font-weight:700;letter-spacing:.04em">${e(OFFICE.schoolName)}</div>
  <div style="color:#e3b94f;font-size:11px;font-weight:700;letter-spacing:.18em;margin-top:3px">${e(OFFICE.centreName)}</div>
</td></tr>
<tr><td style="padding:26px 26px 8px">${body}</td></tr>
<tr><td style="padding:14px 26px 24px;border-top:1px solid ${LINE};font-size:12px;line-height:1.6;color:${SOFT}">
  ${e(OFFICE.signatory)} · ${e(OFFICE.schoolName.replace("EASYWAY GERMAN LANGUAGE SCHOOL", "Easyway German Language School"))}<br/>
  ${e(OFFICE.addressLine)}<br/>
  <a href="mailto:${e(OFFICE.email)}" style="color:${NAVY}">${e(OFFICE.email)}</a> · ${e(OFFICE.phone)}<br/>
  Questions about your examination? Reply to this email — it reaches the Examination Department.
</td></tr>
</table></td></tr></table></body></html>`;
}

const hello = (ctx: EmailContext) => p(`Dear ${e(firstNameOf(ctx.fullName))},`);
const sign = () => p(`Kind regards,<br/>${e(OFFICE.signatory)}<br/>Easyway German Language School`);

const PROHIBITED = [
  "mobile phones", "smartwatches", "unauthorised electronic devices", "learning materials", "notes", "recording devices", "other prohibited items",
];

// ---------------------------------------------------------------- the steps

function bookingReceived(ctx: EmailContext): RenderedEmail {
  const account = ctx.bank;
  return {
    subject: subject("Booking Received", ctx),
    attach: "invoice",
    html: layout(`Your ÖSD booking is received — payment pending. Invoice attached.`, [
      hello(ctx),
      p(`Thank you for registering for an ÖSD German examination with Easyway German Language School. We have received your booking and created the following examination record:`),
      rows([
        { label: "Candidate", value: ctx.fullName },
        { label: "Easyway examination reference", value: ctx.referenceCode },
        { label: "Examination", value: examName(ctx) },
        { label: "Module(s)", value: ctx.modulesLabel },
        { label: "Express result", value: ctx.express ? `Requested (${formatNaira(ctx.expressFee)})` : "Not requested" },
        { label: "Examination date", value: ctx.examDate },
        { label: "Location", value: `${ctx.venueName}${ctx.venueAddress ? `, ${ctx.venueAddress}` : ""}` },
      ]),
      statusBanner("BOOKING RECEIVED — PAYMENT PENDING"),
      p(`Your booking is not yet a final admission to the examination. Your examination place becomes confirmed only after the applicable registration requirements have been completed and your full examination fee has been received and verified by Easyway.`),
      heading("Next step — payment"),
      p(`Your invoice is attached. Please pay <strong>${e(formatNaira(ctx.feeTotal))}</strong> using the official payment details below${ctx.registrationDeadline ? `, before <strong>${e(ctx.registrationDeadline)}</strong>` : ""}.`),
      rows([
        { label: "Account name", value: account.accountName },
        { label: "Account number", value: account.accountNumber },
        { label: "Bank", value: account.bankName },
        { label: "Payment reference", value: ctx.paymentReference },
      ]),
      p(`Please put the payment reference exactly as shown — it is how we match your payment to your booking. <strong>Please do not send payment to any personal bank account or to any member of staff.</strong>`),
      p(`Once you have paid, you don't need to send anything unless we ask. If you would like to, you can upload your transfer receipt from your booking page and we'll verify it faster.`),
      button("Open my booking", ctx.bookingUrl),
      p(`Please also make sure your personal information matches your valid identification document — if anything on the invoice is incorrect, contact us immediately. By completing your registration you accept the <a href="${e(ctx.termsUrl)}" style="color:${NAVY}">Examination Terms</a>; please note that reserved examination seats cannot be reversed, cancelled or transferred, and all payments are non-refundable.`),
      p(`We look forward to welcoming you to Easyway for your ÖSD examination.`),
      sign(),
    ].join("")),
  };
}

function paymentReminder(ctx: EmailContext): RenderedEmail {
  return {
    subject: subject("Payment Reminder", ctx),
    attach: "invoice",
    html: layout("A reminder that your ÖSD examination fee is still outstanding.", [
      hello(ctx),
      p(`This is a reminder that we have not yet received payment for your ${e(examName(ctx))} examination on ${e(ctx.examDate)}. Your invoice is attached again for convenience.`),
      rows([
        { label: "Amount due", value: formatNaira(ctx.feeTotal) },
        { label: "Account name", value: ctx.bank.accountName },
        { label: "Account number", value: ctx.bank.accountNumber },
        { label: "Bank", value: ctx.bank.bankName },
        { label: "Payment reference", value: ctx.paymentReference },
        ...(ctx.registrationDeadline ? [{ label: "Pay before", value: ctx.registrationDeadline }] : []),
      ]),
      p(`Your examination place is confirmed only once the full fee has been received and verified. If you have already paid, please ignore this message — or upload your receipt from your booking page so we can match it quickly. Please do not send payment to any personal account.`),
      button("Open my booking", ctx.bookingUrl),
      sign(),
    ].join("")),
  };
}

function paymentConfirmed(ctx: EmailContext): RenderedEmail {
  return {
    subject: subject("Payment Confirmed", ctx),
    attach: "receipt",
    html: layout("Your ÖSD examination payment has been received and verified.", [
      hello(ctx),
      p(`We confirm that your examination payment has been received and verified. Your receipt is attached.`),
      rows([
        { label: "Candidate", value: ctx.fullName },
        { label: "Examination reference", value: ctx.referenceCode },
        { label: "Examination", value: examName(ctx) },
        { label: "Examination date", value: ctx.examDate },
        { label: "Amount paid", value: ctx.amountReceived !== null ? formatNaira(ctx.amountReceived) : formatNaira(ctx.feeTotal) },
      ]),
      statusBanner("PAYMENT VERIFIED", "good"),
      p(`Your registration will now proceed to the examination admission stage. Please note that payment confirmation does not replace the formal examination admission process — if any information or documentation is still required, Easyway will contact you.`),
      p(`Please keep this email for your records.`),
      button("See where my registration stands", ctx.bookingUrl, "quiet"),
      sign(),
    ].join("")),
  };
}

function infoCheck(ctx: EmailContext): RenderedEmail {
  const missing = ctx.missingFields;
  const todo: string[] = [];
  if (missing.length) todo.push(`add the details we are still missing: <strong>${e(missing.join(", "))}</strong>`);
  if (!ctx.idUploaded) todo.push(`upload a clear photo or scan of the data page of the identification document you registered with`);
  todo.push(`confirm that everything below is correct`);
  return {
    subject: subject("Please Check Your Details", ctx),
    attach: null,
    html: layout("Please check your examination details before your admission is finalised.", [
      hello(ctx),
      p(`Before your examination admission is finalised, please carefully check the information below.`),
      rows(ctx.candidateDetails),
      p(`Your name and personal details must be correct and must correspond with your valid identification document. If you notice an error, please contact Easyway immediately — do not wait until examination day to report an incorrect name or date of birth.`),
      heading("What we need from you"),
      ul(todo.map((t) => t.charAt(0).toUpperCase() + t.slice(1))),
      button("Check and confirm my details", ctx.bookingUrl),
      p(`Your admission can only be issued once this is done.`),
      sign(),
    ].join("")),
  };
}

function prepInvite(ctx: EmailContext): RenderedEmail {
  const weeks = Math.max(1, Math.round(ctx.daysToExam / 7));
  return {
    subject: subject(`Preparing for ${examName(ctx)}`, ctx),
    attach: null,
    html: layout(`With ${weeks} week${weeks === 1 ? "" : "s"} to go — a few ways candidates use the time.`, [
      hello(ctx),
      p(`Your payment is in and your registration is moving along — nothing more is needed from you on that front. With about ${weeks} week${weeks === 1 ? "" : "s"} until ${e(ctx.examDate)}, here is how candidates at ${e(ctx.level)} usually make the most of the time:`),
      ul([
        `<strong>Do one full, timed practice paper</strong> before exam day, so the written part is not a first-time surprise. ÖSD publishes practice material for each level — it shows you the task types and the timing.`,
        `<strong>Practise speaking out loud.</strong> The oral module is a quarter of the fee and the part candidates rehearse least. Even ten minutes a day with a friend beats silent revision.`,
        `<strong>Check your name and ID early.</strong> Most last-minute problems are administrative, not linguistic.`,
      ]),
      p(`If you would like company on the way there: Easyway runs exam-preparation classes built around this exact examination, for candidates who want structured practice with a teacher. It is entirely optional and has no bearing on your registration, your admission or your result.`),
      p(`If you're curious, one tap lets our classes team know — they'll send you dates, with no payment and no obligation.`),
      button("Tell me about prep classes", ctx.prepUrl, "quiet"),
      p(`Either way, we'll see you on ${e(ctx.examDate)}.`),
      sign(),
    ].join("")),
  };
}

function admission(ctx: EmailContext): RenderedEmail {
  return {
    subject: subject("Admission Confirmed", ctx),
    attach: null,
    html: layout("You have been admitted to your ÖSD examination.", [
      hello(ctx),
      p(`We are pleased to confirm that you have been admitted to the following ÖSD examination:`),
      rows([
        { label: "Candidate", value: ctx.fullName },
        { label: "Examination reference", value: ctx.referenceCode },
        { label: "Examination", value: examName(ctx) },
        { label: "Date", value: ctx.examDate },
        { label: "Venue", value: `${ctx.venueName}${ctx.venueAddress ? `, ${ctx.venueAddress}` : ""}` },
        { label: "Arrival time", value: ctx.arrivalTime ?? "To be confirmed by the examination team" },
        { label: "Examination start", value: ctx.startTime ?? "To be confirmed by the examination team" },
        ...(ctx.seatNumber !== null ? [{ label: "Seat number", value: String(ctx.seatNumber) }] : []),
      ]),
      statusBanner("ADMITTED", "good"),
      heading("Important"),
      p(`Please bring the valid identification document used for your examination registration. Your identity will be checked before the examination. Please arrive early enough to complete the admission and security procedures before the examination begins.`),
      p(`Please do not bring: ${PROHIBITED.map(e).join("; ")}.`),
      p(`You will receive further instructions from the examination team on arrival. Candidates are expected to follow all applicable ÖSD examination regulations and Easyway examination instructions.`),
      button("Open my admission slip", ctx.bookingUrl),
      p(`We wish you a successful examination.`),
      p(`<em>You'll also receive your Candidate Examination Guide and an examination-day checklist shortly.</em>`),
      sign(),
    ].join("")),
  };
}

function examGuide(ctx: EmailContext): RenderedEmail {
  return {
    subject: subject("Your Examination Guide", ctx),
    attach: null,
    html: layout("Your ÖSD examination guide and examination-day checklist.", [
      hello(ctx),
      p(`This is your guide to the ÖSD examination at Easyway. Please read it before the day.`),
      referenceBlock(ctx),
      heading("1. Before the examination"),
      ul(["check your examination date, time and venue", "check your name and personal details", "prepare your valid identification document", "read the examination information and the applicable ÖSD Examination Regulations", "arrive early"]),
      heading("2. On arrival"),
      p(`You will check in, have your identity verified, receive examination instructions, store prohibited personal belongings, and enter the examination room when instructed.`),
      heading("3. During the examination"),
      p(`You must work independently, follow the instructions, remain quiet when required, respect the examination team, and raise your hand if you need procedural assistance.`),
      heading("4. You must not"),
      ul(["communicate with another candidate", "copy another candidate's work", "use unauthorised materials", "use a phone or unauthorised electronic device", "photograph or record examination content, or share examination tasks", "receive unauthorised assistance, or submit work that is not independently produced"]),
      heading("5. If you have a problem"),
      p(`Raise your hand and inform the invigilator. The examination team can explain examination procedures — they cannot explain, translate or provide answers to examination tasks.`),
      heading("6. Results"),
      p(`Your official result will be communicated after it has been officially released through the applicable ÖSD process. Easyway does not issue unofficial results.`),
      heading("Examination-day checklist"),
      p(`<strong>Before leaving home:</strong> ☐ valid identification document · ☐ your admission information · ☐ correct date and venue · ☐ permitted writing materials · ☐ no prohibited electronic devices · ☐ no notes or materials`),
      p(`<strong>At Easyway:</strong> ☐ check in · ☐ identity verified · ☐ belongings stored · ☐ instructions received · ☐ correct room · ☐ examination begins`),
      button("Open my admission slip", ctx.bookingUrl, "quiet"),
      sign(),
    ].join("")),
  };
}

function reminder7(ctx: EmailContext): RenderedEmail {
  return {
    subject: subject("Examination Reminder", ctx),
    attach: null,
    html: layout("Your ÖSD examination is approaching.", [
      hello(ctx),
      p(`Your ÖSD examination at Easyway is approaching.`),
      rows([
        { label: "Examination", value: examName(ctx) },
        { label: "Date", value: ctx.examDate },
        { label: "Arrival time", value: ctx.arrivalTime ?? "To be confirmed" },
        { label: "Start time", value: ctx.startTime ?? "To be confirmed" },
        { label: "Venue", value: `${ctx.venueName}${ctx.venueAddress ? `, ${ctx.venueAddress}` : ""}` },
        { label: "Reference", value: ctx.referenceCode },
      ]),
      p(`Before examination day, please:`),
      ul(["check your valid identification", "review the candidate examination guide", "check the examination location", "prepare permitted writing materials", "avoid bringing prohibited electronic devices into the examination area", "arrive early"]),
      p(`Please remember that examination rules apply to every candidate equally. We look forward to welcoming you.`),
      sign(),
    ].join("")),
  };
}

function reminder24(ctx: EmailContext): RenderedEmail {
  return {
    subject: subject("Examination Reminder (Tomorrow)", ctx),
    attach: null,
    html: layout("Your ÖSD examination takes place tomorrow.", [
      hello(ctx),
      p(`This is a reminder that your ÖSD examination will take place <strong>tomorrow</strong>.`),
      rows([
        { label: "Examination", value: examName(ctx) },
        { label: "Arrival", value: ctx.arrivalTime ?? "To be confirmed" },
        { label: "Start", value: ctx.startTime ?? "To be confirmed" },
        { label: "Venue", value: `${ctx.venueName}${ctx.venueAddress ? `, ${ctx.venueAddress}` : ""}` },
        { label: "Reference", value: ctx.referenceCode },
      ]),
      p(`Please bring your valid identification document. Please arrive early. Do not bring prohibited electronic devices or examination materials.`),
      p(`We wish you a successful examination.`),
      sign(),
    ].join("")),
  };
}

function resultPending(ctx: EmailContext): RenderedEmail {
  return {
    subject: subject("Result Update", ctx),
    attach: null,
    html: layout("Your ÖSD result is still in the official process.", [
      hello(ctx),
      p(`Thank you for your patience following your ÖSD examination. Your examination has been completed and is currently undergoing the official result process.`),
      referenceBlock(ctx),
      p(`Please note that Easyway cannot issue or confirm an official result before it has been officially released. We will communicate with you as soon as the official result becomes available.`),
      p(`Thank you for your understanding.`),
      sign(),
    ].join("")),
  };
}

function resultReleased(ctx: EmailContext): RenderedEmail {
  return {
    subject: subject("Examination Result Available", ctx),
    attach: null,
    html: layout("Your official ÖSD examination result is now available.", [
      hello(ctx),
      p(`We are pleased to inform you that your official ÖSD examination result is now available.`),
      referenceBlock(ctx),
      p(`Please follow the instructions provided by Easyway to receive your official result and certificate information. Congratulations on completing your examination.`),
      p(`If you have questions about the result document or certificate collection or delivery, please contact <a href="mailto:${e(OFFICE.email)}" style="color:${NAVY}">${e(OFFICE.email)}</a>.`),
      sign(),
    ].join("")),
  };
}

function certificateReady(ctx: EmailContext): RenderedEmail {
  return {
    subject: subject("Certificate Collection", ctx),
    attach: null,
    html: layout("Your ÖSD result/certificate is ready.", [
      hello(ctx),
      p(`Your ÖSD result/certificate is now available.`),
      rows([
        { label: "Candidate", value: ctx.fullName },
        { label: "Reference", value: ctx.referenceCode },
        { label: "Collection date/period", value: ctx.certificateCollection ?? "We will confirm the collection date shortly" },
      ]),
      p(`Please bring valid identification when collecting your document. Where delivery has been approved, the document will be handled according to Easyway's certificate-delivery procedure.`),
      p(`Please do not send another person to collect your certificate unless Easyway has confirmed that authorised collection by a representative is permitted.`),
      sign(),
    ].join("")),
  };
}

const RENDERERS: Record<JourneyStep, (ctx: EmailContext) => RenderedEmail> = {
  booking_received: bookingReceived,
  payment_reminder: paymentReminder,
  payment_confirmed: paymentConfirmed,
  info_check: infoCheck,
  prep_invite: prepInvite,
  admission,
  exam_guide: examGuide,
  reminder_7day: reminder7,
  reminder_24h: reminder24,
  result_pending: resultPending,
  result_released: resultReleased,
  certificate_ready: certificateReady,
};

export function renderJourneyEmail(step: JourneyStep, ctx: EmailContext): RenderedEmail {
  return RENDERERS[step](ctx);
}
