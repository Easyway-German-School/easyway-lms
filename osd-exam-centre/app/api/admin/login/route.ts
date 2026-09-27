import { NextRequest, NextResponse } from "next/server";
import { checkAdminPassword, clientIp, createSessionToken, isLockedOut, recordLoginAttempt, ADMIN_COOKIE_NAME } from "@/lib/admin-auth";
import { jsonRoute } from "@/lib/api-route";

export const POST = jsonRoute(async (req: NextRequest) => {
  const { password } = await req.json().catch(() => ({ password: "" }));
  if (!process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "ADMIN_PASSWORD is not configured on the server." }, { status: 503 });
  }

  const ip = clientIp(req);
  if (await isLockedOut(ip)) {
    return NextResponse.json({ error: "Too many failed attempts — try again later." }, { status: 429 });
  }

  const correct = checkAdminPassword(String(password || ""));
  await recordLoginAttempt(ip, correct);
  if (!correct) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE_NAME, createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
});
