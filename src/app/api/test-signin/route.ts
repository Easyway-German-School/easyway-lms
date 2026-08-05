import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcryptjs from "bcryptjs";
import { assertDevOnly } from "@/lib/dev-only";

export async function GET() {
  const blocked = assertDevOnly();
  if (blocked) return blocked;

  try {
    // Test if admin account exists
    const admin = await prisma.user.findUnique({
      where: { email: "admin@easyway.test" },
    });
    
    console.log("[test-signin] Admin user:", {
      exists: !!admin,
      email: admin?.email,
      role: admin?.role,
      roleNormalized: admin?.role?.toLowerCase(),
    });

    if (!admin) {
      return NextResponse.json({ error: "Admin not found" }, { status: 404 });
    }

    // Test password
    const passwordMatch = await bcryptjs.compare("AdminPass123!", admin.password);
    console.log("[test-signin] Password match:", passwordMatch);

    return NextResponse.json({
      adminExists: true,
      email: admin.email,
      role: admin.role,
      roleNormalized: admin.role?.toLowerCase(),
      passwordMatches: passwordMatch,
    });
  } catch (error) {
    console.error("[test-signin] Error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
