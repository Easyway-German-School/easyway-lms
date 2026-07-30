import { prisma } from "@/lib/prisma";
import { queueEmail } from "@/lib/email-queue";

/**
 * The registration funnel.
 *
 * A campaign can bring in thousands of registrants, most of whom never pay or
 * turn up. Those land here rather than in Student, because putting them in the
 * roster would wreck every number the school reports on — class sizes,
 * attendance rates, revenue per branch.
 *
 * Converting is deliberately an INVITE, not an account creation. There is no
 * password-reset flow in this app, so minting an account with a password the
 * office had to invent would leave the student locked out of their own record.
 * Instead the invite links to the normal signup form with their details
 * prefilled, they choose their own password, and the Lead is matched back to
 * the new Student by email.
 */

export type LeadInput = {
  name: string;
  email: string;
  phone?: string | null;
  branchId?: string | null;
  interestedLevel?: string | null;
  sessionSlot?: string | null;
  classType?: string | null;
  source?: string | null;
  notes?: string | null;
};

const SLOTS = ["morning", "afternoon", "evening"];

function normalize(input: LeadInput) {
  const slot = String(input.sessionSlot ?? "").toLowerCase();
  return {
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone?.trim() || null,
    branchId: input.branchId?.trim() || null,
    interestedLevel: input.interestedLevel?.trim().toUpperCase() || null,
    sessionSlot: SLOTS.includes(slot) ? slot : null,
    classType: String(input.classType ?? "").toLowerCase() === "private" ? "private" : "group",
    source: input.source?.trim() || "website",
    notes: input.notes?.trim() || null,
  };
}

export type CaptureResult =
  | { ok: true; leadId: string; duplicate: boolean }
  | { ok: false; error: string };

/**
 * Record an enquiry. Re-submitting the same address updates the enquiry rather
 * than erroring: someone filling the form twice is not a failure, and a hard
 * error would just make the marketing site look broken.
 */
export async function captureLead(input: LeadInput): Promise<CaptureResult> {
  const data = normalize(input);

  if (!data.name) return { ok: false, error: "Name is required" };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) {
    return { ok: false, error: "A valid email address is required" };
  }

  // Someone who already has an account is not a lead.
  const existingUser = await prisma.user.findUnique({
    where: { email: data.email },
    select: { id: true },
  });
  if (existingUser) {
    return { ok: false, error: "That email already has an account. Please sign in instead." };
  }

  const existing = await prisma.lead.findUnique({
    where: { email: data.email },
    select: { id: true, status: true },
  });

  if (existing) {
    // A converted lead is finished; do not reopen it from a public form.
    if (existing.status === "converted") {
      return { ok: true, leadId: existing.id, duplicate: true };
    }
    await prisma.lead.update({ where: { id: existing.id }, data });
    return { ok: true, leadId: existing.id, duplicate: true };
  }

  const created = await prisma.lead.create({ data });
  return { ok: true, leadId: created.id, duplicate: false };
}

/** The signup link, prefilled so the student is not retyping what we know. */
export function enrolmentUrl(lead: {
  email: string;
  name: string;
  interestedLevel: string | null;
  branchId: string | null;
  sessionSlot: string | null;
}): string {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const params = new URLSearchParams({ email: lead.email, name: lead.name });
  if (lead.interestedLevel) params.set("level", lead.interestedLevel);
  if (lead.branchId) params.set("branchId", lead.branchId);
  if (lead.sessionSlot) params.set("sessionSlot", lead.sessionSlot);
  return `${base}/auth/signup?${params}`;
}

