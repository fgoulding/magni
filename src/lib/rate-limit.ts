/**
 * Tiny in-memory fixed-window rate limiter for auth endpoints (brute-force
 * defense on /login and /register). Single-instance only — fine for a
 * self-hosted box; if you ever scale to multiple replicas you'd need a shared
 * store (Redis) instead.
 *
 * It is a no-op outside production so the dev server, the unit suite, and the
 * Playwright e2e runs (which hammer /register from one address) aren't throttled.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = { ok: boolean; retryAfter: number };

export type RateLimitOptions = { limit: number; windowMs: number; now?: number };

/**
 * Pure, testable limiter. Records a hit for `key` and reports whether the caller
 * is within `limit` per `windowMs`. `retryAfter` is seconds until the window resets.
 */
export function hitRateLimit(key: string, { limit, windowMs, now = Date.now() }: RateLimitOptions): RateLimitResult {
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return { ok: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

/** Best-effort client IP from the reverse proxy. Caddy/nginx set x-forwarded-for. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/**
 * Production-only guard for an auth route. Returns a 429 Response when the
 * caller is over the limit, otherwise null. Skips entirely outside production.
 */
export function enforceAuthRateLimit(
  request: Request,
  scope: string,
  options: RateLimitOptions = { limit: 10, windowMs: 15 * 60 * 1000 },
): Response | null {
  if (process.env.NODE_ENV !== "production") return null;

  const result = hitRateLimit(`${scope}:${clientIp(request)}`, options);
  if (result.ok) return null;

  return new Response(JSON.stringify({ error: "Too many attempts. Try again later." }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": String(result.retryAfter) },
  });
}
