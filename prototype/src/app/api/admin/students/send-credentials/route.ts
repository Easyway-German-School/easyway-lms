import { NextRequest, NextResponse } from "next/server";
import bcryptjs from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { sendStudentWelcomeEmail } from "@/lib/student-welcome-email";
import { generateTempPassword } from "@/lib/student-password";

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
 *
 * Two request shapes:
 *   { students: [{ name, email, password, studentCode }] }
 *       — the caller already has the freshly minted password in hand (the
 *         import / paste / single-add screens, while that screen is still open).
 *   { emails: ["a@x.com", …], includeSelfRegistered?: boolean }
 *       — RECOVERY. The screen that held the passwords was closed before they
 *         were sent, so there is nothing left to "resend" — this mints a fresh
 *         temporary password for each account, saves it, and sends the welcome
 *         email. Office-imported accounts only unless `includeSelfRegistered`:
 *         a student who signed up themselves has a password they chose and a
 *         self-service reset, and must not have it pulled out from under them
 *         by a batch job.
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

  const emailList: string[] = Array.isArray(body.emails)
    ? Array.from(
        new Set(
          body.emails
            .map((value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
            .filter((value: string) => value.includes("@")),
        ),
      )
    : [];

  // ── RECOVERY PATH: reset + send, keyed by email ──────────────────────────
  if (emailList.length > 0) {
    if (emailList.length > 500) {
      return NextResponse.json({ error: "Send at most 500 at a time" }, { status: 400 });
    }

    const tenantId = gate.session.user.tenantId ?? null;
    // `force` re-issues even for a student we already sent a login to — for
    // when the first batch of mail genuinely did not arrive (provider down,
    // wrong address since corrected). Without it, a student who already has a
    // login on the way is left alone so a second click cannot silently move a
    // password out from under someone who has started using it.
    const force = body.force === true;
    const includeSelfRegistered = body.includeSelfRegistered === true;

    const users = await prisma.user.findMany({
      where: {
        email: { in: emailList },
        role: "STUDENT",
        // A no-tenant student (SQLite-era / early import) is still ours to act
        // on — same widening the roster query uses.
        ...(tenantId ? { OR: [{ tenantId }, { tenantId: null }] } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        student: { select: { id: true, studentCode: true, admission: true } },
      },
    });

    const found = new Set(users.map((u) => u.email.toLowerCase()));

    const perUser = await Promise.all(
      users.map(async (user) => {
        const admission = (user.student?.admission ?? null) as Record<string, unknown> | null;
        const wasImported = Boolean(admission && typeof admission === "object" && admission.importedAt);
        const alreadySent = Boolean(admission && typeof admission === "object" && admission.loginSentAt);

        if (!wasImported && !includeSelfRegistered) {
          return { email: user.email, emailed: false, skipped: "registered themselves" as const };
        }
        if (alreadySent && !force) {
          return { email: user.email, emailed: false, alreadySent: true as const };
        }

        const password = generateTempPassword();
        try {
          await prisma.user.update({
            where: { id: user.id },
            data: { password: await bcryptjs.hash(password, 10), passwordClaimed: true },
          });
          await sendStudentWelcomeEmail({
            studentName: user.name ?? "there",
            studentEmail: user.email,
            temporaryPassword: password,
            studentCode: user.student?.studentCode ?? null,
          });
          // Mark it so a later "send again" does not re-roll this password.
          if (user.student?.id) {
            await prisma.student.update({
              where: { id: user.student.id },
              data: { admission: { ...(admission ?? {}), loginSentAt: new Date().toISOString() } },
            });
          }
          return { email: user.email, emailed: true, reset: true };
        } catch (error) {
          console.error("Could not reset + send login for", user.email, error);
          return { email: user.email, emailed: false, error: "Could not send this one" };
        }
      }),
    );

    const notFoundEmails = emailList.filter((email) => !found.has(email));
    const notFound = notFoundEmails.map((email) => ({ email, emailed: false, notFound: true as const }));

    return NextResponse.json({
      results: [...perUser, ...notFound],
      sent: perUser.filter((r) => r.emailed).length,
      alreadySent: perUser.filter((r) => "alreadySent" in r && r.alreadySent).length,
      skipped: perUser.filter((r) => "skipped" in r && r.skipped).length,
      skippedEmails: perUser.filter((r) => "skipped" in r && r.skipped).map((r) => r.email),
      notFound: notFound.length,
      notFoundEmails,
    });
  }

  // ── ORIGINAL PATH: caller supplies the password ─────────────────────────
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
