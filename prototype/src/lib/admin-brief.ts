import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/ai-cache";
import { callModel, activeModelName } from "@/lib/ai";
import { receivedPaymentFilter } from "@/lib/payment";
import { firstReachable } from "@/lib/admin-routes";
import { schoolDayStart, zonedDateKey, SCHOOL_TIMEZONE } from "@/lib/school-time";
import type { Capability } from "@/lib/admin-roles";

/**
 * The office's own daily / weekly / monthly brief.
 *
 * The dashboard has always answered "how are we doing THIS MONTH". What it
 * could not answer is "what happened TODAY" — how many people registered, how
 * many of them paid tuition the same day, how much came in, who signed up and
 * still owes. That is the number an accountant and a super admin actually run
 * the front desk on, and it was nowhere.
 *
 * Same design as the student brief (see lib/student-brief.ts): every FIGURE is
 * a real query scoped to the period — a model never states a number — and the
 * only model call is ONE that reads those figures back and says what to do
 * about them, cached per (period, capability-set, day) so re-checking the page
 * five times costs one call. When the model is unfunded or unreachable the
 * brief still stands: `advice` comes back null and the UI shows the
 * deterministic `flags` instead.
 *
 * Role-scoped like everything else in the admin area. A Secretary has no
 * `payments` capability, so the money half is never computed and never put in
 * front of them — see `scope` on the result.
 */

export type AdminBriefPeriod = "daily" | "weekly" | "monthly";

export type MetricFormat = "count" | "naira" | "percent";

export type AdminBriefMetric = {
  key: string;
  label: string;
  value: number;
  display: string;
  format: MetricFormat;
  /** The same figure over the previous comparable window, or null if N/A. */
  prev: number | null;
  prevDisplay: string | null;
  /** Percent change vs `prev`. null when there is no meaningful base. */
  deltaPct: number | null;
  /** For a delta, does up mean good? (false for "still owes", etc.) */
  higherIsBetter: boolean;
  hint?: string;
  /** Where clicking the figure takes you — the list behind it. */
  href?: string;
};

export type AdminBriefFlag = { level: "good" | "watch" | "bad"; text: string };

export type AdminBrief = {
  period: AdminBriefPeriod;
  rangeLabel: string;
  comparedTo: string;
  /**
   * The exact wall-clock span the figures below were pulled from, in the
   * school's own timezone — e.g. "6 Oct, 00:00 – 12 Oct, 10:43". Exists so a
   * rolling window never has to be taken on faith: "This week" is a trailing
   * 7 days ending now, not the calendar week since Monday, and the one thing
   * that defuses "it's Monday, why does this look like last week" is showing
   * the actual dates rather than just the word "week".
   */
  windowLabel: string;
  generatedAt: string;
  headline: string;
  metrics: AdminBriefMetric[];
  flags: AdminBriefFlag[];
  /** Claude's "what to act on", one line per entry — null when unavailable. */
  advice: string[] | null;
  /** Per advice line, the list it is about (same index) — or null. */
  adviceTargets: (string | null)[];
  scope: { money: boolean; students: boolean; attendance: boolean };
};

const DAY_MS = 86_400_000;

const RANGE_LABEL: Record<AdminBriefPeriod, string> = {
  daily: "today",
  // Not "this week" — the window is a rolling trailing 7 days ending now, not
  // the calendar week since Monday. Calling it "this week" is what made a
  // Monday-morning owner read a normal rolling window as "stuck on last
  // week"; see the `windowLabel` field for the literal dates.
  weekly: "in the last 7 days",
  monthly: "this month",
};
const COMPARE_LABEL: Record<AdminBriefPeriod, string> = {
  daily: "yesterday, same time of day",
  weekly: "the 7 days before that",
  monthly: "the same point last month",
};

