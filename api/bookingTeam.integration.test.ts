import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

/**
 * Company booking page wiring: open when any member is free, the default member holds it, members get the
 * alert (bell rows), first claim wins (second gets 409), and reassign swaps the owner on the invite list.
 */
describe.skipIf(!hasDb)("company booking page (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwteam-${stamp}-`;
  const slug = `gwteam-${stamp}`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const phone = (n: number) => `+1555${String(stamp + n).slice(-7)}`;
  const ins = async (sql: string, p: unknown[]) => Number(((await db.execute(sql, p as any[])) as any)[0].insertId);
  const q = async (sql: string, p: unknown[]) => ((await db.query(sql, p as any[])) as any)[0] as any[];
  let aId = 0;
  let bId = 0;
  let teamId = 0;
  const sessions: Record<number, string> = {};
  const day = (() => {
    const d = new Date(Date.now() + 3 * 86400_000);
    while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  const login = async (adminId: number) => {
    const crypto = await import("crypto");
    const token = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [adminId, crypto.createHash("sha256").update(token).digest("hex")]);
    sessions[adminId] = token;
  };
  const as = (adminId: number) => ({ Cookie: `gw_admin_sid=${sessions[adminId]}` });

  beforeAll(async () => {
    process.env.VITEST = "true";
    aId = await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Ana', 'Team', 'admin', 'active')`, [em("a")]);
    bId = await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Beto', 'Team', 'admin', 'active')`, [em("b")]);
    // A works mornings, B afternoons (personal links stay off).
    for (const [id, s, e] of [[aId, "09:00", "12:00"], [bId, "13:00", "17:00"]] as const) {
      await db.execute(`INSERT INTO scheduler_settings (admin_id, is_enabled, slug) VALUES (?, 0, ?)`, [id, `${slug}-p${id}`]);
      for (const d of [1, 2, 3, 4, 5]) await db.execute(`INSERT INTO scheduler_availability (admin_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)`, [id, d, s, e]);
    }
    teamId = await ins(
      `INSERT INTO booking_teams (slug, name, is_enabled, duration_minutes, buffer_minutes, min_notice_hours, advance_days, allow_phone, default_admin_id) VALUES (?, ?, 1, 30, 0, 0, 30, 1, ?)`,
      [slug, `${prefix}Groundwork`, aId],
    );
    for (const id of [aId, bId]) await db.execute(`INSERT INTO booking_team_members (team_id, admin_id) VALUES (?, ?)`, [teamId, id]);
    await login(aId);
    await login(bId);
  });

  afterAll(async () => {
    try {
      await db.execute(`DELETE FROM appointments WHERE booking_team_id = ? OR owner_admin_id IN (?, ?)`, [teamId, aId, bId]);
      await db.execute(`DELETE FROM admin_sessions WHERE admin_id IN (?, ?)`, [aId, bId]);
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("shows the company as host and offers times when any member is free", async () => {
    const info = (await request(app).get(`/api/public/book/${slug}`).expect(200)).body;
    expect(info.host).toMatchObject({ name: `${prefix}Groundwork`, team: true });
    const slots: string[] = (await request(app).get(`/api/public/book/${slug}/slots`).query({ date: day }).expect(200)).body.slots;
    expect(slots).toContain("09:00");
    expect(slots).toContain("15:00");
    expect(slots).not.toContain("12:30");
  });

  it("afternoon booking is held by the free member, alerts both, first claim wins, reassign swaps owner", async () => {
    const r = await request(app).post(`/api/public/book/${slug}`).send({ date: day, time: "15:00", name: `${prefix}Homeowner`, phone: phone(1), lang: "en" }).expect(201);
    const id = Number(r.body.appointment_id);
    const [ap] = await q(`SELECT owner_admin_id, booking_team_id, claimed_at FROM appointments WHERE id = ?`, [id]);
    expect(ap).toMatchObject({ owner_admin_id: bId, booking_team_id: teamId, claimed_at: null });
    const bells = await q(`SELECT admin_id FROM admin_notifications WHERE event_key = 'booking_created' AND admin_id IN (?, ?)`, [aId, bId]);
    expect(new Set(bells.map((x) => Number(x.admin_id)))).toEqual(new Set([aId, bId]));

    // Ana takes it (even though Beto held it); Beto is too late.
    const claimed = (await request(app).post(`/api/admin/appointments/${id}/claim`).set(as(aId)).expect(200)).body.appointment;
    expect(claimed.owner_admin_id).toBe(aId);
    expect(claimed.claimed_at).toBeTruthy();
    expect(claimed.attendees.filter((x: any) => x.kind === "admin").map((x: any) => x.admin_id)).toEqual([aId]);
    expect((await request(app).post(`/api/admin/appointments/${id}/claim`).set(as(bId)).expect(409)).body.error).toBe("errors.alreadyClaimed");

    // Reassign back to Beto from the drawer (owner only): Beto replaces Ana on the invite list.
    const out = (await request(app).patch(`/api/admin/appointments/${id}`).set(as(aId)).send({ owner_admin_id: bId }).expect(200)).body;
    expect(out.appointment.owner_admin_id).toBe(bId);
    expect(out.appointment.attendees.filter((x: any) => x.kind === "admin").map((x: any) => x.admin_id)).toEqual([bId]);
  });

  it("a time nobody is free is refused", async () => {
    await request(app).post(`/api/public/book/${slug}`).send({ date: day, time: "12:30", name: `${prefix}Gap`, phone: phone(2), lang: "en" }).expect(409);
  });

  it("a slug can't be shared between a company page and a personal link", async () => {
    await request(app).put(`/api/admin/scheduler`).set(as(aId)).send({ slug }).expect(409);
  });
});
