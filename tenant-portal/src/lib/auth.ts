import jwt from "jsonwebtoken";
import { prisma } from "./prisma";

const JWT_SECRET = process.env.JWT_SECRET ?? "change-me";
const SESSION_EXPIRY = "30d";

export type SessionPayload = {
  userId: string;
  email: string;
  role: string;
  tenantId?: string;
};

export async function createSessionToken(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, role: true, tenantId: true },
  });

  if (!user) {
    throw new Error("User not found");
  }

  return jwt.sign(
    {
      userId,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    },
    JWT_SECRET,
    { expiresIn: SESSION_EXPIRY },
  );
}

export async function getSessionFromToken(token: string | null) {
  if (!token) return null;

  try {
    const payload = jwt.verify(token, JWT_SECRET) as SessionPayload;
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, role: true, tenantId: true },
    });

    if (!user) return null;

    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId ?? undefined,
    };
  } catch (error) {
    return null;
  }
}

export async function requireSession(token: string | null) {
  const session = await getSessionFromToken(token);
  if (!session) {
    return null;
  }
  return session;
}

export function tenantWhere(tenantId?: string) {
  return tenantId ? { tenantId } : {};
}