/**
 * The window for the current period and the comparable one before it.
 *
 *   daily   — midnight today → now,        vs yesterday, UP TO THE SAME
 *             WALL-CLOCK TIME (not the whole of yesterday)
 *   weekly  — a rolling 7 days → now,      vs the 7 days before that, ending
 *             at the SAME POINT the current window ends at (not a full clean
 *             7 days)
 *   monthly — the 1st of THIS month → now, vs the same elapsed span of last
 *             month (month-to-date vs month-to-date)
 *
 * All three compare an elapsed span against an EQUALLY elapsed span — never a
 * partial "so far" window against a complete prior one. That asymmetry used
 * to be exactly the daily/weekly bug here: at 10am the "today" window had
 * covered 10 of its 24 hours, but it was being measured against the whole of
 * yesterday (24 of 24) and the whole of the previous 7 days — so the delta%
 * read as a decline every single morning regardless of the real trend, worst
 * right after the window rolls onto a new day. Lining both ends up the same
 * way monthly already did removes that bias; it does not touch the CURRENT
 * period's own totals (registrations, cash collected), only the baseline
 * they are compared against.
 */
function windows(period: AdminBriefPeriod, now: Date) {
  if (period === "monthly") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const elapsed = now.getTime() - start.getTime();
    const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    return { start, end: now, prevStart, prevEnd: new Date(prevStart.getTime() + elapsed) };
  }
  const start = schoolDayStart(now);
  const span = period === "daily" ? 1 : 7;
  if (period === "weekly") start.setTime(start.getTime() - (span - 1) * DAY_MS);
  const elapsed = now.getTime() - start.getTime();
  const prevStart = new Date(start.getTime() - span * DAY_MS);
  const prevEnd = new Date(prevStart.getTime() + elapsed);
  return { start, end: now, prevStart, prevEnd };
}

/** "6 Oct, 00:00 – 12 Oct, 10:43" — the literal span a window covers, in the
 *  school's own timezone, so a rolling window never has to be taken on faith. */
