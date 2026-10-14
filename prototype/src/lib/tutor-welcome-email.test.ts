import { beforeEach, describe, expect, it, vi } from "vitest";

const { queueEmail } = vi.hoisted(() => ({ queueEmail: vi.fn() }));
vi.mock("@/lib/email-queue", () => ({ queueEmail }));

import { sendTutorWelcomeEmail, tutorWelcomeHtml } from "./tutor-welcome-email";

describe("tutorWelcomeHtml", () => {
  it("includes the tutor login and the lecturer sign-in route", () => {
    const html = tutorWelcomeHtml({
      tutorName: "Ada Evans",
      tutorEmail: "ada@example.com",
      temporaryPassword: "TempPass123",
    });

    expect(html).toContain("Welcome to Easyway, Ada");
    expect(html).toContain("ada@example.com");
    expect(html).toContain("TempPass123");
    expect(html).toContain("/auth/lecturer/signin");
    expect(html).toContain("tutor portal");
  });

  it("escapes tutor-controlled content", () => {
    const html = tutorWelcomeHtml({
      tutorName: "<img src=x> Ada",
      tutorEmail: "ada&<b>@example.com",
      temporaryPassword: "<script>bad</script>",
    });

    expect(html).not.toContain("<img src=x>");
    expect(html).not.toContain("<script>bad</script>");
    expect(html).toContain("&lt;script&gt;bad&lt;/script&gt;");
  });
});

describe("sendTutorWelcomeEmail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("queues the welcome credentials for the tutor", async () => {
    queueEmail.mockResolvedValue({ status: "queued" });
    const input = {
      tutorName: "Ada Evans",
      tutorEmail: "ada@example.com",
      temporaryPassword: "TempPass123",
    };

    await sendTutorWelcomeEmail(input);

    expect(queueEmail).toHaveBeenCalledWith({
      to: input.tutorEmail,
      subject: "Welcome to Easyway — your tutor portal login",
      html: expect.stringContaining("TempPass123"),
      type: "tutor_welcome",
      identity: "noreply",
    });
  });
});
