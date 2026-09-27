import { describe, expect, it } from "vitest";
import { JOURNEY_ORDER, firstNameOf, renderJourneyEmail, type EmailContext, type JourneyStep } from "./journey-emails";

const ctx: EmailContext = {
  fullName: "Dr. Yejide Lamina",
  email: "yejide@example.com",
  referenceCode: "EW-OSD-2026-OBB052",
  invoiceNumber: "EW-OSD-INV-2026-OBB052",
  level: "B2",
  modulesLabel: "Written + Oral",
  express: false,
  expressFee: 0,
  feeTotal: 210_000,
  amountReceived: 210_000,
  examDate: "Thursday, 29 October 2026",
  venueName: "Easyway German Language School",
  venueAddress: "23, Unity Road, Ikeja, Lagos",
  arrivalTime: "8:00 AM",
  startTime: "9:00 AM",
  seatNumber: 12,
  registrationDeadline: "20 October 2026",
  bank: { bankName: "Moniepoint MFB", accountName: "Easyway Sprachschule", accountNumber: "6547656725" },
  paymentReference: "LAMINA EW-OSD-INV-2026-OBB052",
  bookingUrl: "https://osd.example/booking/EW-OSD-2026-OBB052?email=yejide%40example.com",
  prepUrl: "https://osd.example/prepare?ref=EW-OSD-2026-OBB052&email=yejide%40example.com",
  termsUrl: "https://osd.example/terms",
  missingFields: ["ID number", "address"],
  idUploaded: false,
  daysToExam: 24,
  certificateCollection: "From 12 Nov, 10am–4pm, with valid ID",
  candidateDetails: [{ label: "Full name", value: "Dr. Yejide Lamina" }],
};

const all = JOURNEY_ORDER.map((step) => [step, renderJourneyEmail(step, ctx)] as const);

describe("every journey email", () => {
  it.each(all)("%s follows the manual's subject standard and carries the reference", (step, email) => {
    // Manual §47: "[Easyway ÖSD] <what> – <reference>"
    expect(email.subject).toMatch(/^\[Easyway ÖSD\] .+ – EW-OSD-2026-OBB052$/);
    expect(email.html).toContain("EW-OSD-2026-OBB052");
    expect(email.html).toContain("exams@easywaylanguageschool.com"); // a contact channel, §46
    expect(step).toBeTruthy();
  });

  it.each(all)("%s greets the candidate by first name, skipping the title", (_step, email) => {
    expect(email.html).toContain("Dear Yejide,");
  });

  it.each(all)("%s never promises a result, a pass, a refund, or an admission (Manual §12, §15, §41)", (_step, email) => {
    const text = email.html.replace(/<[^>]+>/g, " ").toLowerCase();
    expect(text).not.toMatch(/guarantee|you will pass|you have passed|congratulations, you passed|money.back|refund you|you are guaranteed/);
  });
});

describe("attachments", () => {
  it("attaches the invoice to the booking email and the reminder, the receipt to the payment email, and nothing else", () => {
    const attach = Object.fromEntries(all.map(([step, e]) => [step, e.attach]));
    expect(attach.booking_received).toBe("invoice");
    expect(attach.payment_reminder).toBe("invoice");
    expect(attach.payment_confirmed).toBe("receipt");
    const others = JOURNEY_ORDER.filter((s) => !["booking_received", "payment_reminder", "payment_confirmed"].includes(s));
    for (const step of others) expect(attach[step]).toBeNull();
  });
});

describe("the booking email (Document A)", () => {
  const html = renderJourneyEmail("booking_received", ctx).html;
  it("has the status, the amount, the exact bank details and the payment reference", () => {
    expect(html).toContain("BOOKING RECEIVED — PAYMENT PENDING");
    expect(html).toContain("₦210,000");
    expect(html).toContain("6547656725");
    expect(html).toContain("Easyway Sprachschule");
    expect(html).toContain("LAMINA EW-OSD-INV-2026-OBB052");
    expect(html).toContain("20 October 2026");
  });
  it("warns against paying a person, and states the non-refundable rule", () => {
    expect(html).toContain("Please do not send payment to any personal bank account or to any member of staff");
    expect(html).toContain("non-refundable");
  });
  it("does not sell prep classes — the candidate hasn't even paid yet", () => {
    expect(html.toLowerCase()).not.toContain("prep");
  });
});

describe("the upsell is one soft email, not a theme", () => {
  it("appears only in the prep note", () => {
    for (const [step, email] of all) {
      const mentionsPrep = /prep(aration)? class|prepare|prepUrl|\/prepare/i.test(email.html.replace(ctx.prepUrl, "PREP_LINK")) || email.html.includes(ctx.prepUrl);
      if (step === "prep_invite") expect(mentionsPrep).toBe(true);
      else expect(email.html.includes(ctx.prepUrl), `${step} should not link to prep classes`).toBe(false);
    }
  });

  it("says it is optional, has no bearing on the result, and asks for nothing", () => {
    const html = renderJourneyEmail("prep_invite", ctx).html;
    expect(html).toContain("entirely optional");
    expect(html).toContain("no bearing on your registration, your admission or your result");
    expect(html).toContain("no payment and no obligation");
    expect(html).not.toMatch(/₦\d/); // no price in the pitch
  });

  it("leads with useful advice, and the class mention comes after it", () => {
    const html = renderJourneyEmail("prep_invite", ctx).html;
    expect(html.indexOf("timed practice paper")).toBeGreaterThan(-1);
    expect(html.indexOf("timed practice paper")).toBeLessThan(html.indexOf("exam-preparation classes"));
  });
});

describe("Document C, the details check", () => {
  it("lists exactly what is still missing", () => {
    const html = renderJourneyEmail("info_check", ctx).html;
    expect(html).toContain("ID number, address");
    expect(html).toContain("upload a clear photo".replace("upload", "Upload")); // ID not yet uploaded
  });
  it("drops the missing-details ask once nothing is missing", () => {
    const html = renderJourneyEmail("info_check", { ...ctx, missingFields: [], idUploaded: true }).html;
    expect(html).not.toContain("still missing");
    expect(html).not.toContain("Upload a clear photo");
  });
});

describe("the admission letter (Document D)", () => {
  it("shows arrival and start times, or says they're to be confirmed rather than inventing them", () => {
    expect(renderJourneyEmail("admission", ctx).html).toContain("8:00 AM");
    const unknown = renderJourneyEmail("admission", { ...ctx, arrivalTime: null, startTime: null, seatNumber: null }).html;
    expect(unknown).toContain("To be confirmed by the examination team");
    expect(unknown).not.toContain("Seat number");
  });
});

describe("safety", () => {
  it("escapes a hostile candidate name in every email", () => {
    const evil = { ...ctx, fullName: `Eve <script>alert(1)</script> "Bobby" & Co` };
    for (const step of JOURNEY_ORDER as JourneyStep[]) {
      const html = renderJourneyEmail(step, evil).html;
      expect(html, step).not.toContain("<script>");
    }
  });

  it("finds a first name past titles", () => {
    expect(firstNameOf("Dr. Yejide Lamina")).toBe("Yejide");
    expect(firstNameOf("Mrs Ada Obi")).toBe("Ada");
    expect(firstNameOf("Chidi")).toBe("Chidi");
    expect(firstNameOf("  ")).toBe("Candidate");
  });
});
