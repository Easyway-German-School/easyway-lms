/**
 * The one status a candidate has (Operations Manual §8: "Every candidate must
 * have one clearly defined status"), DERIVED from facts on the booking rather
 * than stored. A stored stage column would need every code path that touches a
 * booking to remember to advance it; a derived one is simply always right.
 *
 * Manual §8 numbering is kept for the statuses this system can actually know.
 * 01/02 (booking received / payment pending) collapse into one — a booking
 * only exists here once it is received, and it is unpaid until it isn't; 07
 * ("examination ready") is admitted-with-the-guide-sent, which is the same
 * fact as admitted from the candidate's side.
 */

export type StatusKey =
  | "cancelled"
  | "no_show"
  | "payment_pending"
  | "payment_review"
  | "information_required"
  | "documents_under_review"
  | "ready_to_admit"
  | "admitted"
  | "result_pending"
  | "result_released"
  | "certificate_ready"
  | "certificate_delivered";

export type CandidateStatus = {
  key: StatusKey;
  /** Manual §8 status number, where there is one. */
  number: number | null;
  /** Candidate-facing wording. */
  label: string;
  /** What the office should do next — shown on the admin pipeline. */
  staffNext: string | null;
  tone: "neutral" | "waiting" | "action" | "good" | "bad";
};

export type StatusFacts = {
  status: string; // booked | confirmed | cancelled | no_show
  paymentStatus: string;
  documentStatus: string;
  passportDataPageUrl: string | null;
  infoConfirmedAt: Date | string | null;
  admittedAt: Date | string | null;
  examCompletedAt: Date | string | null;
  resultReleasedAt: Date | string | null;
  certificateReadyAt: Date | string | null;
  certificateDeliveredAt: Date | string | null;
  // The details the manual (§7, §12) needs before anyone can be admitted.
  countryOfBirth: string | null;
  addressLine: string | null;
  city: string | null;
  idType: string | null;
  idNumber: string | null;
  idExpiry: Date | string | null;
};

const REQUIRED_FOR_ADMISSION: { key: keyof StatusFacts; label: string }[] = [
  { key: "countryOfBirth", label: "country of birth" },
  { key: "addressLine", label: "address" },
  { key: "city", label: "city" },
  { key: "idType", label: "ID document type" },
  { key: "idNumber", label: "ID number" },
  { key: "idExpiry", label: "ID expiry date" },
];

/** What is still blank that admission (Manual §12) cannot go ahead without. */
export function missingAdmissionFields(facts: StatusFacts): string[] {
  return REQUIRED_FOR_ADMISSION.filter(({ key }) => !facts[key]).map(({ label }) => label);
}

