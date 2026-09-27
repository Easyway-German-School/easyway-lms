import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminRequest } from "@/lib/admin-auth";
import { jsonRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

export const GET = jsonRoute(async () => {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const messages = await prisma.supportMessage.findMany({
    orderBy: { createdAt: "desc" },
    include: { booking: { select: { referenceCode: true, session: { select: { title: true } } } } },
  });
  return NextResponse.json({ messages });
});
