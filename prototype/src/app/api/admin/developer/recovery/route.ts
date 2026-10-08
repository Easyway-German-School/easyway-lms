import { NextResponse } from "next/server";

import history from "@/lib/developer-history";
import { requireCapability } from "@/lib/admin-roles";
import { scrub } from "@/lib/incidents";
import { guardedPrisma } from "@/lib/prisma";
import { findRecoveryMatches, recoverySearchTerms, type RecoveryCandidate } from "@/lib/developer-recovery";

export const dynamic = "force-dynamic";

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

export async function POST(request: Request) {
  const gate = await requireCapability("security");
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as { query?: unknown };
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
