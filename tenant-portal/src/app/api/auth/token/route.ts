import { NextResponse } from "next/server";
import { requireSession } from "../../../../lib/auth";

function getBearerToken(req: Request) {
  const authorization = req.headers.get("authorization");
  if (!authorization || !authorization.startsWith("Bearer ")) return null;
  return authorization.replace("Bearer ", "").trim();
}

export async function GET(req: Request) {
  const token = getBearerToken(req);
  const session = await requireSession(token);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ token });
}