function inviteHtml(name: string, url: string): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#0f172a">
      <h2 style="margin:0 0 16px">Complete your enrolment</h2>
      <p>Hello ${name},</p>
      <p>
        Thank you for your interest in Easyway German Language School. Your place is ready to be
        confirmed — follow the link below to finish your registration and choose your password.
      </p>
      <p style="margin:24px 0">
        <a href="${url}"
           style="background:#0a7cff;color:#fff;padding:12px 28px;text-decoration:none;border-radius:6px;display:inline-block">
          Complete my enrolment
        </a>
      </p>
      <p style="font-size:14px;color:#64748b">
        Your details are already filled in. You will be able to pay your tuition once your account
        is set up, and your classes unlock as soon as the deposit is received.
      </p>
      <p style="margin-top:28px;border-top:1px solid #e2e8f0;padding-top:16px;font-size:12px;color:#94a3b8">
        Easyway German Language School
      </p>
    </div>`;
}

export type InviteResult = {
  invited: string[];
  skipped: Array<{ leadId: string; reason: string }>;
};

/** Email the enrolment link to the given leads. */
export async function inviteLeads(leadIds: string[]): Promise<InviteResult> {
  const result: InviteResult = { invited: [], skipped: [] };

  const leads = await prisma.lead.findMany({ where: { id: { in: leadIds } } });

  for (const lead of leads) {
    if (lead.status === "converted") {
      result.skipped.push({ leadId: lead.id, reason: "Already enrolled" });
      continue;
    }

    await queueEmail({
      to: lead.email,
      subject: "Complete your enrolment at Easyway",
      html: inviteHtml(lead.name, enrolmentUrl(lead)),
      type: "lead_enrolment_invite",
    });

    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: "invited", invitedAt: new Date() },
    });

    result.invited.push(lead.id);
  }

  return result;
}

/**
 * Close the loop when a lead signs up. Called from the signup route, so a
 * student who enrols on their own — invite or not — stops showing as an open
 * enquiry the office needs to chase.
 */
export async function linkLeadOnSignup(email: string, studentId: string): Promise<void> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true },
    });
    if (!lead) return;

    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: "converted", convertedStudentId: studentId, convertedAt: new Date() },
    });
  } catch (error) {
    console.error("Could not link lead to new student:", error);
  }
}

export type ImportResult = {
  created: number;
  updated: number;
  skipped: Array<{ row: number; reason: string }>;
};

/**
 * Bulk import from CSV, for registrant lists the school already holds.
 *
 * Expects a header row. Recognised columns: name, email, phone, level,
 * session, notes. Anything else is ignored so an export from another system
 * does not have to be cleaned up first.
 */
export async function importLeadsFromCsv(
  csv: string,
  opts: { source?: string; branchId?: string | null } = {},
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, skipped: [] };

  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    result.skipped.push({ row: 0, reason: "No data rows found below the header" });
    return result;
  }

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };

  const idx = {
    name: col("name", "full name", "student name"),
    email: col("email", "email address", "e-mail"),
    phone: col("phone", "phone number", "mobile", "telephone"),
    level: col("level", "class", "interested level"),
    session: col("session", "session slot", "time"),
    notes: col("notes", "note", "comment"),
  };

  if (idx.name === -1 || idx.email === -1) {
    result.skipped.push({ row: 0, reason: "The header must include a name column and an email column" });
    return result;
  }

  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    const at = (n: number) => (n === -1 ? null : cells[n]?.trim() || null);

    const name = at(idx.name);
    const email = at(idx.email);

    if (!name || !email) {
      result.skipped.push({ row: i + 1, reason: "Missing name or email" });
      continue;
    }

    const outcome = await captureLead({
      name,
      email,
      phone: at(idx.phone),
      interestedLevel: at(idx.level),
      sessionSlot: at(idx.session),
      notes: at(idx.notes),
      branchId: opts.branchId ?? null,
      source: opts.source ?? "csv_import",
    });

    if (!outcome.ok) {
      result.skipped.push({ row: i + 1, reason: outcome.error });
    } else if (outcome.duplicate) {
      result.updated++;
    } else {
      result.created++;
    }
  }

  return result;
}

/** Split one CSV line, honouring quoted fields containing commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (ch === '"') {
      // A doubled quote inside a quoted field is a literal quote.
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  out.push(current);
  return out;
}
