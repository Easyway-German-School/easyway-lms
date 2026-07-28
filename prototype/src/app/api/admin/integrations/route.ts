import { NextResponse } from "next/server";
import { getLmsConnectors, getConnectorData, testLmsConnector, syncLmsConnector } from "@/lib/integrations";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const connectorId = searchParams.get("connectorId");
    const action = searchParams.get("action");

    if (connectorId && action === "data") {
      const result = await getConnectorData(connectorId);
      return NextResponse.json({ result });
    }

    if (connectorId) {
      const result = await testLmsConnector(connectorId);
      return NextResponse.json({ result });
    }

    const connectors = getLmsConnectors();
    return NextResponse.json({ connectors });
  } catch (error) {
    console.error("Error loading integrations:", error);
    return NextResponse.json({ error: "Unable to load integrations" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const connectorId = searchParams.get("connectorId");
    const action = searchParams.get("action");

    if (connectorId && action === "sync") {
      const result = await syncLmsConnector(connectorId);
      return NextResponse.json({ result });
    }

    return NextResponse.json({ error: "Unsupported integration action" }, { status: 400 });
  } catch (error) {
    console.error("Error syncing integrations:", error);
    return NextResponse.json({ error: "Unable to sync integrations" }, { status: 500 });
  }
}
