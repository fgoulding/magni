import type { NextConfig } from "next";

// App-level security headers. TLS-dependent HSTS is added at the Caddy edge
// (see Caddyfile) since the app itself runs HTTP behind the proxy.
// React Refresh uses eval() in `next dev`; production builds don't, so only the
// dev CSP allows 'unsafe-eval'. Everything else stays strict in both.
const scriptSrc =
  process.env.NODE_ENV === "production"
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    // Self-hosted only; no third-party scripts/styles. 'unsafe-inline' is
    // required for Next's hydration bootstrap + inline styles (nonce-based CSP
    // would need middleware — a reasonable future hardening step).
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
  // On-device dev: set DEV_ORIGIN to your computer's LAN IP (e.g. 192.168.1.20)
  // so `next dev` accepts asset requests from your phone on the same network.
  allowedDevOrigins: process.env.DEV_ORIGIN ? [process.env.DEV_ORIGIN] : [],
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
