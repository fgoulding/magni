import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authenticated = vi.hoisted(() => ({ id: 0, denied: false }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, requireUser: async () => {
    if (authenticated.denied) throw new actual.UnauthorizedError();
    return { id: authenticated.id };
  } };
});

let database: typeof import("@/lib/db");
let route: typeof import("./route");
beforeAll(async () => {
  database = await import("@/lib/db");
  route = await import("./route");
  authenticated.id = Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('export@example.com','hash')").run().lastInsertRowid);
});
afterAll(() => database.db.close());

function session(userId: number, status = "completed", unit = "kg", date = "2026-09-01") {
  return Number(database.db.prepare("INSERT INTO sessions(user_id,program_name,day_name,week_number,date,status,unit) VALUES (?,'Saved program','Saved workout',1,?,?,?)")
    .run(userId, date, status, unit).lastInsertRowid);
}
function set(sessionId: number, reps: number | null, weight: number | null, count = 1) {
  return Number(database.db.prepare("INSERT INTO session_sets(session_id,exercise_name,reps,calculated_weight,actual_reps,actual_weight,sets) VALUES (?,'Row',10,40,?,?,?)")
    .run(sessionId, reps, weight, count).lastInsertRowid);
}

describe("training CSV actuals", () => {
  it("separates prescriptions from actuals, keeps zero/null and multiplicity, and exports only owned completed sessions", async () => {
    const id = session(authenticated.id);
    const logged = set(id, 8, 40, 3);
    const missing = set(id, null, null);
    const bodyweight = set(id, 12, 0);
    const failed = set(id, 0, 40);
    const missingLoad = set(id, 5, null);
    set(session(authenticated.id, "in_progress"), 10, 99);
    set(session(authenticated.id, "skipped"), 10, 99);
    const other = Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('other-export@example.com','hash')").run().lastInsertRowid);
    set(session(other), 10, 99);
    const response = await route.GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const [header, ...lines] = (await response.text()).trim().split("\n");
    const columns = header.split(",");
    const records = lines.map(line => Object.fromEntries(line.split(",").map((value, index) => [columns[index], value])));
    expect(records).toHaveLength(5);
    expect(records[0]).toMatchObject({ session_id: String(id), set_id: String(logged), program: "Saved program", workout: "Saved workout", actual_reps: "8", actual_weight: "40", set_count: "3", unit: "kg", is_recorded: "1", prescribed_reps: "10", prescribed_weight: "40", e1rm: "51" });
    expect(records.find(row => row.set_id === String(missing))).toMatchObject({ actual_reps: "", actual_weight: "", e1rm: "", is_recorded: "0" });
    expect(records.find(row => row.set_id === String(bodyweight))).toMatchObject({ actual_reps: "12", actual_weight: "0", e1rm: "", is_recorded: "1" });
    expect(records.find(row => row.set_id === String(failed))).toMatchObject({ actual_reps: "0", actual_weight: "40", e1rm: "", is_recorded: "1" });
    expect(records.find(row => row.set_id === String(missingLoad))).toMatchObject({ actual_reps: "5", actual_weight: "", e1rm: "", is_recorded: "1" });
  });

  it("quotes saved labels and preserves original units on another workout on the same date", async () => {
    const id = session(authenticated.id, "completed", "lb");
    database.db.prepare("UPDATE sessions SET day_name=? WHERE id=?").run('Upper, "A"\rday', id);
    set(id, 1, 100);
    const csv = await (await route.GET()).text();
    expect(csv).toContain('"Upper, ""A""\rday"');
    const lines = csv.split("\n");
    const columns = lines[0].split(",");
    expect(columns).toContain("unit");
    expect(csv).toContain(",lb,");
  });

  it("rejects unauthenticated exports", async () => {
    authenticated.denied = true;
    expect((await route.GET()).status).toBe(401);
    authenticated.denied = false;
  });
});
