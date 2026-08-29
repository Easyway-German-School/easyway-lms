import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { sendStudentWelcomeEmail } from "@/lib/student-welcome-email";

/**
 * The office's "send it now" button for accounts it just created.
 *
 * Single add, the paste-many tool, and the CSV importer all mint a password
 * up front and show it on screen — but until now getting that login to the
 * student meant the office copying it into their own mail client by hand.
 * This is the one place all three call to queue the welcome email instead,
 * so "add students" and "tell them how to sign in" stop being two separate
 * jobs the office has to remember to do.
 *
 * Deliberately per-row rather than all-or-nothing: one bad address in a batch
 * of thirty must not stop the other twenty-nine from going out.
 */

export const dynamic = "force-dynamic";

type CredentialRow = {
  name?: string;
  email?: string;
  password?: string;
  studentCode?: string | null;
};

export async function POST(request: NextRequest) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const rows: CredentialRow[] = Array.isArray(body.students) ? body.students : [];

  if (rows.length === 0) {
    return NextResponse.json({ error: "No students to send to" }, { status: 400 });
  }
  if (rows.length > 500) {
    return NextResponse.json({ error: "Send at most 500 at a time" }, { status: 400 });
  }

  const results = await Promise.all(
    rows.map(async (row) => {
      const email = typeof row.email === "string" ? row.email.trim() : "";
      const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : "there";
      const password = typeof row.password === "string" ? row.password : "";

      if (!email || !password) {
        return { email, emailed: false, error: "Missing email or password" };
      }

      try {
        await sendStudentWelcomeEmail({
          studentName: name,
          studentEmail: email,
          temporaryPassword: password,
          studentCode: row.studentCode ?? null,
        });
        return { email, emailed: true };
      } catch (error) {
        console.error("Could not queue welcome email for", email, error);
        return { email, emailed: false, error: "Could not queue this email" };
      }
    }),
  );

  return NextResponse.json({ results, sent: results.filter((r) => r.emailed).length });
}
