import "dotenv/config";
import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createServer, flowBookingUrl } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

/**
 * Daniel's asks (Nov 17): Affiliate → Clients tile filters Clients by affiliate; the project page gets
 * the people's phones / emails (Text · Call · Email); {{booking_link}} opens the assigned staff
 * member's booking page when theirs is on.
 */
describe.skipIf(!hasDb)("affiliate clients, project people, booking link (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwaffbook-${stamp}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const phone = (n: number) => `+1555${String(stamp + n).slice(-7)}`;
  const ins = async (sql: string, p: unknown[]) => Number(((await db.execute(sql, p as any[])) as any)[0].insertId);
  let cookie = "";
  let adminId = 0;
  let affiliateId = 0;
  let mineId = 0;
  let publicId = "";

  beforeAll(async () => {
    process.env.VITEST = "true";
    adminId = await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Book', 'Rep', 'admin', 'active')`, [em("rep")]);
    const t = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [adminId, crypto.createHash("sha256").update(t).digest("hex")]);
    cookie = `gw_admin_sid=${t}`;
    affiliateId = await ins(`INSERT INTO affiliates (email, first_name, last_name, referral_code, status, phone) VALUES (?, 'Aff', 'Book', ?, 'active', ?)`, [em("aff"), `GWT${String(stamp).slice(-9)}`, phone(1)]);
    mineId = await ins(`INSERT INTO clients (first_name, last_name, phone, status, affiliate_id, assigned_admin_id) VALUES (?, 'Mine', ?, 'prospect', ?, ?)`, [`${prefix}Ana`, phone(2), affiliateId, adminId]);
    await ins(`INSERT INTO clients (first_name, last_name, email, status) VALUES ('Other', 'Client', ?, 'prospect')`, [em("other")]);
    publicId = `GWT${String(stamp).slice(-8)}`;
    await ins(`INSERT INTO projects (public_id, client_id, affiliate_id) VALUES (?, ?, ?)`, [publicId, mineId, affiliateId]);
  });

  afterAll(async () => {
    try {
      await db.execute(`DELETE FROM projects WHERE public_id = ?`, [publicId]);
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("Clients filtered by affiliate lists only that affiliate's clients", async () => {
    const r = await request(app).get("/api/admin/clients").query({ affiliate_id: affiliateId }).set("Cookie", cookie).expect(200);
    expect(r.body.clients.map((c: any) => c.id)).toEqual([mineId]);
  });

  it("project detail carries the homeowner's and affiliate's phone for Text / Call", async () => {
    const r = await request(app).get(`/api/admin/projects/${publicId}`).set("Cookie", cookie).expect(200);
    expect(r.body.project).toMatchObject({ client_phone: phone(2), affiliate_phone: phone(1), affiliate_email: em("aff") });
  });

  it("{{booking_link}} uses the assigned staff member's page only while it's on", async () => {
    const slug = `${prefix}rep`.toLowerCase();
    await db.execute(`INSERT INTO scheduler_settings (admin_id, is_enabled, slug) VALUES (?, 0, ?)`, [adminId, slug]);
    expect(await flowBookingUrl(adminId)).not.toContain(slug);
    await db.execute(`UPDATE scheduler_settings SET is_enabled = 1 WHERE admin_id = ?`, [adminId]);
    expect(await flowBookingUrl(adminId)).toMatch(new RegExp(`/book/${slug}$`));
  });
});
