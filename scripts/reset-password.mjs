/**
 * Admin password reset for a self-hosted Magni instance — no email required.
 *
 * Usage (run on the host / over SSH, from the app directory):
 *   npm run reset-password -- user@email.com                 # random temp password
 *   npm run reset-password -- user@email.com 'newPassw0rd'   # set a specific one
 *
 * Point at the live database with DB_PATH (matches the app's setting), e.g.
 *   DB_PATH=/media/Safe-Storage/magni/data/workouts.db npm run reset-password -- user@email.com
 *
 * It rehashes the password with argon2id (same as the app), writes it directly,
 * and deletes the user's existing login sessions so any old session is revoked.
 */
import crypto from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";
import argon2 from "argon2";

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "data", "workouts.db");
const [emailArg, passwordArg] = process.argv.slice(2);

if (!emailArg) {
  console.error("Usage: npm run reset-password -- <email> [newPassword]");
  process.exit(1);
}

// Readable random password: 3 × 4 chars from an unambiguous alphabet (no 0/O/1/l/I).
function randomPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const pick = () =>
    Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  return `${pick()}-${pick()}-${pick()}`;
}

const password = passwordArg ?? randomPassword();
if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const db = new Database(DB_PATH);
const user = db
  .prepare("SELECT id, email FROM users WHERE lower(email) = lower(?)")
  .get(emailArg.trim());

if (!user) {
  // Don't print the account list — it would leak every registered email if this
  // output is ever captured into logs. Show the count only.
  const total = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  console.error(`No user with email "${emailArg}". (${total} account(s) exist.)`);
  process.exit(1);
}

const passwordHash = await argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});

db.transaction(() => {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, user.id);
  // Revoke any existing logins so an old/leaked session can't keep working.
  db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(user.id);
})();

console.log(`✓ Password reset for ${user.email}`);
if (!passwordArg) {
  console.log(`  New temporary password: ${password}`);
  console.log("  Share it securely; they can change it in Settings.");
}
