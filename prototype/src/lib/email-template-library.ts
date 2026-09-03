import type { EmailBlock } from "@/lib/email-blocks";

/**
 * `Omit` over a union collapses it to the keys every member shares — which for
 * EmailBlock is just `type`, so `{ type: "text", text: "…" }` stops
 * type-checking. The conditional makes it distribute over each member instead,
 * preserving `text` on a heading and `href` on a button.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A block without its id — the id is minted when the template is loaded. */
export type TemplateBlock = DistributiveOmit<EmailBlock, "id">;

/**
 * Ready-made campaigns, as blocks.
 *
 * WHY PRESETS RATHER THAN A BLANK EDITOR. The composer works from an empty
 * canvas, and an empty canvas is why most schools send three emails a year.
 * The hard part of writing to three hundred students is not the formatting, it
 * is deciding what to say and in what order — so each of these is a complete,
 * defensible message that an admin edits rather than composes.
 *
 * THE COPY IS THE PRODUCT HERE. Every one of these follows the same rules the
 * AI drafting prompt enforces, because they are the reference the prompt was
 * written from:
 *
 *   - Lead with what changed, not with "We hope this email finds you well".
 *   - Say what the reader must DO, and by when.
 *   - Never threaten. "Speak to us" outperforms "or lose your seat", and this
 *     school's students are adults paying a large sum in instalments.
 *   - Leave the specifics as visible blanks — a date nobody replaced is
 *     obvious in the preview, whereas a plausible wrong date is not. That is
 *     why these read "Friday 00 Month" rather than a real-looking date.
 *
 * Merge fields resolve per recipient at send time: {{name}} and {{level}}.
 */

