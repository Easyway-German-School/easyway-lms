import { prisma } from "@/lib/prisma";
import { queueEmail } from "@/lib/email-queue";
import { capabilitiesForUser } from "@/lib/admin-roles";
import { KIND, notify } from "@/lib/notify";

/**
 * Office-facing alerts.
 *
 * These go to staff, not students, so they deliberately skip the unsubscribe
 * footer: an admin cannot opt out of being told a student just enrolled.
 *
 * Every function here swallows its own errors. An alert is a courtesy to the
 * office; it must never be the reason a student's signup or payment fails.
 */

/** Where an alert about one student should land. */
function studentLink(studentId?: string | null): string {
  return studentId ? `/admin/students/${studentId}` : "/admin/students";
}

type RegistrationAlert = {
  /**
   * Who to open. Null only when the post-create lookup failed, in which case
   * both the bell and the email fall back to the roster — a link to a list is
   * a mild annoyance, a link to /admin/students/null is a broken page.
   */
  studentId?: string | null;
  studentName: string;
  studentEmail: string;
  studentCode: string | null;
  level: string;
  sessionSlot: string;
  pathway: string;
  branchName: string | null;
  classType: string;
};

function registrationHtml(input: RegistrationAlert): string {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const target = studentLink(input.studentId);
  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:6px 12px 6px 0;color:#64748b;font-size:13px">${label}</td>
      <td style="padding:6px 0;color:#0f172a;font-size:13px;font-weight:600">${value}</td>
    </tr>`;

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#0f172a">
      <h2 style="margin:0 0 4px">New student registration</h2>
      <p style="margin:0 0 20px;color:#64748b;font-size:14px">
        ${input.studentName} just created an account.
      </p>

      <table style="width:100%;border-collapse:collapse;border-top:1px solid #e2e8f0">
        ${row("Name", input.studentName)}
        ${row("Email", input.studentEmail)}
        ${row("Student ID", input.studentCode ?? "not yet issued")}
        ${row("Level", input.level)}
        ${row("Session", input.sessionSlot)}
        ${row("Class type", input.classType === "private" ? "Private (one-to-one)" : "Group")}
        ${row("Pathway", input.pathway)}
        ${row("Branch", input.branchName ?? "not selected")}
      </table>

      <p style="margin:24px 0 0">
        <a href="${base}${target}"
           style="background:#0a7cff;color:#fff;padding:10px 22px;text-decoration:none;border-radius:6px;display:inline-block;font-size:14px">
          ${input.studentId ? "Open this student's file" : "Open the student roster"}
        </a>
      </p>

      <p style="margin-top:28px;border-top:1px solid #e2e8f0;padding-top:16px;font-size:12px;color:#94a3b8">
        Easyway German Language School — automatic staff alert.
      </p>
    </div>`;
}

/**
 * Tell the office a student registered.
 *
 * Only admins who can actually act on it are mailed — the ones with the
 * `students` capability. Mailing every admin turns a useful alert into noise
 * that people filter away, and then nobody sees the ones that matter.
 */
export async function notifyAdminsOfRegistration(input: RegistrationAlert): Promise<void> {
  try {
    // The bell, first: it arrives in seconds and does not depend on a mail
    // provider being configured, which — at time of writing — it is not.
    await notify({
      to: { audience: "admin", capability: "students" },
      kind: KIND.studentRegistered,
      severity: "info",
      title: `New registration: ${input.studentName}`,
      message: `${input.studentName} signed up for ${input.level} (${input.sessionSlot}${
        input.classType === "private" ? ", private" : ""
      }) at ${input.branchName ?? "no branch selected"}.`,
      link: studentLink(input.studentId),
      push: true,
    });
  } catch (error) {
    console.error("Could not raise admin registration notification:", error);
  }

  try {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN" },
      select: { email: true, adminRole: true, adminCapabilities: true },
    });

    const recipients = admins.filter(
      (a) => a.email && capabilitiesForUser(a.adminRole, a.adminCapabilities).includes("students"),
    );
    if (recipients.length === 0) return;

    const html = registrationHtml(input);
    const subject = `New registration: ${input.studentName} (${input.level})`;

    for (const admin of recipients) {
      await queueEmail({
        to: admin.email,
        subject,
        html,
        type: "admin_new_registration",
      });
    }
  } catch (error) {
    console.error("Could not queue admin registration alert:", error);
  }
}
