import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcryptjs from "bcryptjs";
import { verifyClaimToken } from "@/lib/candidates";

/**
 * Sets the first password on an account created by an exam booking.
 *
 * The signed token proves the request came from someone holding the link we
 * emailed to that address. It only ever works while the account has no usable
 * password of its own — once claimed, the link is spent, so a forwarded email
 * cannot be used to take over an account later.
 */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { email, token, password } = await req.json();

    if (!email || !token || !password) {
      return NextResponse.json({ error: "email, token and password are required" }, { status: 400 });
    }
    if (String(password).length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
    if (!verifyClaimToken(String(email), String(token))) {
      return NextResponse.json({ error: "This link is not valid." }, { status: 403 });
    }

    const user = await prisma.user.findUnique({
      where: { email: String(email).toLowerCase() },
      select: { id: true, role: true, passwordClaimed: true },
    });
    if (!user) {
      return NextResponse.json({ error: "No account for that address." }, { status: 404 });
    }
    if (user.passwordClaimed) {
      return NextResponse.json(
        { error: "This account already has a password. Sign in, or reset it instead." },
        { status: 409 },
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { password: await bcryptjs.hash(String(password), 10), passwordClaimed: true },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Candidate claim failed:", error);
    return NextResponse.json({ error: "Unable to set that password" }, { status: 500 });
  }
}