export type EmailTemplate = {
  id: string;
  /** Shown on the picker card. */
  name: string;
  /** One line on what this is for and when to send it. */
  purpose: string;
  subject: string;
  blocks: TemplateBlock[];
};

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: "welcome",
    name: "Welcome & enrolment confirmed",
    purpose: "A new student has paid and been placed in a class.",
    subject: "You are enrolled — here is what happens next",
    blocks: [
      { type: "heading", text: "Willkommen, {{name}} — you are in." },
      {
        type: "text",
        text: "Your place in {{level}} is confirmed and your portal is open. Everything you need is in one place: your timetable, your materials, your tutor and your classmates.",
      },
      { type: "callout", text: "Your first class: [day] at [time] WAT. Add it to your calendar now." },
      {
        type: "text",
        text: "Before your first lesson, do these two things — they take five minutes and they make the first class much easier:\n\nOpen your portal and check your timetable is right.\nInstall the app to your home screen so class reminders reach your phone.",
      },
      { type: "button", label: "Open my portal", href: "/dashboard" },
      {
        type: "text",
        text: "If anything above looks wrong — the level, the times, the branch — reply to this email today rather than waiting for your first class. It is far easier to move you now.",
      },
    ],
  },

  {
    id: "fee-reminder",
    name: "Fee reminder",
    purpose: "Tuition is due, or a balance is running. Firm, not threatening.",
    subject: "Your tuition balance — due [date]",
    blocks: [
      { type: "heading", text: "A reminder about your {{level}} tuition" },
      {
        type: "text",
        text: "Hallo {{name}}, your balance for this term is still outstanding. Settling it keeps your seat and keeps your portal open — materials, recordings and the live classroom all stay available.",
      },
      { type: "callout", text: "Due by [Friday 00 Month]. You can pay the 60% minimum or the full amount." },
      {
        type: "text",
        text: "Paying in full also releases the perks attached to it, including your exam-fee support. Paying the minimum is completely fine and keeps everything running.",
      },
      { type: "button", label: "Pay from my portal", href: "/payments" },
      { type: "divider" },
      {
        type: "text",
        text: "If the date is genuinely not possible, reply to this email and tell us what is. Nobody loses their place without being spoken to first — but we can only help if we hear from you before the date, not after.",
      },
    ],
  },

  {
    id: "schedule-change",
    name: "Class moved or cancelled",
    purpose: "A session has changed. Short, unmissable, and sent immediately.",
    subject: "Your class has moved — [day] at [time]",
    blocks: [
      { type: "callout", text: "[Day]'s class is now [new day] at [new time] WAT. Same room, same tutor." },
      {
        type: "text",
        text: "Hallo {{name}} — apologies for the short notice. Your {{level}} class has been moved, and nothing else about the week changes.",
      },
      {
        type: "text",
        text: "If you cannot make the new time, the session is recorded as always and lands in your library the same day. You will not lose the lesson.",
      },
      { type: "button", label: "See my timetable", href: "/calendar" },
    ],
  },

  {
    id: "new-materials",
    name: "New materials published",
    purpose: "Fresh lessons, worksheets or recordings are available.",
    subject: "New material for {{level}}",
    blocks: [
      { type: "heading", text: "Something new is waiting in your portal" },
      {
        type: "text",
        text: "Hallo {{name}} — your tutor has published new material for {{level}}. It is in your Materials tab now.",
      },
      {
        type: "text",
        text: "What has been added:\n\n[Name of the lesson or worksheet]\n[What it covers]\n[Roughly how long it takes]",
      },
      { type: "button", label: "Open my materials", href: "/materials" },
      { type: "divider" },
      {
        type: "text",
        text: "Working through new material before the next class is the single biggest difference between students who pass their level first time and students who repeat it. Twenty minutes is enough.",
      },
    ],
  },

  {
    id: "exam-registration",
    name: "Exam registration open",
    purpose: "Exam registration is open and has a hard deadline.",
    subject: "Exam registration is open — closes [date]",
    blocks: [
      { type: "heading", text: "Time to register for your {{level}} exam" },
      {
        type: "text",
        text: "Hallo {{name}}, registration for the next exam sitting is open. This is the certificate that counts for your visa and your employer, so the deadline is not one the exam body moves.",
      },
      { type: "callout", text: "Registration closes [date]. Exam date: [date]. Fee: ₦[amount]." },
      {
        type: "text",
        text: "Register through your portal and the office handles the paperwork with the exam centre. You will get your confirmation and your sitting details by email.",
      },
      { type: "button", label: "Register for the exam", href: "/exam-centre" },
      {
        type: "text",
        text: "Not sure you are ready? Speak to your tutor this week rather than skipping the sitting — in most cases the honest answer is that you are closer than you think.",
      },
    ],
  },

  {
    id: "pretest-student",
    name: "Mock exam — heads up (students)",
    purpose: "A practice / pretest sitting is coming. Set expectations, not nerves.",
    subject: "Your {{level}} mock exam — [Friday 00 Month]",
    blocks: [
      { type: "heading", text: "A mock exam is coming up, {{name}}" },
      {
        type: "text",
        text: "Your {{level}} class sits a mock exam soon. It is built exactly like the real ÖSD/telc paper — same sections, same timing — so the room on the day feels familiar instead of new.",
      },
      { type: "callout", text: "[Friday 00 Month] at [time] WAT · [branch / room] · bring a pen and your ID." },
      {
        type: "text",
        text: "What it is for:\n\nYou get a real score on every skill — reading, listening, writing, speaking — before it counts.\nYour tutor sees exactly where to spend the last few weeks.\nThe score is practice. It does not go on your certificate and it does not change your level.",
      },
      { type: "button", label: "See my timetable", href: "/calendar" },
      {
        type: "text",
        text: "Prepare the way you would for the real thing: one past paper, a full night's sleep, arrive early. If you genuinely cannot make this date, tell your tutor now so they can plan around it.",
      },
    ],
  },

  {
    id: "pretest-tutor",
    name: "Mock exam — heads up (tutors)",
    purpose: "Tell the tutor a mock is scheduled and what happens with the marks.",
    subject: "Mock exam for your {{level}} class — [Friday 00 Month]",
    blocks: [
      { type: "heading", text: "Mock exam scheduled for {{level}}" },
      {
        type: "text",
        text: "Hallo {{name}}, a mock / pretest sitting for your {{level}} class is set for [Friday 00 Month] at [time]. Please have the paper ready and run it under real conditions — timing and silence included.",
      },
      { type: "callout", text: "Enter every student's marks in the gradebook. Results release to students automatically once the whole class is marked — you do not need to flip anything." },
      {
        type: "text",
        text: "Before the day:\n\nConfirm the room and the start time with the office.\nPrint enough papers for the full register plus two.\nTell any student who will miss it to speak to you.",
      },
      { type: "button", label: "Open my gradebook", href: "/lecturer/gradebook" },
      { type: "divider" },
      {
        type: "text",
        text: "If you would rather hold results back — a class that needs a conversation first — you still can, from the gradebook, before the release window passes.",
      },
    ],
  },

  {
    id: "results-released",
    name: "Results are ready",
    purpose: "A sitting's results have been released. Neutral, points at the portal.",
    subject: "Your {{level}} results are ready",
    blocks: [
      { type: "heading", text: "Your results are in, {{name}}" },
      {
        type: "text",
        text: "The results for your recent {{level}} [exam / mock] have been released. You can see your score on every skill, your overall mark, and your tutor's notes in your portal now.",
      },
      { type: "button", label: "Open my results", href: "/results" },
      {
        type: "text",
        text: "Read the per-skill breakdown, not just the total — it is the fastest way to see where the next few weeks are best spent. If anything about the marks does not look right, reply to this email and the office will check it with your tutor.",
      },
    ],
  },

  {
    id: "level-complete",
    name: "Level complete — move up",
    purpose: "A cohort has finished. Congratulate, then offer the next level.",
    subject: "You finished {{level}} — what comes next",
    blocks: [
      { type: "heading", text: "Glückwunsch, {{name}}. {{level}} is behind you." },
      {
        type: "text",
        text: "You have finished the level. That is months of evenings after work, and it deserves to be said plainly: well done.",
      },
      { type: "callout", text: "Your certificate is in your portal now, under Certificates." },
      {
        type: "text",
        text: "The next level opens [month]. Students who move up in the same term keep their momentum and, honestly, their German — the gap between levels is where most people lose ground.",
      },
      { type: "button", label: "See my certificate and next level", href: "/certificates" },
      { type: "divider" },
      {
        type: "text",
        text: "If you are stopping here, that is completely fine — tell us, and we will make sure your records and your certificate are in order for wherever you take them next.",
      },
    ],
  },
];

/** Blocks for a template, with fresh ids so the editor can track them. */
export function templateBlocks(template: EmailTemplate): EmailBlock[] {
  return template.blocks.map(
    (block, index) =>
      ({ ...block, id: `t_${template.id}_${index}_${Math.random().toString(36).slice(2, 7)}` }) as EmailBlock,
  );
}
