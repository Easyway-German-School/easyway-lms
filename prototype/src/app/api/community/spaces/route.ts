import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listVisibleSpaces } from "@/lib/community-spaces";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { spaces, scope } = await listVisibleSpaces({
      userId: session.user.id as string,
      role: (session.user as any).role,
    });

    return NextResponse.json({
      spaces,
      isStaff: scope.isStaff,
      // Helps the UI explain an empty state (e.g. student with no branch set).
      scope: { branchId: scope.branchId, level: scope.level },
    });
  } catch (error) {
    console.error("Community spaces error:", error);
    return NextResponse.json({ error: "Unable to load community spaces" }, { status: 500 });
  }
}
