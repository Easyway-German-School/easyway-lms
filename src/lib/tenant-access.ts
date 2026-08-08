import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";

export type TenantAccessContext = {
  ok: boolean;
  response?: NextResponse;
  session?: any;
  tenantId?: string | null;
};

export async function requireTenantSession(): Promise<TenantAccessContext> {
  const session = (await getServerSession(authOptions as any)) as any;

  if (!session?.user?.id) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return {
    ok: true,
    session,
    tenantId: session.user.tenantId ?? null,
  };
}

export function tenantScopeForUser(tenantId: string | null | undefined) {
  return tenantId ? { tenantId } : {};
}

export function tenantScopeForStudent(tenantId: string | null | undefined) {
  if (!tenantId) return {};
  return {
    user: {
      tenantId,
    },
  };
}

export function tenantScopeForBranch(tenantId: string | null | undefined) {
  return tenantId ? { branch: { tenantId } } : {};
}

export function tenantScopeForLecturer(tenantId: string | null | undefined) {
  if (!tenantId) return {};
  return {
    user: {
      tenantId,
    },
  };
}

export function tenantScopeForAttendance(tenantId: string | null | undefined) {
  if (!tenantId) return {};
  return {
    student: {
      user: {
        tenantId,
      },
    },
  };
}

export function tenantScopeForExam(tenantId: string | null | undefined) {
  if (!tenantId) return {};
  return {
    branch: {
      tenantId,
    },
  };
}

export function tenantScopeForExamRegistration(tenantId: string | null | undefined) {
  if (!tenantId) return {};
  return {
    student: {
      user: {
        tenantId,
      },
    },
  };
}

export function tenantScopeForInvoice(tenantId: string | null | undefined) {
  if (!tenantId) return {};
  return {
    student: {
      user: {
        tenantId,
      },
    },
  };
}

export function tenantScopeForPayment(tenantId: string | null | undefined) {
  if (!tenantId) return {};
  return {
    student: {
      user: {
        tenantId,
      },
    },
  };
}

export function tenantScopeForNotification(tenantId: string | null | undefined) {
  if (!tenantId) return {};
  return {
    OR: [
      { branch: { tenantId } },
      { student: { user: { tenantId } } },
    ],
  };
}

export function denyCrossTenantAccess(
  tenantId: string | null | undefined,
  recordTenantId: string | null | undefined,
) {
  if (!tenantId) return null;
  if (recordTenantId && recordTenantId !== tenantId) {
    return NextResponse.json({ error: "Tenant access denied" }, { status: 403 });
  }
  return null;
}
