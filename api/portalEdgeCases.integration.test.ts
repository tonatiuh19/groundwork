/**
 * Edge / concurrency / auth-lifecycle regressions found in deep audit.
 * Uses @example.com fixtures only; cleans via cleanupPortalFixturesByPrefix.
 */
import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  __testClearEmailDryRuns,
  createServer,
} from "./index";
import {
  cleanupPortalFixturesByPrefix,
  createIntegrationTestPool,
} from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
const app = createServer();
const db = createIntegrationTestPool();
const prefix = `gwedge-${Date.now()}-`;
const em = (name: string) => `${prefix}${name}@example.com`;

async function insertId(sql: string, params: any[]): Promise<number> {
  const [r] = await db.execute(sql, params);
  return Number((r as { insertId: number }).insertId);
}

async function makeSession(actor: "admin" | "affiliate" | "contractor" | "client", id: number) {
  const token = crypto.randomBytes(32).toString("hex");
  await db.execute(
    `INSERT INTO \`${actor}_sessions\` (\`${actor}_id\`, token_hash, expires_at) VALUES (?, ?, ?)`,
    [
      id,
      crypto.createHash("sha256").update(token).digest("hex"),
      new Date(Date.now() + 86_400_000),
    ],
  );
  return `gw_${actor}_sid=${token}`;
}