function windowLabel(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleString("en-GB", {
      timeZone: SCHOOL_TIMEZONE,
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  return `${fmt(start)} – ${fmt(end)}`;
}

const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;

function fmt(value: number, format: MetricFormat): string {
  if (format === "naira") return naira(value);
  if (format === "percent") return `${Math.round(value)}%`;
  return value.toLocaleString("en-NG");
}

function deltaPct(value: number, prev: number | null): number | null {
  if (prev === null || prev === 0) return null;
  return Math.round(((value - prev) / prev) * 100);
}

/**
 * Same CALENDAR day in the school's own timezone — not UTC. A registration
 * at 23:50 WAT and a payment 15 minutes later at 00:05 WAT are a different
 * school day (and should NOT count as "paid same day"), but both land in the
 * same UTC calendar day (23:05 UTC the day before), so the old UTC-based
 * comparison called that a match. Africa/Lagos has no DST, so the reverse
 * mistake (same WAT day, different UTC day) happens too, in the mirror hour.
 * One hour wide, once a day, but it is the exact figure this brief is built
 * to get right — see push("paidSameDay", ...) below.
 */
function sameSchoolDay(a: Date, b: Date): boolean {
  return zonedDateKey(a, SCHOOL_TIMEZONE) === zonedDateKey(b, SCHOOL_TIMEZONE);
}

type BriefAdmin = { can: (c: Capability) => boolean; capabilities: readonly string[] };

export async function buildAdminBrief(
  admin: BriefAdmin,
  period: AdminBriefPeriod,
  now: Date = new Date(),
): Promise<AdminBrief> {
  const { start, end, prevStart, prevEnd } = windows(period, now);
  const canMoney = admin.can("payments" as Capability);
  const canStudents = admin.can("students" as Capability);
  const canAttendance = admin.can("attendance" as Capability);

  const caps = admin.capabilities as string[];

  /**
   * Where a figure links to. Student cohorts go to the roster filtered to the
   * EXACT ids the figure counted (see `ids=` in student-roster-query.ts), so
   * "8 still owing" opens those eight and nothing else. `firstReachable` picks
   * the best page the caller can actually open — an Accountant with no
   * `students` capability lands on the receivables ledger instead — and returns
   * undefined when there is none, so the card renders as plain text rather than
   * a link that 404s or apologises.
   */
  const roster = (ids: string[]): string | undefined => {
    // A very long id list would blow the URL; fall back to the plain roster.
    const idParam = ids.length > 0 && ids.length <= 200 ? `?ids=${ids.join(",")}` : "";
    return firstReachable(
      caps,
      `/admin/students${idParam}`,
      "/admin/finance?tab=receivables",
      "/admin/students",
    );
  };
  const cashHref = (): string | undefined =>
    firstReachable(caps, "/admin/finance?tab=cash", "/admin/payments", "/admin/reports");
  const leadsHref = (): string | undefined => firstReachable(caps, "/admin/leads", "/admin/enquiries");
  const attendanceHref = (): string | undefined =>
    firstReachable(caps, "/admin/attendance", "/admin/reports");

  const metrics: AdminBriefMetric[] = [];
  const push = (
    key: string,
    label: string,
    value: number,
    prev: number | null,
    format: MetricFormat,
    higherIsBetter = true,
    hint?: string,
    href?: string,
  ) =>
    metrics.push({
      key,
      label,
      value,
      display: fmt(value, format),
      format,
      prev,
      prevDisplay: prev === null ? null : fmt(prev, format),
      deltaPct: deltaPct(value, prev),
      higherIsBetter,
      hint,
      href,
    });

  // ---- Registrations & same-day payment ------------------------------------
  let registrations = 0;
  let paidSameDay = 0;
  let paidInWindow = 0;
  let stillUnpaid = 0;
  let prevRegistrations = 0;
  let prevPaidSameDay = 0;
  // The exact student sets each figure counts, so the figure can link to them.
  let registrantIds: string[] = [];
  let startedIds: string[] = [];
  let paidSameDayIds: string[] = [];
  let paidInWindowIds: string[] = [];
  let stillUnpaidIds: string[] = [];

  if (canStudents || canMoney) {
    // Only pull each registrant's payments when the caller may see money.
    const registrantSelect = {
      id: true,
      createdAt: true,
      ...(canMoney
        ? {
            payments: {
              where: receivedPaymentFilter(),
              select: { amount: true, createdAt: true },
            },
          }
        : {}),
    };

    const [thisWindow, lastWindow, startedThis, startedPrev, newLeads, prevLeads] =
      await Promise.all([
        prisma.student.findMany({
          where: { createdAt: { gte: start, lte: end } },
          select: registrantSelect,
        }),
        prisma.student.findMany({
          where: { createdAt: { gte: prevStart, lt: prevEnd } },
          select: registrantSelect,
        }),
        canStudents
          ? prisma.student.findMany({
              where: { classesStartedAt: { gte: start, lte: end } },
              select: { id: true },
            })
          : Promise.resolve([] as Array<{ id: string }>),
        canStudents
          ? prisma.student.count({ where: { classesStartedAt: { gte: prevStart, lt: prevEnd } } })
          : Promise.resolve(0),
        canStudents
          ? prisma.lead.count({ where: { createdAt: { gte: start, lte: end } } })
          : Promise.resolve(0),
        canStudents
          ? prisma.lead.count({ where: { createdAt: { gte: prevStart, lt: prevEnd } } })
          : Promise.resolve(0),
      ]);

    type Registrant = { id: string; createdAt: Date; payments?: Array<{ amount: number; createdAt: Date }> };
    registrations = thisWindow.length;
    prevRegistrations = lastWindow.length;
    registrantIds = (thisWindow as Registrant[]).map((s) => s.id);
    startedIds = startedThis.map((s) => s.id);

    if (canMoney) {
      for (const s of thisWindow as Registrant[]) {
        const pays = s.payments ?? [];
        if (pays.length === 0) {
          stillUnpaid += 1;
          stillUnpaidIds.push(s.id);
          continue;
        }
        paidInWindow += 1;
        paidInWindowIds.push(s.id);
        if (pays.some((p) => sameSchoolDay(p.createdAt, s.createdAt))) {
          paidSameDay += 1;
          paidSameDayIds.push(s.id);
        }
      }
      for (const s of lastWindow as Registrant[]) {
        const pays = s.payments ?? [];
        if (pays.some((p) => sameSchoolDay(p.createdAt, s.createdAt))) prevPaidSameDay += 1;
      }
    }

    if (canStudents) {
      push("registrations", "New registrations", registrations, prevRegistrations, "count", true, undefined, roster(registrantIds));
      push("startedClasses", "Started classes", startedIds.length, startedPrev, "count", true, undefined, roster(startedIds));
      push("newLeads", "New enquiries", newLeads, prevLeads, "count", true, undefined, leadsHref());
    }

    if (canMoney) {
      push(
        "paidSameDay",
        "Registered & paid same day",
        paidSameDay,
        prevPaidSameDay,
        "count",
        true,
        "New sign-ups who paid tuition on the day they registered",
        roster(paidSameDayIds),
      );
      const conv = registrations > 0 ? (paidInWindow / registrations) * 100 : 0;
      const prevConv =
        prevRegistrations > 0 ? (prevPaidSameDay / prevRegistrations) * 100 : null;
      push(
        "conversion",
        "Sign-up → paid conversion",
        Math.round(conv),
        prevConv === null ? null : Math.round(prevConv),
        "percent",
        true,
        `${paidInWindow} of ${registrations} new sign-ups ${RANGE_LABEL[period]} have paid tuition`,
        roster(paidInWindowIds),
      );
      push(
        "stillUnpaid",
        "New sign-ups still owing",
        stillUnpaid,
        null,
        "count",
        false,
        "Registered in this window with no tuition payment yet — chase these",
        roster(stillUnpaidIds),
      );
    }
  }

  // ---- Cash in ------------------------------------------------------------
  if (canMoney) {
    const [thisPays, prevPays] = await Promise.all([
      prisma.payment.findMany({
        where: { ...receivedPaymentFilter(), createdAt: { gte: start, lte: end } },
        select: { amount: true },
      }),
      prisma.payment.findMany({
        where: { ...receivedPaymentFilter(), createdAt: { gte: prevStart, lt: prevEnd } },
        select: { amount: true },
      }),
    ]);
    const collected = thisPays.reduce((s, p) => s + p.amount, 0);
    const prevCollected = prevPays.reduce((s, p) => s + p.amount, 0);
    push(
      "tuitionCollected",
      "Tuition in, school-wide",
      collected,
      prevCollected,
      "naira",
      true,
      // This sums EVERY payment in the window, from any student — existing
      // students paying an installment included, not only today's new
      // sign-ups. It used to just say "Tuition collected" sitting right next
      // to "1 registered", which read as "this is that one person's money"
      // even on a day when it was several unrelated students paying.
      "All tuition received in this window, from any student — not only today's new sign-ups.",
      cashHref(),
    );
    push("paymentsCount", "Payments received", thisPays.length, prevPays.length, "count", true, undefined, cashHref());
  }

  // ---- Attendance ------------------------------------------------------------
  if (canAttendance) {
    const [rows, prevRows] = await Promise.all([
      prisma.attendance.findMany({
        where: { date: { gte: start, lte: end } },
        select: { status: true, present: true },
      }),
      prisma.attendance.findMany({
        where: { date: { gte: prevStart, lt: prevEnd } },
        select: { status: true, present: true },
      }),
    ]);
    const presentOf = (r: { status: string | null; present: boolean | null }) =>
      r.present === true || r.status === "present" || r.status === "late";
    push("attendanceMarks", "Attendance marks logged", rows.length, prevRows.length, "count", true, undefined, attendanceHref());
    if (rows.length > 0) {
      const rate = (rows.filter(presentOf).length / rows.length) * 100;
      const prevRate =
        prevRows.length > 0 ? (prevRows.filter(presentOf).length / prevRows.length) * 100 : null;
      push(
        "presentRate",
        "Present rate",
        Math.round(rate),
        prevRate === null ? null : Math.round(prevRate),
        "percent",
        true,
        undefined,
        attendanceHref(),
      );
    }
  }

  const flags = deriveFlags(period, metrics, { canMoney, canStudents, canAttendance, now });
  const headline = deriveHeadline(period, metrics, { canMoney, canStudents });

  const advice = await adviceFor(period, admin.capabilities, { headline, metrics, flags }).catch(
    () => null,
  );
  const adviceTargets = (advice ?? []).map((line) => adviceTargetFor(line, metrics));

  return {
    period,
    rangeLabel: RANGE_LABEL[period],
    comparedTo: COMPARE_LABEL[period],
    windowLabel: windowLabel(start, end),
    generatedAt: now.toISOString(),
    headline,
    metrics,
    flags,
    advice,
    adviceTargets,
    scope: { money: canMoney, students: canStudents, attendance: canAttendance },
  };
}

function metricValue(metrics: AdminBriefMetric[], key: string): number | null {
  const m = metrics.find((x) => x.key === key);
  return m ? m.value : null;
}

function hrefOf(metrics: AdminBriefMetric[], key: string): string | null {
  return metrics.find((x) => x.key === key)?.href ?? null;
}

/**
 * Point an advice line at the list it is about, by what it talks about. The
 * lines are the model's own words, so this is a keyword match, not a promise —
 * a miss just means that one bullet is not a link, which is fine.
 */
function adviceTargetFor(line: string, metrics: AdminBriefMetric[]): string | null {
  const t = line.toLowerCase();
  if (/\b(owe|owing|unpaid|arrear|balance|chase)\b/.test(t)) {
    return hrefOf(metrics, "stillUnpaid") ?? hrefOf(metrics, "tuitionCollected");
  }
  if (/\b(attendance|register|mark)\b/.test(t) && /\bmark|attendance\b/.test(t)) {
    return hrefOf(metrics, "attendanceMarks");
  }
  if (/\b(enquir|lead|outreach|prospect)\b/.test(t)) return hrefOf(metrics, "newLeads");
  if (/\b(convert|conversion|pay(ment)? habit)\b/.test(t)) {
    return hrefOf(metrics, "conversion") ?? hrefOf(metrics, "stillUnpaid");
  }
  if (/\b(collect|revenue|cash|tuition in)\b/.test(t)) return hrefOf(metrics, "tuitionCollected");
  if (/\b(start(ed)? class|class start|begin)\b/.test(t)) return hrefOf(metrics, "startedClasses");
  if (/\b(register|registration|sign-?up|new student|enrol)\b/.test(t)) {
    return hrefOf(metrics, "registrations");
  }
  return hrefOf(metrics, "registrations") ?? metrics.find((m) => m.href)?.href ?? null;
}

function deriveHeadline(
  period: AdminBriefPeriod,
  metrics: AdminBriefMetric[],
  caps: { canMoney: boolean; canStudents: boolean },
): string {
  const range = RANGE_LABEL[period];
  const cap = range.charAt(0).toUpperCase() + range.slice(1);

  /**
   * Two separate sentences on purpose, not one comma-separated run-on.
   * "1 registered, 1 paid tuition same day and ₦1,008,000 in" used to read
   * as one continuous fact about one person — the school owner's actual
   * complaint was exactly this, a single new sign-up next to a six-figure
   * naira total that looked like it was describing them. The sign-up cohort
   * (registered / paid same day / still owing) is one sentence; the
   * school-wide cash figure is its own, explicitly labelled "school-wide" so
   * it cannot be misread as belonging to the sign-up count beside it.
   */
  const signupParts: string[] = [];
  const regs = metricValue(metrics, "registrations");
  if (caps.canStudents && regs !== null) signupParts.push(`${regs} registered`);
  if (caps.canMoney) {
    const paid = metricValue(metrics, "paidSameDay");
    if (paid !== null) signupParts.push(`${paid} paid tuition same day`);
    const owing = metricValue(metrics, "stillUnpaid");
    if (owing && owing > 0) signupParts.push(`${owing} still owe`);
  }

  const cashParts: string[] = [];
  if (caps.canMoney) {
    const collected = metrics.find((m) => m.key === "tuitionCollected");
    if (collected) cashParts.push(`${collected.display} collected school-wide`);
  }

  if (signupParts.length === 0 && cashParts.length === 0) return `${cap}: nothing logged yet.`;

  const sentences: string[] = [];
  if (signupParts.length > 0) {
    sentences.push(
      `${cap}: ${signupParts.slice(0, -1).join(", ")}${
        signupParts.length > 1 ? " and " : ""
      }${signupParts[signupParts.length - 1]}.`,
    );
  }
  if (cashParts.length > 0) {
    const lead = sentences.length > 0 ? "" : `${cap}: `;
    sentences.push(`${lead}${cashParts.join(", ")}.`);
  }
  return sentences.join(" ");
}

function deriveFlags(
  period: AdminBriefPeriod,
  metrics: AdminBriefMetric[],
  ctx: { canMoney: boolean; canStudents: boolean; canAttendance: boolean; now: Date },
): AdminBriefFlag[] {
  const flags: AdminBriefFlag[] = [];
  const range = RANGE_LABEL[period];
  const isWeekday = ctx.now.getUTCDay() >= 1 && ctx.now.getUTCDay() <= 5;

  const regs = metricValue(metrics, "registrations");
  const conv = metricValue(metrics, "conversion");
  const unpaid = metricValue(metrics, "stillUnpaid");
  const collected = metrics.find((m) => m.key === "tuitionCollected");
  const attMarks = metricValue(metrics, "attendanceMarks");

  if (ctx.canStudents && regs === 0) {
    flags.push({ level: "watch", text: `No new registrations logged ${range}.` });
  }
  if (ctx.canMoney && conv !== null && regs !== null && regs >= 2) {
    if (conv < 60) {
      flags.push({
        level: "bad",
        // Not a possessive ("${range}'s N sign-ups") — "in the last 7 days'
        // N sign-ups" doesn't parse. Every RANGE_LABEL value reads cleanly
        // as a trailing adverbial instead.
        text: `Only ${conv}% of ${regs} sign-ups ${range} have paid tuition${
          unpaid ? ` — ${unpaid} to chase` : ""
        }.`,
      });
    } else if (conv >= 90) {
      flags.push({ level: "good", text: `${conv}% of new sign-ups paid tuition ${range}.` });
    }
  }
  if (ctx.canMoney && collected && collected.deltaPct !== null && collected.deltaPct <= -30) {
    flags.push({
      level: "watch",
      text: `Tuition collected is down ${Math.abs(collected.deltaPct)}% vs ${COMPARE_LABEL[period]}.`,
    });
  }
  if (ctx.canMoney && collected && collected.deltaPct !== null && collected.deltaPct >= 40) {
    flags.push({
      level: "good",
      text: `Tuition collected is up ${collected.deltaPct}% vs ${COMPARE_LABEL[period]}.`,
    });
  }
  if (ctx.canAttendance && period === "daily" && isWeekday && attMarks === 0) {
    flags.push({ level: "watch", text: "No attendance has been marked today." });
  }
  return flags;
}

/**
 * The one model call. Handed the already-true figures and asked for up to
 * three short, concrete moves — never a number it wasn't given. Cached per
 * (period, capabilities, day). Null on any failure; the page falls back to
 * the deterministic flags.
 */
async function adviceFor(
  period: AdminBriefPeriod,
  capabilities: readonly string[],
  facts: { headline: string; metrics: AdminBriefMetric[]; flags: AdminBriefFlag[] },
): Promise<string[] | null> {
  const day = new Date().toISOString().slice(0, 10);
  const capKey = [...capabilities].sort().join(",");

  return cached<string[]>(
    "admin_brief_line",
    `${period}:${capKey}:${day}`,
    async () => {
      const figures = facts.metrics
        .map((m) => {
          const delta =
            m.deltaPct === null
              ? ""
              : ` (${m.deltaPct >= 0 ? "+" : ""}${m.deltaPct}% vs previous)`;
          return `- ${m.label}: ${m.display}${delta}`;
        })
        .join("\n");
      const flagText = facts.flags.length
        ? facts.flags.map((f) => `- [${f.level}] ${f.text}`).join("\n")
        : "- (none)";

      const prompt = [
        `You advise the front office of a Nigerian German-language school. Below is the ${period} brief,`,
        `already computed. Write AT MOST 3 short bullet points telling the office what to DO to improve`,
        `these numbers ${period === "daily" ? "today" : "this " + period.replace("ly", "")}.`,
        "",
        "RULES:",
        "- Every number you mention MUST appear in the figures below. Never invent one.",
        "- Each bullet is one imperative sentence under 22 words. No preamble, no headings.",
        "- Be specific: name the cohort, the action, the lever. 'Chase the 3 unpaid sign-ups' not 'improve collections'.",
        "- If the numbers are healthy, say what to keep doing — do not manufacture a problem.",
        "",
        `HEADLINE: ${facts.headline}`,
        "",
        "FIGURES:",
        figures,
        "",
        "FLAGS:",
        flagText,
        "",
        "Reply with only the bullet points, one per line, each starting with '- '.",
      ].join("\n");

      const raw = await callModel(prompt, 300, "student");
      if (!raw) return null;
      const lines = raw
        .split("\n")
        .map((l) => l.replace(/^[-*•]\s*/, "").trim())
        .filter((l) => l.length > 0 && l.length < 240)
        .slice(0, 3);
      return lines.length > 0 ? lines : null;
    },
    { model: activeModelName("student") },
  );
}

/**
 * The weekly/daily digest push + email, for whoever holds `payments`
 * (accountant, super admin). Idempotent per day / per ISO week via the
 * notification dedupeKey, so it is safe to call from /api/cron/tick on
 * every run. Mirrors lib/accountant-digest.ts.
 */
export async function sendAdminBriefDigest(now: Date = new Date()): Promise<{
  daily: { sent: boolean; key: string; reason?: string };
  weekly: { sent: boolean; key: string; reason?: string };
}> {
  const { notify, KIND } = await import("@/lib/notify");

  // A synthetic "payments + students + attendance" context — the digest is
  // only ever sent to payments-holders, so it may carry the money half.
  const digestAdmin: BriefAdmin = {
    can: (c: Capability) =>
      c === "payments" || c === "students" || c === "attendance" || c === "reports",
    capabilities: ["payments", "students", "attendance", "reports"],
  };

  const send = async (period: "daily" | "weekly", key: string) => {
    const brief = await buildAdminBrief(digestAdmin, period, now);
    const body = [
      brief.headline,
      "",
      ...brief.metrics.map((m) => {
        const delta =
          m.deltaPct === null ? "" : ` (${m.deltaPct >= 0 ? "+" : ""}${m.deltaPct}% vs ${brief.comparedTo})`;
        return `• ${m.label}: ${m.display}${delta}`;
      }),
      ...(brief.advice && brief.advice.length
        ? ["", "What to act on:", ...brief.advice.map((a) => `• ${a}`)]
        : brief.flags.length
          ? ["", "Flags:", ...brief.flags.map((f) => `• ${f.text}`)]
          : []),
    ].join("\n");

    const res = await notify({
      to: { audience: "admin", capability: "payments" },
      title: `${period === "daily" ? "Daily" : "Weekly"} office brief — ${brief.headline}`,
      message: brief.headline,
      emailBody: body,
      kind: KIND.general,
      severity: "info",
      link: "/admin/briefing",
      dedupeKey: key,
      push: period === "weekly",
    }).catch((error) => {
      console.error("admin brief digest notify failed", { key, error });
      return null;
    });
    return { sent: Boolean(res && res.batchId), key };
  };

  const dayKey = now.toISOString().slice(0, 10);
  const daily = await send("daily", `admin-brief-daily-${dayKey}`);

  // Weekly only fires its notification on Mondays; the dedupeKey keeps it to
  // once even though the cron runs all week.
  let weekly: { sent: boolean; key: string; reason?: string };
  if (now.getUTCDay() === 1) {
    weekly = await send("weekly", `admin-brief-weekly-${isoWeekKey(now)}`);
  } else {
    weekly = { sent: false, key: `admin-brief-weekly-${isoWeekKey(now)}`, reason: "not Monday" };
  }

  return { daily, weekly };
}

function isoWeekKey(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
