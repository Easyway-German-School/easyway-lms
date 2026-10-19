import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { normalizeStorageEndpoint } from "@/lib/storage";
import { buildDbInfraStatus, parseDbBoxStatus, type LinodeInstanceCost, type DbInfraStatus } from "@/lib/db-infra-status";

export const dynamic = "force-dynamic";

/** Which "eduprime-*" tag belongs to which cost group on the billing breakdown. */
function groupForTags(tags: string[]): LinodeInstanceCost["group"] {
  if (tags.includes("eduprime-db")) return "eduprime-db";
  if (tags.includes("eduprime-recorder")) return "eduprime-recorder";
  if (tags.some((t) => t.startsWith("eduprime-scheduler"))) return "eduprime-scheduler";
  return "other";
}

async function fetchDbBoxStatus(now: Date) {
  const endpoint = normalizeStorageEndpoint(process.env.BACKUP_S3_ENDPOINT);
  if (!endpoint || !process.env.BACKUP_S3_ACCESS_KEY || !process.env.BACKUP_S3_SECRET_KEY) return null;
  try {
    const { AwsClient } = await import("aws4fetch");
    const aws = new AwsClient({
      accessKeyId: process.env.BACKUP_S3_ACCESS_KEY,
      secretAccessKey: process.env.BACKUP_S3_SECRET_KEY,
      region: process.env.BACKUP_S3_REGION || "auto",
      service: "s3",
    });
    const url = `${endpoint.replace(/\/+$/, "")}/easyway-lms-offsite-backup/eduprime-db/status.json`;
    const res = await aws.fetch(url);
    if (!res.ok) return null;
    return parseDbBoxStatus(await res.json(), now);
  } catch {
    return null;
  }
}

async function fetchBilling(): Promise<DbInfraStatus["billing"]> {
  const token = process.env.LINODE_TOKEN;
  const fetchedAt = new Date().toISOString();
  if (!token) return { instances: [], totalUsdPerMonth: 0, byGroup: {}, fetchedAt, error: "LINODE_TOKEN is not set" };

  try {
    const headers = { Authorization: `Bearer ${token}` };
    const [instancesRes, typesRes] = await Promise.all([
      fetch("https://api.linode.com/v4/linode/instances?page_size=100", { headers, cache: "no-store" }),
      fetch("https://api.linode.com/v4/linode/types", { headers, cache: "no-store" }),
    ]);
    if (!instancesRes.ok) throw new Error(`Linode API returned ${instancesRes.status} listing instances`);
    if (!typesRes.ok) throw new Error(`Linode API returned ${typesRes.status} listing types`);

    const instancesJson = (await instancesRes.json()) as { data: { label: string; type: string; status: string; tags: string[] }[] };
    const typesJson = (await typesRes.json()) as { data: { id: string; price: { monthly: number | null } }[] };
    const priceById = new Map(typesJson.data.map((t) => [t.id, t.price.monthly ?? 0]));

    const instances: LinodeInstanceCost[] = instancesJson.data.map((i) => ({
      label: i.label,
      group: groupForTags(i.tags ?? []),
      type: i.type,
      status: i.status,
      usdPerMonth: priceById.get(i.type) ?? 0,
    }));

    const totalUsdPerMonth = instances.reduce((sum, i) => sum + i.usdPerMonth, 0);
    const byGroup: Record<string, number> = {};
    for (const i of instances) byGroup[i.group] = (byGroup[i.group] ?? 0) + i.usdPerMonth;

    return { instances, totalUsdPerMonth, byGroup, fetchedAt, error: null };
  } catch (error) {
    return { instances: [], totalUsdPerMonth: 0, byGroup: {}, fetchedAt, error: error instanceof Error ? error.message : "Could not reach Linode" };
  }
}

export async function GET() {
  const gate = await requireCapability("security");
  if (!gate.ok) return gate.response;

  const now = new Date();
  const [box, billing] = await Promise.all([fetchDbBoxStatus(now), fetchBilling()]);
  return NextResponse.json(buildDbInfraStatus({ box, billing }));
}
