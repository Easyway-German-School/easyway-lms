import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id as string;
  const progress = await prisma.missionProgress.findMany({
    where: { userId },
  });

  const missions = progress.reduce((acc: Record<string, boolean>, item) => {
    acc[item.missionId] = item.done;
    return acc;
  }, {});

  return NextResponse.json({ missions });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { missionId, done } = body || {};
  if (!missionId) return NextResponse.json({ error: "missionId required" }, { status: 400 });

  const userId = session.user.id as string;
  const mission = await prisma.missionProgress.upsert({
    where: { userId_missionId: { userId, missionId } },
    create: { userId, missionId, done: !!done },
    update: { done: !!done },
  });

  const progress = await prisma.missionProgress.findMany({
    where: { userId },
  });

  const missions = progress.reduce((acc: Record<string, boolean>, item) => {
    acc[item.missionId] = item.done;
    return acc;
  }, {});

  return NextResponse.json({ missions, mission });
}
