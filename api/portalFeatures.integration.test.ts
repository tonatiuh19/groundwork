// Split in 3 files so they run in parallel: this one (auth, sign-ups, referrals), portalFeatures.money.* (projects, commissions, draws), portalFeatures.admin.* (staff, settings, notifications). Each has its own fixture prefix.
import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
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
  __testSetNotifyRouting,
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

/** Agreement Section 2: payouts need a signed agreement + W-9 on file + an active plan (card on file). */
async function markOnboarded(affiliateId: number): Promise<void> {
  await db.execute(`UPDATE affiliates SET billing_status = 'trialing' WHERE id = ?`, [affiliateId]);
  await db.execute(
    `INSERT INTO affiliate_agreements
       (affiliate_id, template_version, lang, legal_name, address, email, subscription_price_cents, body_sha256, signature_image)
     VALUES (?, 1, 'en', 'Test Affiliate', '1 Test Way, Irvine, CA', 'fixture@example.com', 0, REPEAT('a', 64), 'data:image/png;base64,AA==')`,
    [affiliateId],
  );
  await db.execute(
    `INSERT INTO affiliate_w9s
       (affiliate_id, legal_name, tax_classification, tin_type, tin_last4, address, city_state_zip, pdf_blob_pathname)
     VALUES (?, 'Test Affiliate', 'individual', 'ssn', '0000', '1 Test Way', 'Irvine, CA 92618', 'affiliates/test/w9.pdf')`,
    [affiliateId],
  );
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
      parent_shared_cents_per_sqft: 150,
      grandparent_cents_per_sqft: 150,
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

  it("two-level plan matches Affiliate Agreement Section 5 (830 sq ft model)", () => {
    const rates = {
      direct_cents_per_sqft: 1000,
      closer_cents_per_sqft: 700,
      parent_cents_per_sqft: 300,
      parent_shared_cents_per_sqft: 150,
      grandparent_cents_per_sqft: 150,
    };
    const base = { override_cents: null, sq_ft: 830, rates };
    // A: no sponsor → $8,300
    expect(resolveAffiliateCommissionSplit({ ...base, has_parent: false, parent_active: false })).toMatchObject({
      total_cents: 830000, closer_cents: 830000, grandparent_cents: 0,
    });
    // B: sponsor only → $5,810 + $2,490
    expect(resolveAffiliateCommissionSplit({ ...base, has_parent: true, parent_active: true })).toMatchObject({
      closer_cents: 581000, parent_cents: 249000, grandparent_cents: 0, total_cents: 830000,
    });
    // C: sponsor + senior → $5,810 + $1,245 + $1,245
    expect(
      resolveAffiliateCommissionSplit({ ...base, has_parent: true, parent_active: true, has_grandparent: true, grandparent_active: true }),
    ).toMatchObject({ closer_cents: 581000, parent_cents: 124500, grandparent_cents: 124500, total_cents: 830000 });
    // Section 13: an ended senior's share is not passed to anyone else.
    expect(
      resolveAffiliateCommissionSplit({ ...base, has_parent: true, parent_active: true, has_grandparent: true, grandparent_active: false }),
    ).toMatchObject({ closer_cents: 581000, parent_cents: 124500, grandparent_cents: 0, total_cents: 705500 });
    // 445 sq ft: Senior Sponsor $667.50
    expect(
      resolveAffiliateCommissionSplit({ ...base, sq_ft: 445, has_parent: true, parent_active: true, has_grandparent: true, grandparent_active: true }).grandparent_cents,
    ).toBe(66750);
    // Override splits proportionally across three and sums exactly.
    const ov = resolveAffiliateCommissionSplit({
      ...base, override_cents: 100001, has_parent: true, parent_active: true, has_grandparent: true, grandparent_active: true,
    });
    expect(ov.closer_cents + ov.parent_cents + ov.grandparent_cents).toBe(100001);
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
    // Tests read fixed settings (TEST_SETTING_DEFAULTS in api/index.ts), never the live ones.
    directRate = 1000;
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
    // Welcome (ES): presentation + secure onboarding link, sent right away while pending.
    const welcome = sent.find((m) => m.to === body.email && /bienvenido/i.test(m.subject));
    expect(welcome).toBeTruthy();
    expect(String(welcome!.html)).toMatch(/\/affiliate\/welcome\/[a-f0-9]{64}/);
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

    // Link names are staff-only: affiliates can't rename themselves from their profile.
    const before = await as(affCookie).get("/api/affiliate/me");
    const mePatch = await as(affCookie)
      .patch("/api/affiliate/me")
      .send({ slug: "Ada Affiliate Link" });
    expect(mePatch.status).toBe(403);
    expect(mePatch.body.error).toBe("errors.slugStaffOnly");
    const unchanged = await as(affCookie).get("/api/affiliate/me");
    expect(unchanged.body.profile.slug).toBe(before.body.profile.slug);
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

});
