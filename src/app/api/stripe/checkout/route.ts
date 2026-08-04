import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  return NextResponse.json(
    { error: "Stripe is not enabled on this deployment" },
    { status: 501 }
  );
}
