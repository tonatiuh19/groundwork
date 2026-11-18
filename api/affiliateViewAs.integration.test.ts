import "dotenv/config";
import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

/** View as affiliate: super admin only, opens a read-only affiliate session (every write refused). */
describe.skipIf(!hasDb)("view as affiliate (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwaffview-${stamp}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const ins = async (sql: string, p: unknown[]) => Number(((await db.execute(sql, p as any[])) as any)[0].insertId);
  const staff = async (n: string, role: string) => {
    const id = await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, ?, 'View', ?, 'active')`, [em(n), n, role]);
    const t = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [id, crypto.createHash("sha256").update(t).digest("hex")]);
    return `gw_admin_sid=${t}`;
  };
  let superCookie = "";
  let adminCookie = "";
  let affiliateId = 0;

  beforeAll(async () => {
    process.env.VITEST = "true";
    superCookie = await staff("super", "super_admin");
    adminCookie = await staff("admin", "admin");
    affiliateId = await ins(`INSERT INTO affiliates (email, first_name, last_name, referral_code, status) VALUES (?, 'Brenda', 'View', ?, 'active')`, [em("aff"), `GWV${String(stamp).slice(-9)}`]);
  });

  afterAll(async () => {
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("only a super admin can open it", async () => {
    expect((await request(app).post(`/api/admin/affiliates/${affiliateId}/view-as`).set("Cookie", adminCookie)).status).toBe(403);
  });

  it("opens their portal read-only: reads work, the banner knows who's viewing, writes are refused", async () => {
    const r = await request(app).post(`/api/admin/affiliates/${affiliateId}/view-as`).set("Cookie", superCookie).expect(200);
    expect(r.body.url).toBe("/affiliate");
    const cookie = String((r.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("gw_affiliate_sid="))).split(";")[0];
    const me = await request(app).get("/api/affiliate/auth/me").set("Cookie", cookie).expect(200);
    expect(me.body.user).toMatchObject({ id: affiliateId, view_as_admin: { name: "super View" } });
    const w = await request(app).post("/api/affiliate/clients").set("Cookie", cookie).send({ first_name: "X", last_name: "Y", phone: "+15550000000" });
    expect(w.status).toBe(403);
    expect(w.body.error).toBe("errors.viewOnly");
    // Onboarding routes (agreement, W-9, card) use their own gate: read-only there too.
    const sign = await request(app).post("/api/affiliate/onboarding/billing/setup").set("Cookie", cookie).send({});
    expect(sign.body.error).toBe("errors.viewOnly");
  });
});
