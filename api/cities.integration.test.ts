import "dotenv/config";
import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createServer, suggestCity } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

describe("suggestCity", () => {
  const list = [{ id: 1, name: "Fontana" }, { id: 2, name: "San Bernardino" }];
  it("finds names and one-letter typos, and guesses nothing otherwise", () => {
    expect(suggestCity("1419 Quail Ct San Bernardino", list)).toBe(2);
    expect(suggestCity("8421 sierra ave, FONTANA ca", list)).toBe(1);
    expect(suggestCity("Fontona", list)).toBe(1);
    expect(suggestCity("7383 Poplar Drive", list)).toBeNull();
    expect(suggestCity("", list)).toBeNull();
  });
});

describe.runIf(hasDb)("cities (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const prefix = `gwcity-${Date.now()}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  let cookie = "";
  let finance = "";
  let cityId = 0;
  const ins = async (sql: string, p: unknown[]) => Number(((await db.execute(sql, p as any[])) as any)[0].insertId);
  const session = async (id: number) => {
    const t = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [id, crypto.createHash("sha256").update(t).digest("hex")]);
    return `gw_admin_sid=${t}`;
  };

  beforeAll(async () => {
    process.env.VITEST = "true";
    cookie = await session(await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'C', 'S', 'super_admin', 'active')`, [em("super")]));
    finance = await session(await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'C', 'F', 'agent', 'active')`, [em("fin")]));
  });
  afterAll(async () => {
    await cleanupPortalFixturesByPrefix(db, prefix);
    await db.end();
  });

  it("admins manage the list; duplicates and blanks are refused; only shown cities are public", async () => {
    const name = `${prefix}Fontana`;
    const r = await request(app).post("/api/admin/cities").set("Cookie", cookie).send({ name }).expect(201);
    cityId = r.body.cities.find((c: { name: string }) => c.name === name).id;
    expect((await request(app).post("/api/admin/cities").set("Cookie", cookie).send({ name })).status).toBe(409);
    expect((await request(app).post("/api/admin/cities").set("Cookie", cookie).send({ name: " " })).status).toBe(400);
    expect((await request(app).post("/api/admin/cities").set("Cookie", finance).send({ name: `${prefix}x` })).status).toBe(403);
    const pub = await request(app).get("/api/public/cities").expect(200);
    expect(pub.body.cities.map((c: { id: number }) => c.id)).toContain(cityId);
  });

  it("a lead's picked city saves and filters; bad ids are ignored and never block", async () => {
    const send = (n: string, phone: string, city_ids: unknown) =>
      request(app).post("/api/public/get-credit-report-lead").send({ first_name: "Cy", last_name: n, email: em(n), phone, preferred_language: "en", soft_pull_consent: true, city_ids });
    expect((await send("a", "+15555550151", [cityId])).status).toBeLessThan(300);
    expect((await send("b", "+15555550152", [2147480000, "x"])).status).toBeLessThan(300);
    const [[a]] = (await db.query(`SELECT id, city_id FROM leads WHERE email = ?`, [em("a")])) as any;
    const [[b]] = (await db.query(`SELECT city_id FROM leads WHERE email = ?`, [em("b")])) as any;
    expect(a.city_id).toBe(cityId);
    expect(b.city_id).toBeNull();
    const list = await request(app).get("/api/admin/leads").query({ city_id: cityId }).set("Cookie", cookie).expect(200);
    expect(list.body.leads.map((l: { id: number }) => l.id)).toEqual([a.id]);
  });

  it("clients and projects inherit the lead's city in the filter and report", async () => {
    const [[lead]] = (await db.query(`SELECT id FROM leads WHERE email = ?`, [em("a")])) as any;
    const clientId = await ins(`INSERT INTO clients (first_name, last_name, email, status, lead_id) VALUES ('Cy', 'Client', ?, 'active', ?)`, [em("client"), lead.id]);
    const list = await request(app).get("/api/admin/clients").query({ city_id: cityId }).set("Cookie", cookie).expect(200);
    expect((list.body.clients || list.body.items).map((c: { id: number }) => c.id)).toContain(clientId);
    const cities = await request(app).get("/api/admin/cities").set("Cookie", cookie).expect(200);
    expect(cities.body.cities.find((c: { id: number }) => c.id === cityId)).toMatchObject({ lead_count: 1, client_count: 1 });
  });

  it("sign-up choices are only requests; staff assign coverage and it filters people", async () => {
    const aff = await ins(`INSERT INTO affiliates (email, first_name, last_name, status, referral_code) VALUES (?, 'Re', 'Medio', 'active', ?)`, [em("aff"), `Y${Date.now() % 1e9}`]);
    await db.execute(`INSERT INTO affiliate_cities (affiliate_id, city_id, assigned) VALUES (?, ?, 0)`, [aff, cityId]);
    const before = await request(app).get(`/api/admin/cities/people/affiliate/${aff}`).set("Cookie", cookie).expect(200);
    expect(before.body).toMatchObject({ assigned: [], requested: [cityId] });
    expect((await request(app).put(`/api/admin/cities/people/affiliate/${aff}`).set("Cookie", finance).send({ assigned: [cityId] })).status).toBe(403);
    const after = await request(app).put(`/api/admin/cities/people/affiliate/${aff}`).set("Cookie", cookie).send({ assigned: [cityId, 2147480000] }).expect(200);
    expect(after.body).toMatchObject({ assigned: [cityId], requested: [] });
    const list = await request(app).get("/api/admin/affiliates").query({ city_id: cityId }).set("Cookie", cookie).expect(200);
    expect((list.body.affiliates || list.body.items).map((a: { id: number }) => a.id)).toEqual([aff]);
  });

  it("older records change only when staff confirm", async () => {
    const lead = await ins(`INSERT INTO leads (first_name, last_name, full_name, email, phone, property_address, status) VALUES ('Old', 'Lead', 'Old Lead', ?, '+15555550153', ?, 'new')`, [`${prefix}old@gmail.invalid`, `12 Elm ${prefix}Fontana`]);
    const s = await request(app).get("/api/admin/cities/suggestions").set("Cookie", cookie).expect(200);
    expect(s.body.records.find((r: { kind: string; id: number }) => r.kind === "lead" && r.id === lead)).toBeTruthy();
    let [[row]] = (await db.query(`SELECT city_id FROM leads WHERE id = ?`, [lead])) as any;
    expect(row.city_id).toBeNull();
    await request(app).post("/api/admin/cities/assign").set("Cookie", cookie).send({ kind: "lead", id: lead, city_id: cityId }).expect(200);
    [[row]] = (await db.query(`SELECT city_id FROM leads WHERE id = ?`, [lead])) as any;
    expect(row.city_id).toBe(cityId);
    await db.execute(`DELETE FROM leads WHERE id = ?`, [lead]);
    expect((await request(app).post("/api/admin/cities/assign").set("Cookie", cookie).send({ kind: "nope", id: 1, city_id: cityId })).status).toBe(400);
  });

  it("archive hides a city from pickers; merge moves everything; delete only when unused", async () => {
    const dup = (await request(app).post("/api/admin/cities").set("Cookie", cookie).send({ name: `${prefix}Fontona` }).expect(201)).body.id;
    const sim = await request(app).get("/api/admin/cities/similar").query({ name: `${prefix}Fontana` }).set("Cookie", cookie).expect(200);
    expect(sim.body.matches.map((m: { id: number }) => m.id)).toEqual(expect.arrayContaining([cityId, dup]));
    const lead = await ins(`INSERT INTO leads (first_name, last_name, full_name, email, phone, status, city_id) VALUES ('Du', 'P', 'Du P', ?, '+15555550154', 'new', ?)`, [em("dup"), dup]);
    expect((await request(app).delete(`/api/admin/cities/${dup}`).set("Cookie", cookie)).body.error).toBe("errors.cityInUse");
    expect((await request(app).get(`/api/admin/cities/${dup}/usage`).set("Cookie", cookie).expect(200)).body.usage).toMatchObject({ leads: 1, total: 1 });
    await request(app).post(`/api/admin/cities/${dup}/archive`).set("Cookie", cookie).send({}).expect(200);
    expect((await request(app).get("/api/public/cities").expect(200)).body.cities.map((c: { id: number }) => c.id)).not.toContain(dup);
    const grid = await request(app).get("/api/admin/cities").query({ paged: 1, status: "archived", q: prefix }).set("Cookie", cookie).expect(200);
    expect(grid.body.cities.map((c: { id: number }) => c.id)).toContain(dup);
    await request(app).post(`/api/admin/cities/${dup}/merge`).set("Cookie", cookie).send({ into_id: cityId }).expect(200);
    const [[row]] = (await db.query(`SELECT city_id FROM leads WHERE id = ?`, [lead])) as any;
    expect(row.city_id).toBe(cityId);
    expect((await request(app).get(`/api/admin/cities/${dup}/usage`).set("Cookie", cookie)).status).toBe(404);
    const archivedTarget = (await request(app).post("/api/admin/cities").set("Cookie", cookie).send({ name: `${prefix}Old` }).expect(201)).body.id;
    await request(app).post(`/api/admin/cities/${archivedTarget}/archive`).set("Cookie", cookie).send({}).expect(200);
    expect((await request(app).post(`/api/admin/cities/${cityId}/merge`).set("Cookie", cookie).send({ into_id: archivedTarget })).body.error).toBe("errors.cityArchivedTarget");
    await db.execute(`INSERT INTO city_contacts (city_id, kind, name) VALUES (?, 'planning', 'Pat')`, [archivedTarget]);
    expect((await request(app).get(`/api/admin/cities/${archivedTarget}/usage`).set("Cookie", cookie)).body.usage.total).toBe(1);
    expect((await request(app).delete(`/api/admin/cities/${archivedTarget}`).set("Cookie", cookie)).status).toBe(409);
    const unused = (await request(app).post("/api/admin/cities").set("Cookie", cookie).send({ name: `${prefix}Unused` }).expect(201)).body.id;
    await request(app).delete(`/api/admin/cities/${unused}`).set("Cookie", cookie).expect(200);
    expect((await request(app).post(`/api/admin/cities/${cityId}/archive`).set("Cookie", finance).send({})).status).toBe(403);
  });
});
