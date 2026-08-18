import bcryptjs from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";

/**
 * The office's own door onto parent accounts.
 *
 * Sits behind the `students` capability (see src/lib/admin-routes.ts) — the
 * same desk that enrols and edits students owns the guardians attached to
 * them. Unlike the self-service form at /auth/parent/signup, a link made here
 * is authoritative: the office picked the student off the real roster, so
 * `studentId` is set directly rather than left as an unconfirmed claim.
 */

const include = {
  user: { select: { id: true, name: true, email: true, createdAt: true } },
  student: {
    select: {
      id: true,
      studentCode: true,
      user: { select: { name: true, email: true } },
    },
  },
} as const;

export async function GET(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim() || undefined;
  const page = parseInt(url.searchParams.get("page") || "1", 10) || 1;
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));

  const whereClause: any = {};
  if (search) {
    whereClause.OR = [
      { user: { name: { contains: search, mode: "insensitive" } } },
      { user: { email: { contains: search, mode: "insensitive" } } },
      { childName: { contains: search, mode: "insensitive" } },
      { childEmail: { contains: search, mode: "insensitive" } },
      { student: { user: { name: { contains: search, mode: "insensitive" } } } },
    ];
  }

  const [parents, totalCount] = await Promise.all([
    prisma.parent.findMany({
      where: whereClause,
      include,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.parent.count({ where: whereClause }),
  ]);

  return NextResponse.json({ parents, totalCount });
}

export async function POST(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const studentId = typeof body.studentId === "string" && body.studentId ? body.studentId : null;
  const childName = typeof body.childName === "string" ? body.childName.trim() : "";
  const childEmail = typeof body.childEmail === "string" ? body.childEmail.trim().toLowerCase() : "";
  const childStudentCode = typeof body.childStudentCode === "string" ? body.childStudentCode.trim() : "";

  if (!name || !email || !password) {
    return NextResponse.json({ error: "Name, email, and password are required" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return NextResponse.json({ error: "Email already registered" }, { status: 400 });
  }

  // A student picked off the real roster is a stronger claim than anything
  // typed by hand, so its details fill in the child fields when they were
  // left blank — but never override a name/email the office typed on purpose.
  let linkedStudent: { id: string; user: { name: string | null; email: string } } | null = null;
  if (studentId) {
    linkedStudent = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, user: { select: { name: true, email: true } } },
    });
    if (!linkedStudent) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }
  }

  const hashedPassword = await bcryptjs.hash(password, 10);

  try {
    const user = await prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        role: "PARENT",
        tenantId: gate.session.user.tenantId,
        parent: {
          create: {
            phone: phone || null,
            studentId: linkedStudent?.id ?? null,
            childName: childName || linkedStudent?.user.name || null,
            childEmail: childEmail || linkedStudent?.user.email || null,
            childStudentCode: childStudentCode || null,
          },
        },
      },
      include,
    });

    return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } }, { status: 201 });
  } catch (error: any) {
    if (error?.code === "P2002" && error?.meta?.target?.includes("email")) {
      return NextResponse.json({ error: "Email already registered" }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Unable to create parent account", detail: error instanceof Error ? error.message : "Unknown" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const parentId = typeof body.parentId === "string" ? body.parentId : "";
  if (!parentId) {
    return NextResponse.json({ error: "Parent ID is required" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
  const newPassword = typeof body.password === "string" ? body.password : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : undefined;
  const childName = typeof body.childName === "string" ? body.childName.trim() : undefined;
  const childEmail = typeof body.childEmail === "string" ? body.childEmail.trim().toLowerCase() : undefined;
  const childStudentCode = typeof body.childStudentCode === "string" ? body.childStudentCode.trim() : undefined;

  try {
    const parent = await prisma.parent.findUnique({ where: { id: parentId }, select: { userId: true } });
    if (!parent) {
      return NextResponse.json({ error: "Parent not found" }, { status: 404 });
    }

    if (email) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing && existing.id !== parent.userId) {
        return NextResponse.json({ error: "Email already registered" }, { status: 400 });
      }
    }

    const updateUser = {} as { name?: string; email?: string; password?: string };
    if (name) updateUser.name = name;
    if (email) updateUser.email = email;
    if (newPassword) {
      if (newPassword.length < 8) {
        return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
      }
      updateUser.password = await bcryptjs.hash(newPassword, 10);
    }
    if (Object.keys(updateUser).length) {
      await prisma.user.update({ where: { id: parent.userId }, data: updateUser });
    }

    // studentId is handled separately so it can be explicitly cleared
    // (unlinking) rather than only ever set — `undefined` means "not part of
    // this request" and `null`/"" means "unlink".
    const updateParent = {} as {
      phone?: string | null;
      studentId?: string | null;
      childName?: string | null;
      childEmail?: string | null;
      childStudentCode?: string | null;
    };
    if (phone !== undefined) updateParent.phone = phone || null;
    if (childName !== undefined) updateParent.childName = childName || null;
    if (childEmail !== undefined) updateParent.childEmail = childEmail || null;
    if (childStudentCode !== undefined) updateParent.childStudentCode = childStudentCode || null;

    if (body.studentId !== undefined) {
      const nextStudentId = typeof body.studentId === "string" && body.studentId ? body.studentId : null;
      if (nextStudentId) {
        const student = await prisma.student.findUnique({
          where: { id: nextStudentId },
          select: { id: true },
        });
        if (!student) {
          return NextResponse.json({ error: "Student not found" }, { status: 404 });
        }
      }
      updateParent.studentId = nextStudentId;
    }

    if (Object.keys(updateParent).length) {
      await prisma.parent.update({ where: { id: parentId }, data: updateParent });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.code === "P2002" && error?.meta?.target?.includes("email")) {
      return NextResponse.json({ error: "Email already registered" }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Unable to update parent", detail: error instanceof Error ? error.message : "Unknown" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const parentId = typeof body.parentId === "string" ? body.parentId : "";
  if (!parentId) {
    return NextResponse.json({ error: "Parent ID is required" }, { status: 400 });
  }

  try {
    const parent = await prisma.parent.findUnique({ where: { id: parentId }, select: { userId: true } });
    if (!parent) {
      return NextResponse.json({ error: "Parent not found" }, { status: 404 });
    }

    await prisma.user.delete({ where: { id: parent.userId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Unable to delete parent", detail: error instanceof Error ? error.message : "Unknown" },
      { status: 500 },
    );
  }
}
