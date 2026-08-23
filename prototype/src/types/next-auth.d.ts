import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role?: string;
      tenantId?: string;
      /** Set only while this session is an admin acting as this student. */
      impersonatedBy?: { id: string; email?: string };
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
    tenantId?: string;
    adminLocked?: boolean;
    impersonatorId?: string;
    impersonatorEmail?: string;
    impersonatedStudentId?: string;
    impersonatorToken?: string;
  }
}
