import "dotenv/config";
import crypto from "crypto";
import type { ResultSetHeader } from "mysql2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { __testClearEmailDryRuns, __testGetEmailDryRuns, __testSetBillingApi, createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

/**
 * Staff edit panels: name / email / language for affiliates and clients.
 * Email is the sign-in identity → notices to old + new address, billing
 * customer updated, audit row; duplicates are refused.
 */
describe.runIf(hasDb)("edit panels: identity changes (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const prefix = `gwedit-${Date.now()}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const billingUpdates: Array<{ id: string; p: any }> = [];
  let cookie = "";
  let affId = 0;
  let otherAffId = 0;
  let clientId = 0;

  const insertId = async (sql: string, params: unknown[]) =>
    Number(((await db.execute(sql, params as any[])) as unknown as [ResultSetHeader])[0].insertId);
  const code = () => `E${crypto.randomBytes(5).toString("hex").toUpperCase()}`;

  beforeAll(async () => {
    process.env.VITEST = "true";
    __testSetBillingApi({ customers: { update: async (id: string, p: any) => (billingUpdates.push({ id, p }), { id }) } });
    const adminId = await insertId(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Edit', 'Admin', 'admin', 'active')`, [em("admin")]);
    const token = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, ?)`, [adminId, crypto.createHash("sha256").update(token).digest("hex"), new Date(Date.now() + 86_400_000)]);
    cookie = `gw_admin_sid=${token}`;
    affId = await insertId(
      `INSERT INTO affiliates (email, first_name, last_name, status, referral_code, billing_customer_id) VALUES (?, 'Edward', 'Arely', 'active', ?, 'cus_gwedit')`,
      [em("edward"), code()],
    );
    otherAffId = await insertId(`INSERT INTO affiliates (email, first_name, last_name, status, referral_code) VALUES (?, 'Other', 'Aff', 'active', ?)`, [em("other"), code()]);
    clientId = await insertId(`INSERT INTO clients (first_name, last_name, email, status) VALUES ('Kayla', 'Gibson', ?, 'prospect')`, [em("kayla")]);
  });

  afterAll(async () => {
    __testSetBillingApi(null);
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("affiliate: rename + new email → notices to both, billing updated, audited", async () => {
    __testClearEmailDryRuns();
    await request(app)
      .patch(`/api/admin/affiliates/${affId}`)
      .set("Cookie", cookie)
      .send({ first_name: "Eduardo", last_name: "Arely Ruiz", email: em("Edward.New").toUpperCase(), preferred_language: "es" })
      .expect(200);
    const [[a]] = (await db.query(`SELECT first_name, last_name, email, preferred_language FROM affiliates WHERE id = ?`, [affId])) as any;
    expect(a).toMatchObject({ first_name: "Eduardo", last_name: "Arely Ruiz", email: em("edward.new"), preferred_language: "es" });
    const to = __testGetEmailDryRuns().map((m: any) => String(m.to));
    expect(to).toContain(em("edward"));
    expect(to).toContain(em("edward.new"));
    expect(billingUpdates).toEqual([{ id: "cus_gwedit", p: { email: em("edward.new") } }]);
    const [[log]] = (await db.query(`SELECT action, entity, reason FROM people_dedupe_log WHERE action = 'email_change' AND record_id = ? ORDER BY id DESC LIMIT 1`, [affId])) as any;
    expect(log).toMatchObject({ action: "email_change", entity: "affiliate" });
    expect(log.reason).toBe(`${em("edward")} → ${em("edward.new")}`);
  });

  it("refuses an email another person already uses; name-only saves send no notices", async () => {
    const dup = await request(app).patch(`/api/admin/affiliates/${affId}`).set("Cookie", cookie).send({ email: em("other") });
    expect(dup.status).toBe(409);
    await request(app).patch(`/api/admin/affiliates/${affId}`).set("Cookie", cookie).send({ email: "not-an-email" }).expect(400);
    __testClearEmailDryRuns();
    await request(app).patch(`/api/admin/affiliates/${affId}`).set("Cookie", cookie).send({ first_name: "Edward" }).expect(200);
    expect(__testGetEmailDryRuns()).toHaveLength(0);
    expect(otherAffId).toBeGreaterThan(0);
  });

  it("client: email change notifies both addresses and is audited", async () => {
    __testClearEmailDryRuns();
    await request(app).patch(`/api/admin/clients/${clientId}`).set("Cookie", cookie).send({ email: em("kayla.g") }).expect(200);
    const to = __testGetEmailDryRuns().map((m: any) => String(m.to));
    expect(to).toEqual(expect.arrayContaining([em("kayla"), em("kayla.g")]));
    const [[log]] = (await db.query(`SELECT entity FROM people_dedupe_log WHERE action = 'email_change' AND record_id = ? AND entity = 'client'`, [clientId])) as any;
    expect(log.entity).toBe("client");
  });
});
