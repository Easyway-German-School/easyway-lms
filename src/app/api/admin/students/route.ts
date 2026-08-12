import bcryptjs from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { requireTenantSession, tenantScopeForUser } from "@/lib/tenant-access";
async function isAdmin(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user?.role === "ADMIN";
}

export async function GET(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const auth = await requireTenantSession();
  if (!auth.ok) return auth.response!;

  if (!await isAdmin(auth.session.user.id)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId");
  const level = url.searchParams.get("level");
  const batch = url.searchParams.get("batch");
  const status = url.searchParams.get("status");
  const paymentStatus = url.searchParams.get("paymentStatus");
  const tutorId = url.searchParams.get("tutorId");
  const classTypeFilter = url.searchParams.get("classType") || undefined;
  const search = url.searchParams.get("search") || undefined;
  const page = parseInt(url.searchParams.get("page") || "1", 10) || 1;
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));

  const whereClause: any = tenantScopeForUser(auth.tenantId);
  if (branchId) whereClause.branchId = branchId;
  if (level) whereClause.level = level;
  if (batch) whereClause.admission = { path: ["batch"], equals: batch };
  if (status) whereClause.status = status;
  if (classTypeFilter) whereClause.classType = classTypeFilter;

  if (search) {
    whereClause.AND = whereClause.AND || [];
    // No `mode: "insensitive"` here: SQLite does not support it and Prisma
    // rejects the whole query, so every search returned a 500. SQLite's LIKE is
    // already case-insensitive for ASCII, which is what these columns hold.
    whereClause.AND.push({
      OR: [
        // `mode: "insensitive"` throughout: on SQLite a LIKE was already
        // case-blind, so nobody ever typed a capital letter and lost a student.
        // Postgres is not, and without this the office would search "chidi" and
        // be told there is no such person.
        { user: { name: { contains: search, mode: "insensitive" } } },
        { user: { email: { contains: search, mode: "insensitive" } } },
      ],
    });
  }

  if (paymentStatus) {
    whereClause.payments = { some: { status: paymentStatus } };
  }
  if (tutorId) {
    whereClause.tutorId = tutorId;
  }

  const totalCount = await prisma.student.count({ where: whereClause });

  const students = await prisma.student.findMany({
    where: whereClause,
    include: {
      user: true,
      branch: true,
      tutor: { include: { user: true } },
      payments: {
        orderBy: { createdAt: "desc" },
      },
      invoices: {
        include: { payments: true },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  // Compute simple payment summary per student
  const enriched = students.map((s) => {
    const totalPaid = (s.payments || []).reduce((acc, p) => acc + (p.amount || 0), 0);
    const totalInvoiced = (s.invoices || []).reduce((acc, inv) => acc + (inv.totalAmount || 0), 0);
    const balance = totalInvoiced - totalPaid;
    return { ...s, _paymentSummary: { totalPaid, totalInvoiced, balance } };
  });

  return NextResponse.json({ students: enriched, totalCount });
}

export async function POST(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const auth = await requireTenantSession();
  if (!auth.ok) return auth.response!;

  if (!await isAdmin(auth.session.user.id)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const level = typeof body.level === "string" ? body.level : "A1";
  const branchId = typeof body.branchId === "string" ? body.branchId : null;
  const tutorId = typeof body.tutorId === "string" ? body.tutorId : null;
  const status = typeof body.status === "string" ? body.status : "active";

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

  const hashedPassword = await bcryptjs.hash(password, 10);

  if (auth.tenantId && branchId) {
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { tenantId: true } });
    if (!branch || branch.tenantId !== auth.tenantId) {
      return NextResponse.json({ error: "Branch not found" }, { status: 404 });
    }
  }

  try {
    const user = await prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        role: "STUDENT",
        tenantId: auth.tenantId ?? undefined,
        student: {
          create: {
            level,
            branchId,
            status,
            tutorId,
            pathway: "Language training",
          },
        },
      },
    });

    return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Unable to create student", detail: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const auth = await requireTenantSession();
  if (!auth.ok) return auth.response!;

  if (!await isAdmin(auth.session.user.id)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const studentId = typeof body.studentId === "string" ? body.studentId : "";
  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
  const level = typeof body.level === "string" ? body.level : undefined;
  const branchId = typeof body.branchId === "string" ? body.branchId : null;
  const tutorId = typeof body.tutorId === "string" ? body.tutorId : null;
  const status = typeof body.status === "string" ? body.status : undefined;
  const classType = body.classType === "private" || body.classType === "group" ? body.classType : undefined;
  const sessionSlot = ["morning", "afternoon", "evening"].includes(String(body.sessionSlot))
    ? String(body.sessionSlot)
    : undefined;
  const newPassword = typeof body.password === "string" ? body.password : "";

  if (!studentId) {
    return NextResponse.json({ error: "Student ID is required" }, { status: 400 });
  }

  try {
    const student = await prisma.student.findUnique({ where: { id: studentId }, include: { user: true } });
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    if (auth.tenantId && student.user.tenantId !== auth.tenantId) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    if (email && email !== student.user.email) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return NextResponse.json({ error: "Email already registered" }, { status: 400 });
      }
    }

    const updateUser = {} as { name?: string; email?: string; password?: string };
    if (name) updateUser.name = name;
    if (email) updateUser.email = email;

    /**
     * Resetting a student's password from the office.
     *
     * There is no self-service "forgot password" flow, and a locked-out student
     * cannot be sent a reset link by an app with no email configured — so
     * without this the only cure was editing the database by hand. A school
     * secretary sets a temporary password and reads it to the student over the
     * phone or WhatsApp, which is how the branches already work.
     *
     * Gated the same as every other admin write on this route: the `students`
     * capability plus a confirmed admin account.
     */
    if (newPassword) {
      if (newPassword.length < 8) {
        return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
      }
      updateUser.password = await bcryptjs.hash(newPassword, 10);
    }

    const updateStudent = {} as {
      level?: string;
      branchId?: string | null;
      status?: string;
      tutorId?: string | null;
      classType?: string;
      sessionSlot?: string;
    };
    if (level) updateStudent.level = level;
    if (body.branchId !== undefined) updateStudent.branchId = branchId;
    if (body.tutorId !== undefined) updateStudent.tutorId = tutorId;
    if (status) updateStudent.status = status;
    if (classType) updateStudent.classType = classType;
    if (sessionSlot) updateStudent.sessionSlot = sessionSlot;

    await prisma.user.update({ where: { id: student.userId }, data: updateUser });
    await prisma.student.update({ where: { id: studentId }, data: updateStudent });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Unable to update student", detail: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const auth = await requireTenantSession();
  if (!auth.ok) return auth.response!;

  if (!await isAdmin(auth.session.user.id)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const studentId = typeof body.studentId === "string" ? body.studentId : "";
  if (!studentId) {
    return NextResponse.json({ error: "Student ID is required" }, { status: 400 });
  }

  try {
    const student = await prisma.student.findUnique({ where: { id: studentId }, include: { user: true } });
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    if (auth.tenantId && student.user.tenantId !== auth.tenantId) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    await prisma.user.delete({ where: { id: student.userId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Unable to delete student", detail: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}
