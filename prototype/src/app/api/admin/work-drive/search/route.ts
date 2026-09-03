import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { visibleWorkspacesWhere } from "@/lib/work-drive/workspaces";

export const dynamic = "force-dynamic";

/**
 * GET ?q= — full-text search across the files in every workspace this admin can
 * see. Matches the filename (the Phase 0 generated vector) OR the extracted
 * text (the Phase 2 index), and ranks filename hits above content hits.
 *
 * Raw SQL, because the search is two GIN indexes and a rank expression. Tenant
 * safety comes from resolving the visible workspace ids through the Prisma
 * (tenant-scoped) client FIRST and constraining the raw query to that set — the
 * raw query itself never sees another tenant's ids.
 */
export async function GET(request: NextRequest) {
  const gate = await requireCapability("work_drive");
  if (!gate.ok) return gate.response;

  const q = (new URL(request.url).searchParams.get("q") || "").trim().slice(0, 200);
  if (q.length < 2) return NextResponse.json({ query: q, files: [] });

  const workspaces = await prisma.workspace.findMany({
    where: { deletedAt: null, ...visibleWorkspacesWhere(gate.admin) },
    select: { id: true, name: true, slug: true },
  });
  if (workspaces.length === 0) return NextResponse.json({ query: q, files: [] });
  const wsById = new Map(workspaces.map((w) => [w.id, w]));

  const rows = await prisma.$queryRaw<
    { id: string; name: string; kind: string; sizeBytes: bigint; workspaceId: string; updatedAt: Date; rank: number }[]
  >`
    SELECT "id", "name", "kind", "sizeBytes", "workspaceId", "updatedAt",
           ts_rank("searchVector", plainto_tsquery('simple', ${q})) * 2
             + ts_rank(to_tsvector('simple', coalesce("textContent", '')), plainto_tsquery('simple', ${q})) AS rank
    FROM "DriveFile"
    WHERE "deletedAt" IS NULL
      AND "workspaceId" IN (${Prisma.join(workspaces.map((w) => w.id))})
      AND (
        "searchVector" @@ plainto_tsquery('simple', ${q})
        OR to_tsvector('simple', coalesce("textContent", '')) @@ plainto_tsquery('simple', ${q})
      )
    ORDER BY rank DESC, "updatedAt" DESC
    LIMIT 50
  `;

  return NextResponse.json({
    query: q,
    files: rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      sizeBytes: Number(r.sizeBytes),
      updatedAt: r.updatedAt,
      workspaceName: wsById.get(r.workspaceId)?.name ?? null,
      workspaceSlug: wsById.get(r.workspaceId)?.slug ?? null,
    })),
  });
}
