import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  __test,
  __testClearEmailDryRuns,
  __testGetEmailDryRuns,
  addDaysIso,
  computeProjectEconomics,
  createServer,
  resolveCommissionCents,
} from "./index";
import {
  cleanupPortalFixturesByPrefix,
  createIntegrationTestPool,
} from "./testDbCleanup";
import { ADMIN_PERMS } from "../shared/api";

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
    ).toEqual({ net_profit_cents: 9_000_000, net_profit_per_sqft_cents: 16364 });
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

  it("resolves commission: override > plan default > sqft x rate", () => {
    expect(
      resolveCommissionCents({ override_cents: 1, plan_default_cents: 550000, sq_ft: 550, rate_cents_per_sqft: 1000 }),
    ).toBe(1);
    expect(
      resolveCommissionCents({ override_cents: null, plan_default_cents: 550000, sq_ft: 550, rate_cents_per_sqft: 1000 }),
    ).toBe(550000);
    expect(
      resolveCommissionCents({ override_cents: null, plan_default_cents: null, sq_ft: 600, rate_cents_per_sqft: 1000 }),
    ).toBe(600000);
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
    const financeId = await mkAdmin("finance", "finance");
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
      `SELECT id FROM adu_plans WHERE code = 'fontana-1br' LIMIT 1`,
    );
    planId = Number((plans as { id: number }[])[0].id);
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
    expect((await as(affCookie).get("/api/contractor/projects")).status).toBe(401);
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
    expect((await as(agentCookie).get("/api/admin/commissions")).status).toBe(403);
    expect((await as(financeCookie).get("/api/admin/leads")).status).toBe(403);
    expect((await as(contentCookie).get("/api/admin/projects")).status).toBe(403);
    // content may edit plans; agent may not — use a no-op sort_order toggle restored after
    const [before] = await db.query(
      `SELECT sort_order FROM adu_plans WHERE id = ? LIMIT 1`,
      [planId],
    );
    const prevSort = Number((before as { sort_order: number }[])[0].sort_order);
    const nextSort = prevSort === 1 ? 2 : 1;
    expect(
      (await as(contentCookie).patch(`/api/admin/plans/${planId}`).send({ sort_order: nextSort }))
        .status,
    ).not.toBe(403);
    expect(
      (await as(agentCookie).patch(`/api/admin/plans/${planId}`).send({ sort_order: nextSort }))
        .status,
    ).toBe(403);
    await db.execute(`UPDATE adu_plans SET sort_order = ? WHERE id = ?`, [prevSort, planId]);
    expect((await as(agentCookie).get("/api/admin/settings")).status).toBe(403);
    expect((await as(financeCookie).get("/api/admin/settings")).status).toBe(200);
    // approvals = super_admin/admin only
    expect(
      (await as(agentCookie).patch(`/api/admin/affiliates/${affId}`).send({ notes: "n" })).status,
    ).toBe(403);
  });

  it("affiliate signup → pending → admin approval → OTP allowed", async () => {
    __testClearEmailDryRuns();
    const body = {
      first_name: "Pat",
      last_name: "Pending",
      email: em("pending"),
      phone: "9495551234",
      company: "Realty Co",
      preferred_language: "es",
    };
    const res = await request(app).post("/api/public/affiliate/signup").send(body);
    expect(res.status).toBe(201);
    const sent = __testGetEmailDryRuns();
    expect(sent.some((m) => m.to === body.email && /recibida/i.test(m.subject))).toBe(true);
    expect(sent.length).toBeGreaterThan(1); // + staff alerts

    expect((await request(app).post("/api/public/affiliate/signup").send(body)).status).toBe(409);
    expect(
      (await request(app).post("/api/public/affiliate/signup").send({ ...body, email: "nope" })).status,
    ).toBe(400);

    // Pending: 403 with legend key (login form stays on email step).
    __testClearEmailDryRuns();
    const otp = await request(app)
      .post("/api/affiliate/auth/otp/request")
      .send({ email: body.email });
    expect(otp.status).toBe(403);
    expect(otp.body.error).toBe("errors.authPending");
    expect(__testGetEmailDryRuns().filter((m) => m.to === body.email)).toHaveLength(0);
    const pendingVerify = await request(app)
      .post("/api/affiliate/auth/otp/verify")
      .send({ email: body.email, code: "123456" });
    expect(pendingVerify.status).toBe(401);
    expect(pendingVerify.body.error).toBe("errors.authInvalid");

    const list = await as(superCookie).get("/api/admin/affiliates");
    const row = list.body.affiliates.find((a: any) => a.email === body.email);
    expect(row.status).toBe("pending");
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
  });

  it("tracks referral clicks and attributes leads", async () => {
    const card = await request(app).get(`/api/public/affiliates/by-code/${affCode}`);
    expect(card.status).toBe(200);
    expect(card.body.affiliate.referral_code).toBe(affCode);
    expect(card.body.affiliate.initials).toBeTruthy();
    const unknown = await request(app).get("/api/public/affiliates/by-code/NOPE1234");
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe("errors.referralInactive");

    const redirect = await request(app).get(`/api/public/r/${affCode}?to=partners`);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.location).toBe(`/partners?ref=${affCode}`);
    const expiredHome = await request(app).get("/api/public/r/NOPE1234");
    expect(expiredHome.headers.location).toBe("/r/expired");

    const lead = await request(app)
      .post("/api/public/leads")
      .send({
        full_name: "Lee Lead",
        email: em("lead"),
        phone: "9495550000",
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
    const convert = await as(superCookie)
      .post(`/api/admin/leads/${lead.body.lead_id}/convert`)
      .send({ adu_plan_id: planId });
    expect(convert.status).toBe(201);
    expect((await as(superCookie).post(`/api/admin/leads/${lead.body.lead_id}/convert`).send({})).status).toBe(409);
    const detail = await as(superCookie).get(`/api/admin/projects/${convert.body.project_public_id}`);
    expect(detail.body.project.affiliate_id).toBe(affId);
  });

  it("affiliate registers a client with consent; list hides loan detail", async () => {
    const payload = {
      first_name: "Rita",
      last_name: "Registered",
      email: em("registered"),
      phone: "9495551111",
      property_address: "22 Builder Ave, Fontana",
      adu_plan_id: planId,
    };
    expect((await as(affCookie).post("/api/affiliate/clients").send(payload)).status).toBe(400);
    __testClearEmailDryRuns();
    const ok = await as(affCookie)
      .post("/api/affiliate/clients")
      .send({ ...payload, homeowner_consent: true });
    expect(ok.status).toBe(201);
    publicId = ok.body.project_public_id;
    expect(ok.body.invite_sent).toBe(true);
    const inviteMail = __testGetEmailDryRuns().find((m) => m.to === em("registered"));
    expect(inviteMail).toBeTruthy();
    expect(inviteMail!.html).toMatch(/client\/invite\/[a-f0-9]{64}/);
    expect(
      (await as(affCookie).post("/api/affiliate/clients").send({ ...payload, homeowner_consent: true })).status,
    ).toBe(409);

    const list = await as(affCookie).get("/api/affiliate/clients");
    const row = list.body.clients.find((c: any) => c.public_id === publicId);
    expect(row.milestone).toBe("lead");
    expect(row.sq_ft).toBe(550);
    for (const banned of ["loan_status", "loan_lender_name", "sale_price_cents", "net_profit_cents", "contractor_cost_cents"]) {
      expect(row).not.toHaveProperty(banned);
    }
  });

  it("public enroll creates client+project and magic link activates prospect", async () => {
    __testClearEmailDryRuns();
    const email = em("enroll");
    const bad = await request(app).post("/api/public/enroll").send({
      first_name: "Nora",
      last_name: "New",
      email,
      phone: "9495552222",
      property_address: "9 Enroll Way",
      soft_pull_consent: false,
      referral_code: affCode,
    });
    expect(bad.status).toBe(400);

    const ok = await request(app).post("/api/public/enroll").send({
      first_name: "Nora",
      last_name: "New",
      email,
      phone: "9495552222",
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

    const [[client]] = (await db.query(
      `SELECT id, status, affiliate_id FROM clients WHERE email = ? LIMIT 1`,
      [email],
    )) as any;
    expect(client.status).toBe("prospect");
    expect(Number(client.affiliate_id)).toBe(affId);

    const mail = __testGetEmailDryRuns().find((m) => m.to === email);
    expect(mail).toBeTruthy();
    const token = /client\/invite\/([a-f0-9]{64})/.exec(mail!.html)![1];
    expect((await request(app).get(`/api/public/client-invite/${token}`)).body.email).toBe(email);

    const accept = await request(app)
      .post("/api/public/client-invite/accept")
      .send({ token });
    expect(accept.status).toBe(200);
    expect(accept.body.actor).toBe("client");
    expect(accept.body.user.status).toBe("active");
    expect(String(accept.headers["set-cookie"] || "")).toMatch(/gw_client_sid=/);
    expect((await request(app).post("/api/public/client-invite/accept").send({ token })).status).toBe(404);

    const [[after]] = (await db.query(
      `SELECT status, email_verified_at FROM clients WHERE id = ?`,
      [client.id],
    )) as any;
    expect(after.status).toBe("active");
    expect(after.email_verified_at).toBeTruthy();
  });

  it("contractor invite → accept → activate", async () => {
    __testClearEmailDryRuns();
    const invite = await as(superCookie)
      .post("/api/admin/contractors/invite")
      .send({ email: em("invited"), first_name: "Ivy", last_name: "Invited", company: "Ivy Co" });
    expect(invite.status).toBe(201);
    const mail = __testGetEmailDryRuns().find((m) => m.to === em("invited"));
    const token = /contractor\/invite\/([a-f0-9]{64})/.exec(mail!.html)![1];

    const preOtp = await request(app)
      .post("/api/contractor/auth/otp/request")
      .send({ email: em("invited") });
    expect(preOtp.status).toBe(403);
    expect(preOtp.body.error).toBe("errors.authInvited");

    expect((await request(app).get(`/api/public/contractor-invite/${"0".repeat(64)}`)).status).toBe(404);
    expect((await request(app).get(`/api/public/contractor-invite/${token}`)).body.email).toBe(em("invited"));
    expect((await request(app).post("/api/public/contractor-invite/accept").send({ token })).status).toBe(200);
    expect((await request(app).post("/api/public/contractor-invite/accept").send({ token })).status).toBe(404);
    expect(
      (await request(app).post("/api/contractor/auth/otp/request").send({ email: em("invited") })).status,
    ).toBe(200);
    expect(
      (await as(superCookie).post("/api/admin/contractors/invite").send({ email: em("ctr"), first_name: "C", last_name: "B" })).status,
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
    await db.execute(`UPDATE contractors SET status = 'suspended' WHERE id = ?`, [otherCtr.id]);
    expect(
      (await as(superCookie).patch(`/api/admin/projects/${publicId}`).send({ contractor_id: otherCtr.id })).body.error,
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
    expect(p.affiliate_commission_cents).toBe(550_000); // plan default, 550 sq ft × $10
    expect(p.net_profit_cents).toBe(30_000_000 - 20_000_000 - 550_000 - 450_000);
    expect(p.net_profit_per_sqft_cents).toBe(Math.round(p.net_profit_cents / 550));
    expect(assigned.body.events.map((e: any) => e.to_milestone)).toEqual(["lead", "contracted"]);

    // agent sees the project without financial columns
    const agentView = await as(agentCookie).get(`/api/admin/projects/${publicId}`);
    expect(agentView.status).toBe(200);
    expect(agentView.body.project).not.toHaveProperty("sale_price_cents");
    expect(agentView.body.commission).toBeNull();
    const financeView = await as(financeCookie).get(`/api/admin/projects/${publicId}`);
    expect(financeView.body.project.sale_price_cents).toBe(30_000_000);

    // contractor sees the project (budget only), never sale price / affiliate
    const cProjects = await as(ctrCookie).get("/api/contractor/projects");
    const cRow = cProjects.body.projects.find((x: any) => x.public_id === publicId);
    expect(cRow.budget_cents).toBe(20_000_000);
    expect(cRow).not.toHaveProperty("sale_price_cents");
    expect(cRow).not.toHaveProperty("affiliate_commission_cents");

    // contract stub
    const contract = await as(superCookie).post(`/api/admin/projects/${publicId}/contracts`).send({});
    expect(contract.status).toBe(201);
    const ctrDetail = await as(ctrCookie).get(`/api/contractor/projects/${publicId}`);
    expect(ctrDetail.body.contracts).toHaveLength(1);
    expect(ctrDetail.body.contracts[0]).not.toHaveProperty("payload_json");

    // loan finalize → commission row with expected pay date (5 days by default)
    const fin = await as(superCookie)
      .patch(`/api/admin/projects/${publicId}`)
      .send({ loan_status: "finalized", loan_lender_type: "external", loan_lender_name: "ABC Mortgage" });
    expect(fin.status).toBe(200);
    expect(fin.body.commission.status).toBe("pending");
    expect(fin.body.commission.amount_cents).toBe(550_000);
    const days = await (async () => {
      const [rows] = await db.query(
        `SELECT setting_value FROM system_settings WHERE setting_key = 'commission_payout_days_after_loan_close'`,
      );
      return Number((rows as any[])[0].setting_value);
    })();
    expect(String(fin.body.commission.expected_pay_at).slice(0, 10)).toBe(addDaysIso(new Date(), days));
    // affiliate cannot be swapped once finalized
    expect(
      (await as(superCookie).patch(`/api/admin/projects/${publicId}`).send({ affiliate_id: null })).body.error,
    ).toBe("errors.projectLocked");

    // affiliate sees commission; client view hides financials
    const myComm = await as(affCookie).get("/api/affiliate/commissions");
    expect(myComm.body.commissions.find((c: any) => c.project_public_id === publicId).amount_cents).toBe(550_000);
    const finalized = await as(affCookie).get("/api/affiliate/clients");
    expect(finalized.body.clients.find((c: any) => c.public_id === publicId).commission_status).toBe("pending");

    // un-finalize voids the pending commission
    const undo = await as(superCookie).patch(`/api/admin/projects/${publicId}`).send({ loan_status: "underwriting" });
    expect(undo.body.commission.status).toBe("void");
    await as(superCookie).patch(`/api/admin/projects/${publicId}`).send({ loan_status: "finalized" });

    // commission lifecycle: pending → approved → paid (+ email), paid is immutable
    const commission = (await as(financeCookie).get("/api/admin/commissions")).body.commissions.find(
      (c: any) => c.project_public_id === publicId,
    );
    expect(commission.status).toBe("pending");
    expect((await as(financeCookie).patch(`/api/admin/commissions/${commission.id}`).send({ status: "paid" })).status).toBe(409);
    expect((await as(financeCookie).patch(`/api/admin/commissions/${commission.id}`).send({ status: "approved" })).status).toBe(200);
    __testClearEmailDryRuns();
    expect((await as(financeCookie).patch(`/api/admin/commissions/${commission.id}`).send({ status: "paid" })).status).toBe(200);
    expect(__testGetEmailDryRuns().some((m) => m.to === em("aff"))).toBe(true);
    expect((await as(financeCookie).patch(`/api/admin/commissions/${commission.id}`).send({ status: "void" })).status).toBe(409);
    // After payout, commission math inputs are frozen (super_admin has projects.write)
    expect(
      (await as(superCookie).patch(`/api/admin/projects/${publicId}`).send({ commission_override_cents: 1 })).body.error,
    ).toBe("errors.commissionPaidLocked");
    expect(
      (await as(superCookie).patch(`/api/admin/projects/${publicId}`).send({ sq_ft: 100 })).body.error,
    ).toBe("errors.commissionPaidLocked");
  });

  it("contractor draws: budget guard, submit, admin review", async () => {
    // other contractors cannot reach the project
    expect((await as(ctrCookie).post("/api/contractor/projects/GW-NOPE1234/draws").send({ amount_cents: 100 })).status).toBe(404);
    expect((await as(ctrCookie).post(`/api/contractor/projects/${publicId}/draws`).send({ amount_cents: -5 })).body.error).toBe("validation.drawAmount");
    expect(
      (await as(ctrCookie).post(`/api/contractor/projects/${publicId}/draws`).send({ amount_cents: 20_000_001 })).body.error,
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
    expect((await as(ctrCookie).post(`/api/contractor/draws/${draft.body.id}/submit`)).status).toBe(200);
    expect((await as(ctrCookie).post(`/api/contractor/draws/${draft.body.id}/submit`)).status).toBe(409);

    const adminList = await as(financeCookie).get("/api/admin/draws?status=submitted");
    expect(adminList.body.draws.some((d: any) => d.id === draw.body.id)).toBe(true);
    expect((await as(financeCookie).patch(`/api/admin/draws/${draw.body.id}`).send({ status: "paid" })).status).toBe(409);
    // Temporary: agents (projects.read) may approve draws — not finance-only.
    expect((await as(agentCookie).patch(`/api/admin/draws/${draw.body.id}`).send({ status: "approved" })).status).toBe(200);
    expect((await as(financeCookie).patch(`/api/admin/draws/${draw.body.id}`).send({ status: "paid" })).status).toBe(200);

    // photos must be https URLs on an allow-listed host (Vercel Blob)
    expect((await as(ctrCookie).post(`/api/contractor/projects/${publicId}/photos`).send({ storage_url: "javascript:alert(1)" })).body.error).toBe("validation.photoUrl");
    expect((await as(ctrCookie).post(`/api/contractor/projects/${publicId}/photos`).send({ storage_url: "https://example.com/p.jpg" })).body.error).toBe("validation.photoUrl");
    expect((await as(ctrCookie).post(`/api/contractor/projects/${publicId}/photos`).send({ storage_url: "https://abc123.public.blob.vercel-storage.com/p.jpg", caption: "Slab" })).status).toBe(201);
    expect((await as(ctrCookie).get("/api/contractor/photos")).body.photos).toHaveLength(1);
  });

  it("homeowner only sees their own project without financials", async () => {
    const [[reg]] = (await db.query(`SELECT id FROM clients WHERE email = ?`, [em("registered")])) as any;
    const regCookie = await makeSession("client", reg.id);
    const mine = await as(regCookie).get("/api/client/overview");
    expect(mine.status).toBe(200);
    const proj = mine.body.projects.find((x: any) => x.public_id === publicId);
    expect(proj.plan.name).toMatch(/Fontana/);
    expect(proj.photos).toHaveLength(1);
    expect(proj.contractor_name).toBe("Cole Builds");
    for (const banned of ["sale_price_cents", "contractor_cost_cents", "affiliate_id", "net_profit_cents", "loan_lender_name"]) {
      expect(proj).not.toHaveProperty(banned);
    }
    const others = await as(otherClientCookie).get("/api/client/overview");
    expect(others.body.projects.find((x: any) => x.public_id === publicId)).toBeUndefined();

    const docs = await as(regCookie).get("/api/client/documents");
    expect(docs.body.documents).toHaveLength(1);
    expect(docs.body.documents[0]).not.toHaveProperty("payload_json");
    expect((await as(otherClientCookie).get("/api/client/documents")).body.documents).toHaveLength(0);
    // the contractor/affiliate cannot be used on client routes
    expect((await as(ctrCookie).get("/api/client/documents")).status).toBe(401);
    expect(clientId).toBeGreaterThan(0);
    expect(clientCookie).toContain("gw_client_sid");
  });

  it("staff management guards self-demotion and role validation", async () => {
    expect((await as(superCookie).patch(`/api/admin/staff/${superId}`).send({ role: "agent" })).body.error).toBe("errors.cannotDemoteSelf");
    expect((await as(superCookie).patch(`/api/admin/staff/${superId}`).send({ status: "inactive" })).body.error).toBe("errors.cannotDemoteSelf");
    expect((await as(superCookie).post("/api/admin/staff").send({ email: em("newstaff"), first_name: "N", last_name: "S", role: "owner" })).status).toBe(400);
    const created = await as(superCookie)
      .post("/api/admin/staff")
      .send({ email: em("newstaff"), first_name: "New", last_name: "Staff", role: "finance" });
    expect(created.status).toBe(201);
    expect((await as(superCookie).post("/api/admin/staff").send({ email: em("newstaff"), first_name: "New", last_name: "Staff", role: "finance" })).status).toBe(409);
  });

  it("validates settings and unknown ids", async () => {
    expect((await as(superCookie).put("/api/admin/settings").send({ commission_payout_days_after_loan_close: -1 })).status).toBe(400);
    expect((await as(superCookie).get("/api/admin/projects/not_valid!")).status).toBe(400);
    expect((await as(superCookie).get("/api/admin/projects/GW-ZZZZZZZZ")).status).toBe(404);
    expect((await as(superCookie).patch("/api/admin/clients/abc").send({})).status).toBe(400);
    expect((await as(superCookie).patch(`/api/admin/projects/${publicId}`).send({ milestone: "nonsense" })).status).toBe(400);
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
    const board = await as(superCookie).get("/api/admin/projects/board?limit=5");
    expect(board.status).toBe(200);
    expect(board.body.ok).toBe(true);
    expect(board.body.columns.lead).toBeDefined();
    expect(board.body.columns.cancelled).toMatchObject({
      items: expect.any(Array),
      total: expect.any(Number),
      has_more: expect.any(Boolean),
    });
    // Our fixture project should appear in some column.
    const allIds = Object.values(board.body.columns as Record<string, { items: { public_id: string }[] }>)
      .flatMap((c) => c.items.map((p) => p.public_id));
    expect(allIds).toContain(publicId);

    const page = await as(superCookie).get(
      `/api/admin/projects/board?milestone=lead&limit=1&offset=0`,
    );
    expect(page.status).toBe(200);
    expect(page.body.milestone).toBe("lead");
    expect(page.body.items.length).toBeLessThanOrEqual(1);
    expect(typeof page.body.has_more).toBe("boolean");

    expect((await as(contentCookie).get("/api/admin/projects/board")).status).toBe(403);
    expect((await as(affCookie).get("/api/admin/projects/board")).status).toBe(401);
  });

  it("GET /api/admin/assignees returns active staff only for people.read", async () => {
    expect((await as(contentCookie).get("/api/admin/assignees")).status).toBe(403);

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
    expect(res.body.assignees.some((a: { email: string }) => a.email === em("agent"))).toBe(true);
    expect(res.body.assignees.some((a: { id: number }) => a.id === inactiveId)).toBe(false);
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
    const page0 = await as(financeCookie).get(`/api/admin/clients?q=${q}&limit=1&offset=0`);
    expect(page0.status).toBe(200);
    expect(page0.body.limit).toBe(1);
    expect(page0.body.offset).toBe(0);
    expect(typeof page0.body.total).toBe("number");
    expect(page0.body.total).toBeGreaterThanOrEqual(2);
    expect(page0.body.clients).toHaveLength(1);

    const page1 = await as(financeCookie).get(`/api/admin/clients?q=${q}&limit=1&offset=1`);
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
    expect(listed.body.notify_extra_emails.some((r: { id: number; email: string }) => r.id === extraId && r.email === email)).toBe(
      true,
    );

    const toggled = await as(financeCookie)
      .patch(`/api/admin/settings/notify-extras/${extraId}`)
      .send({ is_active: false });
    expect(toggled.status).toBe(200);
    const afterToggle = (await as(financeCookie).get("/api/admin/settings")).body.notify_extra_emails.find(
      (r: { id: number }) => r.id === extraId,
    );
    expect(afterToggle.is_active).toBe(false);

    const removed = await as(financeCookie).delete(`/api/admin/settings/notify-extras/${extraId}`);
    expect(removed.status).toBe(200);
    expect(
      (await as(financeCookie).get("/api/admin/settings")).body.notify_extra_emails.some(
        (r: { id: number }) => r.id === extraId,
      ),
    ).toBe(false);
  });
});
