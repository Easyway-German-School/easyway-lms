import { TERMS_SECTIONS, type TermsSection } from "@/lib/terms-content";

export { TERMS_PREAMBLE, TERMS_SECTIONS } from "@/lib/terms-content";
export type { TermsBlock, TermsSection } from "@/lib/terms-content";

/**
 * WHICH TERMS, AND WHAT THE CODE IS ALLOWED TO ASSUME ABOUT THEM.
 *
 * The text itself is generated (terms-content.ts). This file is the part
 * written by hand: the version, the groupings, and the small amount of
 * vocabulary three different surfaces need to agree on.
 *
 * ---------------------------------------------------------------------------
 * WHY A VERSION STRING AND NOT A BOOLEAN
 * ---------------------------------------------------------------------------
 * The obvious shape for "has this student agreed" is a boolean on Student, and
 * it is wrong for one reason: section 20 reserves the school's right to amend
 * these terms. The moment the document changes, a `true` written last month
 * means "agreed to a text that no longer exists" — and there is no way to tell
 * that apart from "agreed to the current one" after the fact. A school that
 * cannot answer "which wording did this student accept" cannot rely on the
 * consent at all, which defeats the point of collecting it.
 *
 * So every acceptance stores the version it was given, and the version is the
 * document's own date rather than a running integer, so the answer is legible
 * without a lookup table.
 *
 * WHEN THE DOCUMENT CHANGES: re-run scripts/extract-terms.mjs, then bump both
 * constants below. Nothing else needs touching — the admin consent page reads
 * the current version and shows who is behind it, and the signup gate starts
 * asking for the new one on its next render.
 */
export const TERMS_VERSION = "2026-08-24";

/** The same version, for a human. Shown next to every consent record. */
export const TERMS_VERSION_LABEL = "24 August 2026";

export const TERMS_TITLE = "Student Terms and Conditions";
export const TERMS_SCHOOL = "Easyway German Language School";

/**
 * The only email channel section 24 recognises for a refund request.
 *
 * Named here rather than typed into the components, because section 24 also
 * says a request sent to ANY other address "shall not be processed or
 * considered" — so a typo in this string is not a cosmetic bug, it is a student
 * following our instructions to an address nobody reads.
 */
export const REFUND_EMAIL = "germanprivateclass@gmail.com";

/**
 * WHERE A CONSENT RECORD CAME FROM.
 *
 * Kept as an explicit vocabulary rather than a free-text column because the
 * admin page counts by it, and "how many people accepted at signup" is a
 * different and more interesting number than "how many acknowledged the refund
 * policy on their way to asking for their money back".
 */
export const TERMS_CONTEXT = {
  /** The unskippable gate on the last step of the signup form. */
  signup: "signup",
  /** Acknowledged on the way into a refund request. */
  refund: "refund",
  /** Accepted inside the portal, after the document was amended. */
  reprompt: "reprompt",
} as const;

export type TermsContext = (typeof TERMS_CONTEXT)[keyof typeof TERMS_CONTEXT];

export const isTermsContext = (value: unknown): value is TermsContext =>
  typeof value === "string" && Object.values(TERMS_CONTEXT).includes(value as TermsContext);

/**
 * THE SECTIONS THE REFUND WALL LEADS WITH.
 *
 * A student who clicks "request a refund" is not asking to reread the
 * attendance policy, and burying the answer at position 51 of 58 would be a
 * way of technically disclosing it while practically hiding it. These four
 * come first, in this order — what the policy is, when it does apply, how to
 * ask, how long it takes — and the full document is still there underneath,
 * because the wall must never be able to be described as a summary that left
 * the inconvenient part out.
 *
 * 6 and 7 are deliberately NOT here despite both mentioning refunds: 6 is
 * about payment deadlines and 7 is an earlier, shorter statement that 23
 * supersedes in detail. Leading with the short version would understate it.
 */
export const REFUND_SECTION_NUMBERS = ["23", "24", "25", "26"] as const;

/** One section by its number in the school's own scheme, or undefined. */
export function termsSection(number: string): TermsSection | undefined {
  return TERMS_SECTIONS.find((section) => section.number === number);
}

/** The refund sections, in the order the wall shows them. Missing numbers are skipped. */
export function refundSections(): TermsSection[] {
  return REFUND_SECTION_NUMBERS.map(termsSection).filter((section): section is TermsSection => Boolean(section));
}

/**
 * Everything except the refund sections, for the "and here is the rest of it"
 * half of the wall. Order is the document's own.
 */
export function nonRefundSections(): TermsSection[] {
  const lead = new Set<string>(REFUND_SECTION_NUMBERS);
  return TERMS_SECTIONS.filter((section) => !lead.has(section.number));
}

/**
 * THE FALLBACK FOR SOMEBODY WITH NO CONSENT RECORD.
 *
 * The refund wall's strongest line is "you agreed to this on 12 August" — and
 * for every student who enrolled before this gate existed, there is no such
 * date. Inventing one is out of the question, and staying silent invites the
 * obvious reply ("I never agreed to any of that").
 *
 * Section 30 already answers it, in the school's own words, so the wall quotes
 * that instead. This is the exact sentence to use — it is a quotation, not a
 * paraphrase, and it should keep reading as one.
 */
export const ACCEPTANCE_WITHOUT_RECORD =
  termsSection("30")?.blocks[0]?.text ??
  "Payment of any tuition fee, registration fee, examination fee, or travel package fee constitutes full acceptance of these Terms and Conditions, whether or not the student has signed a physical copy.";
