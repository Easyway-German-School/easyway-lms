import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcryptjs from "bcryptjs";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assignStudentCode } from "@/lib/student-code";
import { LEVELS } from "@/lib/levels";

export const dynamic = "force-dynamic";

/**
 * Bringing students who are ALREADY mid-course onto the LMS.
 *
 * The school does not start from zero on launch day: there are people three
 * weeks into B1 who have paid most of their fee. The generic importer that
 * existed only carried name, email and level, which produced accounts that
 * were technically real and practically useless — no branch, so no timetable,
 * no community space and no tutor; no batch, so the promotion engine could
 * never tell their level had ended; no payment record, so the paywall locked
 * them out of classes they had already paid for.
 *
 * This carries the fields that actually make an account work, and hands back
 * the generated passwords so the office can give people their logins.
 */

const SLOTS = ["morning", "afternoon", "evening"];

type ImportRow = Record<string, unknown>;

function str(row: ImportRow, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function money(value: string): number {
  // Offices type "150,000", "₦150000" and "150000.00". All mean the same thing.
  const digits = value.replace(/[^0-9.]/g, "");
  return Math.max(0, Math.round(Number(digits) || 0));
}

/** Readable, sayable-over-the-phone temporary password. */
function tempPassword(): string {
  return `Easyway${Math.floor(1000 + Math.random() * 9000)}!`;
}

async function requireAdmin() {
  const session = (await getServerSession(authOptions as any)) as any;
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if ((user?.role ?? "").toLowerCase() !== "admin") {
    return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }
  return { ok: true as const };
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const body = await request.json().catch(() => ({}));
    const rows: ImportRow[] = Array.isArray(body.rows) ? body.rows : [];
    // A dry run renders the preview table. Same code path as the real import,
    // so what the office previews is exactly what it gets.
    const dryRun = body.dryRun !== false;

    if (rows.length === 0) {
      return NextResponse.json({ error: "No rows to import" }, { status: 400 });
    }
    if (rows.length > 500) {
      return NextResponse.json({ error: "Import at most 500 students at a time" }, { status: 400 });
    }

    const branches = await prisma.branch.findMany({ select: { id: true, name: true } });
    const branchByName = new Map(branches.map((branch) => [branch.name.toLowerCase(), branch]));

    const results: Array<{
      row: number;
      name: string;
      email: string;
      level: string;
      branch: string | null;
      batch: string | null;
      sessionSlot: string;
      amountPaid: number;
      status: "ready" | "created" | "skipped" | "error";
      note: string;
      password?: string;
      studentCode?: string | null;
    }> = [];

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const name = str(row, "name", "full_name", "fullname", "student_name");
      const email = str(row, "email", "email_address").toLowerCase();
      const levelRaw = str(row, "level", "class", "current_level").toUpperCase();
      const level = (LEVELS as readonly string[]).includes(levelRaw) ? levelRaw : "A1";
      const branchName = str(row, "branch", "campus", "location");
      const batch = str(row, "batch", "start_month", "started");
      const slotRaw = str(row, "session", "session_slot", "slot", "time").toLowerCase();
      const sessionSlot = SLOTS.includes(slotRaw) ? slotRaw : "morning";
      const phone = str(row, "phone", "phone_number", "mobile");
      const amountPaid = money(str(row, "amount_paid", "paid", "amountpaid", "payment"));

      const base = {
        row: index + 1,
        name,
        email,
        level,
        branch: branchName || null,
        batch: batch || null,
        sessionSlot,
        amountPaid,
      };

      if (!name || !email) {
        results.push({ ...base, status: "error", note: "Name and email are both required" });
        continue;
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        results.push({ ...base, status: "error", note: "That email does not look valid" });
        continue;
      }

      const branch = branchName ? branchByName.get(branchName.toLowerCase()) : undefined;
      if (branchName && !branch) {
        results.push({
          ...base,
          status: "error",
          note: `No branch called "${branchName}". Use one of: ${branches.map((b) => b.name).join(", ")}`,
        });
        continue;
      }

      const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) {
        results.push({ ...base, status: "skipped", note: "Already has an account — left untouched" });
        continue;
      }

      if (dryRun) {
        results.push({
          ...base,
          status: "ready",
          note: batch
            ? "Will be created and placed on the timetable from their batch month"
            : "Will be created. Without a batch month their level-end date cannot be worked out",
        });
        continue;
      }

      const password = tempPassword();

      try {
        const user = await prisma.user.create({
          data: {
            email,
            name,
            password: await bcryptjs.hash(password, 10),
            role: "STUDENT",
            student: {
              create: {
                level,
                sessionSlot,
                branchId: branch?.id ?? null,
                pathway: str(row, "pathway", "program") || "Goethe exam mastery",
                // The batch month is what the timetable generator and the
                // promotion engine both read, so a mid-course student is
                // useless without it.
                admission: { batch: batch || undefined, phone: phone || undefined, importedAt: new Date().toISOString() },
              },
            },
          },
        });

        const student = await prisma.student.findUnique({ where: { userId: user.id }, select: { id: true } });
        let studentCode: string | null = null;
        if (student) {
          studentCode = await assignStudentCode(student.id, { level, batch });

          // Money already collected, recorded so the paywall does not lock a
          // student out of a class they have paid for.
          if (amountPaid > 0) {
            await prisma.payment.create({
              data: {
                studentId: student.id,
                amount: amountPaid,
                currency: "NGN",
                status: "completed",
                method: "imported",
                description: "Recorded on import — paid before joining the portal",
              },
            });
          }
        }

        results.push({ ...base, status: "created", note: "Account created", password, studentCode });
      } catch (rowError) {
        console.error("Student import row failed", rowError);
        results.push({ ...base, status: "error", note: "Could not create this account" });
      }
    }

    const counts = results.reduce<Record<string, number>>((acc, result) => {
      acc[result.status] = (acc[result.status] ?? 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({ dryRun, results, counts, branches: branches.map((b) => b.name) });
  } catch (error) {
    console.error("Student import failed", error);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}
