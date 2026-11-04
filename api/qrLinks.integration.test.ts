import "dotenv/config";
import crypto from "crypto";
import type { ResultSetHeader } from "mysql2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

/** Admin -> QR codes: permanent /go/{slug} codes whose destination staff change per event. */
describe.runIf(hasDb)("dynamic QR codes (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const prefix = `gwqr-${Date.now()}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  let adminCookie = "";
  let agentCookie = "";

  const insertId = async (sql: string, params: unknown[]) =>
    Number(((await db.execute(sql, params as any[])) as unknown as [ResultSetHeader])[0].insertId);
  const session = async (id: number) => {
    const token = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, ?)`, [
      id, crypto.createHash("sha256").update(token).digest("hex"), new Date(Date.now() + 86_400_000),
    ]);
    return `gw_admin_sid=${token}`;
  };

  beforeAll(async () => {
    process.env.VITEST = "true";
    adminCookie = await session(await insertId(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Qr', 'Admin', 'admin', 'active')`, [em("admin")]));
    agentCookie = await session(await insertId(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Qr', 'Finance', 'finance', 'active')`, [em("fin")]));
  });

  afterAll(async () => {
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  const page = (key: string) => ({ type: "page", key });
  const post = (body: object) => request(app).post("/api/admin/qr-links").set("Cookie", adminCookie).send(body);
  const patch = (id: number, body: object) => request(app).patch(`/api/admin/qr-links/${id}`).set("Cookie", adminCookie).send(body);

  it("creates a code, forwards scans, counts them per destination, and logs changes", async () => {
    const c = await post({ slug: `${prefix}Canopy`, label: "Canopy", destination: page("partners") }).expect(201);
    const item = c.body.item;
    expect(item.slug).toBe(`${prefix}canopy`);
    expect(item.destination).toMatchObject({ type: "page", key: "partners", url: "/partners", ok: true });

    const scan = await request(app).get(`/go/${item.slug}`).set("User-Agent", IPHONE).expect(302);
    expect(scan.headers.location).toBe("/partners");
    expect(scan.headers["cache-control"]).toContain("no-store");
    expect(String(scan.headers["set-cookie"])).toContain(`gw_qr=${item.id}`);

    const ext = await request(app).post("/api/admin/qr-external-links").set("Cookie", adminCookie).send({ label: `${prefix}Lender`, url: "https://example.com/rsvp?x=1" }).expect(201);
    await patch(item.id, { destination: { type: "external", id: ext.body.item.id } }).expect(200);
    const scan2 = await request(app).get(`/api/public/go/${item.slug}`).set("User-Agent", ANDROID).expect(302);
    expect(scan2.headers.location).toBe("https://example.com/rsvp?x=1");

    // Staff "Test" clicks forward but never count or credit.
    const test = await request(app).get(`/go/${item.slug}?test=1`).set("User-Agent", IPHONE).expect(302);
    expect(test.headers["set-cookie"]).toBeUndefined();

    const list = await request(app).get("/api/admin/qr-links").set("Cookie", adminCookie).expect(200);
    expect(list.body.items.find((x: { id: number }) => x.id === item.id).scan_count).toBe(2);
    expect(Array.isArray(list.body.event_codes)).toBe(true);

    const ins = await request(app).get(`/api/admin/qr-links/${item.id}/insights`).set("Cookie", adminCookie).expect(200);
    expect(ins.body.destinations.map((d: { ref: string }) => d.ref).sort()).toEqual([`external:${ext.body.item.id}`, "page:partners"].sort());
    expect(ins.body.changes.map((x: { action: string }) => x.action)).toEqual(["destination", "created"]);
  });

  it("does not count bots", async () => {
    const c = await post({ slug: `${prefix}bots`, label: "Bots", destination: page("partners") }).expect(201);
    await request(app).get(`/go/${c.body.item.slug}`).set("User-Agent", "WhatsApp/2.23").expect(302);
    await request(app).get(`/go/${c.body.item.slug}`).expect(302);
    const [[row]] = (await db.query(`SELECT scan_count FROM qr_links WHERE id = ?`, [c.body.item.id])) as any;
    expect(row.scan_count).toBe(0);
  });

  it("off and archived codes use their fallback, else home; unknown slugs go home", async () => {
    const c = await post({ slug: `${prefix}banner`, label: "Banner", destination: page("partners"), fallback: page("contact") }).expect(201);
    const id = c.body.item.id;
    await patch(id, { active: false }).expect(200);
    const off = await request(app).get(`/go/${prefix}banner`).set("User-Agent", IPHONE).expect(302);
    expect(off.headers.location).toBe("/contact");
    expect(off.headers["set-cookie"]).toBeUndefined();
    await patch(id, { active: true, archived: true, fallback: null }).expect(200);
    expect((await request(app).get(`/go/${prefix}banner`).expect(302)).headers.location).toBe("/");
    expect((await request(app).get(`/go/${prefix}nope`).expect(302)).headers.location).toBe("/");
    expect((await request(app).get("/go/free-score").expect(302)).headers.location).not.toBe("/");
    const [[row]] = (await db.query(`SELECT scan_count FROM qr_links WHERE id = ?`, [id])) as any;
    expect(row.scan_count).toBe(0);
  });

  it("an affiliate destination that goes inactive falls back; pickers only offer live records", async () => {
    const aff = await insertId(`INSERT INTO affiliates (email, first_name, last_name, status, referral_code) VALUES (?, 'Ana', 'Qr', 'active', ?)`, [em("aff"), `Q${Date.now()}`.slice(0, 12)]);
    const c = await post({ slug: `${prefix}aff`, label: "Aff", destination: { type: "affiliate", id: aff }, fallback: page("contact") }).expect(201);
    expect(c.body.item.destination.url).toMatch(/^\/r\//);
    const found = await request(app).get("/api/admin/qr-destinations").query({ type: "affiliate", q: em("aff") }).set("Cookie", adminCookie).expect(200);
    expect(found.body.options.map((o: { value: string }) => o.value)).toContain(String(aff));
    await db.execute(`UPDATE affiliates SET status = 'inactive' WHERE id = ?`, [aff]);
    expect((await request(app).get(`/go/${prefix}aff`).set("User-Agent", IPHONE).expect(302)).headers.location).toBe("/contact");
    const gone = await request(app).get("/api/admin/qr-destinations").query({ type: "affiliate", q: em("aff") }).set("Cookie", adminCookie).expect(200);
    expect(gone.body.options).toEqual([]);
    expect((await post({ slug: `${prefix}aff2`, label: "x", destination: { type: "affiliate", id: aff } })).status).toBe(400);
  });

  it("credits the scanned code on a public lead, first code wins", async () => {
    const c = await post({ slug: `${prefix}credit`, label: "Credit", destination: page("contact") }).expect(201);
    const id = c.body.item.id;
    const lead = await request(app).post("/api/public/contact").set("Cookie", `gw_qr=${id}`).send({
      full_name: "Qr Lead", email: em("lead"), phone: "+15555550142", intent: "general", message: "hi", sms_transactional_consent: true,
    });
    expect(lead.status).toBeLessThan(300);
    const [[row]] = (await db.query(`SELECT qr_link_id FROM leads WHERE email = ?`, [em("lead")])) as any;
    expect(row.qr_link_id).toBe(id);
    const list = await request(app).get("/api/admin/qr-links").set("Cookie", adminCookie).expect(200);
    expect(list.body.items.find((x: { id: number }) => x.id === id).lead_count).toBe(1);
    const later = await post({ slug: `${prefix}credit2`, label: "Later", destination: page("contact") }).expect(201);
    await request(app).post("/api/public/contact").set("Cookie", `gw_qr=${later.body.item.id}`).send({
      full_name: "Qr Lead", email: em("lead"), phone: "+15555550142", intent: "general", message: "again", sms_transactional_consent: true,
    });
    const [[kept]] = (await db.query(`SELECT qr_link_id FROM leads WHERE email = ?`, [em("lead")])) as any;
    expect(kept.qr_link_id).toBe(id);
    // Garbage cookies are ignored.
    await request(app).post("/api/public/contact").set("Cookie", "gw_qr=abc").send({
      full_name: "Qr Other", email: em("lead2"), phone: "+15555550143", intent: "general", message: "hi", sms_transactional_consent: true,
    });
    const [[other]] = (await db.query(`SELECT qr_link_id FROM leads WHERE email = ?`, [em("lead2")])) as any;
    if (other) expect(other.qr_link_id).toBeNull();
  });

  it("rejects bad input: duplicate or reserved slug, typed or unknown destinations, bad external links", async () => {
    const dup = await post({ slug: `${prefix}canopy`, label: "x", destination: page("home") });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("errors.qrSlugTaken");
    for (const slug of ["free-score", "!", ""]) expect((await post({ slug, label: "x", destination: page("home") })).status).toBe(400);
    for (const destination of [undefined, "/partners", { type: "page", key: "nope" }, { type: "page", key: "constructor" }, { type: "event", id: 2147480000 }, { type: "external", id: 2147480000 }, { type: "url", key: "x" }, { type: "event", id: "x" }]) {
      const r = await post({ slug: `${prefix}bad`, label: "x", destination });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("validation.qrDestination");
    }
    for (const url of ["http://example.com", "javascript:alert(1)", "https://user:pw@example.com", "https://localhost", "not a url"]) {
      const r = await request(app).post("/api/admin/qr-external-links").set("Cookie", adminCookie).send({ label: `${prefix}bad`, url });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("validation.qrExternalUrl");
    }
    expect((await post({ slug: `${prefix}noname`, label: " ", destination: page("home") })).status).toBe(400);
  });

  it("slug never changes; only events staff can manage codes", async () => {
    const list = await request(app).get("/api/admin/qr-links").set("Cookie", adminCookie).expect(200);
    const mine = list.body.items.find((x: { slug: string }) => x.slug === `${prefix}canopy`);
    const r = await request(app).patch(`/api/admin/qr-links/${mine.id}`).set("Cookie", adminCookie).send({ slug: `${prefix}other`, label: "Renamed" }).expect(200);
    expect(r.body.item).toMatchObject({ slug: `${prefix}canopy`, label: "Renamed" });
    await request(app).get("/api/admin/qr-links").set("Cookie", agentCookie).expect(403);
    await request(app).post("/api/admin/qr-links").set("Cookie", agentCookie).send({ slug: `${prefix}x`, label: "x", destination: { type: "page", key: "home" } }).expect(403);
    await request(app).post("/api/admin/qr-external-links").set("Cookie", agentCookie).send({ label: `${prefix}x`, url: "https://example.com" }).expect(403);
    await request(app).get("/api/admin/qr-links").expect(401);
  });
});
