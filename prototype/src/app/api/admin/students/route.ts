import bcryptjs from "bcryptjs";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
async function isAdmin(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user?.role === "ADMIN";
}

export async function GET(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!await isAdmin(session.user.id)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId");
  const level = url.searchParams.get("level");
  const batch = url.searchParams.get("batch");
  const status = url.searchParams.get("status");
  const paymentStatus = url.searchParams.get("paymentStatus");
  const tutorId = url.searchParams.get("tutorId");
  const search = url.searchParams.get("search") || undefined;
  const page = parseInt(url.searchParams.get("page") || "1", 10) || 1;
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));

  const whereClause: any = {};
  if (branchId) whereClause.branchId = branchId;
  if (level) whereClause.level = level;
  if (batch) whereClause.admission = { path: ["batch"], equals: batch };
  if (status) whereClause.status = status;

  if (search) {
    whereClause.AND = whereClause.AND || [];
    // No `mode: "insensitive"` here: SQLite does not support it and Prisma
    // rejects the whole query, so every search returned a 500. SQLite's LIKE is
    // already case-insensitive for ASCII, which is what these columns hold.
    whereClause.AND.push({
      OR: [
        { user: { name: { contains: search } } },
        { user: { email: { contains: search } } },
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

  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!await isAdmin(session.user.id)) {
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

  try {
    const user = await prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        role: "STUDENT",
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

  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!await isAdmin(session.user.id)) {
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

  if (!studentId) {
    return NextResponse.json({ error: "Student ID is required" }, { status: 400 });
  }

  try {
    const student = await prisma.student.findUnique({ where: { id: studentId }, include: { user: true } });
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    if (email && email !== student.user.email) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return NextResponse.json({ error: "Email already registered" }, { status: 400 });
      }
    }

    const updateUser = {} as { name?: string; email?: string };
    if (name) updateUser.name = name;
    if (email) updateUser.email = email;

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

  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!await isAdmin(session.user.id)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const studentId = typeof body.studentId === "string" ? body.studentId : "";
  if (!studentId) {
    return NextResponse.json({ error: "Student ID is required" }, { status: 400 });
  }

  try {
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    await prisma.user.delete({ where: { id: student.userId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Unable to delete student", detail: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}
