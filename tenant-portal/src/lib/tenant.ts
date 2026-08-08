import { prisma } from "./prisma";

export async function getTenantBySlug(slug: string) {
  return prisma.tenant.findUnique({ where: { slug } });
}

export async function getPartnerConfig(tenantId: string) {
  return prisma.partnerConfig.findUnique({ where: { tenantId } });
}
