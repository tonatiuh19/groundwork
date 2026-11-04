import "dotenv/config";
import crypto from "crypto";
import type { ResultSetHeader } from "mysql2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

/** Admin → Billing: bulk "add your card" links for approved members with no membership running. */
describe.runIf(hasDb)("bulk card links (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const prefix = `gwbulkcard-${Date.now()}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const ids: Record<string, number> = {};
  let financeCookie = "";
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
  const code = () => `B${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
  const aff = (n: string, status: string, billing: string, override: number | null) =>
    insertId(
      `INSERT INTO affiliates (email, first_name, last_name, status, referral_code, billing_status, billing_price_override_cents, phone) VALUES (?, 'Bulk', ?, ?, ?, ?, ?, '+15555550142')`,
      [em(n), n, status, code(), billing, override],
    );

  beforeAll(async () => {
    process.env.VITEST = "true";
    financeCookie = await session(await insertId(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Bulk', 'Finance', 'finance', 'active')`, [em("fin")]));
    agentCookie = await session(await insertId(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Bulk', 'Agent', 'agent', 'active')`, [em("agent")]));
    ids.noCard = await aff("nocard", "active", "none", 2900);
    ids.pastDue = await aff("pastdue", "active", "past_due", 2900);
    ids.trialing = await aff("trialing", "active", "trialing", 2900);
    ids.waived = await aff("waived", "active", "none", 0);
    ids.noPrice = await aff("noprice", "active", "none", null);
    ids.pending = await aff("pending", "pending", "none", 2900);
    ids.ctr = await insertId(
      `INSERT INTO contractors (email, first_name, last_name, company, status, subscription_price_cents) VALUES (?, 'Bulk', 'Ctr', ?, 'active', 9990)`,
      [em("ctr"), `${prefix}Co`],
    );
  });

  afterAll(async () => {
    try {
      await db.query(`DELETE FROM billing_card_links WHERE (member_role = 'affiliate' AND member_id IN (?)) OR (member_role = 'contractor' AND member_id = ?)`, [Object.values(ids), ids.ctr]);
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  const eligible = () => request(app).get(`/api/admin/billing/card-links/eligible?email_prefix=${encodeURIComponent(prefix)}`).set("Cookie", financeCookie);

  it("counts only approved members with no membership running and a price above $0", async () => {
    const r = await eligible().expect(200);
    // no card + past due affiliates, and the active contractor. Not: trialing, waived, no price, pending.
    expect(r.body).toMatchObject({ count: 3, affiliates: 2, contractors: 1 });
  });

  it("needs confirm and finance access; real members are never touched under tests", async () => {
    await request(app).post("/api/admin/billing/card-links/send-all").set("Cookie", financeCookie).send({ email_prefix: prefix }).expect(400);
    await request(app).get("/api/admin/billing/card-links/eligible").set("Cookie", agentCookie).expect(403);
    await request(app).post("/api/admin/billing/card-links/send-all").set("Cookie", agentCookie).send({ confirm: true, email_prefix: prefix }).expect(403);
    // Without a fixture prefix Vitest sees nobody (never real members).
    const none = await request(app).get("/api/admin/billing/card-links/eligible").set("Cookie", financeCookie).expect(200);
    expect(none.body.count).toBe(0);
  });

  it("sends one secure link each, logs it, and skips anyone sent a link in the last 3 days", async () => {
    const r = await request(app).post("/api/admin/billing/card-links/send-all").set("Cookie", financeCookie).send({ confirm: true, email_prefix: prefix }).expect(200);
    expect(r.body).toMatchObject({ sent: 3, failed: 0 });
    const [links] = (await db.query(
      `SELECT member_role, member_id FROM billing_card_links WHERE (member_role = 'affiliate' AND member_id IN (?)) OR (member_role = 'contractor' AND member_id = ?)`,
      [Object.values(ids), ids.ctr],
    )) as any;
    expect(links.map((l: any) => `${l.member_role}:${l.member_id}`).sort()).toEqual(
      [`affiliate:${ids.noCard}`, `affiliate:${ids.pastDue}`, `contractor:${ids.ctr}`].sort(),
    );
    const [[logged]] = (await db.query(
      `SELECT COUNT(*) n FROM billing_admin_actions WHERE action = 'card_link' AND ((member_role = 'affiliate' AND member_id IN (?)) OR (member_role = 'contractor' AND member_id = ?))`,
      [Object.values(ids), ids.ctr],
    )) as any;
    expect(Number(logged.n)).toBe(3);
    expect((await eligible().expect(200)).body.count).toBe(0);
    const again = await request(app).post("/api/admin/billing/card-links/send-all").set("Cookie", financeCookie).send({ confirm: true, email_prefix: prefix }).expect(200);
    expect(again.body.sent).toBe(0);
  });
});
