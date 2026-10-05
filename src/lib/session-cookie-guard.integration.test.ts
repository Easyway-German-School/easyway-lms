import { beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import { encode, decode } from "next-auth/jwt";

import { guardSessionResponse } from "./session-cookie-guard";

/**
 * Against the real next-auth, not an imitation of it: prove the behaviour the
 * guard exists for (a throwing callback deletes the cookie), and that the guard
 * answers it correctly. If a next-auth upgrade changes how it clears cookies,
 * THIS is the test that fails — the unit tests would keep passing on the old shape.
 */
/**
 * next-auth's package "exports" hide its internals, so they are loaded by path:
 * the core handler, and its own bridge from the internal response to a web Response.
 */
const nodeRequire = createRequire(import.meta.url);
const nextAuthRoot = path.join(process.cwd(), "node_modules", "next-auth");
const { AuthHandler } = nodeRequire(path.join(nextAuthRoot, "core", "index.js"));
const { toResponse } = nodeRequire(path.join(nextAuthRoot, "next", "utils.js"));

const secret = "test-secret-test-secret-test-secret";

beforeAll(() => {
  process.env.NEXTAUTH_URL = "https://example.test";
  process.env.NEXTAUTH_SECRET = secret;
});

async function callSession(token: string, jwtThrows: boolean) {
  const internal = await AuthHandler({
    req: {
      action: "session",
      method: "GET",
      cookies: { "__Secure-next-auth.session-token": token },
      headers: { host: "example.test" },
    } as never,
    options: {
      secret,
      providers: [],
      session: { strategy: "jwt" },
      jwt: { secret },
      callbacks: {
        jwt: async ({ token }: { token: unknown }) => {
          if (jwtThrows) throw new Error("callback exploded");
          return token as never;
        },
      },
      logger: { error() {}, warn() {}, debug() {} },
    } as never,
  });
  return toResponse(internal);
}

const guard = (response: Response, goodToken: string) =>
  guardSessionResponse({
    method: "GET",
    pathname: "/api/auth/session",
    cookieHeader: `__Secure-next-auth.session-token=${goodToken}`,
    response,
    cookieDecodes: async () => Boolean(await decode({ token: goodToken, secret })),
  });

describe("against real next-auth", () => {
  it("a throwing callback really does clear a good cookie — and the guard keeps it", async () => {
    const token = await encode({ token: { id: "u1", role: "student" }, secret });
    const response = await callSession(token, true);

    expect(await response.clone().json()).toEqual({}); // what the browser would have believed
    expect(response.headers.getSetCookie().length).toBeGreaterThan(0); // and it clears the cookie

    const verdict = await guard(response, token);
    expect(verdict.action).toBe("replace");
    if (verdict.action === "replace") {
      expect(verdict.response.status).toBe(503);
      expect(verdict.response.headers.getSetCookie()).toEqual([]);
    }
  });

  it("a healthy session is left completely alone", async () => {
    const token = await encode({ token: { id: "u1", role: "student" }, secret });
    const response = await callSession(token, false);
    expect(((await response.clone().json()) as { user?: unknown }).user).toBeDefined();
    expect((await guard(response, token)).action).toBe("pass");
  });

  it("a cookie that does not decode is cleared as before", async () => {
    const response = await callSession("not-a-real-token", false);
    expect(await response.clone().json()).toEqual({});
    const verdict = await guardSessionResponse({
      method: "GET",
      pathname: "/api/auth/session",
      cookieHeader: "__Secure-next-auth.session-token=not-a-real-token",
      response,
      cookieDecodes: async () => Boolean(await decode({ token: "not-a-real-token", secret }).catch(() => null)),
    });
    expect(verdict.action).toBe("pass");
  });
});
