// Part 2 of portalFeatures (see portalFeatures.integration.test.ts).
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
const prefix = `gwfeatm-${Date.now()}-`;
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

describe("portal features: projects, commissions, draws (integration)", () => {
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
    const days = 5; // TEST_SETTING_DEFAULTS.commission_payout_days_after_loan_close
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
    // Payout hold until the affiliate's agreement + W-9 are on file.
    expect(
      (
        await as(financeCookie)
          .patch(`/api/admin/commissions/${commission.id}`)
          .send({ status: "paid" })
      ).body.error,
    ).toBe("errors.affiliateOnboardingIncomplete");
    await markOnboarded(affId);
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

  // One flow split in 4 steps (same order, shared state) so each stays well under the per-test timeout
  // on the shared remote TiDB. Steps depend on the previous ones: run the whole describe.
  describe("commission split: sub closer + parent", () => {
    let parentId = 0;
    let parentCookie = "";
    let subId = 0;
    let subCookie = "";
    let splitPublicId = "";
    let sq = 0;
    let closerAfter: any = null;
    let parentAfter: any = null;

    it("commission split 1/4: top-level invites a pending sub; self-parent pointer ignored; subs recruit; sponsor cycles refused", async () => {
      const parentCode = crypto.randomBytes(4).toString("hex").toUpperCase();
      parentId = await insertId(
        `INSERT INTO affiliates (email, first_name, last_name, status, referral_code)
         VALUES (?, 'Pam', 'Parent', 'active', ?)`,
        [em("parent"), parentCode],
      );
      parentCookie = await makeSession("affiliate", parentId);

      // Top-level can invite; the sub starts pending until Groundwork approves.
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
      subId = Number(invite.body.affiliate_id);
      expect(subId).toBeGreaterThan(0);
      const [[subRow]] = (await db.query(
        `SELECT status, parent_affiliate_id, preferred_language FROM affiliates WHERE id = ?`,
        [subId],
      )) as any;
      expect(subRow.status).toBe("pending");
      expect(Number(subRow.parent_affiliate_id)).toBe(parentId);
      expect(subRow.preferred_language).toBe("es");
      expect((await as(superCookie).patch(`/api/admin/affiliates/${subId}`).send({ status: "active" })).status).toBe(200);

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

      subCookie = await makeSession("affiliate", subId);
      // Agreement §9: subs may recruit too; their recruit's Senior Sponsor is the top parent.
      expect((await as(subCookie).get("/api/affiliate/team")).status).toBe(200);
      const nested = await as(subCookie)
        .post("/api/affiliate/team")
        .send({
          first_name: "Nia",
          last_name: "Nested",
          email: em("nested"),
          phone: ph("0101"),
        });
      expect(nested.status).toBe(201);
      const nestedId = Number(nested.body.affiliate_id);
      const [[nestedRow]] = (await db.query(`SELECT parent_affiliate_id FROM affiliates WHERE id = ?`, [nestedId])) as any;
      expect(Number(nestedRow.parent_affiliate_id)).toBe(subId);
      // Admin sponsor edits refuse cycles (top parent cannot report to its own recruit).
      const cycle = await as(superCookie).patch(`/api/admin/affiliates/${parentId}`).send({ parent_affiliate_id: nestedId });
      expect(cycle.body.error).toBe("errors.sponsorCycle");
    }, 120_000);

    it("commission split 2/4: sub's client snapshots closer + parent (70/30); inactive parent voids its share, reactivating restores it", async () => {
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
      splitPublicId = String(reg.body.project_public_id);
      const [[proj]] = (await db.query(
        `SELECT id, sq_ft, closer_affiliate_id, parent_affiliate_id, affiliate_id
         FROM projects WHERE public_id = ?`,
        [splitPublicId],
      )) as any;
      expect(Number(proj.closer_affiliate_id)).toBe(subId);
      expect(Number(proj.parent_affiliate_id)).toBe(parentId);
      sq = Number(proj.sq_ft || 550);

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
    }, 120_000);

    it("commission split 3/4: unpaid amounts keep the frozen rate after a Settings change; a per-row edit doesn't re-split", async () => {
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
      closerAfter = afterEdit.body.commissions.find(
        (c: any) => c.role === "closer",
      );
      parentAfter = afterEdit.body.commissions.find(
        (c: any) => c.role === "parent",
      );
      expect(closerAfter.amount_cents).toBe(closerRow.amount_cents + 1000);
      expect(parentAfter.amount_cents).toBe(parentRow.amount_cents);
      expect(afterEdit.body.project.affiliate_commission_cents).toBe(
        closerAfter.amount_cents + parentAfter.amount_cents,
      );
    }, 120_000);

    it("commission split 4/4: paying the closer leaves the parent payable and locked; paid_at only once both are paid", async () => {
      await markOnboarded(subId);
      await markOnboarded(parentId);
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
    }, 120_000);
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

});
