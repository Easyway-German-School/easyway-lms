import { prisma } from "@/lib/prisma";
import { nextLevelAfter } from "@/lib/levels";
import { completeLevelForStudents } from "@/lib/germany-journey-server";
import { issueCertificateForStudent } from "@/lib/certificates";
import { promoteStudents } from "@/lib/promotion";
import { KIND, notify } from "@/lib/notify";
import { normaliseDeliveryMode } from "@/lib/access";
import { requiredDepositFor, tuitionFeeFor } from "@/lib/payment";
import { buildInvite } from "@/lib/next-level-invite";
import { cleanDetails, readIntent, type NextLevelIntent } from "@/lib/next-level-journey";
import { loadJourney, loadJourneyStudent, opensFor, seatAndOwed } from "@/lib/next-level-journey-server";
import { readIntakeStartDayOverrides } from "@/lib/intake-server";

/**
 * The office's manual path: Students → Graduate.
 *
 * The automatic lists (the Graduation desk, the Next level pipeline) decide who
 * is due by rules. This is for the other case — "I, the admin, am choosing THIS
 * student" — so nobody is stranded outside the rules, and so a click is never
 * the thing that moves a student: the dialog previews, then asks, then applies.
 *
 *   preview   read-only: who, which level, price, opening day, what is on file
 *   apply     mode "invite"  mark them offered; Becca speaks to them; no level change
 *             mode "move"    sign the level off, issue the certificate, move them up
 *                            into the next intake (same steps as the Graduation
 *                            desk), then speak to them
 *
 * Either way the details the admin edited are written to the student's own
 * record, which the tutor rosters, the timetable, the dossier and the student's
 * portal all read — one source, so every screen shows the same thing.
 */

