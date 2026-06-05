import type { NextConfig } from "next";

// App-level security headers. The public edge is Cloudflare (Tunnel), which
// terminates TLS; Cloudflare's HSTS is OFF by default, so we emit HSTS from the
// app itself (harmless when proxied over HTTPS). React Refresh uses eval() in
// `next dev`; production builds don't, so only the dev CSP allows 'unsafe-eval'.
const isProd = process.env.NODE_ENV === "production";
const scriptSrc = isProd
  ? "script-src 'self' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Force HTTPS for two years. No `preload` (that's an apex-domain commitment);
  // includeSubDomains is safe for this subdomain host. Only emitted in prod.
  ...(isProd
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
  {
    // Self-hosted only; no third-party scripts/styles. 'unsafe-inline' is
    // required for Next's inline RSC-streaming/hydration scripts (dynamic per
    // render, so not hashable). Moving to a per-request nonce is a deliberate
    // deferred hardening step — see docs/security.md ("Accepted residual risks").
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      scriptSrc,
      "connect-src 'self'",
      "manifest-src 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone) so the Docker runtime
  // image doesn't need the full node_modules tree.
  output: "standalone",
  // Keep the native SQLite addon out of the bundle; it's required from
  // node_modules at runtime and traced into the standalone output.
  serverExternalPackages: ["better-sqlite3"],
  // On-device dev: set DEV_ORIGIN to your computer's LAN IP(s), comma-separated
  // (e.g. 192.168.1.20), so `next dev` accepts asset/HMR requests from your phone
  // on the same network. Without it, the phone loads HTML but no JS hydrates.
  allowedDevOrigins: process.env.DEV_ORIGIN
    ? process.env.DEV_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean)
    : [],
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
