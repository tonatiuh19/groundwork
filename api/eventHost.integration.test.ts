import "dotenv/config";
import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { __testClearEmailDryRuns, __testGetEmailDryRuns, createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
const DAY = 24 * 3600_000;

/**
 * Events hosted by an affiliate: wiring only (the credit rule itself is unit tested in eventHost.test.ts).
 * RSVP without a link → host's referral + host email; another affiliate's link wins; My events shows only
 * the affiliate's own RSVPs; staff can only pick an active affiliate as host.
 */
describe.skipIf(!hasDb)("event host affiliate (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const prefix = `gwevhost-${Date.now()}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const ins = async (sql: string, p: unknown[]) => Number(((await db.execute(sql, p as any[])) as any)[0].insertId);
  const session = async (table: string, col: string, id: number) => {
    const t = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO ${table} (${col}, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [id, crypto.createHash("sha256").update(t).digest("hex")]);
    return t;
  };
  const affiliate = (n: string, status = "active") =>
    ins(`INSERT INTO affiliates (email, first_name, last_name, status, referral_code, preferred_language) VALUES (?, ?, 'Host', ?, ?, 'es')`, [
      em(n),
      n,
      status,
      `EH${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
    ]);
  let hostId = 0;
  let otherId = 0;
  let otherCode = "";
  let eventId = 0;
  let hostCookie = "";
  let adminCookie = "";

  beforeAll(async () => {
    process.env.VITEST = "true";
    hostId = await affiliate("brenda");
    otherId = await affiliate("other");
    otherCode = String(((await db.query(`SELECT referral_code FROM affiliates WHERE id = ?`, [otherId])) as any)[0][0].referral_code);
    eventId = await ins(
      `INSERT INTO marketing_events (slug, status, starts_at, registration_opens_at, city, title_en, title_es, host_affiliate_id)
       VALUES (?, 'published', ?, ?, 'Fontana', 'Brenda night', 'Noche de Brenda', ?)`,
      [`${prefix}brenda`, new Date(Date.now() + 2 * DAY), new Date(Date.now() - DAY), hostId],
    );
    hostCookie = `gw_affiliate_sid=${await session("affiliate_sessions", "affiliate_id", hostId)}`;
    const adminId = await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Ev', 'Admin', 'super_admin', 'active')`, [em("admin")]);
    adminCookie = `gw_admin_sid=${await session("admin_sessions", "admin_id", adminId)}`;
  });

  afterAll(async () => {
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  const rsvp = (name: string, extra: Record<string, unknown> = {}) =>
    request(app)
      .post("/api/public/leads")
      .send({ full_name: `Guest ${name}`, email: em(name), phone: "5550109876", property_address: "1 Test Way, Fontana, CA", mode: "event", event_id: eventId, ...extra });

  it("RSVP with no link is the host's referral and emails the host; another affiliate's link keeps its credit", async () => {
    __testClearEmailDryRuns();
    await rsvp("walkin").expect(201);
    await rsvp("linked", { referral_code: otherCode }).expect(201);
    const [rows] = (await db.query(`SELECT email, affiliate_id FROM leads WHERE event_id = ? ORDER BY id`, [eventId])) as any;
    expect(rows.map((r: any) => [r.email, Number(r.affiliate_id)])).toEqual([
      [em("walkin"), hostId],
      [em("linked"), otherId],
    ]);
    const hostMails = __testGetEmailDryRuns().filter((m: any) => [].concat(m.to).includes(em("brenda") as never));
    expect(hostMails).toHaveLength(1);
    expect(hostMails[0].subject).toContain("Guest walkin");
    expect(hostMails[0].subject).toContain("Noche de Brenda");
  });

  it("My events shows the host only their own RSVPs, with contact details", async () => {
    const r = await request(app).get("/api/affiliate/events").set("Cookie", hostCookie).expect(200);
    const ev = r.body.events.find((e: any) => e.id === eventId);
    expect(ev).toMatchObject({ is_host: true });
    expect(ev.rsvps.map((x: any) => x.email)).toEqual([em("walkin")]);
    expect(ev.rsvps[0]).toMatchObject({ registration_status: "confirmed", became_client: false });
    await request(app).get("/api/affiliate/events").expect(401);
  });

  it("staff pick an active affiliate as host; an inactive one is refused", async () => {
    const inactive = await affiliate("paused", "inactive");
    const bad = await request(app).patch(`/api/admin/events/${eventId}`).set("Cookie", adminCookie).send({ host_affiliate_id: inactive }).expect(400);
    expect(bad.body.error).toBe("validation.invalidField");
    const ok = await request(app).patch(`/api/admin/events/${eventId}`).set("Cookie", adminCookie).send({ host_affiliate_id: otherId }).expect(200);
    expect(ok.body.event).toMatchObject({ host_affiliate_id: otherId, host_affiliate_name: "other Host" });
  });
});