export type MoveUpPreview = {
  studentId: string;
  name: string;
  email: string;
  level: string;
  targetLevel: string | null;
  branchName: string | null;
  tuitionFee: number;
  requiredDeposit: number;
  priorOwed: number;
  opensLabel: string | null;
  current: {
    sessionSlot: string;
    deliveryMode: string;
    phone: string;
    parentPhone: string;
    note: string;
  };
  alreadyOffered: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export async function previewMoveUp(studentId: string): Promise<MoveUpPreview | null> {
  const student = await loadJourneyStudent({ id: studentId });
  if (!student) return null;
  const target = nextLevelAfter(student.level);
  const admission = asRecord(student.admission);
  const branchName = student.branch?.name ?? null;

  let priorOwed = 0;
  let opensLabel: string | null = null;
  if (target) {
    priorOwed = (await seatAndOwed(student.id, target)).priorOwed;
    // The real opening day for THIS student's level (per-level overrides included).
    const overrides = await readIntakeStartDayOverrides(student.tenantId ?? null);
    opensLabel = opensFor(student, { state: "invited", finishedLevel: student.level, targetLevel: target }, overrides, new Date()).opensLabel;
  }

  const intent = target ? readIntent(admission, target) : null;
  return {
    studentId: student.id,
    name: student.user.name || student.user.email,
    email: student.user.email,
    level: student.level,
    targetLevel: target,
    branchName,
    tuitionFee: target ? tuitionFeeFor({ level: target, branch: branchName, pathway: student.pathway }) : 0,
    requiredDeposit: target ? requiredDepositFor({ level: target, branch: branchName }) : 0,
    priorOwed,
    opensLabel,
    current: {
      sessionSlot: student.sessionSlot ?? "morning",
      deliveryMode: normaliseDeliveryMode(student.deliveryMode),
      phone: intent?.details?.phone ?? (typeof admission.phone === "string" ? admission.phone : ""),
      parentPhone: intent?.details?.parentPhone ?? (typeof admission.parentPhone === "string" ? admission.parentPhone : ""),
      note: intent?.details?.note ?? "",
    },
    alreadyOffered: intent?.manualOffer === true,
  };
}

export type ApplyMoveUpInput = {
  mode: "invite" | "move";
  details?: unknown;
  /** Send Becca's message (bell, push, email). The pop shows on the dashboard regardless. */
  notify: boolean;
};

export type ApplyMoveUpResult =
  | {
      ok: true;
      moved: boolean;
      certificate: "issued" | "pending" | "not-applicable";
      notified: boolean;
      targetLevel: string;
      note: string | null;
    }
  | { ok: false; reason: string };

export async function applyMoveUp(studentId: string, input: ApplyMoveUpInput, now = new Date()): Promise<ApplyMoveUpResult> {
  const before = await loadJourneyStudent({ id: studentId });
  if (!before) return { ok: false, reason: "Student not found" };
  const target = nextLevelAfter(before.level);
  if (!target) return { ok: false, reason: `${before.level} is the top of the ladder — there is no next level` };

  const details = cleanDetails(input.details);
  let certificate: "issued" | "pending" | "not-applicable" = "not-applicable";
  let moved = false;

  // 1. Move up — only when the admin asked for it, and in the same order the
  // Graduation desk uses: sign off, certificate (while they are still on the
  // level they finished), THEN promote. Promoting first would lose the
  // certificate for the level just completed.
  if (input.mode === "move") {
    await completeLevelForStudents([studentId], { now, announce: false });
    const cert = await issueCertificateForStudent(studentId, { now }).catch(
      (): { issued: false; reason: string } => ({ issued: false, reason: "Certificate could not be issued" }),
    );
    certificate = cert.issued ? "issued" : "pending";

    const promotion = await promoteStudents([studentId], { now, placement: "next-intake" });
    if (promotion.skipped.length > 0) {
      // The level IS signed off by now; say so, and why the move did not happen
      // (typically an unpaid balance on a level they were already in).
      return { ok: false, reason: `Signed off, but not moved up: ${promotion.skipped[0].reason}` };
    }
    moved = true;
  }

  // 2. Write what the admin edited to the student's own record, from a FRESH
  // read — promotion rewrites `admission`, and writing the stale copy back would
  // undo the new batch month it just set.
  const fresh = await loadJourneyStudent({ id: studentId });
  if (!fresh) return { ok: false, reason: "Student vanished mid-update" };
  const admission = asRecord(fresh.admission);
  const existing = readIntent(admission, target);
  const intent: NextLevelIntent = {
    ...(existing ?? { targetLevel: target }),
    targetLevel: target,
    manualOffer: true,
    offeredAt: now.toISOString(),
    details: { ...(existing?.details ?? {}), ...Object.fromEntries(Object.entries(details).filter(([, v]) => v)) },
  };

  await prisma.student.update({
    where: { id: studentId },
    data: {
      ...(details.sessionSlot ? { sessionSlot: details.sessionSlot } : {}),
      ...(details.deliveryMode ? { deliveryMode: details.deliveryMode } : {}),
      admission: {
        ...admission,
        ...(details.phone ? { phone: details.phone } : {}),
        ...(details.parentPhone ? { parentPhone: details.parentPhone } : {}),
        nextLevel: intent,
      } as never,
    },
  });

  await prisma.journeyEvent
    .create({
      data: {
        studentId,
        type: moved ? "level-advanced" : "registered",
        stage: target,
        label: moved ? `Moved up to ${target} by the office` : `Invited to ${target} by the office`,
        source: "admin",
      },
    })
    .catch(() => undefined);

  // 3. Tell them — the same one message as the pipeline's Send button.
  let notified = false;
  if (input.notify) {
    const after = await loadJourneyStudent({ id: studentId });
    const journey = after ? await loadJourney(after, now) : null;
    if (after && journey) {
      const invite = buildInvite(journey, after.user.name);
      await notify({
        to: { studentIds: [studentId] },
        kind: KIND.levelAdvance,
        severity: "success",
        title: invite.title,
        message: invite.message,
        emailBody: invite.emailBody,
        emailHtmlFor: () => invite.html,
        link: "/next-level",
        dedupeKey: `next-level-invite:${studentId}:${target}:${now.toISOString().slice(0, 10)}`,
      }).then(() => {
        notified = true;
      }).catch((error) => console.error("manual next-level notify failed", error));
    }
  }

  return {
    ok: true,
    moved,
    certificate,
    notified,
    targetLevel: target,
    note: certificate === "pending" ? "The certificate could not be issued yet — check Certificates." : null,
  };
}
