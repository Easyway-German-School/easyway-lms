import { NextRequest, NextResponse } from "next/server";
import bcryptjs from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { generateTempPassword } from "@/lib/student-password";
import { normalizeNigerianPhone } from "@/lib/sms";

/**
 * Issue portal logins to a batch of already-enrolled students who have no
 * email on file — the September intake and every intake after it.
 *
 * The office adds these students from a paper form or a spreadsheet with a
 * phone number and no email, so the importer gives each a random placeholder
 * address (`noemail.<hex>@students.placeholder.…`). That address is a real
 * unique login as far as the database is concerned, but nobody can be asked
 * to type it. This route rewrites it to something they CAN type — their own
 * phone number in international shape at a school subdomain, e.g.
 * `2348031234567@student.easywayschoollms.com.ng` — mints a fresh temporary
 * password, and hands both back so the office can send them by WhatsApp/SMS
 * (there is no mailbox behind a placeholder address, so email is not an
 * option here).
 *
 * Matched on the same last-10-digits phone key the importer uses, so
 * "08031234567", "+2348031234567" and "8031234567" all resolve to the same
 * student. A number that matches two students (siblings sharing a line) or
 * none is reported, never guessed at.
 *
 *   { rows: [{ phone, name? }], commit?: boolean, force?: boolean }
 *
 * commit:false (default) previews: who matches, what their login will be,
 * nothing written. commit:true does the work and returns the passwords in
 * the response body — shown once, on that screen, then gone.
 *
 * force:true also re-issues to a student who already has a real, non-
 * placeholder email (their existing login is replaced). Off by default so a
 * batch run cannot pull a working password out from under a student who
 * signed up themselves.
 */

export const dynamic = "force-dynamic";

const LOGIN_EMAIL_DOMAIN = "student.easywayschoollms.com.ng";

/** digits only, drop leading zeros, keep the last 10 — the importer's key. */
const phoneKey = (value: string) => value.replace(/\D/g, "").replace(/^0+/, "").slice(-10);

type InputRow = { phone: string; name?: string };

type ResultRow = {
  input: string;
  name: string;
  studentCode?: string;
  level?: string;
  session?: string;
  branch?: string;
  loginEmail?: string;
  password?: string;
  status: "ready" | "done" | "not_found" | "shared_phone" | "has_real_email" | "email_clash" | "manual" | "error";
  note: string;
};

