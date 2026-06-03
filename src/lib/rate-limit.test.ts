import { describe, expect, it } from "vitest";
import { clientIp, hitRateLimit } from "./rate-limit";

describe("hitRateLimit", () => {
  it("allows up to the limit within a window, then blocks", () => {
    const opts = { limit: 3, windowMs: 1000, now: 0 };
    const key = "test:allow-then-block";
    expect(hitRateLimit(key, opts).ok).toBe(true); // 1
    expect(hitRateLimit(key, opts).ok).toBe(true); // 2
    expect(hitRateLimit(key, opts).ok).toBe(true); // 3
    const blocked = hitRateLimit(key, opts); // 4
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBe(1);
  });

  it("resets after the window elapses", () => {
    const key = "test:reset";
    hitRateLimit(key, { limit: 1, windowMs: 1000, now: 0 });
    expect(hitRateLimit(key, { limit: 1, windowMs: 1000, now: 500 }).ok).toBe(false);
    expect(hitRateLimit(key, { limit: 1, windowMs: 1000, now: 1500 }).ok).toBe(true);
  });

  it("keys are independent", () => {
    const opts = { limit: 1, windowMs: 1000, now: 0 };
    expect(hitRateLimit("test:a", opts).ok).toBe(true);
    expect(hitRateLimit("test:b", opts).ok).toBe(true);
  });
});

describe("clientIp", () => {
  it("uses the first x-forwarded-for hop", () => {
    const req = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } });
    expect(clientIp(req)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip then 'unknown'", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "5.6.7.8" } }))).toBe("5.6.7.8");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });
});
