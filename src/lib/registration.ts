/**
 * Registration is gated by an email allowlist so a public instance can be opened
 * to the internet without letting strangers create accounts. The owner controls
 * *who* may register (via the REGISTER_ALLOWLIST env var); each invited person
 * still chooses their own private password.
 *
 * REGISTER_ALLOWLIST is a comma/space/newline-separated list of emails, e.g.
 *   REGISTER_ALLOWLIST="me@example.com, partner@example.com"
 *
 * If the var is unset or empty, registration is OPEN (convenient for local dev
 * and the test suite). In production you should always set it — see the
 * deployment guide.
 */
export function parseAllowlist(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[\s,]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Whether `email` (already normalized to lowercase) may register. */
export function isEmailAllowedToRegister(email: string, raw = process.env.REGISTER_ALLOWLIST): boolean {
  const allowlist = parseAllowlist(raw);
  // Empty allowlist => open registration (dev/test). Set it to lock down prod.
  if (allowlist.size === 0) return true;
  return allowlist.has(email.trim().toLowerCase());
}
