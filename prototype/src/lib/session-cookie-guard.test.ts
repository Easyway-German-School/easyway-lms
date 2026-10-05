import { describe, expect, it, vi } from "vitest";

import {
  clearsSessionCookie,
  guardSessionResponse,
  requestCarriesSessionCookie,
} from "./session-cookie-guard";

const COOKIE = "__Secure-next-auth.session-token=abc.def";

function responseSetting(...cookies: string[]) {
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response("{}", { status: 200, headers });
}

const input = (over: Partial<Parameters<typeof guardSessionResponse>[0]> = {}) => ({
  method: "GET",
  pathname: "/api/auth/session",
  cookieHeader: COOKIE,
  response: responseSetting("__Secure-next-auth.session-token=; Max-Age=0; Path=/"),
  cookieDecodes: async () => true,
  ...over,
});

describe("clearsSessionCookie", () => {
  it("recognises the shapes next-auth uses to delete a cookie", () => {
    expect(clearsSessionCookie("__Secure-next-auth.session-token=; Max-Age=0; Path=/")).toBe(true);
    expect(clearsSessionCookie("next-auth.session-token=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/")).toBe(true);
    expect(clearsSessionCookie("__Secure-next-auth.session-token.1=; Path=/")).toBe(true);
  });

  it("does not mistake a normal refresh or an unrelated cookie for a clear", () => {
    expect(clearsSessionCookie("__Secure-next-auth.session-token=eyJhbGciOi; Path=/; Expires=Fri, 01 Jan 2027 00:00:00 GMT")).toBe(false);
    expect(clearsSessionCookie("other=; Max-Age=0")).toBe(false);
    expect(clearsSessionCookie("__Host-next-auth.csrf-token=; Max-Age=0")).toBe(false);
  });
});

describe("requestCarriesSessionCookie", () => {
  it("finds the plain, secure and chunked names", () => {
    expect(requestCarriesSessionCookie("a=1; next-auth.session-token=x")).toBe(true);
    expect(requestCarriesSessionCookie("__Secure-next-auth.session-token.0=x; b=2")).toBe(true);
    expect(requestCarriesSessionCookie("a=1; b=2")).toBe(false);
    expect(requestCarriesSessionCookie(null)).toBe(false);
  });
});

describe("guardSessionResponse", () => {
  it("turns a clear of a GOOD cookie into a 503 with no Set-Cookie", async () => {
    const result = await guardSessionResponse(input());
    expect(result.action).toBe("replace");
    if (result.action !== "replace") return;
    expect(result.response.status).toBe(503);
    expect(result.response.headers.getSetCookie()).toEqual([]);
  });

  it("lets the clear through when the cookie really is invalid", async () => {
    const result = await guardSessionResponse(input({ cookieDecodes: async () => false }));
    expect(result.action).toBe("pass");
  });

  it("treats a decode that throws as invalid, never as a reason to keep it", async () => {
    const result = await guardSessionResponse(
      input({
        cookieDecodes: async () => {
          throw new Error("boom");
        },
      }),
    );
    expect(result.action).toBe("pass");
  });

  it("does not even try to decode when nothing is being cleared", async () => {
    const cookieDecodes = vi.fn(async () => true);
    const result = await guardSessionResponse(
      input({ response: responseSetting("__Secure-next-auth.session-token=newvalue; Path=/"), cookieDecodes }),
    );
    expect(result.action).toBe("pass");
    expect(cookieDecodes).not.toHaveBeenCalled();
  });

  it("leaves every other route, method and cookie-less request alone", async () => {
    expect((await guardSessionResponse(input({ pathname: "/api/auth/signout" }))).action).toBe("pass");
    expect((await guardSessionResponse(input({ method: "POST" }))).action).toBe("pass");
    expect((await guardSessionResponse(input({ cookieHeader: null }))).action).toBe("pass");
  });

  it("sign-out still works: its response is not a session GET", async () => {
    const result = await guardSessionResponse(
      input({ method: "POST", pathname: "/api/auth/signout" }),
    );
    expect(result.action).toBe("pass");
  });
});
