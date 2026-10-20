import { prisma } from "@/lib/prisma";
import {
  parseClosedSignupSlots,
  SIGNUP_CLOSED_SLOTS_KEY,
  type ClosedSignupSlot,
} from "@/lib/signup-availability";

export async function readClosedSignupSlots(tenantId: string): Promise<ClosedSignupSlot[]> {
  const row = await prisma.schoolSetting.findUnique({
    where: { tenantId_key: { tenantId, key: SIGNUP_CLOSED_SLOTS_KEY } },
  });
  return parseClosedSignupSlots(row?.value);
}

export async function writeClosedSignupSlots(
  tenantId: string,
  closedSlots: ClosedSignupSlot[],
): Promise<void> {
  await prisma.schoolSetting.upsert({
    where: { tenantId_key: { tenantId, key: SIGNUP_CLOSED_SLOTS_KEY } },
    update: { value: closedSlots },
    create: { tenantId, key: SIGNUP_CLOSED_SLOTS_KEY, value: closedSlots },
  });
}
