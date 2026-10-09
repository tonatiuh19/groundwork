import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  __test,
  __testClearEmailDryRuns,
  __testClearSmsDryRuns,
  __testGetEmailDryRuns,
  __testGetSmsDryRuns,
  addDaysIso,
  computeProjectEconomics,
  createServer,
  resolveAffiliateCommissionSplit,
  resolveCommissionCents,
} from "./index";
import {
  cleanupPortalFixturesByPrefix,
  createIntegrationTestPool,
  withSystemSettingsLock,
} from "./testDbCleanup";
import { ADMIN_PERMS } from "../shared/api";

// Unique-per-run test phones: the one-person-per-phone rule must never match other suites or real rows.
const RUN_PHONE = String(100 + Math.floor(Math.random() * 900));
const ph = (last4: string) => `949${RUN_PHONE}${last4}`;

const app = createServer();
const db = createIntegrationTestPool();
const prefix = `gwfeat-${Date.now()}-`;
const em = (name: string) => `${prefix}${name}@example.com`;

type Actor = "admin" | "affiliate" | "contractor" | "client";

async function makeSession(actor: Actor, id: number): Promise<string> {
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

async function insertId(sql: string, params: any[]): Promise<number> {
  const [r] = await db.execute(sql, params);
  return Number((r as { insertId: number }).insertId);
}

const as = (cookie: string) => ({
  get: (u: string) => request(app).get(u).set("Cookie", cookie),
  post: (u: string) => request(app).post(u).set("Cookie", cookie),
  patch: (u: string) => request(app).patch(u).set("Cookie", cookie),
  put: (u: string) => request(app).put(u).set("Cookie", cookie),
  delete: (u: string) => request(app).delete(u).set("Cookie", cookie),
});

describe("portal feature helpers (pure)", () => {
  it("computes net profit and per-sqft", () => {
    expect(
      computeProjectEconomics({
        sale_price_cents: 30_000_000,
        contractor_cost_cents: 20_000_000,
        affiliate_commission_cents: 550_000,
        agent_commission_cents: 450_000,
        sq_ft: 550,
      }),
    ).toEqual({
      net_profit_cents: 9_000_000,
      net_profit_per_sqft_cents: 16364,
    });
    expect(
      computeProjectEconomics({
        sale_price_cents: null,
        contractor_cost_cents: 1,
        affiliate_commission_cents: null,
        agent_commission_cents: null,
        sq_ft: 100,
      }),
    ).toEqual({ net_profit_cents: null, net_profit_per_sqft_cents: null });
    // negative margins stay negative; no sq ft → no per-sqft
    const neg = computeProjectEconomics({
      sale_price_cents: 100,
      contractor_cost_cents: 500,
      affiliate_commission_cents: 0,
      agent_commission_cents: 0,
      sq_ft: null,
    });
    expect(neg.net_profit_cents).toBe(-400);
    expect(neg.net_profit_per_sqft_cents).toBeNull();
  });

  it("resolves legacy commission: override > sqft x rate (plan default ignored)", () => {
    expect(
      resolveCommissionCents({
        override_cents: 1,
        plan_default_cents: 550000,
        sq_ft: 550,
        rate_cents_per_sqft: 1000,
      }),
    ).toBe(1);
    expect(
      resolveCommissionCents({
        override_cents: null,
        plan_default_cents: 999999,
        sq_ft: 550,
        rate_cents_per_sqft: 1000,
      }),
    ).toBe(550000);
    expect(
      resolveCommissionCents({
        override_cents: null,
        plan_default_cents: null,
        sq_ft: 600,
        rate_cents_per_sqft: 1000,
      }),
    ).toBe(600000);
  });

  it("splits affiliate commissions: direct / closer+parent / inactive parent", () => {
    const rates = {
      direct_cents_per_sqft: 1000,
      closer_cents_per_sqft: 700,
      parent_cents_per_sqft: 300,
    };
    expect(
      resolveAffiliateCommissionSplit({
        override_cents: null,
        sq_ft: 100,
        has_parent: false,
        parent_active: true,
        rates,
      }),
    ).toMatchObject({
      total_cents: 100000,
      closer_cents: 100000,
      parent_cents: 0,
      role_closer: "direct",
    });
    expect(
      resolveAffiliateCommissionSplit({
        override_cents: null,
        sq_ft: 100,
        has_parent: true,
        parent_active: true,
        rates,
      }),
    ).toMatchObject({
      total_cents: 100000,
      closer_cents: 70000,
      parent_cents: 30000,
      role_closer: "closer",
    });
    expect(
      resolveAffiliateCommissionSplit({
        override_cents: null,
        sq_ft: 100,
        has_parent: true,
        parent_active: false,
        rates,
      }),
    ).toMatchObject({
      total_cents: 70000,
      closer_cents: 70000,
      parent_cents: 0,
      role_closer: "closer",
    });
    const ov = resolveAffiliateCommissionSplit({
      override_cents: 100000,
      sq_ft: 100,
      has_parent: true,
      parent_active: true,
      rates,
    });
    expect(ov.closer_cents + ov.parent_cents).toBe(100000);
    expect(ov.parent_cents).toBe(30000);
    expect(ov.closer_cents).toBe(70000);
  });

  it("adds payout days in UTC", () => {
    expect(addDaysIso(new Date("2026-10-06T12:00:00Z"), 5)).toBe("2026-10-11");
  });

  it("keeps the API permission matrix identical to shared/api.ts", () => {
    expect(__test.ADMIN_PERMS).toEqual(ADMIN_PERMS);
  });
});

describe("portal features (integration)", () => {
  let superCookie = "";
  let agentCookie = "";
  let financeCookie = "";
  let contentCookie = "";
  let superId = 0;
  let financeId = 0;
  let affId = 0;
  let affCookie = "";
  let affCode = "";
  let ctrId = 0;
  let ctrCookie = "";
  let clientId = 0;
  let clientCookie = "";
  let otherClientCookie = "";
  let publicId = "";
  let planId = 0;
  // Live catalog values (plans get renamed/resized in prod — never hardcode them).
  let planSqFt = 0;
  let planName = "";
  let directRate = 0;
  const planCommission = () => planSqFt * directRate;

  beforeAll(async () => {
    process.env.VITEST = "true";
    __testClearEmailDryRuns();
    const mkAdmin = (name: string, role: string) =>
      insertId(
        `INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, ?, 'Test', ?, 'active')`,
        [em(name), name, role],
      );
    superId = await mkAdmin("super", "super_admin");
    const agentId = await mkAdmin("agent", "agent");
    financeId = await mkAdmin("finance", "finance");
    const contentId = await mkAdmin("content", "content");
    superCookie = await makeSession("admin", superId);
    agentCookie = await makeSession("admin", agentId);
    financeCookie = await makeSession("admin", financeId);
    contentCookie = await makeSession("admin", contentId);

    affCode = crypto.randomBytes(4).toString("hex").toUpperCase();
    affId = await insertId(
      `INSERT INTO affiliates (email, first_name, last_name, status, referral_code) VALUES (?, 'Ada', 'Affiliate', 'active', ?)`,
      [em("aff"), affCode],
    );
    affCookie = await makeSession("affiliate", affId);

    ctrId = await insertId(
      `INSERT INTO contractors (email, first_name, last_name, company, status) VALUES (?, 'Cole', 'Builder', 'Cole Builds', 'active')`,
      [em("ctr")],
    );
    ctrCookie = await makeSession("contractor", ctrId);

    clientId = await insertId(
      `INSERT INTO clients (email, first_name, last_name, status, affiliate_id) VALUES (?, 'Hana', 'Homeowner', 'prospect', ?)`,
      [em("client"), affId],
    );
    clientCookie = await makeSession("client", clientId);
    const otherId = await insertId(
      `INSERT INTO clients (email, first_name, last_name, status) VALUES (?, 'Olga', 'Other', 'prospect')`,
      [em("other")],
    );
    otherClientCookie = await makeSession("client", otherId);

    const [plans] = await db.query(
      `SELECT id, sq_ft, name FROM adu_plans WHERE code = 'fontana-1br' LIMIT 1`,
    );
    const plan = (plans as { id: number; sq_ft: number; name: string }[])[0];
    planId = Number(plan.id);
    planSqFt = Number(plan.sq_ft);
    planName = String(plan.name);
    const [rate] = await db.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'commission_direct_cents_per_sqft'`,
    );
    directRate = Number((rate as any[])[0]?.setting_value || 1000);
  });

  afterAll(async () => {
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
      __testClearEmailDryRuns();
    }
  });

  it("rejects unauthenticated + cross-portal access", async () => {
    for (const url of [
      "/api/admin/dashboard",
      "/api/admin/projects",
      "/api/affiliate/overview",
      "/api/contractor/projects",
      "/api/client/overview",
    ]) {
      expect((await request(app).get(url)).status).toBe(401);
    }
    // valid affiliate cookie is not valid for contractor/client/admin routes
    expect((await as(affCookie).get("/api/contractor/projects")).status).toBe(
      401,
    );
    expect((await as(affCookie).get("/api/client/overview")).status).toBe(401);
    expect((await as(affCookie).get("/api/admin/dashboard")).status).toBe(401);
  });

  it("blocks cookie-authenticated mutations from foreign origins (CSRF)", async () => {
    const res = await request(app)
      .patch("/api/admin/leads/1")
      .set("Cookie", superCookie)
      .set("Origin", "https://evil.example")
      .send({ status: "spam" });
    expect(res.status).toBe(403);
  });

  it("enforces role permissions", async () => {
    expect((await as(agentCookie).get("/api/admin/staff")).status).toBe(403);
    expect((await as(agentCookie).get("/api/admin/commissions")).status).toBe(
      403,
    );
    expect((await as(financeCookie).get("/api/admin/leads")).status).toBe(403);
    expect((await as(contentCookie).get("/api/admin/projects")).status).toBe(
      403,
    );
    // content may edit plans; agent may not — use a no-op sort_order toggle restored after
    const [before] = await db.query(
      `SELECT sort_order FROM adu_plans WHERE id = ? LIMIT 1`,
      [planId],
    );
    const prevSort = Number((before as { sort_order: number }[])[0].sort_order);
    const nextSort = prevSort === 1 ? 2 : 1;
    expect(
      (
        await as(contentCookie)
          .patch(`/api/admin/plans/${planId}`)
          .send({ sort_order: nextSort })
      ).status,
    ).not.toBe(403);
    expect(
      (
        await as(agentCookie)
          .patch(`/api/admin/plans/${planId}`)
          .send({ sort_order: nextSort })
      ).status,
    ).toBe(403);
    await db.execute(`UPDATE adu_plans SET sort_order = ? WHERE id = ?`, [
      prevSort,
      planId,
    ]);
    expect((await as(agentCookie).get("/api/admin/settings")).status).toBe(403);
    expect((await as(financeCookie).get("/api/admin/settings")).status).toBe(
      200,
    );
    // approvals = super_admin/admin only
    expect(
      (
        await as(agentCookie)
          .patch(`/api/admin/affiliates/${affId}`)
          .send({ notes: "n" })
      ).status,
    ).toBe(403);
  });

  it("affiliate signup → pending → admin approval → OTP allowed", async () => {
    __testClearEmailDryRuns();
    const body = {
      first_name: "Pat",
      last_name: "Pending",
      email: em("pending"),
      phone: ph("1234"),
      company: "Realty Co",
      preferred_language: "es",
    };
    const res = await request(app)
      .post("/api/public/affiliate/signup")
      .send(body);
    expect(res.status).toBe(201);
    const sent = __testGetEmailDryRuns();
    expect(
      sent.some((m) => m.to === body.email && /recibida/i.test(m.subject)),
    ).toBe(true);
    expect(sent.length).toBeGreaterThan(1); // + staff alerts

    expect(
      (await request(app).post("/api/public/affiliate/signup").send(body))
        .status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .post("/api/public/affiliate/signup")
          .send({ ...body, email: "nope" })
      ).status,
    ).toBe(400);

    // Pending: 403 with legend key (login form stays on email step).
    __testClearEmailDryRuns();
    const otp = await request(app)
      .post("/api/affiliate/auth/otp/request")
      .send({ email: body.email });
    expect(otp.status).toBe(403);
    expect(otp.body.error).toBe("errors.authPending");
    expect(
      __testGetEmailDryRuns().filter((m) => m.to === body.email),
    ).toHaveLength(0);
    const pendingVerify = await request(app)
      .post("/api/affiliate/auth/otp/verify")
      .send({ email: body.email, code: "123456" });
    expect(pendingVerify.status).toBe(401);
    expect(pendingVerify.body.error).toBe("errors.authInvalid");

    const list = await as(superCookie).get("/api/admin/affiliates");
    const row = list.body.affiliates.find((a: any) => a.email === body.email);
    expect(row.status).toBe("pending");
    expect(row.slug).toBe("pat-pending");

    // Collision suffix while first still owns pat-pending
    const twinBody = {
      first_name: "Pat",
      last_name: "Pending",
      email: em("pending-twin"),
      phone: ph("1235"),
      preferred_language: "en",
    };
    const twin = await request(app)
      .post("/api/public/affiliate/signup")
      .send(twinBody);
    expect(twin.status).toBe(201);
    const twinList = await as(superCookie).get("/api/admin/affiliates");
    const twinRow = twinList.body.affiliates.find(
      (a: any) => a.email === twinBody.email,
    );
    expect(twinRow.slug).toBe("pat-pending-2");

    __testClearEmailDryRuns();
    const approve = await as(superCookie)
      .patch(`/api/admin/affiliates/${row.id}`)
      .send({ status: "active" });
    expect(approve.status).toBe(200);
    expect(__testGetEmailDryRuns().some((m) => m.to === body.email)).toBe(true);
    const otp2 = await request(app)
      .post("/api/affiliate/auth/otp/request")
      .send({ email: body.email });
    expect(otp2.status).toBe(200);

    // Vanity slug: reserved blocked; custom set; taken → 409
    expect(
      (
        await as(superCookie)
          .patch(`/api/admin/affiliates/${row.id}`)
          .send({ slug: "admin" })
      ).body.error,
    ).toBe("validation.slugReserved");
    const setSlug = await as(superCookie)
      .patch(`/api/admin/affiliates/${row.id}`)
      .send({ slug: "Pat Pending Cool" });
    expect(setSlug.status).toBe(200);
    const after = await as(superCookie).get(`/api/admin/affiliates/${row.id}`);
    expect(after.body.affiliate.slug).toBe("pat-pending-cool");
    const taken = await as(superCookie)
      .patch(`/api/admin/affiliates/${twinRow.id}`)
      .send({ slug: "pat-pending-cool" });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toBe("errors.slugTaken");

    const mePatch = await as(affCookie)
      .patch("/api/affiliate/me")
      .send({ slug: "Ada Affiliate Link" });
    expect(mePatch.status).toBe(200);
    expect(mePatch.body.profile.slug).toBe("ada-affiliate-link");
    // Restore fixture affiliate so later tests still expect /r/{affCode}
    const cleared = await as(affCookie)
      .patch("/api/affiliate/me")
      .send({ slug: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.profile.slug).toBeNull();
  });

  it("client signup → pending → admin approve → prospect + invite", async () => {
    __testClearEmailDryRuns();
    const body = {
      first_name: "Home",
      last_name: "Owner",
      email: em("client-signup"),
      phone: ph("9876"),
      preferred_language: "en",
    };
    const created = await request(app)
      .post("/api/public/client/signup")
      .send(body);
    expect(created.status).toBe(201);
    expect(created.body.outcome).toBe("created");
    const sent = __testGetEmailDryRuns();
    expect(
      sent.some(
        (m) => m.to === body.email && /application received/i.test(m.subject),
      ),
    ).toBe(true);

    __testClearEmailDryRuns();
    const again = await request(app)
      .post("/api/public/client/signup")
      .send(body);
    expect(again.status).toBe(200);
    expect(again.body.outcome).toBe("resent");

    const otp = await request(app)
      .post("/api/client/auth/otp/request")
      .send({ email: body.email });
    expect(otp.status).toBe(403);
    expect(otp.body.error).toBe("errors.authPending");

    const list = await as(superCookie).get("/api/admin/clients?status=pending");
    const row = list.body.clients.find(
      (c: { email: string }) => c.email === body.email,
    );
    expect(row?.status).toBe("pending");

    // Agents can edit clients but cannot approve self-signups (approvals perm).
    const agentDeny = await as(agentCookie)
      .patch(`/api/admin/clients/${row.id}`)
      .send({ status: "prospect" });
    expect(agentDeny.status).toBe(403);
    expect(agentDeny.body.error).toBe("errors.forbidden");

    __testClearEmailDryRuns();
    const approve = await as(superCookie)
      .patch(`/api/admin/clients/${row.id}`)
      .send({ status: "prospect" });
    expect(approve.status).toBe(200);
    expect(approve.body.invite_sent).toBe(true);
    expect(__testGetEmailDryRuns().some((m) => m.to === body.email)).toBe(true);

    const [[after]] = (await db.query(
      `SELECT status FROM clients WHERE id = ?`,
      [row.id],
    )) as any;
    expect(after.status).toBe("prospect");

    // Prospect can OTP; re-signup soft-resends invite.
    expect(
      (
        await request(app)
          .post("/api/client/auth/otp/request")
          .send({ email: body.email })
      ).status,
    ).toBe(200);
    __testClearEmailDryRuns();
    const inviteAgain = await request(app)
      .post("/api/public/client/signup")
      .send(body);
    expect(inviteAgain.status).toBe(200);
    expect(inviteAgain.body.outcome).toBe("invite_resent");
    expect(__testGetEmailDryRuns().some((m) => m.to === body.email)).toBe(true);

    // Active / inactive → ready (no invite spam).
    await db.execute(`UPDATE clients SET status = 'active' WHERE id = ?`, [
      row.id,
    ]);
    expect(
      (await request(app).post("/api/public/client/signup").send(body)).body
        .outcome,
    ).toBe("ready");
    await db.execute(`UPDATE clients SET status = 'inactive' WHERE id = ?`, [
      row.id,
    ]);
    expect(
      (await request(app).post("/api/public/client/signup").send(body)).body
        .outcome,
    ).toBe("ready");
  });

  it("contractor signup → pending → admin approve → active + OTP", async () => {
    __testClearEmailDryRuns();
    const body = {
      first_name: "Build",
      last_name: "Crew",
      email: em("ctr-signup"),
      phone: ph("4321"),
      company: "Crew Co",
      preferred_language: "es",
    };
    const created = await request(app)
      .post("/api/public/contractor/signup")
      .send(body);
    expect(created.status).toBe(201);
    expect(created.body.outcome).toBe("created");
    expect(
      __testGetEmailDryRuns().some(
        (m) =>
          m.to === body.email &&
          /precalificaci/i.test(m.subject) &&
          /contractor\/apply\/[a-f0-9]{64}/.test(m.html),
      ),
    ).toBe(true);

    __testClearEmailDryRuns();
    const again = await request(app)
      .post("/api/public/contractor/signup")
      .send(body);
    expect(again.status).toBe(200);
    expect(again.body.outcome).toBe("resent");

    expect(
      (
        await request(app)
          .post("/api/contractor/auth/otp/request")
          .send({ email: body.email })
      ).status,
    ).toBe(403);

    const list = await as(superCookie).get(
      "/api/admin/contractors?status=pending",
    );
    const row = list.body.contractors.find(
      (c: { email: string }) => c.email === body.email,
    );
    expect(row?.status).toBe("pending");

    expect(
      (
        await as(agentCookie)
          .patch(`/api/admin/contractors/${row.id}`)
          .send({ status: "active" })
      ).status,
    ).toBe(403);

    expect(row?.application_status).toBe("draft");

    // pending → active needs an approved prequalification (super_admin may override with a reason).
    const blocked = await as(superCookie)
      .patch(`/api/admin/contractors/${row.id}`)
      .send({ status: "active" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("errors.contractorOverrideReasonRequired");

    __testClearEmailDryRuns();
    const approve = await as(superCookie)
      .patch(`/api/admin/contractors/${row.id}`)
      .send({ status: "active", override_reason: "Known partner (vitest)" });
    expect(approve.status).toBe(200);
    expect(__testGetEmailDryRuns().some((m) => m.to === body.email)).toBe(true);

    const otp = await request(app)
      .post("/api/contractor/auth/otp/request")
      .send({ email: body.email });
    expect(otp.status).toBe(200);

    expect(
      (await request(app).post("/api/public/contractor/signup").send(body)).body
        .outcome,
    ).toBe("ready");

    const dash = await as(superCookie).get("/api/admin/dashboard");
    expect(dash.status).toBe(200);
    expect(typeof dash.body.clients_pending).toBe("number");
    expect(typeof dash.body.contractors_pending).toBe("number");
  });

  it("contractor invited re-signup soft-resends invite", async () => {
    const email = em("ctr-invited-signup");
    const id = await insertId(
      `INSERT INTO contractors
         (email, first_name, last_name, status, preferred_language, invited_by_admin_id)
       VALUES (?, 'Ivy', 'Invitee', 'invited', 'en', ?)`,
      [email, superId],
    );
    await db.execute(
      `INSERT INTO contractor_invites (token, email, contractor_id, created_by_admin_id, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        crypto.randomBytes(16).toString("hex"),
        email,
        id,
        superId,
        new Date(Date.now() + 7 * 86_400_000),
      ],
    );
    __testClearEmailDryRuns();
    const res = await request(app)
      .post("/api/public/contractor/signup")
      .send({
        first_name: "Ivy",
        last_name: "Invitee",
        email,
        phone: ph("1111"),
      });
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("invite_resent");
    expect(__testGetEmailDryRuns().some((m) => m.to === email)).toBe(true);
  });

  it("tracks referral clicks and attributes leads", async () => {
    const card = await request(app).get(
      `/api/public/affiliates/by-code/${affCode}`,
    );
    expect(card.status).toBe(200);
    expect(card.body.affiliate.referral_code).toBe(affCode);
    expect(card.body.affiliate.initials).toBeTruthy();
    const unknown = await request(app).get(
      "/api/public/affiliates/by-code/NOPE1234",
    );
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe("errors.referralInactive");

    const redirect = await request(app).get(
      `/api/public/r/${affCode}?to=partners`,
    );
    expect(redirect.status).toBe(302);
    expect(redirect.headers.location).toBe(`/partners?ref=${affCode}`);
    const expiredHome = await request(app).get("/api/public/r/NOPE1234");
    expect(expiredHome.headers.location).toBe("/r/expired");

    // Unique phone — shared TiDB + parallel suites can collide on last-10 match (convert 7b+c).
    const leadPhone = `949${String(Date.now()).slice(-7)}`;
    const lead = await request(app)
      .post("/api/public/leads")
      .send({
        full_name: "Lee Lead",
        email: em("lead"),
        phone: leadPhone,
        property_address: "1 Test St, Fontana",
        soft_pull_consent: true,
        referral_code: affCode,
        source: "vitest",
      });
    expect(lead.status).toBe(201);
    const [rows] = await db.query(
      `SELECT affiliate_id, referral_code FROM leads WHERE id = ?`,
      [lead.body.lead_id],
    );
    expect(Number((rows as any[])[0].affiliate_id)).toBe(affId);

    const overview = await as(affCookie).get("/api/affiliate/overview");
    expect(overview.status).toBe(200);
    expect(overview.body.stats.clicks).toBeGreaterThanOrEqual(1);
    expect(overview.body.stats.leads).toBeGreaterThanOrEqual(1);
    expect(overview.body.affiliate.tracking_url).toContain(`/r/${affCode}`);

    // admin converts attributed lead into client + project keeping the affiliate
    let convert = await as(superCookie)
      .post(`/api/admin/leads/${lead.body.lead_id}/convert`)
      .send({ adu_plan_id: planId });
    // Rare cross-suite phone collision: confirm link and continue (still creates project).
    if (
      convert.status === 409 &&
      convert.body?.error === "errors.phoneLinkConfirmRequired"
    ) {
      convert = await as(superCookie)
        .post(`/api/admin/leads/${lead.body.lead_id}/convert`)
        .send({ adu_plan_id: planId, confirm_phone_link: true });
    }
    expect(convert.status).toBe(201);
    expect(convert.body.project_public_id).toBeTruthy();
    expect(
      (
        await as(superCookie)
          .post(`/api/admin/leads/${lead.body.lead_id}/convert`)
          .send({})
      ).status,
    ).toBe(409);
    const detail = await as(superCookie).get(
      `/api/admin/projects/${convert.body.project_public_id}`,
    );
    expect(detail.body.project.affiliate_id).toBe(affId);
  });

  it("affiliate registers a client with consent; list hides loan detail", async () => {
    const payload = {
      first_name: "Rita",
      last_name: "Registered",
      email: em("registered"),
      phone: ph("1111"),
      property_address: "22 Builder Ave, Fontana",
      adu_plan_id: planId,
    };
    expect(
      (await as(affCookie).post("/api/affiliate/clients").send(payload)).status,
    ).toBe(400);
    __testClearEmailDryRuns();
    const ok = await as(affCookie)
      .post("/api/affiliate/clients")
      .send({ ...payload, homeowner_consent: true });
    expect(ok.status).toBe(201);
    publicId = ok.body.project_public_id;
    expect(ok.body.invite_sent).toBe(true);
    const inviteMail = __testGetEmailDryRuns().find(
      (m) => m.to === em("registered"),
    );
    expect(inviteMail).toBeTruthy();
    expect(inviteMail!.html).toMatch(/client\/invite\/[a-f0-9]{64}/);
    expect(
      (
        await as(affCookie)
          .post("/api/affiliate/clients")
          .send({ ...payload, homeowner_consent: true })
      ).status,
    ).toBe(409);

    const list = await as(affCookie).get("/api/affiliate/clients");
    const row = list.body.clients.find((c: any) => c.public_id === publicId);
    expect(row.milestone).toBe("lead");
    expect(row.sq_ft).toBe(planSqFt);
    for (const banned of [
      "loan_status",
      "loan_lender_name",
      "sale_price_cents",
      "net_profit_cents",
      "contractor_cost_cents",
    ]) {
      expect(row).not.toHaveProperty(banned);
    }
  });

  it("public enroll creates client+project and magic link activates prospect", async () => {
    __testClearEmailDryRuns();
    const email = em("enroll");
    const bad = await request(app)
      .post("/api/public/enroll")
      .send({
        first_name: "Nora",
        last_name: "New",
        email,
        phone: ph("2222"),
        property_address: "9 Enroll Way",
        soft_pull_consent: false,
        referral_code: affCode,
      });
    expect(bad.status).toBe(400);

    const ok = await request(app)
      .post("/api/public/enroll")
      .send({
        first_name: "Nora",
        last_name: "New",
        email,
        phone: ph("2222"),
        property_address: "9 Enroll Way, Fontana",
        property_city: "Fontana",
        property_zip: "92335",
        preferred_language: "en",
        soft_pull_consent: true,
        homeowner_consent: true,
        referral_code: affCode,
        adu_plan_id: planId,
      });
    expect(ok.status).toBe(201);
    expect(ok.body.invite_sent).toBe(true);
    expect(ok.body.project_public_id).toMatch(/^GW-/);
    expect(ok.body.outcome).toBe("created");

    // Returning homeowner: friendly outcome + fresh portal link, no second client/project.
    __testClearEmailDryRuns();
    const again = await request(app)
      .post("/api/public/enroll")
      .send({
        first_name: "Nora",
        last_name: "New",
        email,
        phone: ph("2222"),
        property_address: "9 Enroll Way, Fontana",
        preferred_language: "en",
        homeowner_consent: true,
      });
    expect(again.status).toBe(200);
    expect(again.body.outcome).toBe("invite_resent");
    expect(again.body.project_public_id).toBeNull();
    expect(__testGetEmailDryRuns().some((m) => m.to === email)).toBe(true);
    const [[cnt]] = (await db.query(`SELECT COUNT(*) AS n FROM clients WHERE email = ?`, [email])) as any;
    expect(Number(cnt.n)).toBe(1);

    const [[client]] = (await db.query(
      `SELECT id, status, affiliate_id FROM clients WHERE email = ? LIMIT 1`,
      [email],
    )) as any;
    expect(client.status).toBe("prospect");
    expect(Number(client.affiliate_id)).toBe(affId);

    const mail = __testGetEmailDryRuns().find((m) => m.to === email);
    expect(mail).toBeTruthy();
    const token = /client\/invite\/([a-f0-9]{64})/.exec(mail!.html)![1];
    expect(
      (await request(app).get(`/api/public/client-invite/${token}`)).body.email,
    ).toBe(email);

    const accept = await request(app)
      .post("/api/public/client-invite/accept")
      .send({ token });
    expect(accept.status).toBe(200);
    expect(accept.body.actor).toBe("client");
    expect(accept.body.user.status).toBe("active");
    expect(String(accept.headers["set-cookie"] || "")).toMatch(
      /gw_client_sid=/,
    );
    expect(
      (
        await request(app)
          .post("/api/public/client-invite/accept")
          .send({ token })
      ).status,
    ).toBe(404);

    const [[after]] = (await db.query(
      `SELECT status, email_verified_at FROM clients WHERE id = ?`,
      [client.id],
    )) as any;
    expect(after.status).toBe("active");
    expect(after.email_verified_at).toBeTruthy();
  });

  it("contractor invite → accept → prequalification (pending until approved)", async () => {
    __testClearEmailDryRuns();
    const invite = await as(superCookie)
      .post("/api/admin/contractors/invite")
      .send({
        email: em("invited"),
        first_name: "Ivy",
        last_name: "Invited",
        company: "Ivy Co",
      });
    expect(invite.status).toBe(201);
    const mail = __testGetEmailDryRuns().find((m) => m.to === em("invited"));
    // The invite email is the prequalification link.
    expect(/contractor\/apply\/[a-f0-9]{64}/.test(mail!.html)).toBe(true);
    const [invRows] = await db.query(
      `SELECT token FROM contractor_invites WHERE contractor_id = ? ORDER BY id DESC LIMIT 1`,
      [invite.body.contractor_id],
    );
    const token = String((invRows as any[])[0].token);

    const preOtp = await request(app)
      .post("/api/contractor/auth/otp/request")
      .send({ email: em("invited") });
    expect(preOtp.status).toBe(403);
    expect(preOtp.body.error).toBe("errors.authInvited");

    expect(
      (
        await request(app).get(
          `/api/public/contractor-invite/${"0".repeat(64)}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (await request(app).get(`/api/public/contractor-invite/${token}`)).body
        .email,
    ).toBe(em("invited"));
    const accepted = await request(app)
      .post("/api/public/contractor-invite/accept")
      .send({ token });
    expect(accepted.status).toBe(200);
    expect(accepted.body.next).toBe("application");
    expect(accepted.body.application_path).toMatch(
      /^\/contractor\/apply\/[a-f0-9]{64}$/,
    );
    expect(
      (
        await request(app)
          .post("/api/public/contractor-invite/accept")
          .send({ token })
      ).status,
    ).toBe(404);
    // Accepting starts the application; login stays closed until staff approves it.
    const postOtp = await request(app)
      .post("/api/contractor/auth/otp/request")
      .send({ email: em("invited") });
    expect(postOtp.status).toBe(403);
    expect(postOtp.body.error).toBe("errors.authPending");
    expect(
      (
        await as(superCookie)
          .post("/api/admin/contractors/invite")
          .send({ email: em("ctr"), first_name: "C", last_name: "B" })
      ).status,
    ).toBe(409);
  });

  it("runs the project → loan → commission → profit flow with role-scoped finance", async () => {
    // in_build requires a contractor
    const bad = await as(superCookie)
      .patch(`/api/admin/projects/${publicId}`)
      .send({ milestone: "in_build" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("errors.contractorRequired");

    // agent cannot touch finance fields
    const denied = await as(agentCookie)
      .patch(`/api/admin/projects/${publicId}`)
      .send({ sale_price_cents: 1 });
    expect(denied.status).toBe(403);

    // inactive contractors cannot be assigned
    const [[otherCtr]] = (await db.query(
      `SELECT id FROM contractors WHERE email = ?`,
      [em("invited")],
    )) as any;
    await db.execute(
      `UPDATE contractors SET status = 'suspended' WHERE id = ?`,
      [otherCtr.id],
    );
    expect(
      (
        await as(superCookie)
          .patch(`/api/admin/projects/${publicId}`)
          .send({ contractor_id: otherCtr.id })
      ).body.error,
    ).toBe("errors.contractorInactive");

    const assigned = await as(superCookie)
      .patch(`/api/admin/projects/${publicId}`)
      .send({
        contractor_id: ctrId,
        milestone: "contracted",
        sale_price_cents: 30_000_000,
        contractor_cost_cents: 20_000_000,
        agent_commission_cents: 450_000,
      });
    expect(assigned.status).toBe(200);
    const p = assigned.body.project;
    expect(p.affiliate_commission_cents).toBe(planCommission()); // plan sq ft × direct rate
    expect(p.net_profit_cents).toBe(
      30_000_000 - 20_000_000 - planCommission() - 450_000,
    );
    expect(p.net_profit_per_sqft_cents).toBe(
      Math.round(p.net_profit_cents / planSqFt),
    );
    expect(assigned.body.events.map((e: any) => e.to_milestone)).toEqual([
      "lead",
      "contracted",
    ]);

    // agent sees the project without financial columns
    const agentView = await as(agentCookie).get(
      `/api/admin/projects/${publicId}`,
    );
    expect(agentView.status).toBe(200);
    expect(agentView.body.project).not.toHaveProperty("sale_price_cents");
    expect(agentView.body.commission).toBeNull();
    const financeView = await as(financeCookie).get(
      `/api/admin/projects/${publicId}`,
    );
    expect(financeView.body.project.sale_price_cents).toBe(30_000_000);

    // contractor sees the project (budget only), never sale price / affiliate
    const cProjects = await as(ctrCookie).get("/api/contractor/projects");
    const cRow = cProjects.body.projects.find(
      (x: any) => x.public_id === publicId,
    );
    expect(cRow.budget_cents).toBe(20_000_000);
    expect(cRow).not.toHaveProperty("sale_price_cents");
    expect(cRow).not.toHaveProperty("affiliate_commission_cents");

    // contract stub
    const contract = await as(superCookie)
      .post(`/api/admin/projects/${publicId}/contracts`)
      .send({});
    expect(contract.status).toBe(201);
    const ctrDetail = await as(ctrCookie).get(
      `/api/contractor/projects/${publicId}`,
    );
    expect(ctrDetail.body.contracts).toHaveLength(1);
    expect(ctrDetail.body.contracts[0]).not.toHaveProperty("payload_json");

    // loan finalize → commission row with expected pay date (5 days by default)
    const fin = await as(superCookie)
      .patch(`/api/admin/projects/${publicId}`)
      .send({
        loan_status: "finalized",
        loan_lender_type: "external",
        loan_lender_name: "ABC Mortgage",
      });
    expect(fin.status).toBe(200);
    expect(fin.body.commission.status).toBe("pending");
    expect(fin.body.commission.amount_cents).toBe(planCommission());
    const days = await (async () => {
      const [rows] = await db.query(
        `SELECT setting_value FROM system_settings WHERE setting_key = 'commission_payout_days_after_loan_close'`,
      );
      return Number((rows as any[])[0].setting_value);
    })();
    expect(String(fin.body.commission.expected_pay_at).slice(0, 10)).toBe(
      addDaysIso(new Date(), days),
    );
    // affiliate cannot be swapped once finalized
    expect(
      (
        await as(superCookie)
          .patch(`/api/admin/projects/${publicId}`)
          .send({ affiliate_id: null })
      ).body.error,
    ).toBe("errors.projectLocked");

    // affiliate sees commission; client view hides financials
    const myComm = await as(affCookie).get("/api/affiliate/commissions");
    expect(
      myComm.body.commissions.find((c: any) => c.project_public_id === publicId)
        .amount_cents,
    ).toBe(planCommission());
    const finalized = await as(affCookie).get("/api/affiliate/clients");
    expect(
      finalized.body.clients.find((c: any) => c.public_id === publicId)
        .commission_status,
    ).toBe("pending");

    // un-finalize voids the pending commission
    const undo = await as(superCookie)
      .patch(`/api/admin/projects/${publicId}`)
      .send({ loan_status: "underwriting" });
    expect(undo.body.commission.status).toBe("void");
    await as(superCookie)
      .patch(`/api/admin/projects/${publicId}`)
      .send({ loan_status: "finalized" });

    // commission lifecycle: pending → approved → paid (+ email), paid is immutable
    const commission = (
      await as(financeCookie).get("/api/admin/commissions")
    ).body.commissions.find((c: any) => c.project_public_id === publicId);
    expect(commission.status).toBe("pending");
    expect(
      (
        await as(financeCookie)
          .patch(`/api/admin/commissions/${commission.id}`)
          .send({ status: "paid" })
      ).status,
    ).toBe(409);
    expect(
      (
        await as(financeCookie)
          .patch(`/api/admin/commissions/${commission.id}`)
          .send({ status: "approved" })
      ).status,
    ).toBe(200);
    __testClearEmailDryRuns();
    expect(
      (
        await as(financeCookie)
          .patch(`/api/admin/commissions/${commission.id}`)
          .send({ status: "paid" })
      ).status,
    ).toBe(200);
    expect(__testGetEmailDryRuns().some((m) => m.to === em("aff"))).toBe(true);
    expect(
      (
        await as(financeCookie)
          .patch(`/api/admin/commissions/${commission.id}`)
          .send({ status: "void" })
      ).status,
    ).toBe(409);
    // After payout, commission math inputs are frozen (super_admin has projects.write)
    expect(
      (
        await as(superCookie)
          .patch(`/api/admin/projects/${publicId}`)
          .send({ commission_override_cents: 1 })
      ).body.error,
    ).toBe("errors.commissionPaidLocked");
    expect(
      (
        await as(superCookie)
          .patch(`/api/admin/projects/${publicId}`)
          .send({ sq_ft: 100 })
      ).body.error,
    ).toBe("errors.commissionPaidLocked");
  });

  it("splits commissions for sub closer + parent; voids parent when inactive; guards sub invite", async () => {
    const parentCode = crypto.randomBytes(4).toString("hex").toUpperCase();
    const parentId = await insertId(
      `INSERT INTO affiliates (email, first_name, last_name, status, referral_code)
       VALUES (?, 'Pam', 'Parent', 'active', ?)`,
      [em("parent"), parentCode],
    );
    const parentCookie = await makeSession("affiliate", parentId);

    // Top-level can invite; invite activates immediately.
    const invite = await as(parentCookie)
      .post("/api/affiliate/team")
      .send({
        first_name: "Sam",
        last_name: "Sub",
        email: em("sub"),
        phone: ph("0100"),
        preferred_language: "es",
      });
    expect(invite.status).toBe(201);
    const subId = Number(invite.body.affiliate_id);
    expect(subId).toBeGreaterThan(0);
    const [[subRow]] = (await db.query(
      `SELECT status, parent_affiliate_id, preferred_language FROM affiliates WHERE id = ?`,
      [subId],
    )) as any;
    expect(subRow.status).toBe("active");
    expect(Number(subRow.parent_affiliate_id)).toBe(parentId);
    expect(subRow.preferred_language).toBe("es");

    // Self-parent corrupt pointer is ignored → treated as direct (no parent split).
    await db.execute(
      `UPDATE affiliates SET parent_affiliate_id = id WHERE id = ?`,
      [parentId],
    );
    const selfReg = await as(parentCookie)
      .post("/api/affiliate/clients")
      .send({
        first_name: "Self",
        last_name: "Parent",
        email: em("self-parent-client"),
        phone: ph("0188"),
        property_address: "2 Self St",
        homeowner_consent: true,
        preferred_language: "en",
        adu_plan_id: planId,
      });
    expect(selfReg.status).toBe(201);
    const [[selfProj]] = (await db.query(
      `SELECT closer_affiliate_id, parent_affiliate_id FROM projects WHERE public_id = ?`,
      [selfReg.body.project_public_id],
    )) as any;
    expect(Number(selfProj.closer_affiliate_id)).toBe(parentId);
    expect(selfProj.parent_affiliate_id).toBeNull();
    await db.execute(
      `UPDATE affiliates SET parent_affiliate_id = NULL WHERE id = ?`,
      [parentId],
    );

    const subCookie = await makeSession("affiliate", subId);
    expect((await as(subCookie).get("/api/affiliate/team")).status).toBe(403);
    expect(
      (
        await as(subCookie)
          .post("/api/affiliate/team")
          .send({
            first_name: "Nope",
            last_name: "Nest",
            email: em("nested"),
            phone: ph("0101"),
          })
      ).body.error,
    ).toBe("errors.subCannotInvite");

    // Sub registers a client → project snapshots closer + parent.
    const reg = await as(subCookie)
      .post("/api/affiliate/clients")
      .send({
        first_name: "Split",
        last_name: "Home",
        email: em("split-client"),
        phone: ph("0199"),
        property_address: "1 Split St",
        homeowner_consent: true,
        preferred_language: "en",
        adu_plan_id: planId,
      });
    expect(reg.status).toBe(201);
    const splitPublicId = String(reg.body.project_public_id);
    const [[proj]] = (await db.query(
      `SELECT id, sq_ft, closer_affiliate_id, parent_affiliate_id, affiliate_id
       FROM projects WHERE public_id = ?`,
      [splitPublicId],
    )) as any;
    expect(Number(proj.closer_affiliate_id)).toBe(subId);
    expect(Number(proj.parent_affiliate_id)).toBe(parentId);
    const sq = Number(proj.sq_ft || 550);

    await as(superCookie).patch(`/api/admin/projects/${splitPublicId}`).send({
      contractor_id: ctrId,
      milestone: "contracted",
      sale_price_cents: 30_000_000,
      contractor_cost_cents: 20_000_000,
    });
    const fin = await as(superCookie)
      .patch(`/api/admin/projects/${splitPublicId}`)
      .send({
        loan_status: "finalized",
        loan_lender_type: "external",
        loan_lender_name: "Split Bank",
      });
    expect(fin.status).toBe(200);
    expect(fin.body.commissions).toHaveLength(2);
    const byRole = Object.fromEntries(
      fin.body.commissions.map((c: any) => [c.role, c]),
    );
    expect(byRole.closer.amount_cents).toBe(sq * 700);
    expect(byRole.parent.amount_cents).toBe(sq * 300);
    expect(fin.body.project.affiliate_commission_cents).toBe(sq * 1000);

    // Deactivating parent voids unpaid parent share immediately.
    expect(
      (
        await as(superCookie)
          .patch(`/api/admin/affiliates/${parentId}`)
          .send({ status: "inactive" })
      ).status,
    ).toBe(200);
    const afterInactive = await as(financeCookie).get(
      `/api/admin/projects/${splitPublicId}`,
    );
    const parentVoid = afterInactive.body.commissions.find(
      (c: any) => c.role === "parent",
    );
    expect(parentVoid.status).toBe("void");
    expect(afterInactive.body.project.affiliate_commission_cents).toBe(
      sq * 700,
    );

    // Reactivate restores parent share on finalized deal.
    expect(
      (
        await as(superCookie)
          .patch(`/api/admin/affiliates/${parentId}`)
          .send({ status: "active" })
      ).status,
    ).toBe(200);
    const afterActive = await as(financeCookie).get(
      `/api/admin/projects/${splitPublicId}`,
    );
    const parentLive = afterActive.body.commissions.find(
      (c: any) => c.role === "parent",
    );
    expect(parentLive.status).toBe("pending");
    expect(parentLive.amount_cents).toBe(sq * 300);

    // Rate freeze: live Settings change must not rewrite unpaid amounts.
    await withSystemSettingsLock(db, async () => {
      const settingsBefore = (await as(superCookie).get("/api/admin/settings"))
        .body.settings;
      try {
        expect(
          (
            await as(superCookie)
              .put("/api/admin/settings")
              .send({
                ...settingsBefore,
                commission_closer_cents_per_sqft: 999,
                commission_parent_cents_per_sqft: 1,
              })
          ).status,
        ).toBe(200);
        const newSq = sq + 10;
        expect(
          (
            await as(superCookie)
              .patch(`/api/admin/projects/${splitPublicId}`)
              .send({ sq_ft: newSq })
          ).status,
        ).toBe(200);
        const frozen = await as(financeCookie).get(
          `/api/admin/projects/${splitPublicId}`,
        );
        expect(frozen.body.project.commission_rate_closer_cents_per_sqft).toBe(
          700,
        );
        expect(frozen.body.project.commission_rate_parent_cents_per_sqft).toBe(
          300,
        );
        expect(
          frozen.body.commissions.find((c: any) => c.role === "closer")
            .amount_cents,
        ).toBe(newSq * 700);
        expect(
          frozen.body.commissions.find((c: any) => c.role === "parent")
            .amount_cents,
        ).toBe(newSq * 300);
        // restore sq for later asserts
        expect(
          (
            await as(superCookie)
              .patch(`/api/admin/projects/${splitPublicId}`)
              .send({ sq_ft: sq })
          ).status,
        ).toBe(200);
      } finally {
        await as(superCookie).put("/api/admin/settings").send(settingsBefore);
      }
    });

    // Per-row amount edit on split must not re-split 70/30 of that share.
    const restored = await as(financeCookie).get(
      `/api/admin/projects/${splitPublicId}`,
    );
    const closerRow = restored.body.commissions.find(
      (c: any) => c.role === "closer",
    );
    const parentRow = restored.body.commissions.find(
      (c: any) => c.role === "parent",
    );
    const closerEdit = await as(financeCookie)
      .patch(`/api/admin/commissions/${closerRow.id}`)
      .send({ amount_cents: closerRow.amount_cents + 1000 });
    expect(closerEdit.status).toBe(200);
    const afterEdit = await as(financeCookie).get(
      `/api/admin/projects/${splitPublicId}`,
    );
    const closerAfter = afterEdit.body.commissions.find(
      (c: any) => c.role === "closer",
    );
    const parentAfter = afterEdit.body.commissions.find(
      (c: any) => c.role === "parent",
    );
    expect(closerAfter.amount_cents).toBe(closerRow.amount_cents + 1000);
    expect(parentAfter.amount_cents).toBe(parentRow.amount_cents);
    expect(afterEdit.body.project.affiliate_commission_cents).toBe(
      closerAfter.amount_cents + parentAfter.amount_cents,
    );

    // Partial pay: pay closer → parent still payable; amount edits locked; paid_at only when both paid.
    const closerId = closerAfter.id;
    const parentIdRow = parentAfter.id;
    expect(
      (
        await as(financeCookie)
          .patch(`/api/admin/commissions/${closerId}`)
          .send({ status: "approved" })
      ).status,
    ).toBe(200);
    expect(
      (
        await as(financeCookie)
          .patch(`/api/admin/commissions/${closerId}`)
          .send({ status: "paid" })
      ).status,
    ).toBe(200);
    const midPay = await as(financeCookie).get(
      `/api/admin/projects/${splitPublicId}`,
    );
    expect(midPay.body.project.commission_paid_at).toBeNull();
    expect(
      (
        await as(financeCookie)
          .patch(`/api/admin/commissions/${parentIdRow}`)
          .send({ amount_cents: 1 })
      ).body.error,
    ).toBe("errors.commissionPaidLocked");
    expect(
      (
        await as(financeCookie)
          .patch(`/api/admin/commissions/${parentIdRow}`)
          .send({ status: "approved" })
      ).status,
    ).toBe(200);
    __testClearEmailDryRuns();
    expect(
      (
        await as(financeCookie)
          .patch(`/api/admin/commissions/${parentIdRow}`)
          .send({ status: "paid" })
      ).status,
    ).toBe(200);
    expect(__testGetEmailDryRuns().some((m) => m.to === em("parent"))).toBe(
      true,
    );
    const allPaid = await as(financeCookie).get(
      `/api/admin/projects/${splitPublicId}`,
    );
    expect(allPaid.body.project.commission_paid_at).toBeTruthy();
  });

  it("contractor draws: budget guard, submit, admin review", async () => {
    // other contractors cannot reach the project
    expect(
      (
        await as(ctrCookie)
          .post("/api/contractor/projects/GW-NOPE1234/draws")
          .send({ amount_cents: 100 })
      ).status,
    ).toBe(404);
    expect(
      (
        await as(ctrCookie)
          .post(`/api/contractor/projects/${publicId}/draws`)
          .send({ amount_cents: -5 })
      ).body.error,
    ).toBe("validation.drawAmount");
    expect(
      (
        await as(ctrCookie)
          .post(`/api/contractor/projects/${publicId}/draws`)
          .send({ amount_cents: 20_000_001 })
      ).body.error,
    ).toBe("errors.drawExceedsBudget");

    __testClearEmailDryRuns();
    const draw = await as(ctrCookie)
      .post(`/api/contractor/projects/${publicId}/draws`)
      .send({ amount_cents: 5_000_000, note: "Foundation" });
    expect(draw.status).toBe(201);
    expect(__testGetEmailDryRuns().length).toBeGreaterThan(0); // staff alert (dry run)

    const draft = await as(ctrCookie)
      .post(`/api/contractor/projects/${publicId}/draws`)
      .send({ amount_cents: 1_000_000, submit: false });
    expect(
      (
        await as(ctrCookie).post(
          `/api/contractor/draws/${draft.body.id}/submit`,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await as(ctrCookie).post(
          `/api/contractor/draws/${draft.body.id}/submit`,
        )
      ).status,
    ).toBe(409);

    const adminList = await as(financeCookie).get(
      "/api/admin/draws?status=submitted",
    );
    expect(adminList.body.draws.some((d: any) => d.id === draw.body.id)).toBe(
      true,
    );
    expect(
      (
        await as(financeCookie)
          .patch(`/api/admin/draws/${draw.body.id}`)
          .send({ status: "paid" })
      ).status,
    ).toBe(409);
    // Temporary: agents (projects.read) may approve draws — not finance-only.
    expect(
      (
        await as(agentCookie)
          .patch(`/api/admin/draws/${draw.body.id}`)
          .send({ status: "approved" })
      ).status,
    ).toBe(200);
    expect(
      (
        await as(financeCookie)
          .patch(`/api/admin/draws/${draw.body.id}`)
          .send({ status: "paid" })
      ).status,
    ).toBe(200);

    // photos must be https URLs on an allow-listed host (Vercel Blob)
    expect(
      (
        await as(ctrCookie)
          .post(`/api/contractor/projects/${publicId}/photos`)
          .send({ storage_url: "javascript:alert(1)" })
      ).body.error,
    ).toBe("validation.photoUrl");
    expect(
      (
        await as(ctrCookie)
          .post(`/api/contractor/projects/${publicId}/photos`)
          .send({ storage_url: "https://example.com/p.jpg" })
      ).body.error,
    ).toBe("validation.photoUrl");
    expect(
      (
        await as(ctrCookie)
          .post(`/api/contractor/projects/${publicId}/photos`)
          .send({
            storage_url: "https://abc123.public.blob.vercel-storage.com/p.jpg",
            caption: "Slab",
          })
      ).status,
    ).toBe(201);
    expect(
      (await as(ctrCookie).get("/api/contractor/photos")).body.photos,
    ).toHaveLength(1);
  });

  it("homeowner only sees their own project without financials", async () => {
    const [[reg]] = (await db.query(`SELECT id FROM clients WHERE email = ?`, [
      em("registered"),
    ])) as any;
    const regCookie = await makeSession("client", reg.id);
    const mine = await as(regCookie).get("/api/client/overview");
    expect(mine.status).toBe(200);
    const proj = mine.body.projects.find((x: any) => x.public_id === publicId);
    expect(proj.plan.name).toBe(planName);
    expect(proj.photos).toHaveLength(1);
    expect(proj.contractor_name).toBe("Cole Builds");
    for (const banned of [
      "sale_price_cents",
      "contractor_cost_cents",
      "affiliate_id",
      "net_profit_cents",
      "loan_lender_name",
    ]) {
      expect(proj).not.toHaveProperty(banned);
    }
    const others = await as(otherClientCookie).get("/api/client/overview");
    expect(
      others.body.projects.find((x: any) => x.public_id === publicId),
    ).toBeUndefined();

    const docs = await as(regCookie).get("/api/client/documents");
    expect(docs.body.documents).toHaveLength(1);
    expect(docs.body.documents[0]).not.toHaveProperty("payload_json");
    expect(
      (await as(otherClientCookie).get("/api/client/documents")).body.documents,
    ).toHaveLength(0);
    // the contractor/affiliate cannot be used on client routes
    expect((await as(ctrCookie).get("/api/client/documents")).status).toBe(401);
    expect(clientId).toBeGreaterThan(0);
    expect(clientCookie).toContain("gw_client_sid");
  });

  it("staff management guards self-demotion and role validation", async () => {
    expect(
      (
        await as(superCookie)
          .patch(`/api/admin/staff/${superId}`)
          .send({ role: "agent" })
      ).body.error,
    ).toBe("errors.cannotDemoteSelf");
    expect(
      (
        await as(superCookie)
          .patch(`/api/admin/staff/${superId}`)
          .send({ status: "inactive" })
      ).body.error,
    ).toBe("errors.cannotDemoteSelf");
    expect(
      (
        await as(superCookie)
          .post("/api/admin/staff")
          .send({
            email: em("newstaff"),
            first_name: "N",
            last_name: "S",
            role: "owner",
          })
      ).status,
    ).toBe(400);
    const created = await as(superCookie)
      .post("/api/admin/staff")
      .send({
        email: em("newstaff"),
        first_name: "New",
        last_name: "Staff",
        role: "finance",
      });
    expect(created.status).toBe(201);
    expect(
      (
        await as(superCookie)
          .post("/api/admin/staff")
          .send({
            email: em("newstaff"),
            first_name: "New",
            last_name: "Staff",
            role: "finance",
          })
      ).status,
    ).toBe(409);
  });

  it("validates settings and unknown ids", async () => {
    expect(
      (
        await as(superCookie)
          .put("/api/admin/settings")
          .send({ commission_payout_days_after_loan_close: -1 })
      ).status,
    ).toBe(400);
    expect(
      (await as(superCookie).get("/api/admin/projects/not_valid!")).status,
    ).toBe(400);
    expect(
      (await as(superCookie).get("/api/admin/projects/GW-ZZZZZZZZ")).status,
    ).toBe(404);
    expect(
      (await as(superCookie).patch("/api/admin/clients/abc").send({})).status,
    ).toBe(400);
    expect(
      (
        await as(superCookie)
          .patch(`/api/admin/projects/${publicId}`)
          .send({ milestone: "nonsense" })
      ).status,
    ).toBe(400);
  });

  it("dashboard returns counts; finance block is role-scoped", async () => {
    const s = await as(superCookie).get("/api/admin/dashboard");
    expect(s.status).toBe(200);
    expect(s.body.finance).toBeDefined();
    const a = await as(agentCookie).get("/api/admin/dashboard");
    expect(a.body.finance).toBeUndefined();
    expect(typeof a.body.leads_new).toBe("number");
  });

  it("projects board returns per-milestone columns and supports load-more + filters", async () => {
    const board = await as(superCookie).get(
      "/api/admin/projects/board?limit=5",
    );
    expect(board.status).toBe(200);
    expect(board.body.ok).toBe(true);
    expect(board.body.columns.lead).toBeDefined();
    expect(board.body.columns.cancelled).toMatchObject({
      items: expect.any(Array),
      total: expect.any(Number),
      has_more: expect.any(Boolean),
    });
    // Our fixture project should appear in some column.
    const allIds = Object.values(
      board.body.columns as Record<string, { items: { public_id: string }[] }>,
    ).flatMap((c) => c.items.map((p) => p.public_id));
    expect(allIds).toContain(publicId);

    const page = await as(superCookie).get(
      `/api/admin/projects/board?milestone=lead&limit=1&offset=0`,
    );
    expect(page.status).toBe(200);
    expect(page.body.milestone).toBe("lead");
    expect(page.body.items.length).toBeLessThanOrEqual(1);
    expect(typeof page.body.has_more).toBe("boolean");

    expect(
      (await as(contentCookie).get("/api/admin/projects/board")).status,
    ).toBe(403);
    expect((await as(affCookie).get("/api/admin/projects/board")).status).toBe(
      401,
    );
  });

  it("GET /api/admin/assignees returns active staff only for people.read", async () => {
    expect((await as(contentCookie).get("/api/admin/assignees")).status).toBe(
      403,
    );

    const inactiveId = await insertId(
      `INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Idle', 'Staff', 'agent', 'inactive')`,
      [em("inactive-staff")],
    );

    const res = await as(agentCookie).get("/api/admin/assignees");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.assignees)).toBe(true);
    expect(res.body.assignees.length).toBeGreaterThan(0);
    for (const a of res.body.assignees) {
      expect(a).toEqual(
        expect.objectContaining({
          id: expect.any(Number),
          email: expect.any(String),
          role: expect.any(String),
        }),
      );
    }
    expect(
      res.body.assignees.some(
        (a: { email: string }) => a.email === em("agent"),
      ),
    ).toBe(true);
    expect(
      res.body.assignees.some((a: { id: number }) => a.id === inactiveId),
    ).toBe(false);
  });

  it("rejects inactive affiliate assignment on client and project", async () => {
    const inactiveAff = await insertId(
      `INSERT INTO affiliates (email, first_name, last_name, status, referral_code) VALUES (?, 'Ina', 'Active', 'inactive', ?)`,
      [em("inactive-aff"), crypto.randomBytes(4).toString("hex").toUpperCase()],
    );

    const create = await as(agentCookie)
      .post("/api/admin/clients")
      .send({
        email: em("aff-inactive-client"),
        first_name: "No",
        last_name: "Affiliate",
        affiliate_id: inactiveAff,
      });
    expect(create.status).toBe(400);
    expect(create.body.error).toBe("errors.affiliateInactive");

    const patchClient = await as(agentCookie)
      .patch(`/api/admin/clients/${clientId}`)
      .send({ affiliate_id: inactiveAff });
    expect(patchClient.status).toBe(400);
    expect(patchClient.body.error).toBe("errors.affiliateInactive");

    // Separate unlocked project (publicId may already be loan-finalized / locked)
    const unlockedClient = await insertId(
      `INSERT INTO clients (email, first_name, last_name, status) VALUES (?, 'Una', 'Locked', 'prospect')`,
      [em("unlocked-client")],
    );
    const unlocked = await as(superCookie)
      .post("/api/admin/projects")
      .send({ client_id: unlockedClient, adu_plan_id: planId });
    expect(unlocked.status).toBe(201);
    const patchProject = await as(superCookie)
      .patch(`/api/admin/projects/${unlocked.body.project_public_id}`)
      .send({ affiliate_id: inactiveAff });
    expect(patchProject.status).toBe(400);
    expect(patchProject.body.error).toBe("errors.affiliateInactive");
  });

  it("paginates people list (clients) with total/limit/offset", async () => {
    // Ensure at least two fixture clients exist for a second page
    await insertId(
      `INSERT INTO clients (email, first_name, last_name, status) VALUES (?, 'Page', 'Two', 'prospect')`,
      [em("page-two")],
    );
    const q = encodeURIComponent(prefix);
    const page0 = await as(financeCookie).get(
      `/api/admin/clients?q=${q}&limit=1&offset=0`,
    );
    expect(page0.status).toBe(200);
    expect(page0.body.limit).toBe(1);
    expect(page0.body.offset).toBe(0);
    expect(typeof page0.body.total).toBe("number");
    expect(page0.body.total).toBeGreaterThanOrEqual(2);
    expect(page0.body.clients).toHaveLength(1);

    const page1 = await as(financeCookie).get(
      `/api/admin/clients?q=${q}&limit=1&offset=1`,
    );
    expect(page1.status).toBe(200);
    expect(page1.body.limit).toBe(1);
    expect(page1.body.offset).toBe(1);
    expect(page1.body.total).toBe(page0.body.total);
    expect(page1.body.clients).toHaveLength(1);
    expect(page1.body.clients[0].id).not.toBe(page0.body.clients[0].id);
  });

  it("CRUD notify extra emails for settings-capable admin", async () => {
    expect((await as(agentCookie).get("/api/admin/settings")).status).toBe(403);

    const before = await as(financeCookie).get("/api/admin/settings");
    expect(before.status).toBe(200);
    expect(Array.isArray(before.body.notify_extra_emails)).toBe(true);

    const email = em("notify-extra");
    const created = await as(financeCookie)
      .post("/api/admin/settings/notify-extras")
      .send({ email, label: "Ops pager", events: ["client_created"] });
    expect(created.status).toBe(201);
    expect(created.body.id).toBeGreaterThan(0);
    const extraId = Number(created.body.id);

    const listed = await as(superCookie).get("/api/admin/settings");
    expect(
      listed.body.notify_extra_emails.some(
        (r: { id: number; email: string }) =>
          r.id === extraId && r.email === email,
      ),
    ).toBe(true);

    const listedRow = listed.body.notify_extra_emails.find(
      (r: { id: number }) => r.id === extraId,
    );
    expect(listedRow.events).toEqual(["client_created"]);
    expect(Array.isArray(listed.body.notify_event_keys)).toBe(true);
    expect(listed.body.notify_event_keys).toContain("inbound_sms");

    const eventsPatch = await as(financeCookie)
      .patch(`/api/admin/settings/notify-extras/${extraId}`)
      .send({ events: ["draw_submitted", "milestone_changed"] });
    expect(eventsPatch.status).toBe(200);
    const afterEvents = (
      await as(financeCookie).get("/api/admin/settings")
    ).body.notify_extra_emails.find((r: { id: number }) => r.id === extraId);
    expect(afterEvents.events).toEqual(
      expect.arrayContaining(["draw_submitted", "milestone_changed"]),
    );
    expect(afterEvents.events).toHaveLength(2);

    const allEvents = await as(financeCookie)
      .patch(`/api/admin/settings/notify-extras/${extraId}`)
      .send({ events: null });
    expect(allEvents.status).toBe(200);
    const afterAll = (
      await as(financeCookie).get("/api/admin/settings")
    ).body.notify_extra_emails.find((r: { id: number }) => r.id === extraId);
    expect(afterAll.events).toBeNull();

    const toggled = await as(financeCookie)
      .patch(`/api/admin/settings/notify-extras/${extraId}`)
      .send({ is_active: false });
    expect(toggled.status).toBe(200);
    const afterToggle = (
      await as(financeCookie).get("/api/admin/settings")
    ).body.notify_extra_emails.find((r: { id: number }) => r.id === extraId);
    expect(afterToggle.is_active).toBe(false);

    const removed = await as(financeCookie).delete(
      `/api/admin/settings/notify-extras/${extraId}`,
    );
    expect(removed.status).toBe(200);
    expect(
      (
        await as(financeCookie).get("/api/admin/settings")
      ).body.notify_extra_emails.some((r: { id: number }) => r.id === extraId),
    ).toBe(false);
  });

  it("lists team notify recipients and updates staff prefs", async () => {
    expect(
      (await as(agentCookie).get("/api/admin/notify-recipients")).status,
    ).toBe(403);

    const recipients = await as(financeCookie).get(
      "/api/admin/notify-recipients",
    );
    expect(recipients.status).toBe(200);
    expect(Array.isArray(recipients.body.staff)).toBe(true);
    expect(Array.isArray(recipients.body.extras)).toBe(true);
    expect(recipients.body.events).toContain("lead_submitted");
    expect(recipients.body.staff.length).toBeGreaterThan(0);

    const target = recipients.body.staff.find(
      (s: { email: string }) => typeof s.email === "string",
    );
    expect(target?.id).toBeGreaterThan(0);
    expect(target.prefs.email.lead_submitted).toBe(true);
    expect(target.channels.email.available).toBe(true);

    const off = await as(financeCookie)
      .put(`/api/admin/admins/${target.id}/notification-prefs`)
      .send({ email: { lead_submitted: false } });
    expect(off.status).toBe(200);
    expect(off.body.staff.prefs.email.lead_submitted).toBe(false);

    const masterOff = await as(financeCookie)
      .put(`/api/admin/admins/${target.id}/notification-prefs`)
      .send({ channel_masters: { email: false } });
    expect(masterOff.status).toBe(200);
    expect(masterOff.body.staff.prefs.email.client_created).toBe(false);

    // Restore defaults for other tests
    const restore = await as(financeCookie)
      .put(`/api/admin/admins/${target.id}/notification-prefs`)
      .send({ channel_masters: { email: true, in_app: true } });
    expect(restore.status).toBe(200);
    expect(restore.body.staff.prefs.email.lead_submitted).toBe(true);

    const badEvents = await as(financeCookie)
      .post("/api/admin/settings/notify-extras")
      .send({ email: em("bad-events"), events: "not-an-array" });
    expect(badEvents.status).toBe(400);

    const defaultExtra = await as(financeCookie)
      .post("/api/admin/settings/notify-extras")
      .send({ email: em("default-extra"), label: "Ops" });
    expect(defaultExtra.status).toBe(201);
    const defaultId = Number(defaultExtra.body.id);
    const defaultRow = (
      await as(financeCookie).get("/api/admin/notify-recipients")
    ).body.extras.find((r: { id: number }) => r.id === defaultId);
    expect(Array.isArray(defaultRow.events)).toBe(true);
    expect(defaultRow.events).not.toContain("inbound_sms");
    expect(defaultRow.events).toContain("client_created");
    await as(financeCookie).delete(
      `/api/admin/settings/notify-extras/${defaultId}`,
    );
  });

  it("skips staff email when notification prefs mute the event", async () => {
    const financeEmail = em("finance");
    await as(financeCookie)
      .put(`/api/admin/admins/${financeId}/notification-prefs`)
      .send({ email: { affiliate_signup: false } });

    __testClearEmailDryRuns();
    const body = {
      first_name: "Muted",
      last_name: "Prefs",
      email: em("muted-aff"),
      phone: ph("9999"),
      company: "Mute Co",
      preferred_language: "en",
    };
    const res = await request(app)
      .post("/api/public/affiliate/signup")
      .send(body);
    expect(res.status).toBe(201);
    const sent = __testGetEmailDryRuns();
    expect(sent.some((m) => m.to === financeEmail)).toBe(false);
    expect(sent.some((m) => m.to === em("super"))).toBe(true);

    // Restore
    await as(financeCookie)
      .put(`/api/admin/admins/${financeId}/notification-prefs`)
      .send({ email: { affiliate_signup: true } });
  });

  it("self-service prefs, in-app inbox, and team SMS fan-out", async () => {
    const mePrefs = await as(financeCookie).get(
      "/api/admin/me/notification-prefs",
    );
    expect(mePrefs.status).toBe(200);
    expect(mePrefs.body.prefs.email.lead_submitted).toBe(true);
    expect(mePrefs.body.channels.email.available).toBe(true);
    expect(Array.isArray(mePrefs.body.events)).toBe(true);

    const muteInApp = await as(financeCookie)
      .put("/api/admin/me/notification-prefs")
      .send({ in_app: { affiliate_signup: false } });
    expect(muteInApp.status).toBe(200);
    expect(muteInApp.body.prefs.in_app.affiliate_signup).toBe(false);

    await db.execute(`DELETE FROM admin_notifications WHERE admin_id = ?`, [
      financeId,
    ]);

    __testClearEmailDryRuns();
    const mutedBody = {
      first_name: "InApp",
      last_name: "Mute",
      email: em("inapp-mute-aff"),
      phone: ph("8888"),
      company: "InApp Mute Co",
      preferred_language: "en",
    };
    expect(
      (await request(app).post("/api/public/affiliate/signup").send(mutedBody))
        .status,
    ).toBe(201);

    const mutedInbox = await as(financeCookie).get(
      "/api/admin/me/notifications?limit=10",
    );
    expect(mutedInbox.status).toBe(200);
    expect(
      mutedInbox.body.notifications.some(
        (n: { event_key: string }) => n.event_key === "affiliate_signup",
      ),
    ).toBe(false);

    await as(financeCookie)
      .put("/api/admin/me/notification-prefs")
      .send({ in_app: { affiliate_signup: true } });

    // Clear again — parallel suites may have fan-out notifyStaff to this admin.
    await db.execute(`DELETE FROM admin_notifications WHERE admin_id = ?`, [
      financeId,
    ]);

    __testClearEmailDryRuns();
    const openBody = {
      first_name: "InApp",
      last_name: "Open",
      email: em("inapp-open-aff"),
      phone: `949${String(Date.now()).slice(-7)}`,
      company: "InApp Open Co",
      preferred_language: "en",
    };
    expect(
      (await request(app).post("/api/public/affiliate/signup").send(openBody))
        .status,
    ).toBe(201);

    const inbox = await as(financeCookie).get("/api/admin/me/notifications");
    expect(inbox.status).toBe(200);
    const hit = inbox.body.notifications.find(
      (n: { event_key: string; read_at: string | null }) =>
        n.event_key === "affiliate_signup" && n.read_at == null,
    );
    expect(hit?.id).toBeGreaterThan(0);
    expect(inbox.body.unread_count).toBeGreaterThan(0);

    const marked = await as(financeCookie)
      .post("/api/admin/me/notifications/read")
      .send({ ids: [hit.id] });
    expect(marked.status).toBe(200);
    const after = await as(financeCookie).get("/api/admin/me/notifications");
    const hitAfter = after.body.notifications.find(
      (n: { id: number }) => n.id === hit.id,
    );
    // Assert the row was marked read (unread_count can race when parallel suites
    // notifyStaff fan-out to this admin between GET and POST /read).
    expect(hitAfter?.read_at).toBeTruthy();
    expect(marked.body.unread_count).toBeLessThanOrEqual(
      inbox.body.unread_count,
    );

    // SMS fan-out: personal phone + assigned brand From
    const ofgE164 = `+1555${String(Date.now()).slice(-7)}`;
    const personalPhone = "+15559876099";
    await db.execute(`UPDATE admins SET phone = ? WHERE id = ?`, [
      personalPhone,
      financeId,
    ]);
    const phoneNumberId = await insertId(
      `INSERT INTO admin_phone_numbers
         (e164, friendly_name, assigned_admin_id, is_active, capabilities_json)
       VALUES (?, 'Vitest Notify SMS', ?, 1, JSON_OBJECT('sms', TRUE, 'voice', TRUE))`,
      [ofgE164, financeId],
    );

    try {
      const smsMeta = await as(financeCookie).get(
        "/api/admin/me/notification-prefs",
      );
      expect(smsMeta.body.channels.sms.available).toBe(true);

      await as(financeCookie)
        .put("/api/admin/me/notification-prefs")
        .send({
          channel_masters: { sms: true },
          email: { affiliate_signup: false },
          in_app: { affiliate_signup: false },
        });

      __testClearSmsDryRuns();
      const smsBody = {
        first_name: "Sms",
        last_name: "Fanout",
        email: em("sms-fanout-aff"),
        phone: ph("6666"),
        company: "SMS Fanout Co",
        preferred_language: "en",
      };
      expect(
        (await request(app).post("/api/public/affiliate/signup").send(smsBody))
          .status,
      ).toBe(201);
      const smsSent = __testGetSmsDryRuns();
      expect(
        smsSent.some(
          (m) =>
            m.from === ofgE164 &&
            (m.to.includes("5559876099") || m.to.includes(personalPhone)),
        ),
      ).toBe(true);
    } finally {
      await as(financeCookie)
        .put("/api/admin/me/notification-prefs")
        .send({
          channel_masters: { email: true, in_app: true, sms: true },
        });
      await db
        .execute(`DELETE FROM admin_phone_numbers WHERE id = ?`, [
          phoneNumberId,
        ])
        .catch(() => {});
      await db
        .execute(`UPDATE admins SET phone = NULL WHERE id = ?`, [financeId])
        .catch(() => {});
      await db
        .execute(`DELETE FROM admin_notifications WHERE admin_id = ?`, [
          financeId,
        ])
        .catch(() => {});
    }
  });
});
