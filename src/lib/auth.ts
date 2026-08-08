import NextAuth, { type AuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcryptjs from "bcryptjs";
import { lecturerCanSignIn } from "@/lib/lecturer-status";

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

export const authHandler = NextAuth(authOptions);