export function deriveStatus(facts: StatusFacts): CandidateStatus {
  if (facts.status === "cancelled") {
    return { key: "cancelled", number: null, label: "Cancelled", staffNext: null, tone: "bad" };
  }
  if (facts.status === "no_show") {
    return { key: "no_show", number: null, label: "Did not attend", staffNext: null, tone: "bad" };
  }
  if (facts.certificateDeliveredAt) {
    return { key: "certificate_delivered", number: 11, label: "Certificate delivered", staffNext: null, tone: "good" };
  }
  if (facts.certificateReadyAt) {
    return {
      key: "certificate_ready", number: 10, label: "Certificate ready",
      staffNext: "Mark it delivered once the candidate has collected it or it has been sent.", tone: "action",
    };
  }
  if (facts.resultReleasedAt) {
    return {
      key: "result_released", number: 10, label: "Result released",
      staffNext: "When the certificate arrives, mark it ready and say how to collect it.", tone: "action",
    };
  }
  if (facts.examCompletedAt) {
    return {
      key: "result_pending", number: 9, label: "Result pending",
      staffNext: "Release the result when the official ÖSD result arrives.", tone: "waiting",
    };
  }
  if (facts.admittedAt) {
    return { key: "admitted", number: 6, label: "Admitted", staffNext: null, tone: "good" };
  }

  if (facts.paymentStatus === "pending_verification") {
    return {
      key: "payment_review", number: 2, label: "Payment under review",
      staffNext: "Check the Moniepoint account, then verify the payment.", tone: "action",
    };
  }
  if (facts.paymentStatus !== "paid") {
    return {
      key: "payment_pending", number: 2, label: "Payment pending",
      staffNext: "Waiting for the transfer — verify it once it lands.", tone: "waiting",
    };
  }

  // Paid from here on.
  const missing = missingAdmissionFields(facts);
  if (missing.length > 0 || !facts.infoConfirmedAt) {
    return {
      key: "information_required", number: 3, label: "Information required",
      staffNext: missing.length > 0
        ? `Waiting on the candidate: ${missing.join(", ")}.`
        : "Waiting for the candidate to confirm their details are correct.",
      tone: "waiting",
    };
  }
  if (facts.documentStatus !== "approved") {
    const uploaded = Boolean(facts.passportDataPageUrl);
    return uploaded
      ? { key: "documents_under_review", number: 5, label: "Documents under review", staffNext: "Check the ID document, then approve or reject it.", tone: "action" }
      : { key: "information_required", number: 3, label: "Information required", staffNext: "Waiting for the candidate to upload their ID.", tone: "waiting" };
  }
  return {
    key: "ready_to_admit", number: 5, label: "Ready for admission",
    staffNext: "Everything checks out — admit the candidate.", tone: "action",
  };
}

/** The four things that must be true before "Admit" is allowed — for the admin checklist. */
export function admissionChecklist(facts: StatusFacts): { label: string; done: boolean }[] {
  const missing = missingAdmissionFields(facts);
  return [
    { label: "Payment verified", done: facts.paymentStatus === "paid" },
    { label: "Details complete and confirmed", done: missing.length === 0 && Boolean(facts.infoConfirmedAt) },
    { label: "ID document approved", done: facts.documentStatus === "approved" },
  ];
}

export type JourneyStepView = { key: string; label: string; state: "done" | "current" | "todo"; hint: string | null };

/**
 * The candidate-facing tracker: the same facts as `deriveStatus`, laid out as
 * the road ahead so a candidate always knows what is done, what is theirs to
 * do now, and what comes after. Exactly one step is "current" until the very
 * end (a cancelled booking has no journey).
 */
export function candidateJourney(facts: StatusFacts): JourneyStepView[] {
  const paid = facts.paymentStatus === "paid";
  const detailsDone = paid && missingAdmissionFields(facts).length === 0 && Boolean(facts.infoConfirmedAt);
  const idDone = facts.documentStatus === "approved";

  const steps: { key: string; label: string; done: boolean; hint: string }[] = [
    { key: "registered", label: "Registered", done: true, hint: "" },
    {
      key: "payment", label: "Payment", done: paid,
      hint: facts.paymentStatus === "pending_verification" ? "We're checking your transfer." : "Pay the invoice we emailed you.",
    },
    { key: "details", label: "Confirm your details", done: detailsDone, hint: "Check your details match your ID, then confirm." },
    {
      key: "id", label: "ID check", done: idDone,
      hint: facts.passportDataPageUrl ? "Our team is reviewing your ID." : "Upload the data page of your ID.",
    },
    { key: "admission", label: "Admission", done: Boolean(facts.admittedAt), hint: "The office admits you once everything checks out." },
    { key: "exam", label: "Examination day", done: Boolean(facts.examCompletedAt), hint: "" },
    { key: "result", label: "Official result", done: Boolean(facts.resultReleasedAt), hint: "Released through the official ÖSD process." },
    { key: "certificate", label: "Certificate", done: Boolean(facts.certificateDeliveredAt), hint: "" },
  ];

  const firstOpen = steps.findIndex((s) => !s.done);
  return steps.map((s, i) => ({
    key: s.key,
    label: s.label,
    state: s.done ? "done" : i === firstOpen ? "current" : "todo",
    hint: i === firstOpen && s.hint ? s.hint : null,
  }));
}
