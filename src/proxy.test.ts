import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

function request(pathname: string, token?: string): NextRequest {
  return new NextRequest(`http://localhost${pathname}`, {
    headers: token ? { cookie: `auth_token=${token}` } : undefined,
  });
}

describe("proxy auth boundary", () => {
  it("returns 401 for unauthenticated API requests", async () => {
    const response = proxy(request("/api/programs"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("redirects unauthenticated page requests to login", () => {
    const response = proxy(request("/history"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("allows auth routes and PWA assets without a token", () => {
    expect(proxy(request("/api/auth/login")).status).toBe(200);
    expect(proxy(request("/manifest.json")).status).toBe(200);
    expect(proxy(request("/sw.js")).status).toBe(200);
  });

  it("allows the health probe without a token", () => {
    expect(proxy(request("/api/health")).status).toBe(200);
  });

  it("allows protected pages when a token cookie exists", () => {
    expect(proxy(request("/history", "abc")).status).toBe(200);
  });
});
