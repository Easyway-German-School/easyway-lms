import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcryptjs from "bcryptjs";
import { assertDevOnly } from "@/lib/dev-only";

export async function GET() {
  const blocked = assertDevOnly();
  if (blocked) return blocked;

  try {
    const demoAdminEmail = "admin@easyway.test";
    const demoAdminPassword = "AdminPass123!";

    let admin = await prisma.user.findUnique({
      where: { email: demoAdminEmail },
    });
    let seeded = false;

    if (!admin) {
      const hashedAdmin = await bcryptjs.hash(demoAdminPassword, 10);
      admin = await prisma.user.create({
        data: {
          email: demoAdminEmail,
          name: "Demo Admin",
          password: hashedAdmin,
          role: "ADMIN",
        },
      });
      seeded = true;
      console.log("[test-signin] Created demo admin account for local development.");
    }

    console.log("[test-signin] Admin user:", {
      exists: !!admin,
      email: admin?.email,
      role: admin?.role,
      roleNormalized: admin?.role?.toLowerCase(),
    });

    const passwordMatch = await bcryptjs.compare(demoAdminPassword, admin.password);
    console.log("[test-signin] Password match:", passwordMatch);

    return NextResponse.json({
      adminExists: true,
      email: admin.email,
      role: admin.role,
      roleNormalized: admin.role?.toLowerCase(),
      passwordMatches: passwordMatch,
      seeded,
    });
  } catch (error) {
    console.error("[test-signin] Error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
