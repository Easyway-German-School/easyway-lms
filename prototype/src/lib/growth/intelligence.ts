import { prisma } from "@/lib/prisma";

/**
 * Growth Desk Intelligence — the part of "the algorithm" that actually
 * learns, as opposed to the fixed rules the rest of src/lib/growth/*.ts
 * runs on. Not a neural net, not an LLM call: a small, explainable
 * statistical model (Bayesian rate estimation + weighted-random routing)
 * that starts at sensible defaults on day one and measurably shifts toward
 * reality as real conversions happen. See GROWTH_LEARNING_NOTES below for
 * exactly what it does and does not claim.
 *
 * GROWTH_LEARNING_NOTES
 * ----------------------
 * Every "learned" number here is a Beta-Bernoulli posterior: a prior guess
 * (the school's starting assumption, e.g. "walk-ins convert better than a
 * CSV import") blended with observed outcomes (real Leads that did or did
 * not reach status "converted"). With zero real data the posterior equals
 * the prior — the system behaves exactly like the old hardcoded weights it
 * replaces. Every real conversion nudges it a little further from the
 * prior and closer to this school's actual numbers. There is no training
 * step to run and nothing to "deploy" — it recomputes from the live ledger
 * (Lead + SalesTask) on every call, so it is never stale and never needs
 * retraining by hand.
 *
 * Rep routing (pickRepForLead) deliberately does NOT always send a new
 * lead to whoever has the best number so far. A pure "send it to the
 * leader" policy would starve everyone else of leads, which starves the
 * model of the exact data it needs to find out whether a quieter rep is
 * actually good — a well-known failure mode in this kind of system
 * (the explore/exploit problem). Selection is weighted-random instead:
 * better performance means a bigger share of new leads, not all of them,
 * so the system keeps learning about everyone, not just whoever got lucky
 * first.
 */

/** How many pseudo-observations the prior is worth — see smoothedRate. */
const PRIOR_STRENGTH = 10;

/**
 * The school's starting assumption per source, carried over unchanged from
 * the original hardcoded SOURCE_WEIGHT constants — now a PRIOR rather than
 * the final answer. A source the school has never seen falls back to 0.15.
 */
const SOURCE_PRIOR_RATE: Record<string, number> = {
  walk_in: 0.3,
  website: 0.2,
  csv_import: 0.1,
};
const DEFAULT_SOURCE_PRIOR = 0.15;

/** How much a rep's current queue length discounts their routing weight. */
const LOAD_PENALTY = 0.15;

/**
 * Beta-Bernoulli posterior mean: (prior pseudo-successes + real successes)
 * / (prior pseudo-observations + real observations). Standard, textbook
 * Bayesian smoothing — not a novel formula, which is the point: it is
 * auditable by anyone who wants to check the math, not a black box.
 */
function smoothedRate(successes: number, total: number, priorRate: number, priorStrength = PRIOR_STRENGTH): number {
  const alpha0 = priorRate * priorStrength;
  const beta0 = priorStrength - alpha0;
  return (alpha0 + successes) / (alpha0 + beta0 + total);
}

async function sourceStats(): Promise<Map<string, { total: number; converted: number }>> {
  const [totals, converted] = await Promise.all([
    prisma.lead.groupBy({ by: ["source"], _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["source"], where: { status: "converted" }, _count: { _all: true } }),
  ]);
  const convertedBySource = new Map(converted.map((c) => [c.source, c._count._all]));
  return new Map(totals.map((t) => [t.source, { total: t._count._all, converted: convertedBySource.get(t.source) ?? 0 }]));
}

/** The learned conversion rate for one source — what priorityScoreForLead now scores on. */
export async function sourceConversionRate(source: string): Promise<number> {
  const stats = await sourceStats();
  const row = stats.get(source);
  const prior = SOURCE_PRIOR_RATE[source] ?? DEFAULT_SOURCE_PRIOR;
  return smoothedRate(row?.converted ?? 0, row?.total ?? 0, prior);
}