export async function POST(request: NextRequest) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const commit = body.commit === true;
  const force = body.force === true;

  const rows: InputRow[] = Array.isArray(body.rows)
    ? body.rows
        .map((row: unknown) => {
          const record = (row ?? {}) as Record<string, unknown>;
          return {
            phone: String(record.phone ?? "").trim(),
            name: typeof record.name === "string" ? record.name.trim() : undefined,
          };
        })
        .filter((row: InputRow) => row.phone)
    : [];

  if (rows.length === 0) {
    return NextResponse.json({ error: "No phone numbers supplied" }, { status: 400 });
  }
  if (rows.length > 300) {
    return NextResponse.json({ error: "Do at most 300 at a time" }, { status: 400 });
  }

  const tenantId = gate.session.user.tenantId ?? null;

  // One read of the roster; match in memory. A no-tenant student (early
  // import / SQLite era) is still ours to act on — the same widening the
  // roster and send-credentials queries use.
  const students = await prisma.user.findMany({
    where: {
      role: "STUDENT",
      deletedAt: null,
      ...(tenantId ? { OR: [{ tenantId }, { tenantId: null }] } : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      student: {
        select: {
          id: true,
          studentCode: true,
          level: true,
          sessionSlot: true,
          admission: true,
          branch: { select: { name: true } },
          profile: { select: { phone: true, altPhone: true, whatsapp: true } },
        },
      },
    },
  });

  const byKey = new Map<string, typeof students>();
  for (const user of students) {
    const student = user.student;
    if (!student) continue;
    const admission = (student.admission ?? null) as Record<string, unknown> | null;
    const candidates = [
      student.profile?.phone,
      student.profile?.altPhone,
      student.profile?.whatsapp,
      admission && typeof admission === "object" ? admission.phone : null,
    ];
    for (const candidate of candidates) {
      const key = phoneKey(String(candidate ?? ""));
      if (key.length < 10) continue;
      const list = byKey.get(key) ?? [];
      if (!list.some((existing) => existing.id === user.id)) list.push(user);
      byKey.set(key, list);
    }
  }
  const byEmail = new Map(students.map((user) => [user.email.toLowerCase(), user]));

  const results: ResultRow[] = [];

  for (const row of rows) {
    const intl = normalizeNigerianPhone(row.phone);
    const key = phoneKey(row.phone);
    const fallbackName = row.name ?? "";

    if (!intl) {
      results.push({
        input: row.phone,
        name: fallbackName,
        status: "manual",
        note: "not a Nigerian mobile number — issue this one by hand",
      });
      continue;
    }

    const hits = key.length >= 10 ? byKey.get(key) ?? [] : [];

    if (hits.length === 0) {
      results.push({
        input: row.phone,
        name: fallbackName,
        status: "not_found",
        note: "no enrolled student has this phone number",
      });
      continue;
    }
    if (hits.length > 1) {
      results.push({
        input: row.phone,
        name: hits.map((hit) => hit.name).join(" / "),
        status: "shared_phone",
        note: `${hits.length} students share this number (${hits
          .map((hit) => hit.name)
          .join(", ")}) — issue these by hand`,
      });
      continue;
    }

    const user = hits[0];
    const student = user.student!;
    const loginEmail = `${intl}@${LOGIN_EMAIL_DOMAIN}`;
    const currentEmail = user.email.toLowerCase();
    const isPlaceholder = currentEmail.includes(".placeholder.") || currentEmail.startsWith("noemail.");
    const isAlreadyPhoneLogin = currentEmail.endsWith(`@${LOGIN_EMAIL_DOMAIN}`);

    const base = {
      input: row.phone,
      name: user.name ?? fallbackName,
      studentCode: student.studentCode ?? "",
      level: student.level,
      session: student.sessionSlot,
      branch: student.branch?.name ?? "",
      loginEmail,
    };

    if (!isPlaceholder && !isAlreadyPhoneLogin && !force) {
      results.push({
        ...base,
        status: "has_real_email",
        note: `already signed in with ${user.email} — leave it, or tick "replace real emails" to override`,
      });
      continue;
    }

    const clash = byEmail.get(loginEmail);
    if (clash && clash.id !== user.id) {
      results.push({
        ...base,
        status: "email_clash",
        note: `${loginEmail} is already ${clash.name}'s login — issue this one by hand`,
      });
      continue;
    }

    if (!commit) {
      results.push({
        ...base,
        status: "ready",
        note: isAlreadyPhoneLogin ? "already on a phone login — password will be reset" : "login email will be set + password reset",
      });
      continue;
    }

    const password = generateTempPassword();
    const admission = (student.admission ?? {}) as Record<string, unknown>;
    try {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          email: loginEmail,
          password: await bcryptjs.hash(password, 10),
          passwordClaimed: true,
        },
      });
      await prisma.student.update({
        where: { id: student.id },
        data: {
          admission: {
            ...admission,
            phone: (admission.phone as string | undefined) ?? row.phone,
            loginSentAt: new Date().toISOString(),
          },
        },
      });
      // Keep the in-memory index honest for the rest of this batch.
      byEmail.set(loginEmail, user);
      results.push({ ...base, password, status: "done", note: "" });
    } catch (error) {
      console.error("issue-phone-logins failed for", row.phone, error);
      results.push({ ...base, status: "error", note: "could not update this account" });
    }
  }

  const counts = results.reduce<Record<string, number>>((accumulator, result) => {
    accumulator[result.status] = (accumulator[result.status] ?? 0) + 1;
    return accumulator;
  }, {});

  return NextResponse.json({ commit, counts, results });
}
