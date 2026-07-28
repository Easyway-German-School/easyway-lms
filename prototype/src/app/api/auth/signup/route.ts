import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcryptjs from "bcryptjs";

function buildCorsHeaders(request: NextRequest) {
  const origin = request.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin === "*" ? "*" : origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  };
}

export async function OPTIONS(request: NextRequest) {
  return NextResponse.json({}, { status: 204, headers: buildCorsHeaders(request) });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const { email, password, name, role } = body || {};

    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const normalizedName = typeof name === "string" ? name.trim() : "";
    const normalizedPassword = typeof password === "string" ? password : "";
    const normalizedRole = role === "lecturer" ? "LECTURER" : "STUDENT";

    if (!normalizedEmail || !normalizedPassword || !normalizedName) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (normalizedPassword.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 400 }
      );
    }

    const hashedPassword = await bcryptjs.hash(normalizedPassword, 10);

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name: normalizedName,
        password: hashedPassword,
        role: normalizedRole,
        student: normalizedRole === "STUDENT" ? {
          create: {
            level: "A1",
            pathway: "Goethe exam mastery",
          },
        } : undefined,
      },
    });

    return NextResponse.json(
      {
        message: "User created successfully",
        user: { id: user.id, email: user.email, name: user.name },
      },
      { status: 201, headers: buildCorsHeaders(request) }
    );
  } catch (error) {
    console.error("Sign up error:", error);
    return NextResponse.json(
      {
        error: "Unable to create account right now. Please try again in a moment.",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500, headers: buildCorsHeaders(request) }
    );
  }
}