describe.runIf(hasDb)("portal edge cases (integration)", () => {
  let adminId = 0;
  let adminCookie = "";
  let affId = 0;
  let ctrId = 0;
  let ctrCookie = "";
  let clientId = 0;
  let planId = 0;
  let racePublicId = "";

  beforeAll(async () => {
    process.env.VITEST = "true";
    __testClearEmailDryRuns();
    adminId = await insertId(
      `INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Edge', 'Admin', 'super_admin', 'active')`,
      [em("admin")],
    );
    adminCookie = await makeSession("admin", adminId);

    affId = await insertId(
      `INSERT INTO affiliates (email, first_name, last_name, status, referral_code) VALUES (?, 'Edge', 'Aff', 'active', ?)`,
      [em("aff"), crypto.randomBytes(4).toString("hex").toUpperCase()],
    );
    ctrId = await insertId(
      `INSERT INTO contractors (email, first_name, last_name, status) VALUES (?, 'Edge', 'Ctr', 'active')`,
      [em("ctr")],
    );
    ctrCookie = await makeSession("contractor", ctrId);
    clientId = await insertId(
      `INSERT INTO clients (email, first_name, last_name, status, affiliate_id) VALUES (?, 'Edge', 'Client', 'active', ?)`,
      [em("client"), affId],
    );
    const [plans] = await db.query(`SELECT id, sq_ft FROM adu_plans WHERE code = 'fontana-1br' LIMIT 1`);
    planId = Number((plans as { id: number }[])[0].id);
    const sq = Number((plans as { sq_ft: number }[])[0].sq_ft);

    racePublicId = `GW-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    await db.execute(
      `INSERT INTO projects
         (public_id, client_id, affiliate_id, contractor_id, adu_plan_id, milestone,
          sq_ft, contractor_cost_cents, sale_price_cents)
       VALUES (?, ?, ?, ?, ?, 'in_build', ?, 1000000, 5000000)`,
      [racePublicId, clientId, affId, ctrId, planId, sq],
    );
  });

  afterAll(async () => {
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
      // Repair any prior test that wrote description = 'x' onto the shared plan.
      await db.execute(
        `UPDATE adu_plans SET description = 'Simple ADU layout'
         WHERE code = 'fontana-1br' AND description = 'x'`,
      );
    } finally {
      await db.end();
      __testClearEmailDryRuns();
    }
  });

  it("malformed cookies do not 500 portal routes", async () => {
    const me = await request(app)
      .get("/api/admin/auth/me")
      .set("Cookie", "gw_admin_sid=%; junk=%E0%A4%A");
    expect(me.status).toBe(401);
    expect(me.body.error).toBe("errors.unauthorized");

    const dash = await request(app)
      .get("/api/admin/dashboard")
      .set("Cookie", `junk=%E0%A4%A; ${adminCookie}`);
    expect(dash.status).toBe(200);
  });

  it("unknown /api path and invalid JSON return JSON errors", async () => {
    const miss = await request(app).get("/api/does-not-exist");
    expect(miss.status).toBe(404);
    expect(miss.body.error).toBe("errors.notFound");

    const bad = await request(app)
      .post("/api/admin/auth/otp/request")
      .set("Content-Type", "application/json")
      .send('{"email":');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("validation.invalidJson");

    expect(
      (await request(app).patch("/api/admin/leads/999999999").set("Cookie", adminCookie).send({ status: "spam" }))
        .status,
    ).toBe(404);
  });

  it("OTP lifecycle: request → lockout → verify → me → logout → replay rejected", async () => {
    __testClearEmailDryRuns();
    const email = em("admin");
    expect((await request(app).post("/api/admin/auth/otp/request").send({ email })).status).toBe(200);

    // Pull latest OTP hash from DB and reverse isn't possible — insert a known code.
    const code = "424242";
    const hash = crypto.createHash("sha256").update(code).digest("hex");
    await db.execute(
      `INSERT INTO admin_otp_codes (admin_id, code_hash, purpose, expires_at) VALUES (?, ?, 'login', ?)`,
      [adminId, hash, new Date(Date.now() + 10 * 60 * 1000)],
    );

    for (let i = 0; i < 5; i++) {
      const wrong = await request(app)
        .post("/api/admin/auth/otp/verify")
        .send({ email, code: "111111" });
      expect(wrong.status).toBe(401);
    }
    expect(
      (await request(app).post("/api/admin/auth/otp/verify").send({ email, code: "111111" })).body
        .error,
    ).toBe("errors.authLocked");

    // Fresh OTP after lockout
    await db.execute(
      `INSERT INTO admin_otp_codes (admin_id, code_hash, purpose, expires_at) VALUES (?, ?, 'login', ?)`,
      [adminId, hash, new Date(Date.now() + 10 * 60 * 1000)],
    );
    const ok = await request(app).post("/api/admin/auth/otp/verify").send({ email, code });
    expect(ok.status).toBe(200);
    const cookie = String(ok.headers["set-cookie"] || "").match(/gw_admin_sid=[^;]+/)?.[0];
    expect(cookie).toBeTruthy();

    expect((await request(app).get("/api/admin/auth/me").set("Cookie", cookie!)).status).toBe(200);
    expect((await request(app).post("/api/admin/auth/logout").set("Cookie", cookie!)).status).toBe(200);
    expect((await request(app).get("/api/admin/auth/me").set("Cookie", cookie!)).status).toBe(401);

    // Replay same code
    expect(
      (await request(app).post("/api/admin/auth/otp/verify").send({ email, code })).status,
    ).toBe(401);
  });

  it("parallel OTP verifies with the same code mint at most one session", async () => {
    const code = "656565";
    const hash = crypto.createHash("sha256").update(code).digest("hex");
    await db.execute(
      `DELETE FROM admin_sessions WHERE admin_id = ?`,
      [adminId],
    );
    await db.execute(
      `INSERT INTO admin_otp_codes (admin_id, code_hash, purpose, expires_at) VALUES (?, ?, 'login', ?)`,
      [adminId, hash, new Date(Date.now() + 10 * 60 * 1000)],
    );
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        request(app).post("/api/admin/auth/otp/verify").send({ email: em("admin"), code }),
      ),
    );
    const oks = results.filter((r) => r.status === 200);
    expect(oks.length).toBe(1);
    const [[count]] = (await db.query(
      `SELECT COUNT(*) AS n FROM admin_sessions WHERE admin_id = ? AND is_active = 1`,
      [adminId],
    )) as any;
    expect(Number(count.n)).toBe(1);
  });

  it("concurrent draws cannot exceed contractor budget", async () => {
    const amounts = [200_000, 200_000, 200_000, 200_000, 200_000, 200_000];
    const results = await Promise.all(
      amounts.map((amount_cents) =>
        request(app)
          .post(`/api/contractor/projects/${racePublicId}/draws`)
          .set("Cookie", ctrCookie)
          .send({ amount_cents }),
      ),
    );
    const created = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 400);
    expect(created.length).toBeLessThanOrEqual(5); // budget 1_000_000
    expect(rejected.length).toBeGreaterThan(0);
    const [[sum]] = (await db.query(
      `SELECT COALESCE(SUM(d.amount_cents),0) AS total
       FROM draw_requests d JOIN projects p ON p.id = d.project_id
       WHERE p.public_id = ? AND d.status IN ('draft','submitted','approved','paid')`,
      [racePublicId],
    )) as any;
    expect(Number(sum.total)).toBeLessThanOrEqual(1_000_000);
  });

  it("rejects draws when contractor budget is unset", async () => {
    const pid = `GW-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    await db.execute(
      `INSERT INTO projects (public_id, client_id, contractor_id, milestone)
       VALUES (?, ?, ?, 'in_build')`,
      [pid, clientId, ctrId],
    );
    const res = await request(app)
      .post(`/api/contractor/projects/${pid}/draws`)
      .set("Cookie", ctrCookie)
      .send({ amount_cents: 1000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("errors.drawBudgetRequired");
  });
});
