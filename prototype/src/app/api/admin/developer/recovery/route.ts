import { NextResponse } from "next/server";

import history from "@/lib/developer-history";
import { requireCapability } from "@/lib/admin-roles";
import { scrub } from "@/lib/incidents";
import { guardedPrisma } from "@/lib/prisma";
import {
  buildRiskRadar,
  findRecoveryMatches,
  recoverySearchTerms,
  type RecoveryCandidate,
  type RiskObservation,
} from "@/lib/developer-recovery";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type HistoryRow = {
  id: string;
  title: string;
  detail: string;
  url: string | null;
  date: string;
  status: string;
  source: "issue" | "pull request" | "commit";
};

function historyCandidates(): HistoryRow[] {
  return [
    ...history.issues.map((row) => ({
      id: `issue-${row.number}`,
      title: row.title,
      detail: row.body ?? "",
      url: row.url,
      date: row.createdAt,
      status: row.state,
      source: "issue" as const,
    })),
    ...history.pullRequests.map((row) => ({
      id: `pr-${row.number}`,
      title: row.title,
      detail: row.body ?? "",
      url: row.url,
      date: row.mergedAt ?? row.createdAt,
      status: row.mergedAt ? "merged" : row.state,
      source: "pull request" as const,
    })),
    ...history.commits.map((row) => ({
      id: `commit-${row.sha}`,
      title: row.title,
      detail: row.body ?? "",
      url: row.url,
      date: row.date,
      status: "committed",
      source: "commit" as const,
    })),
  ];
}

async function riskRadar() {
  const now = new Date();
  const since = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const [incidents, feedback] = await Promise.all([
    guardedPrisma.incident.findMany({
      where: {
        OR: [
          { lastSeenAt: { gte: since } },
          { status: { in: ["open", "acknowledged"] } },
        ],
      },
      orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }],
      take: 500,
      select: {
        id: true,
        kind: true,
        severity: true,
        status: true,
        title: true,
        message: true,
        route: true,
        occurrences: true,
        reopenedCount: true,
        resolutionNote: true,
        lastSeenAt: true,
      },
    }),
    guardedPrisma.betaFeedback.findMany({
      where: {
        kind: { in: ["bug", "improve"] },
        createdAt: { gte: since },
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 500,
      select: { id: true, kind: true, message: true, path: true, createdAt: true },
    }),
  ]);

  const observations: RiskObservation[] = [
    ...incidents.map((incident) => ({
      id: incident.id,
      source: "incident" as const,
      title: scrub(incident.title),
      detail: scrub([incident.message, incident.resolutionNote].filter(Boolean).join(" ")).slice(0, 1200),
      route: incident.route ? scrub(incident.route) : null,
      date: incident.lastSeenAt.toISOString(),
      status: incident.status,
      severity: incident.severity,
      occurrences: incident.occurrences,
      reopenedCount: incident.reopenedCount,
    })),
    ...feedback.map((report) => ({
      id: report.id,
      source: "user report" as const,
      detail: scrub(report.message),
      title: scrub(report.message).slice(0, 160) || `${report.kind === "bug" ? "Bug report" : "Improvement request"}`,
      route: report.path ? scrub(report.path) : null,
      date: report.createdAt.toISOString(),
      status: "reported",
      severity: "low",
      occurrences: 1,
      reopenedCount: 0,
    })),
  ];
  const { predictions, patternsExamined } = buildRiskRadar(observations, now);
  const repositoryHistory = historyCandidates();
  const enriched = predictions.map((prediction) => ({
    ...prediction,
    history: findRecoveryMatches(
      `${prediction.title} ${prediction.evidence[0]?.route ?? ""}`,
      repositoryHistory,
      3,
    ),
  }));

  return NextResponse.json({
    generatedAt: now.toISOString(),
    windowDays: 90,
    patternsExamined,
    observations: { incidents: incidents.length, userReports: feedback.length },
    observationLimitPerSource: 500,
    predictions: enriched,
    repositoryIndex: {
      issues: history.issues.length,
      pullRequests: history.pullRequests.length,
      commits: history.commits.length,
      generatedAt: history.generatedAt,
    },
  });
}

export async function POST(request: Request) {
  const gate = await requireCapability("security");
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as { query?: unknown; action?: unknown };
  if (body.action === "risk-radar") return riskRadar();

  const query = typeof body.query === "string" ? body.query.trim().slice(0, 500) : "";
  if (query.length < 3) {
    return NextResponse.json({ error: "Describe the problem in at least 3 characters." }, { status: 400 });
  }

  const terms = recoverySearchTerms(query);
  if (terms.length === 0) return NextResponse.json({ matches: [] });

  const incidents = await guardedPrisma.incident.findMany({
    where: {
      OR: terms.flatMap((term) => [
        { title: { contains: term, mode: "insensitive" as const } },
        { message: { contains: term, mode: "insensitive" as const } },
        { resolutionNote: { contains: term, mode: "insensitive" as const } },
        { route: { contains: term, mode: "insensitive" as const } },
      ]),
    },
    orderBy: [
      { reopenedCount: "asc" },
      { resolvedAt: { sort: "desc", nulls: "last" } },
      { lastSeenAt: "desc" },
      { id: "asc" },
    ],
    take: 200,
    select: {
      id: true,
      kind: true,
      severity: true,
      status: true,
      title: true,
      message: true,
      route: true,
      occurrences: true,
      reopenedCount: true,
      resolutionNote: true,
      resolvedAt: true,
      firstSeenAt: true,
      lastSeenAt: true,
    },
  });

  const incidentCandidates: RecoveryCandidate[] = incidents.map((incident) => ({
    id: incident.id,
    source: "incident",
    title: incident.title,
    detail: [incident.message, incident.route].filter(Boolean).join(" "),
    url: null,
    date: incident.resolvedAt?.toISOString() ?? incident.lastSeenAt.toISOString(),
    status: incident.status,
    resolutionNote: incident.resolutionNote,
    kind: incident.kind,
    severity: incident.severity,
    occurrences: incident.occurrences,
    reopenedCount: incident.reopenedCount,
  }));

  const feedback = await guardedPrisma.betaFeedback.findMany({
    where: {
      kind: { in: ["bug", "improve"] },
      OR: terms.flatMap((term) => [
        { message: { contains: term, mode: "insensitive" as const } },
        { path: { contains: term, mode: "insensitive" as const } },
      ]),
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 100,
    select: { id: true, kind: true, message: true, path: true, createdAt: true },
  });
  const feedbackCandidates: RecoveryCandidate[] = feedback.map((row) => {
    const message = scrub(row.message);
    const path = row.path ? scrub(row.path) : "";
    return {
      id: row.id,
      source: "user report",
      title: `${row.kind === "bug" ? "Bug report" : "Improvement request"}${path ? ` · ${path}` : ""}`,
      detail: message,
      url: null,
      date: row.createdAt.toISOString(),
      status: "reported",
    };
  });

  const matches = findRecoveryMatches(query, [...incidentCandidates, ...feedbackCandidates, ...historyCandidates()]);
  return NextResponse.json({
    matches: matches.map((match) => ({
      ...match,
      detail: match.detail.slice(0, 1200),
      score: Math.round(match.score * 100),
    })),
    indexed: {
      matchingIncidents: incidents.length,
      matchingUserReports: feedback.length,
      issues: history.issues.length,
      pullRequests: history.pullRequests.length,
      commits: history.commits.length,
      repositoryGeneratedAt: history.generatedAt,
    },
  });
}
