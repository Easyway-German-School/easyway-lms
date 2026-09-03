/**
 * Workspace access rules and the slug helper.
 *
 * A workspace has a `visibility`:
 *
 *   private  only people in WorkspaceMember can open it
 *   staff    every admin in the tenant can open it; editing needs membership
 *            (or the `work_drive` holder who created it)
 *   branch   staff whose admin scope includes `branchId` can open it
 *
 * The `work_drive` capability is the outer gate — every route checks it — so
 * this layer is about which workspaces a capable admin sees, not whether they
 * are an admin at all. A super admin (branchIds === null, capability "all")
 * sees everything, which matches how the rest of the admin area treats them.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AdminContext } from "@/lib/admin-roles";

export type WorkspaceRole = "owner" | "editor" | "viewer";

const VISIBILITIES = new Set(["private", "staff", "branch"]);

/** Fail closed: anything unrecognised is treated as the most private setting. */
export function normalizeVisibility(value: unknown): "private" | "staff" | "branch" {
  const v = String(value ?? "").toLowerCase();
  return VISIBILITIES.has(v) ? (v as "private" | "staff" | "branch") : "private";
}

const KINDS = new Set(["general", "department", "project", "event"]);
export function normalizeKind(value: unknown): string {
  const v = String(value ?? "").toLowerCase();
  return KINDS.has(v) ? v : "general";
}

/**
 * A URL-safe slug from a workspace name, made unique within the tenant by
 * appending -2, -3 … The tenant client scopes the uniqueness check, so two
 * schools can both have a "finance" workspace.
 */
export async function uniqueWorkspaceSlug(name: string): Promise<string> {
  const base =
    String(name)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "workspace";

  for (let n = 1; n < 500; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const clash = await prisma.workspace.findFirst({ where: { slug }, select: { id: true } });
    if (!clash) return slug;
  }
  // 500 workspaces sharing a name is not a real scenario; a timestamp suffix
  // is the safe way out rather than looping forever.
  return `${base}-${Date.now().toString(36)}`;
}

type WorkspaceForAccess = {
  id: string;
  visibility: string;
  branchId: string | null;
  createdById: string | null;
  members: { userId: string; role: string }[];
};

export type WorkspaceAccess = {
  canView: boolean;
  canEdit: boolean;
  /** The viewer's explicit membership role, if any. */
  memberRole: WorkspaceRole | null;
};

/**
 * What this admin may do with this workspace. `members` must be loaded on the
 * workspace (select just userId + role).
 */
export function workspaceAccess(
  workspace: WorkspaceForAccess,
  admin: Pick<AdminContext, "userId" | "branchIds">,
): WorkspaceAccess {
  const membership = workspace.members.find((m) => m.userId === admin.userId);
  const memberRole = (membership?.role as WorkspaceRole | undefined) ?? null;

  // Unrestricted admins (super) see and manage everything, the same way they
  // do across the rest of /admin.
  const unrestricted = admin.branchIds === null;

  let canView = false;
  const visibility = normalizeVisibility(workspace.visibility);
  if (memberRole) canView = true;
  else if (visibility === "staff") canView = true;
  else if (visibility === "branch") {
    canView =
      unrestricted || (workspace.branchId != null && (admin.branchIds ?? []).includes(workspace.branchId));
  } else if (visibility === "private") {
    canView = unrestricted; // a super admin can still open it; nobody else without membership
  }

  const canEdit =
    unrestricted ||
    workspace.createdById === admin.userId ||
    memberRole === "owner" ||
    memberRole === "editor";

  return { canView: canView || canEdit, canEdit, memberRole };
}

/**
 * The Prisma `where` that lists the workspaces this admin can see. Kept in
 * step with workspaceAccess() above — the list query cannot call a function per
 * row, so the rule is expressed twice: once as a filter here, once as a
 * decision there.
 */
export function visibleWorkspacesWhere(
  admin: Pick<AdminContext, "userId" | "branchIds">,
): Prisma.WorkspaceWhereInput {
  const unrestricted = admin.branchIds === null;
  if (unrestricted) return {};

  const or: Prisma.WorkspaceWhereInput[] = [
    { visibility: "staff" },
    { members: { some: { userId: admin.userId } } },
    { createdById: admin.userId },
  ];
  if ((admin.branchIds ?? []).length > 0) {
    or.push({ visibility: "branch", branchId: { in: admin.branchIds as string[] } });
  }
  return { OR: or };
}
