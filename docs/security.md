# Security posture

Magni is a self-hosted, internet-facing app (public domain via Cloudflare
Tunnel, email-allowlisted registration). This documents what the app enforces,
the residual risks we've accepted, and the planned hardening we've deliberately
deferred.

## What's enforced

- **Passwords**: argon2id with pinned OWASP-minimum work factors (`src/lib/auth.ts`). Minimum length 8.
- **Sessions**: 256-bit CSPRNG opaque tokens in `auth_sessions`, 30-day expiry. `HttpOnly` + `SameSite=Lax` cookie; `Secure` in production (derived from `x-forwarded-proto`, which Cloudflare sets). Logout deletes the server row; changing/resetting a password revokes all sessions.
- **Registration**: gated by `REGISTER_ALLOWLIST`. **Fails closed in production** — an empty/unset allowlist denies all sign-ups rather than opening them.
- **Authorization**: every API route authenticates via `requireUser()` and scopes every query by the owner's `user_id` (no IDOR). Shared-program routes additionally check membership/role.
- **CSRF**: all state-changing routes (incl. login/register/logout) call `assertSameOrigin`, backed by `SameSite=Lax`.
- **Brute force**: per-IP rate limit on login/register (production only), keyed on the trusted `CF-Connecting-IP` header (not the spoofable `x-forwarded-for`).
- **SQL**: parameterized queries throughout (better-sqlite3 bound params).
- **Headers**: `next.config.ts` sets CSP, `X-Frame-Options: DENY` / `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, and HSTS (prod).
- **Login enumeration**: a decoy argon2 verify runs for unknown emails so response timing doesn't reveal which accounts exist.

## Accepted residual risks

These are deliberate trade-offs that are reasonable for a small self-hosted
instance. Revisit them if the user base or attack surface grows.

### 1. CSP allows `script-src 'unsafe-inline'` (deferred: nonce-based CSP)

**Status: known, accepted, fix planned.**

The production CSP includes `'unsafe-inline'` for `script-src`. This weakens the
CSP as an anti-XSS *second* layer: if an XSS sink were ever introduced, an
injected inline `<script>` would execute.

- **Why it's currently required**: Next.js App Router streams the page's RSC
  ("flight") payload to the browser via **inline** `self.__next_f.push(...)`
  scripts, which the client must run to hydrate. They're dynamic per render, so
  they can't be allowlisted by a static hash; without `'unsafe-inline'` (or a
  nonce) the browser blocks them and the page never hydrates (every button dead).
- **Current exposure**: low. The audit found **no XSS sink** — output is
  JSX-escaped, there's no `dangerouslySetInnerHTML`, and the session cookie is
  `HttpOnly` (an XSS couldn't read it, though it could still act same-origin).
- **The proper fix (deferred)**: a per-request nonce. `proxy.ts` (middleware)
  generates a nonce, emits it in the CSP header (`script-src 'self' 'nonce-…'`),
  and Next stamps it onto its own inline scripts; the browser then runs only
  Next's scripts and blocks any injected one. Deferred because it must be wired
  through middleware *and* verified to not break hydration (test at the iPhone
  viewport + PWA install). **Worth doing before shared-programs carries more
  user-generated content between accounts** — that's the most plausible future
  stored-XSS vector.

### 2. Rate limiter is in-memory, single-instance

Resets on every redeploy/restart and isn't shared across replicas. Fine for one
self-hosted container; a restart loop hands an attacker fresh windows. A shared
store (Redis) would be needed only if scaled to multiple instances.

### 3. Sessions have no idle timeout

A 30-day absolute expiry with no sliding/idle timeout and no rotation. A stolen
token is valid until expiry. Acceptable for this app class; logout and
password-change both revoke immediately.

## Operator checklist (infrastructure, outside the app)

- **Cloudflare SSL/TLS mode**: set to **Full (Strict)**.
- **Rotate the tunnel token** if it has ever been shared/exposed.
- Consider **Cloudflare WAF / rate-limiting rules** as edge defense-in-depth.
- Keep the `REGISTER_ALLOWLIST` set (production fails closed if empty).
- Keep **off-box backups** of the SQLite volume (`deploy/backup.sh`).
- Note: Watchtower mounts the Docker socket — a compromise of that container is
  host-root. Standard for Watchtower; acceptable for a single trusted host.
