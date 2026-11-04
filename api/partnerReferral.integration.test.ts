import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { __testClearEmailDryRuns, __testGetEmailDryRuns, createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

describe.runIf(hasDb)("affiliate link: homeowner or realtor / partner; move a client to affiliate", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwpartner-${stamp}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const digits = String(stamp).slice(-7);
  const one = async (sql: string, p: unknown[]) => ((await db.query(sql, p as any[])) as any)[0][0];
  let sponsorId = 0;
  const sponsorCode = `GWP${digits}`;
  let adminCookie = "";
  let agentCookie = "";

  beforeAll(async () => {
    process.env.VITEST = "true";
    const [r] = (await db.execute(
      `INSERT INTO affiliates (email, first_name, last_name, phone, status, referral_code, approved_at, preferred_language) VALUES (?, 'Arely', 'Sponsor', ?, 'active', ?, NOW(), 'es')`,
      [em("arely"), `+1555${digits}`, sponsorCode],
    )) as any;
    sponsorId = Number(r.insertId);
    for (const [role, set] of [["admin", (c: string) => (adminCookie = c)], ["agent", (c: string) => (agentCookie = c)]] as const) {
      const [a] = (await db.execute(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, ?, 'Partner', ?, 'active')`, [em(role), role, role])) as any;
      const t = crypto.randomBytes(32).toString("hex");
      await db.execute(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [a.insertId, crypto.createHash("sha256").update(t).digest("hex")]);
      set(`gw_admin_sid=${t}`);
    }
  });

  afterAll(async () => {
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("realtor on the link: pending affiliate on the inviter's team; the inviter is told", async () => {
    __testClearEmailDryRuns();
    const r = await request(app)
      .post("/api/public/affiliate/signup")
      .send({ first_name: "Luis", last_name: "Realtor", email: em("luis"), phone: `+1555${String(stamp + 7).slice(-7)}`, company: "Luis Realty", preferred_language: "en", sponsor_code: sponsorCode })
      .expect(201);
    expect(r.body.sponsored).toBe(true);
    const luis = await one(`SELECT status, parent_affiliate_id FROM affiliates WHERE email = ?`, [em("luis")]);
    expect(luis).toMatchObject({ status: "pending", parent_affiliate_id: sponsorId });
    const toSponsor = __testGetEmailDryRuns().find((m: any) => m.to === em("arely")) as any;
    expect(String(toSponsor?.subject)).toMatch(/Luis se unió a tu equipo/);
    expect(String(toSponsor?.html)).not.toMatch(/ — /);
    const team = await one(`SELECT COUNT(*) n FROM affiliates WHERE parent_affiliate_id = ?`, [sponsorId]);
    expect(Number(team.n)).toBe(1);
  });

  it("a dead sponsor code is refused (no orphan sign-ups)", async () => {
    const r = await request(app)
      .post("/api/public/affiliate/signup")
      .send({ first_name: "No", last_name: "Code", email: em("nocode"), phone: `+1555${String(stamp + 8).slice(-7)}`, sponsor_code: `${prefix}missing` });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("errors.referralInactive");
  });

  it("homeowner signup that should have been a partner: staff move it to affiliate under the same inviter", async () => {
    await request(app)
      .post("/api/public/enroll")
      .send({
        first_name: "Andre",
        last_name: "Mixup",
        email: em("andre"),
        phone: `+1555${String(stamp + 9).slice(-7)}`,
        property_address: "1 Test Way",
        property_city: "Fontana",
        homeowner_consent: true,
        preferred_language: "en",
        referral_code: sponsorCode,
      })
      .expect((res) => expect([200, 201]).toContain(res.status));
    const client = await one(`SELECT id, affiliate_id FROM clients WHERE email = ?`, [em("andre")]);
    expect(client.affiliate_id).toBe(sponsorId);

    await request(app).post(`/api/admin/clients/${client.id}/move-to-affiliate`).set("Cookie", agentCookie).send({ dry_run: true }).expect(403);
    const pv = await request(app).post(`/api/admin/clients/${client.id}/move-to-affiliate`).set("Cookie", adminCookie).send({ dry_run: true }).expect(200);
    expect(pv.body.inviter).toMatchObject({ id: sponsorId, name: "Arely Sponsor" });
    expect(pv.body.plan.blockers).toEqual([]);
    await request(app).post(`/api/admin/clients/${client.id}/move-to-affiliate`).set("Cookie", adminCookie).send({}).expect(400);

    const done = await request(app).post(`/api/admin/clients/${client.id}/move-to-affiliate`).set("Cookie", adminCookie).send({ confirm: true }).expect(201);
    expect(done.body.affiliate_id).toBeGreaterThan(0);
    const aff = await one(`SELECT status, parent_affiliate_id, email FROM affiliates WHERE id = ?`, [done.body.affiliate_id]);
    expect(aff).toMatchObject({ status: "pending", parent_affiliate_id: sponsorId, email: em("andre") });
    expect(await one(`SELECT COUNT(*) n FROM clients WHERE id = ?`, [client.id])).toMatchObject({ n: 0 });
  });
});
