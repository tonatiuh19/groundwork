import "dotenv/config";
import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

/**
 * Appointments carry a City (City Pipeline record): picked or inherited from the client, required for
 * City meetings / Presentations, logged on the city's history, listed on the staff Meetings tab, and
 * visible to that city's partners only for City meetings / Presentations.
 */
describe.skipIf(!hasDb)("appointment city (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const prefix = `gwapptcity-${Date.now()}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const ins = async (sql: string, p: unknown[]) => Number(((await db.execute(sql, p as any[])) as any)[0].insertId);
  const session = async (table: string, col: string, id: number, cookie: string) => {
    const t = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO ${table} (${col}, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [id, crypto.createHash("sha256").update(t).digest("hex")]);
    return `${cookie}=${t}`;
  };
  const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
  let admin = "";
  let partner = "";
  let cityId = 0;
  let clientId = 0;
  let partnerId = 0;

  beforeAll(async () => {
    process.env.VITEST = "true";
    admin = await session("admin_sessions", "admin_id", await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Ap', 'City', 'super_admin', 'active')`, [em("admin")]), "gw_admin_sid");
    cityId = await ins(`INSERT INTO service_cities (name, active, pipeline_stage) VALUES (?, 0, 'target')`, [`${prefix}Rancho`]);
    clientId = await ins(`INSERT INTO clients (first_name, last_name, email, status, city_id) VALUES ('Ana', 'City', ?, 'active', ?)`, [em("ana"), cityId]);
    const p = (partnerId = await ins(`INSERT INTO city_partners (email, first_name, last_name, company, status) VALUES (?, 'Adam', 'Perez', 'Perez Test LLC', 'active')`, [em("adam")]));
    await db.execute(`INSERT INTO city_partner_cities (city_partner_id, city_id) VALUES (?, ?)`, [p, cityId]);
    partner = await session("city_partner_sessions", "city_partner_id", p, "gw_city_sid");
  });

  afterAll(async () => {
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  const book = (body: Record<string, unknown>) =>
    request(app).post("/api/admin/appointments").set("Cookie", admin).send({ date: day(4), start: "10:00", duration_minutes: 60, location_type: "office", notify_homeowner: false, attendees: [], ...body });

  it("a city meeting needs a city; with one it lands on the city's history", async () => {
    expect((await book({ kind: "city_meeting", title: `${prefix}council` })).body.error).toBe("validation.appointmentCity");
    const r = await book({ kind: "city_meeting", title: `${prefix}council`, city_id: cityId }).expect(201);
    expect(r.body.appointment).toMatchObject({ city_id: cityId, city_name: `${prefix}Rancho` });
    const [[act]] = (await db.query(`SELECT activity_type, summary FROM city_activities WHERE city_id = ? ORDER BY id DESC LIMIT 1`, [cityId])) as any;
    expect(act).toMatchObject({ activity_type: "meeting" });
    expect(act.summary).toContain(`${prefix}council`);
  });

  it("a homeowner appointment inherits the client's city; staff see both on the Meetings tab, the partner only the city meeting", async () => {
    const r = await book({ kind: "consultation", title: `${prefix}consult`, client_id: clientId }).expect(201);
    expect(r.body.appointment.city_id).toBe(cityId);
    const staff = await request(app).get(`/api/admin/city-pipeline/${cityId}/appointments`).set("Cookie", admin).expect(200);
    expect(staff.body.items.map((a: any) => a.title).sort()).toEqual([`${prefix}consult`, `${prefix}council`]);
    const mine = await request(app).get("/api/city/meetings").set("Cookie", partner).expect(200);
    const titles = mine.body.items.map((a: any) => a.title);
    expect(titles).toContain(`${prefix}council`);
    expect(titles).not.toContain(`${prefix}consult`);
    expect(mine.body.items.find((a: any) => a.title === `${prefix}council`)).toMatchObject({ mine: false });
    // A partner can't cancel a meeting Groundwork booked.
    const council = mine.body.items.find((a: any) => a.title === `${prefix}council`);
    await request(app).post(`/api/city/meetings/${council.id}/cancel`).set("Cookie", partner).send({}).expect(404);
  });

  it("staff tag a City Partner on a Presentation: picker lists them, they're invited and see it in their portal", async () => {
    const list = await request(app).get("/api/admin/appointments/city-partners").set("Cookie", admin).expect(200);
    expect(list.body.items.find((x: any) => x.id === partnerId)).toMatchObject({ company: "Perez Test LLC", city_ids: [cityId] });
    const r = await book({ kind: "presentation", title: `${prefix}pres`, city_id: cityId, attendees: [{ kind: "city_partner", city_partner_id: partnerId }] }).expect(201);
    expect(r.body.appointment.attendees).toContainEqual(expect.objectContaining({ kind: "city_partner", city_partner_id: partnerId, email: em("adam") }));
    const mine = await request(app).get("/api/city/meetings").set("Cookie", partner).expect(200);
    expect(mine.body.items.find((a: any) => a.title === `${prefix}pres`)).toMatchObject({ mine: false });
    // An unknown / inactive partner is refused.
    expect((await book({ kind: "presentation", title: `${prefix}bad-p`, city_id: cityId, attendees: [{ kind: "city_partner", city_partner_id: 999999999 }] })).body.error).toBe("validation.invalidReference");
  });

  it("edge cases: older city meetings stay editable, clearing the city is refused, archived cities aren't inherited", async () => {
    // An older City meeting saved without a city (before this field existed): other edits still work.
    const [[a]] = (await db.query(`SELECT id FROM appointments WHERE title = ?`, [`${prefix}council`])) as any;
    await db.execute(`UPDATE appointments SET city_id = NULL WHERE id = ?`, [a.id]);
    await request(app).patch(`/api/admin/appointments/${a.id}`).set("Cookie", admin).send({ title: `${prefix}council` }).expect(200);
    // Clearing the city of a City meeting is refused; picking one works.
    expect((await request(app).patch(`/api/admin/appointments/${a.id}`).set("Cookie", admin).send({ city_id: null })).body.error).toBe("validation.appointmentCity");
    const fixed = await request(app).patch(`/api/admin/appointments/${a.id}`).set("Cookie", admin).send({ city_id: cityId }).expect(200);
    expect(fixed.body.appointment.city_id).toBe(cityId);
    // Changing a consultation into a Presentation inherits the client's city.
    const r = await book({ kind: "consultation", title: `${prefix}later`, client_id: clientId, city_id: null }).expect(201);
    expect(r.body.appointment.city_id).toBeNull();
    const p = await request(app).patch(`/api/admin/appointments/${r.body.appointment.id}`).set("Cookie", admin).send({ kind: "presentation" }).expect(200);
    expect(p.body.appointment.city_id).toBe(cityId);
    // An archived city is never inherited (and a typed bad id is refused).
    await db.execute(`UPDATE service_cities SET archived_at = NOW() WHERE id = ?`, [cityId]);
    const arch = await book({ kind: "consultation", title: `${prefix}arch`, client_id: clientId }).expect(201);
    expect(arch.body.appointment.city_id).toBeNull();
    expect((await book({ kind: "consultation", title: `${prefix}bad`, city_id: 999999999 })).body.error).toBe("validation.invalidField");
    await db.execute(`UPDATE service_cities SET archived_at = NULL WHERE id = ?`, [cityId]);
  });
});
