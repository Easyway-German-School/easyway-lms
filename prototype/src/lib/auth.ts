import NextAuth, { getServerSession, type AuthOptions, type Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcryptjs from "bcryptjs";
import { lecturerCanSignIn } from "@/lib/lecturer-status";
import { checkRateLimit, clearRateLimit, clientIp } from "@/lib/rate-limit";
import { NextResponse } from "next/server";

/**
 * The role a revoked tutor's session carries. Not a real role — every route
 * that requires "lecturer" refuses it, which is exactly the point. See the
 * session callback below.
 */
export const INACTIVE_LECTURER_ROLE = "inactive_lecturer";

const normalizeRole = (value: unknown) => String(value || "STUDENT").toLowerCase();

export const authOptions: AuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        role: { label: "Role", type: "text" },
        /**
         * The authenticator code, or a backup code. Empty on the first
         * attempt: the form does not know whether this account needs one until
         * the password has been checked, and asking everybody for a code they
         * may not have would be worse than a second round trip.
         */
        totp: { label: "Authentication code", type: "text" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Missing credentials");
        }

        /**
         * Two counters, because they stop different attacks and one alone
         * leaves the other open.
         *
         * By email: caps guesses against one account no matter how many
         * addresses the attacker comes from. By IP: caps an attacker who
         * sprays one common password across many accounts, which the
         * per-email counter would never see.
         *
         * The per-email limit is deliberately the looser of the two and the
         * window deliberately short. A tight one hands anybody who knows a
         * student's address the ability to lock them out of their own portal
         * by failing sign-in on purpose — trading a brute-force risk for a
         * harassment tool. Ten tries in fifteen minutes is far below what
         * guessing a password needs and far above what a real person typing
         * from memory ever hits.
         *
         * Counted before the bcrypt compare, so a refused attempt costs us
         * nothing. That is half the point: bcrypt is expensive by design, and
         * an unmetered sign-in route is a way to spend our CPU, not just our
         * patience.
         */
        const email = credentials.email.trim().toLowerCase();
        const ip = clientIp(req?.headers);

        const byEmail = checkRateLimit(`signin:email:${email}`, {
          windowMs: 15 * 60 * 1000,
          max: 10,
        });
        const byIp = checkRateLimit(`signin:ip:${ip}`, {
          windowMs: 15 * 60 * 1000,
          max: 50,
        });

        if (!byEmail.ok || !byIp.ok) {
          /**
           * One message for both, and it names no account. Saying "this
           * account is locked" would confirm the address exists — turning the
           * protection into the enumeration oracle it was added to prevent.
           */
          throw new Error(
            "Too many sign-in attempts. Please wait a few minutes and try again.",
          );
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
          // Exam candidates sign in through the student form — they have no
          // portal of their own to be sent to — and are routed to /candidate
          // afterwards based on their real role.
          const acceptable = requestedRole === "student"
            ? ["student", "candidate"]
            : [requestedRole];

          if (!acceptable.includes(storedRole)) {
            const portalName = storedRole === "lecturer" ? "lecturer" : "student";
            throw new Error(`This account is registered as a ${portalName} account. Please use the correct portal.`);
          }
        }

        /**
         * A tutor who no longer works here cannot sign in.
         *
         * This is the whole point of the status field: when somebody leaves,
         * the office marks them inactive instead of deleting the account, and
         * their marks, classes and history stay on record while their access
         * stops. Checked after the password so the message cannot be used to
         * enumerate which accounts are inactive.
         */
        if (storedRole === "lecturer") {
          const lecturer = await prisma.lecturer.findUnique({
            where: { userId: user.id },
            select: { status: true },
          });
          if (lecturer && !lecturerCanSignIn(lecturer.status)) {
            throw new Error(
              "This tutor account is no longer active. Contact the school office if you think this is wrong.",
            );
          }
        }

        /**
         * The second factor, checked only after the password is known good.
         *
         * Order matters: checking the code first would let anybody discover
         * which accounts have two-factor enabled without knowing any password.
         *
         * The thrown strings are a protocol with the sign-in forms, which read
         * `error` and decide whether to show the code field. NextAuth passes
         * the message through verbatim, so these must stay in step with
         * MFA_REQUIRED / MFA_INVALID in the form components.
         */
        const { verifyLogin, shouldRequireMfa, isEnforced } = await import("@/lib/mfa");
        const check = await verifyLogin(user.id, credentials.totp);

        if (check.status === "required") throw new Error("MFA_REQUIRED");
        if (check.status === "invalid") throw new Error("MFA_INVALID");

        if (check.status === "not_enrolled") {
          /**
           * An account that should carry a second factor and does not.
           *
           * Refused only once MFA_ENFORCED is set — before that the school is
           * still enrolling, and turning people away from the very screens
           * they enrol on would be a lockout rather than a control.
           */
          if (
            isEnforced() &&
            shouldRequireMfa(user.adminRole, user.adminCapabilities, user.role)
          ) {
            throw new Error("MFA_ENROLMENT_REQUIRED");
          }
        }

        /**
         * Cleared only here, at full success — past the password, the tutor
         * status check and the second factor.
         *
         * Not cleared on MFA_REQUIRED: that path has a correct password but no
         * code yet, and forgiving the count there would let somebody who has
         * stolen a password retry the six-digit code without limit, which is
         * the one thing the second factor exists to make expensive.
         */
        clearRateLimit(`signin:email:${email}`);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: storedRole,
          tenantId: user.tenantId ?? undefined,
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
        token.tenantId = user.tenantId;
      }
      return token;
    },
    async session({ session, token }: { session: any; token: JWT }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = normalizeRole(token.role || "STUDENT");
        session.user.tenantId = token.tenantId as string | undefined;
        if (!token.tenantId && token.id) {
          try {
            const u = await prisma.user.findUnique({
              where: { id: token.id as string },
              select: { tenantId: true },
            });
            session.user.tenantId = u?.tenantId ?? undefined;
          } catch (e) {
            session.user.tenantId = undefined;
          }
        }
        if (!token.role) {
          try {
            const u = await prisma.user.findUnique({ where: { id: token.id as string } });
            session.user.role = normalizeRole(u?.role || "STUDENT");
          } catch (e) {
            session.user.role = "student";
          }
        }

        /**
         * REVOCATION FOR A SESSION THAT ALREADY EXISTS.
         *
         * Refusing an inactive tutor at the sign-in form only stops the next
         * sign-in. These sessions are JWTs with a 30-day life, so somebody
         * marked inactive on Monday would otherwise keep their roster, their
         * register and their students' marks until the token happened to lapse
         * — precisely the window the status field was added to close.
         *
         * This is the one seam that covers it in a single place: every
         * `/api/lecturer/*` route reaches its data through `getServerSession`,
         * and each already refuses a session whose role is not "lecturer".
         * Downgrading the role here therefore locks all seventeen of them at
         * once, without seventeen chances to forget one.
         *
         * Only the role is dropped, never the identity — they stay signed in
         * as themselves and the portal shell signs them out with an
         * explanation, rather than the session vanishing under them.
         */
        if (session.user.role === "lecturer" && session.user.id) {
          try {
            const lecturer = await prisma.lecturer.findUnique({
              where: { userId: session.user.id as string },
              select: { status: true },
            });
            if (lecturer && !lecturerCanSignIn(lecturer.status)) {
              session.user.role = INACTIVE_LECTURER_ROLE;
            }
          } catch (e) {
            // Fail open: a database blip must not lock every tutor out of the
            // school mid-lesson. Sign-in still refuses them.
          }
        }
      }
      return session;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};

export async function getServerAuthSession(): Promise<Session | null> {
  return (await getServerSession(authOptions as never)) as Session | null;
}

export async function requireAuthSession(): Promise<Session | null> {
  const session = await getServerAuthSession();
  if (!session?.user?.id) return null;
  return session;
}

export function tenantWhere(tenantId?: string): { tenantId?: string } {
  return tenantId ? { tenantId } : {};
}

export const authHandler = NextAuth(authOptions);
