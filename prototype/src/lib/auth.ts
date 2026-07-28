import NextAuth, { type AuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcryptjs from "bcryptjs";

const normalizeRole = (value: unknown) => String(value || "STUDENT").toLowerCase();

export const authOptions: AuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        role: { label: "Role", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Missing credentials");
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user || !(await bcryptjs.compare(credentials.password, user.password))) {
          throw new Error("Invalid credentials");
        }

        const storedRole = normalizeRole(user.role);
        // Only check role mismatch if a specific role was requested
        if (credentials.role) {
          const requestedRole = normalizeRole(credentials.role);
          if (requestedRole !== storedRole) {
            const portalName = storedRole === "lecturer" ? "lecturer" : "student";
            throw new Error(`This account is registered as a ${portalName} account. Please use the correct portal.`);
          }
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: storedRole,
        };
      },
    }),
  ],
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  session: {
    strategy: "jwt" as const,
    maxAge: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
  jwt: {
    secret: process.env.NEXTAUTH_SECRET,
    maxAge: 30 * 24 * 60 * 60,
  },
  callbacks: {
    async jwt({ token, user }: { token: JWT; user?: any }) {
      if (user) {
        token.id = user.id;
        token.role = normalizeRole(user.role);
      }
      return token;
    },
    async session({ session, token }: { session: any; token: JWT }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = normalizeRole(token.role || "STUDENT");
        if (!token.role) {
          try {
            const u = await prisma.user.findUnique({ where: { id: token.id as string } });
            session.user.role = normalizeRole(u?.role || "STUDENT");
          } catch (e) {
            session.user.role = "student";
          }
        }
      }
      return session;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};

export const authHandler = NextAuth(authOptions);