/** Every source the school has actually seen, with its learned rate and how much real data backs it. */
export async function sourcePerformanceSummary() {
  const stats = await sourceStats();
  return [...stats.entries()]
    .map(([source, row]) => ({
      source,
      sampleSize: row.total,
      rate: smoothedRate(row.converted, row.total, SOURCE_PRIOR_RATE[source] ?? DEFAULT_SOURCE_PRIOR),
      // Below this, the number shown is mostly the prior talking, not the
      // school's own data — worth saying so in the UI rather than implying
      // false confidence.
      confident: row.total >= PRIOR_STRENGTH * 2,
    }))
    .sort((a, b) => b.rate - a.rate);
}

async function overallConversionRate(): Promise<number> {
  const [total, converted] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { status: "converted" } }),
  ]);
  // Neutral fallback for a school with no leads at all yet.
  if (total === 0) return 0.2;
  return converted / total;
}

async function repStats(repIds: string[]): Promise<Map<string, { assigned: number; converted: number; openTasks: number }>> {
  const rows = await Promise.all(
    repIds.map(async (id) => {
      const [assigned, converted, openTasks] = await Promise.all([
        prisma.lead.count({ where: { assignedToId: id } }),
        prisma.lead.count({ where: { assignedToId: id, status: "converted" } }),
        prisma.salesTask.count({ where: { assignedToId: id, status: "pending" } }),
      ]);
      return [id, { assigned, converted, openTasks }] as const;
    }),
  );
  return new Map(rows);
}

/**
 * Who gets a freshly-captured lead. Weighted-random, not "send it to the
 * leader" — see GROWTH_LEARNING_NOTES above for why. A rep with no leads
 * yet starts at the school-wide average, so a brand-new hire is not
 * penalised for having no track record; they just haven't pulled the
 * estimate away from the average in either direction yet.
 */
export async function pickRepForLead(): Promise<string | null> {
  const reps = await prisma.user.findMany({
    where: { role: "ADMIN", adminRole: "growth", deletedAt: null },
    select: { id: true },
  });
  if (reps.length === 0) return null;
  if (reps.length === 1) return reps[0].id;

  const [stats, prior] = await Promise.all([repStats(reps.map((r) => r.id)), overallConversionRate()]);

  const weighted = reps.map((rep) => {
    const row = stats.get(rep.id) ?? { assigned: 0, converted: 0, openTasks: 0 };
    const rate = smoothedRate(row.converted, row.assigned, prior);
    // Floor so nobody's weight ever hits exactly zero — a rep on a cold
    // streak should still occasionally get a lead, both because it is
    // fair and because that is the only way the estimate can recover.
    const weight = Math.max(0.05, rate) / (1 + row.openTasks * LOAD_PENALTY);
    return { id: rep.id, weight };
  });

  const total = weighted.reduce((sum, w) => sum + w.weight, 0);
  let draw = Math.random() * total;
  for (const w of weighted) {
    draw -= w.weight;
    if (draw <= 0) return w.id;
  }
  return weighted[weighted.length - 1].id;
}

/** Every rep's learned conversion rate, for the Team tab's "what the algorithm has learned" panel. */
export async function repPerformanceSummary() {
  const reps = await prisma.user.findMany({
    where: { role: "ADMIN", adminRole: "growth", deletedAt: null },
    select: { id: true, name: true, email: true },
  });
  if (reps.length === 0) return [];

  const [stats, prior] = await Promise.all([repStats(reps.map((r) => r.id)), overallConversionRate()]);

  return reps
    .map((rep) => {
      const row = stats.get(rep.id) ?? { assigned: 0, converted: 0, openTasks: 0 };
      return {
        id: rep.id,
        name: rep.name,
        email: rep.email,
        sampleSize: row.assigned,
        rate: smoothedRate(row.converted, row.assigned, prior),
        confident: row.assigned >= PRIOR_STRENGTH * 2,
      };
    })
    .sort((a, b) => b.rate - a.rate);
}
