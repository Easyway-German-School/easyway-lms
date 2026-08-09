import NextAuth, { getServerSession, type AuthOptions, type Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcryptjs from "bcryptjs";
import { lecturerCanSignIn } from "@/lib/lecturer-status";
import { checkRateLimit, clearRateLimit, clientIp } from "@/lib/rate-limit";
import { setTenantScope, runWithTenant, runUnscoped } from "@/lib/tenant/context";
import { NextResponse } from "next/server";

/**
 * Run one query with whatever scope we have.
 *
 * Sign-in and session resolution both run in the gap where a tenant is being
 * established rather than known, and the two halves of that gap need different
 * treatment: once the user's tenant is in hand the query should be scoped to
 * it, and before that it cannot be. Written once here so the two call sites
 * below cannot disagree about which case they are in.
 */
function withScope<T>(tenantId: string | undefined, fn: () => Promise<T>): Promise<T> {
  return tenantId
    ? runWithTenant(tenantId, fn)
    : runUnscoped("session callback resolving a user who carries no tenant", fn);
}

/**
 * The role a revoked tutor's session carries. Not a real role — every route
 * that requires "lecturer" refuses it, which is exactly the point. See the
 * session callback below.
 */
export const INACTIVE_LECTURER_ROLE = "inactive_lecturer";

/**
 * The role a session carries once the account's password has been reset out
 * from under it. Not a real role — every route refuses it, which is the point.
 */
export const REVOKED_SESSION_ROLE = "revoked_session";

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
          /**
           * Unscoped because sign-in is the one moment there is no tenant to
           * scope by — finding this person's own record is precisely how their
           * tenant gets established. The lookup is by their own user id, which
           * the password has just been checked against, so it can reach exactly
           * one row and that row is theirs.
           */
          const lecturer = await runUnscoped(
            "sign-in resolves the user's own tutor record before any tenant is known",
            async () =>
              await prisma.lecturer.findUnique({
                where: { userId: user.id },
                select: { status: true },
              }),
          );
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
        // Sign-in time. Anything reset after this invalidates the token.
        token.issuedAt = Date.now();
        token.pwCheckedAt = Date.now();
      }

      /**
       * A password reset must end the sessions that existed before it.
       *
       * Otherwise the feature does not do the job people actually use it for.
       * Someone resets their password precisely because they think another
       * person is in their account — and with 30-day JWTs, that person keeps
       * the roster, the marks and the payment history for the rest of the
       * month regardless.
       *
       * Checked here rather than in the session callback, and throttled,
       * because the session callback runs on every `getServerSession` — that
       * is a database round trip per API call, forever, for every user. Every
       * five minutes bounds the cost to something negligible and bounds the
       * attacker's remaining window to five minutes, which is the right trade
       * against a 30-day one.
       */
      const CHECK_EVERY_MS = 5 * 60 * 1000;
      const lastChecked = Number(token.pwCheckedAt ?? 0);

      if (token.id && Date.now() - lastChecked > CHECK_EVERY_MS) {
        try {
          const { lastPasswordResetAt } = await import("@/lib/password-reset");
          const resetAt = await lastPasswordResetAt(token.id as string);
          const issuedAt = Number(token.issuedAt ?? 0);

          if (resetAt && issuedAt && resetAt.getTime() > issuedAt) {
            token.revoked = true;
          }
          token.pwCheckedAt = Date.now();
        } catch {
          /**
           * Fail open, deliberately, and for the same reason the tutor status
           * check below does: a database blip must not sign the whole school
           * out mid-lesson. It also means this works before the
           * PasswordResetToken table has been pushed — the query throws, the
           * check is skipped, and everything else carries on.
           */
        }
      }

      return token;
    },
    async session({ session, token }: { session: any; token: JWT }) {
      if (session.user) {
        /**
         * A token issued before the password was reset carries no role.
         *
         * Same seam the revoked-tutor check below uses, for the same reason:
         * every route already refuses a session whose role it does not
         * recognise, so dropping the role here locks all of them at once
         * rather than requiring each to remember a new check. The identity is
         * kept so the portal can explain itself instead of the session
         * silently evaporating.
         */
        if (token.revoked) {
          session.user.id = token.id as string;
          session.user.role = REVOKED_SESSION_ROLE;
          return session;
        }

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
            const lecturer = await withScope(session.user.tenantId, async () =>
              await prisma.lecturer.findUnique({
                where: { userId: session.user.id as string },
                select: { status: true },
              }),
            );
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

/**
 * The one place a request's tenant is established.
 *
 * Every signed-in route and page in the app reaches its session through here or
 * through requireAuthSession() below, so setting the scope at this single point
 * scopes all of them — including the ones written after this, which is the
 * whole reason it is here and not in each handler.
 *
 * Set unconditionally, including when there is no session and when the user
 * carries no tenant. A gate that only sets the scope on success leaves the
 * previous value in place on failure, and the previous value belongs to
 * somebody else.
 */
export async function getServerAuthSession(): Promise<Session | null> {
  const session = (await getServerSession(authOptions as never)) as Session | null;
  setTenantScope(session?.user?.tenantId ?? null);
  return session;
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
