import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcryptjs from "bcryptjs";
import { assertDevOnly } from "@/lib/dev-only";
import { withUnscoped } from "@/lib/tenant/context";

async function handleGET() {

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

/**
 * Wrapped rather than marked inside the body: the scope has to be
 * established before the handler runs, not on its first line. See
 * withUnscoped in src/lib/tenant/context.ts.
 */
export const GET = withUnscoped(
  "development test-account fixture, refused outside development by assertDevOnly",
  handleGET,
);
