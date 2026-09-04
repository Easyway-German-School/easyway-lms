import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import bcryptjs from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { assignStudentCode } from "@/lib/student-code";
import { LEVELS } from "@/lib/levels";
import { bestMatch, matchBatch, matchDeliveryMode, matchLevel, matchSessionSlot } from "@/lib/fuzzy-match";
import { generateTempPassword } from "@/lib/student-password";
import { ensureChargeForLevel } from "@/lib/tuition-charges";
import { isOnlineBranch } from "@/lib/online-branch";

import { requireCapability } from "@/lib/admin-roles";
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

const SLOTS = ["morning", "afternoon", "evening", "weekend"];

type ImportRow = Record<string, unknown>;

function str(row: ImportRow, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function normalizedKey(key: string): string {
  return key.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function rowValue(row: ImportRow, aliases: string[]): string {
  const normalized = new Map(Object.entries(row).map(([key, value]) => [normalizedKey(key), value]));
  for (const alias of aliases) {
    const value = normalized.get(normalizedKey(alias));
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function money(value: string): number {
  // Offices type "150,000", "₦150000", "150000.00" and — this school's own
  // habit — "150K" for 150,000. All mean the same thing.
  const trimmed = value.trim();
  const shorthand = /^[₦$]?\s*([\d.,]+)\s*([km])\s*$/i.exec(trimmed);
  if (shorthand) {
    const n = Number(shorthand[1].replace(/,/g, ""));
    const multiplier = shorthand[2].toLowerCase() === "k" ? 1_000 : 1_000_000;
    return Math.max(0, Math.round((Number.isFinite(n) ? n : 0) * multiplier));
  }
  const digits = trimmed.replace(/[^0-9.]/g, "");
  return Math.max(0, Math.round(Number(digits) || 0));
}

/**
 * A stand-in for a student the office has no email address for yet — this
 * spreadsheet's own "phone but no email" shape, not a hypothetical. `noemail.`
 * makes the account findable later (grep the roster for the prefix), and the
 * `.placeholder.` subdomain means nothing here is ever a real mailbox this
 * school's domain has to answer for — no bounce, no deliverability hit.
 */
function placeholderEmail(): string {
  return `noemail.${randomBytes(5).toString("hex")}@students.placeholder.easywayschoollms.com.ng`;
}

export async function POST(request: NextRequest) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

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
    /**
     * Branch aliases the office actually writes.
     *
     * "PH" for Port Harcourt is the one that matters — it is shorter than the
     * containment floor in `bestMatch` and a hundred edit-distances away from
     * the real name, so nothing but an explicit alias will ever catch it.
     */
    const branchCandidates = branches.map((branch) => ({
      value: branch,
      label: branch.name,
      aliases: /port\s*harcourt/i.test(branch.name) ? ["ph", "phc"] : [],
    }));

    // Resolved lazily — most imports have branches for every row and never
    // need this looked up.
    let onlineBranch: { id: string; name: string } | null | undefined;
    async function resolveOnlineBranch() {
      if (onlineBranch === undefined) {
        const candidates = await prisma.branch.findMany({ select: { id: true, name: true, mode: true } });
        onlineBranch = candidates.find((b) => isOnlineBranch(b)) ?? null;
      }
      return onlineBranch;
    }

    const results: Array<{
      row: number;
      name: string;
      email: string;
      level: string;
      branch: string | null;
      batch: string | null;
      sessionSlot: string;
      deliveryMode: string;
      amountPaid: number;
      status: "ready" | "created" | "skipped" | "error";
      note: string;
      /** "portharcourt → Port Harcourt". Shown in the preview, never hidden. */
      corrections?: string[];
      password?: string;
      studentCode?: string | null;
      /** True when this row had no email and one was minted to create the account. */
      placeholderEmail?: boolean;
    }> = [];

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const name = rowValue(row, [
        "name", "names", "student", "student name", "student names", "student full name",
        "full name", "fullname", "name of student", "name of students", "learner name",
      ]);
      const emailInput = rowValue(row, [
        "email", "email address", "email id", "email address of student", "mail", "e-mail",
      ]).toLowerCase();
      // No email on file at all — mint a placeholder rather than reject the
      // whole row, since this school's own walk-in sheets carry a phone number
      // and nothing else. Never invented for a row that gave an email that
      // merely looks wrong — that is still an error below, not a guess.
      const placeholderEmailUsed = !emailInput;
      const email = emailInput || placeholderEmail();
      /**
       * SPELLING IS NOT DATA ENTRY'S JOB.
       *
       * Every one of these was an exact match before, and a spreadsheet
       * reading `portharcourt` for `Port Harcourt` failed fifteen of twenty
       * rows with "no branch called portharcourt". Nobody typed anything
       * wrong; they just did not type it the way the database stores it.
       *
       * Each field now resolves through `bestMatch`, and every correction is
       * collected so the preview can show the admin exactly what was read as
       * what. Silent reinterpretation would be worse than the original bug.
       */
      const corrections: string[] = [];
      // Generic so it passes the match through unchanged — typing the
      // parameter as the structural shape erased `value` from every caller.
      const note = <M extends { input: string; label: string; corrected: boolean } | null>(match: M): M => {
        if (match?.corrected) corrections.push(`${match.input} → ${match.label}`);
        return match;
      };

      const levelInput = str(row, "level", "class", "current_level");
      const levelMatch = note(matchLevel(levelInput, LEVELS));
      const level = levelMatch?.value ?? "A1";

      const branchInput = str(row, "branch", "campus", "location");
      const branchMatch = branchInput ? note(bestMatch(branchInput, branchCandidates)) : null;
      const branchName = branchMatch?.label ?? branchInput;

      const batchInput = str(row, "batch", "start_month", "started");
      const batchMatch = batchInput ? note(matchBatch(batchInput)) : null;
      const batch = batchMatch?.value ?? batchInput;

      const slotMatch = note(matchSessionSlot(str(row, "session", "session_slot", "slot", "time")));
      const sessionSlot = slotMatch?.value ?? "morning";

      // "Type of class" in this school's own sheets means how the student
      // attends (online/physical/hybrid) — a different question from group vs
      // private, which has no column here and stays the create-call's default.
      const deliveryModeInput = str(row, "type_of_class", "class_type", "delivery_mode", "attendance", "attending");
      const deliveryModeMatch = deliveryModeInput ? note(matchDeliveryMode(deliveryModeInput)) : null;
      const deliveryMode = deliveryModeMatch?.value ?? "physical";

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
        deliveryMode,
        amountPaid,
        corrections: corrections.length ? corrections : undefined,
        placeholderEmail: placeholderEmailUsed || undefined,
      };

      if (!name) {
        results.push({ ...base, status: "error", note: "A name is required" });
        continue;
      }
      if (!placeholderEmailUsed && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        results.push({ ...base, status: "error", note: "That email does not look valid" });
        continue;
      }
      // A level was typed but did not resolve to any offered level — silently
      // filing this student as A1 would be a guess dressed up as a read, and
      // the fuzzy-match module's whole point is refusing to do that.
      if (levelInput && !levelMatch) {
        results.push({
          ...base,
          status: "error",
          note: `No level close to "${levelInput}". Use one of: ${LEVELS.join(", ")}`,
        });
        continue;
      }

      let branch = branchMatch?.value as { id: string; name: string } | null | undefined;
      if (branchInput && !branch) {
        results.push({
          ...base,
          status: "error",
          note: `No branch close to "${branchInput}". Use one of: ${branches.map((b) => b.name).join(", ")}`,
        });
        continue;
      }
      // Online, but the sheet gave no branch to place them at (this school's
      // own sheets leave BRANCH blank for every online row) — the online
      // branch itself is the answer, the same way a physical row's branch
      // decides its fee table, its roster and its community space.
      if (!branch && deliveryMode === "online") {
        branch = (await resolveOnlineBranch()) ?? undefined;
      }

      const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, tenantId: true } });
      if (existing) {
        if (!dryRun && !existing.tenantId && gate.session.user.tenantId) {
          await prisma.user.update({
            where: { id: existing.id },
            data: { tenantId: gate.session.user.tenantId },
          });
        }
        results.push({ ...base, status: "skipped", note: "Already has an account — left untouched" });
        continue;
      }

      if (dryRun) {
        const timetableNote = batch
          ? "Will be created and placed on the timetable from their batch month"
          : "Will be created. Without a batch month their level-end date cannot be worked out";
        results.push({
          ...base,
          status: "ready",
          note: placeholderEmailUsed
            ? `${timetableNote}. No email on file — a placeholder account is created; add their real email from the student's profile before sending login details.`
            : timetableNote,
        });
        continue;
      }

      const password = generateTempPassword();

      try {
        const user = await prisma.user.create({
          data: {
            email,
            name,
            password: await bcryptjs.hash(password, 10),
            role: "STUDENT",
            tenantId: gate.session.user.tenantId ?? null,
            student: {
              create: {
                level,
                sessionSlot,
                deliveryMode,
                branchId: branch?.id ?? null,
                pathway: str(row, "pathway", "program") || "Language training",
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
          studentCode = await assignStudentCode(student.id, {
            level,
            batch,
            branch,
            classType: str(row, "classType") === "private" ? "private" : "group",
          });

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

          // Open the tuition ledger for the level they are imported into. Lower
          // levels a mid-course import already passed are the backfill script's
          // job (or an admin adjustment); this covers the level they're in now.
          try {
            await ensureChargeForLevel({ studentId: student.id, level, origin: "import" });
          } catch (chargeError) {
            console.error("Tuition charge creation failed on import", chargeError);
          }
        }

        results.push({
          ...base,
          status: "created",
          note: placeholderEmailUsed
            ? "Account created with a placeholder email — add their real email from the student's profile before sending login details"
            : "Account created",
          password,
          studentCode,
        });
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

// Long-running: model calls / bulk work. Set here (not vercel.json) so it
// travels with the route regardless of where the app is built from.
export const maxDuration = 60;
