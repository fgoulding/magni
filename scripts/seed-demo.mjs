/**
 * Seed a demo account with ~12 weeks of training history so the Stats and
 * Calendar screens have realistic data to look at.
 *
 * Usage (with the dev server running on http://localhost:3000):
 *   node scripts/seed-demo.mjs
 *
 * Then log in with:  demo@demo.com  /  demo1234
 *
 * Re-running wipes and re-seeds the demo user's sessions (idempotent).
 * Override the server URL with BASE_URL=... and the DB path with DB_PATH=...
 */
import Database from "better-sqlite3";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "data", "workouts.db");
const EMAIL = "demo@demo.com";
const PASSWORD = "demo1234";

const dateKey = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

// Register via the API so the password is hashed correctly (ignore "already exists").
const res = await fetch(`${BASE}/api/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!res.ok && res.status !== 409) {
  const body = await res.text();
  throw new Error(`register failed (${res.status}): ${body}`);
}

const db = new Database(DB_PATH);
db.pragma("busy_timeout = 8000");
const user = db.prepare("SELECT id FROM users WHERE email = ?").get(EMAIL);
if (!user) throw new Error("demo user not found after register; is the dev server using this DB_PATH?");
const userId = user.id;

// Clean any prior demo data for a deterministic re-seed.
db.prepare("DELETE FROM session_sets WHERE session_id IN (SELECT id FROM sessions WHERE user_id = ?)").run(userId);
db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);

const insSession = db.prepare(
  `INSERT INTO sessions (user_id, program_name, day_name, week_number, status, completed, completed_at, date)
   VALUES (?, ?, ?, ?, 'completed', 1, ?, ?)`,
);
const insSet = db.prepare(
  `INSERT INTO session_sets (session_id, exercise_name, category, progression_type, week_number, set_number, intensity_pct, reps, sets, rep_out_target, calculated_weight, actual_reps, actual_weight)
   VALUES (?, ?, ?, 'sbs', ?, ?, 0, ?, 1, ?, ?, ?, ?)`,
);

// Three sessions per week for 12 weeks; each centered on a main lift + accessories.
const days = [
  {
    name: "Squat Day",
    main: { name: "Squat", base: 245, step: 5, sets: 5, reps: 5 },
    accessories: [
      { name: "Leg Press", weight: 230, sets: 3, reps: 10 },
      { name: "Leg Curl", weight: 90, sets: 3, reps: 12, category: "accessory" },
    ],
  },
  {
    name: "Bench Day",
    main: { name: "Bench Press", base: 175, step: 3, sets: 5, reps: 5 },
    accessories: [
      { name: "DB Incline Bench Press", weight: 60, sets: 3, reps: 10 },
      { name: "Lateral Raise", weight: 20, sets: 3, reps: 15, category: "accessory" },
    ],
  },
  {
    name: "Deadlift Day",
    main: { name: "Deadlift", base: 305, step: 5, sets: 3, reps: 5 },
    accessories: [
      { name: "Barbell Row", weight: 155, sets: 4, reps: 8 },
      { name: "Biceps Curl", weight: 40, sets: 3, reps: 12, category: "accessory" },
    ],
  },
];

const seed = db.transaction(() => {
  for (let week = 0; week < 12; week += 1) {
    const weekNumber = week + 1;
    days.forEach((day, dayIndex) => {
      // spread the 3 sessions across the week, oldest week first
      const offset = (11 - week) * 7 + (5 - dayIndex * 2);
      if (offset < 0) return;
      const date = dateKey(daysAgo(offset));
      const sid = insSession.run(userId, "Demo Program", day.name, weekNumber, date, date).lastInsertRowid;

      const mainWeight = day.main.base + week * day.main.step;
      for (let setNumber = 1; setNumber <= day.main.sets; setNumber += 1) {
        // last set is an AMRAP-ish top set
        const actualReps = setNumber === day.main.sets ? day.main.reps + (week % 3) : day.main.reps;
        insSet.run(sid, day.main.name, "main", weekNumber, setNumber, day.main.reps, day.main.reps, mainWeight, actualReps, mainWeight);
      }
      for (const acc of day.accessories) {
        const weight = acc.weight + week * 2;
        for (let setNumber = 1; setNumber <= acc.sets; setNumber += 1) {
          insSet.run(sid, acc.name, acc.category ?? "aux", weekNumber, setNumber, acc.reps, acc.reps, weight, acc.reps, weight);
        }
      }
    });
  }
});
seed();

const sessions = db.prepare("SELECT COUNT(*) c FROM sessions WHERE user_id = ?").get(userId).c;
db.close();
console.log(`Seeded ${sessions} completed sessions for ${EMAIL}. Log in with ${EMAIL} / ${PASSWORD}`);
