import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  __testClearEmailDryRuns,
  __testGetEmailDryRuns,
  createServer,
} from "./index";
import {
  cleanupPortalFixturesByPrefix,
  createIntegrationTestPool,
} from "./testDbCleanup";

// Unique-per-run test phones: the one-person-per-phone rule must never match other suites or real rows.
const RUN_PHONE = String(100 + Math.floor(Math.random() * 900));
const ph = (last4: string) => `949${RUN_PHONE}${last4}`;

const app = createServer();
const db = createIntegrationTestPool();
const prefix = `gwleadcv-${Date.now()}-`;
const em = (name: string) => `${prefix}${name}@example.com`;

async function makeAdminSession(id: number): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  await db.execute(
    `INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, ?)`,
    [
      id,
      crypto.createHash("sha256").update(token).digest("hex"),
      new Date(Date.now() + 86_400_000),
    ],
  );
  return `gw_admin_sid=${token}`;
}

async function insertId(sql: string, params: any[]): Promise<number> {
  const [r] = await db.execute(sql, params);
  return Number((r as { insertId: number }).insertId);
}

const as = (cookie: string) => ({
  post: (u: string) => request(app).post(u).set("Cookie", cookie),
  get: (u: string) => request(app).get(u).set("Cookie", cookie),
});

describe("lead multi-role convert + partners intake", () => {
  let superCookie = "";
  let agentCookie = "";
  let planId = 0;
  let parentAffId = 0;
  let parentCode = "";

  beforeAll(async () => {
    const superId = await insertId(
      `INSERT INTO admins (email, first_name, last_name, role, status, preferred_language)
       VALUES (?, 'Super', 'LeadCv', 'super_admin', 'active', 'en')`,
      [em("super")],
    );
    const agentId = await insertId(
      `INSERT INTO admins (email, first_name, last_name, role, status, preferred_language)
       VALUES (?, 'Agent', 'LeadCv', 'agent', 'active', 'en')`,
      [em("agent")],
    );
    superCookie = await makeAdminSession(superId);
    agentCookie = await makeAdminSession(agentId);
    planId = await insertId(
      `INSERT INTO adu_plans
         (code, name, bedrooms, bathrooms, stories, sq_ft, default_commission_cents, is_active, sort_order)
       VALUES (?, 'LeadCv Plan', 1, 1, 1, 400, 400000, 1, 99)`,
      [`LCV-${Date.now()}`],
    );
    parentCode = `LCV${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    parentAffId = await insertId(
      `INSERT INTO affiliates
         (email, first_name, last_name, phone, status, preferred_language, referral_code, approved_at)
       VALUES (?, 'Parent', 'Aff', '${ph("0100")}', 'active', 'en', ?, NOW())`,
      [em("parent"), parentCode],
    );
  });

  afterAll(async () => {
    await cleanupPortalFixturesByPrefix(db, prefix);
    await db.execute(`DELETE FROM adu_plans WHERE id = ?`, [planId]).catch(() => {});
    await db.end();
  });

  it("partners referral creates pending affiliate with parent, no lead", async () => {
    const email = em("partner");
    const res = await request(app).post("/api/public/partner-referral").send({
      full_name: "Angelica Rivera",
      email,
      phone: ph("0200"),
      company: "Encore Mortgage",
      preferred_language: "en",
      referral_code: parentCode,
    });
    expect(res.status).toBe(201);
    expect(res.body.affiliate_id).toBeTruthy();
    expect(res.body.lead_id).toBeUndefined();

    const [affRows] = await db.query(
      `SELECT status, parent_affiliate_id, company FROM affiliates WHERE id = ?`,
      [res.body.affiliate_id],
    );
    const aff = (affRows as any[])[0];
    expect(aff.status).toBe("pending");
    expect(Number(aff.parent_affiliate_id)).toBe(parentAffId);
    expect(aff.company).toBe("Encore Mortgage");

    const [leadRows] = await db.query(`SELECT id FROM leads WHERE email = ?`, [email]);
    expect((leadRows as any[]).length).toBe(0);
  });

  it("convert → client still creates project (regression)", async () => {
    const leadId = await insertId(
      `INSERT INTO leads
         (first_name, last_name, full_name, email, phone, soft_pull_consent, mode, source, status)
       VALUES ('Lee', 'Client', 'Lee Client', ?, '${ph("0300")}', 0, 'standard', 'vitest', 'new')`,
      [em("lead-client")],
    );
    const convert = await as(superCookie)
      .post(`/api/admin/leads/${leadId}/convert`)
      .send({ adu_plan_id: planId });
    expect(convert.status).toBe(201);
    expect(convert.body.target).toBe("client");
    expect(convert.body.project_public_id).toBeTruthy();
    expect(
      (await as(superCookie).post(`/api/admin/leads/${leadId}/convert`).send({})).status,
    ).toBe(409);
  });

  it("convert → affiliate pending|active + historical partner_referral", async () => {
    const leadId = await insertId(
      `INSERT INTO leads
         (first_name, last_name, full_name, email, phone, soft_pull_consent, mode,
          source, status, notes, affiliate_id, referral_code)
       VALUES ('Angie', 'Hist', 'Angie Hist', ?, '${ph("0400")}', 0, 'standard',
          'partner_referral', 'new', 'company=Encore Mortgage', ?, ?)`,
      [em("lead-aff"), parentAffId, parentCode],
    );
    const convert = await as(superCookie)
      .post(`/api/admin/leads/${leadId}/convert`)
      .send({ target: "affiliate", status: "active" });
    expect(convert.status).toBe(201);
    expect(convert.body.target).toBe("affiliate");
    expect(convert.body.affiliate_id).toBeTruthy();

    const [leadRows] = await db.query(
      `SELECT converted_affiliate_id, status FROM leads WHERE id = ?`,
      [leadId],
    );
    const lead = (leadRows as any[])[0];
    expect(Number(lead.converted_affiliate_id)).toBe(convert.body.affiliate_id);
    expect(lead.status).toBe("qualified");

    const [affRows] = await db.query(
      `SELECT status, parent_affiliate_id, company FROM affiliates WHERE id = ?`,
      [convert.body.affiliate_id],
    );
    const aff = (affRows as any[])[0];
    expect(aff.status).toBe("active");
    expect(Number(aff.parent_affiliate_id)).toBe(parentAffId);
    expect(aff.company).toBe("Encore Mortgage");
  });

  it("convert → contractor invite path with pending status", async () => {
    const leadId = await insertId(
      `INSERT INTO leads
         (first_name, last_name, full_name, email, phone, soft_pull_consent, mode,
          source, status, notes)
       VALUES ('Cody', 'Build', 'Cody Build', ?, '${ph("0500")}', 0, 'standard',
          'web', 'new', 'intent=contractor')`,
      [em("lead-ctr")],
    );
    const convert = await as(superCookie)
      .post(`/api/admin/leads/${leadId}/convert`)
      .send({ target: "contractor", status: "pending" });
    expect(convert.status).toBe(201);
    expect(convert.body.target).toBe("contractor");
    expect(convert.body.invite_sent).toBe(true);

    const [ctrRows] = await db.query(
      `SELECT status FROM contractors WHERE id = ?`,
      [convert.body.contractor_id],
    );
    expect((ctrRows as any[])[0].status).toBe("pending");

    const [inv] = await db.query(
      `SELECT token FROM contractor_invites WHERE contractor_id = ? AND accepted_at IS NULL`,
      [convert.body.contractor_id],
    );
    expect((inv as any[]).length).toBeGreaterThan(0);
  });

  it("email exists → 409; phone match → confirm link", async () => {
    await insertId(
      `INSERT INTO affiliates
         (email, first_name, last_name, phone, status, preferred_language, referral_code)
       VALUES (?, 'Dup', 'Aff', '${ph("0600")}', 'pending', 'en', ?)`,
      [em("dup-aff"), `DUP${crypto.randomBytes(3).toString("hex").toUpperCase()}`],
    );
    const emailLead = await insertId(
      `INSERT INTO leads
         (first_name, last_name, full_name, email, phone, soft_pull_consent, mode, source, status)
       VALUES ('Dup', 'Lead', 'Dup Lead', ?, '${ph("0699")}', 0, 'standard', 'vitest', 'new')`,
      [em("dup-aff")],
    );
    expect(
      (
        await as(superCookie)
          .post(`/api/admin/leads/${emailLead}/convert`)
          .send({ target: "affiliate", status: "pending" })
      ).status,
    ).toBe(409);

    const existingPhone = await insertId(
      `INSERT INTO affiliates
         (email, first_name, last_name, phone, status, preferred_language, referral_code)
       VALUES (?, 'Phone', 'Match', '${ph("0700")}', 'pending', 'en', ?)`,
      [em("phone-aff"), `PHN${crypto.randomBytes(3).toString("hex").toUpperCase()}`],
    );
    const phoneLead = await insertId(
      `INSERT INTO leads
         (first_name, last_name, full_name, email, phone, soft_pull_consent, mode, source, status)
       VALUES ('Other', 'Email', 'Other Email', ?, '${ph("0700")}', 0, 'standard', 'vitest', 'new')`,
      [em("phone-lead")],
    );
    const warn = await as(superCookie)
      .post(`/api/admin/leads/${phoneLead}/convert`)
      .send({ target: "affiliate", status: "active" });
    expect(warn.status).toBe(409);
    expect(warn.body.error).toBe("errors.phoneLinkConfirmRequired");
    expect(warn.body.phone_match.id).toBe(existingPhone);

    const linked = await as(superCookie)
      .post(`/api/admin/leads/${phoneLead}/convert`)
      .send({ target: "affiliate", status: "active", confirm_phone_link: true });
    expect(linked.status).toBe(201);
    expect(linked.body.affiliate_id).toBe(existingPhone);
  });

  it("convert → affiliate defaults active; contractor active marks invite accepted", async () => {
    const affLead = await insertId(
      `INSERT INTO leads
         (first_name, last_name, full_name, email, phone, soft_pull_consent, mode, source, status)
       VALUES ('Def', 'Aff', 'Def Aff', ?, '${ph("0810")}', 0, 'standard', 'vitest', 'new')`,
      [em("aff-default")],
    );
    const aff = await as(superCookie)
      .post(`/api/admin/leads/${affLead}/convert`)
      .send({ target: "affiliate" });
    expect(aff.status).toBe(201);
    const [affRows] = await db.query(`SELECT status FROM affiliates WHERE id = ?`, [
      aff.body.affiliate_id,
    ]);
    expect((affRows as any[])[0].status).toBe("active");

    const ctrLead = await insertId(
      `INSERT INTO leads
         (first_name, last_name, full_name, email, phone, soft_pull_consent, mode, source, status)
       VALUES ('Act', 'Ctr', 'Act Ctr', ?, '${ph("0811")}', 0, 'standard', 'vitest', 'new')`,
      [em("ctr-active")],
    );
    // Skipping prequalification needs a logged super_admin override reason.
    const noReason = await as(superCookie)
      .post(`/api/admin/leads/${ctrLead}/convert`)
      .send({ target: "contractor", status: "active" });
    expect(noReason.status).toBe(409);
    expect(noReason.body.error).toBe("errors.contractorOverrideReasonRequired");
    const ctr = await as(superCookie)
      .post(`/api/admin/leads/${ctrLead}/convert`)
      .send({ target: "contractor", status: "active", override_reason: "Vetted offline (vitest)" });
    expect(ctr.status).toBe(201);
    const [ovr] = await db.query(
      `SELECT e.kind, e.note FROM contractor_application_events e
       JOIN contractor_applications a ON a.id = e.application_id
       WHERE a.contractor_id = ? AND e.kind = 'activation_override'`,
      [ctr.body.contractor_id],
    );
    expect((ovr as any[])[0]?.note).toBe("Vetted offline (vitest)");
    const [ctrRows] = await db.query(`SELECT status FROM contractors WHERE id = ?`, [
      ctr.body.contractor_id,
    ]);
    expect((ctrRows as any[])[0].status).toBe("active");
    const [inv] = await db.query(
      `SELECT accepted_at FROM contractor_invites WHERE contractor_id = ? ORDER BY id DESC LIMIT 1`,
      [ctr.body.contractor_id],
    );
    expect((inv as any[])[0].accepted_at).toBeTruthy();
  });

  it("client phone-link invites the matched client email; forged confirm still blocks cross email", async () => {
    const existingClientId = await insertId(
      `INSERT INTO clients
         (email, first_name, last_name, phone, preferred_language, status)
       VALUES (?, 'Match', 'Client', '${ph("0820")}', 'en', 'prospect')`,
      [em("match-client")],
    );
    const leadId = await insertId(
      `INSERT INTO leads
         (first_name, last_name, full_name, email, phone, soft_pull_consent, mode, source, status)
       VALUES ('Other', 'Lead', 'Other Lead', ?, '${ph("0820")}', 0, 'standard', 'vitest', 'new')`,
      [em("phone-client-lead")],
    );
    const warn = await as(superCookie)
      .post(`/api/admin/leads/${leadId}/convert`)
      .send({ target: "client", adu_plan_id: planId });
    expect(warn.status).toBe(409);
    expect(warn.body.phone_match.id).toBe(existingClientId);

    __testClearEmailDryRuns();
    const linked = await as(superCookie)
      .post(`/api/admin/leads/${leadId}/convert`)
      .send({
        target: "client",
        adu_plan_id: planId,
        confirm_phone_link: true,
      });
    expect(linked.status).toBe(201);
    expect(linked.body.client_id).toBe(existingClientId);
    const mails = __testGetEmailDryRuns().filter((m) => m.to === em("match-client"));
    expect(mails.length).toBeGreaterThan(0);
    expect(__testGetEmailDryRuns().some((m) => m.to === em("phone-client-lead"))).toBe(
      false,
    );

    await insertId(
      `INSERT INTO affiliates
         (email, first_name, last_name, phone, status, preferred_language, referral_code)
       VALUES (?, 'Cross', 'Aff', '${ph("0821")}', 'pending', 'en', ?)`,
      [em("cross-aff"), `XAF${crypto.randomBytes(3).toString("hex").toUpperCase()}`],
    );
    const crossLead = await insertId(
      `INSERT INTO leads
         (first_name, last_name, full_name, email, phone, soft_pull_consent, mode, source, status)
       VALUES ('Cross', 'Lead', 'Cross Lead', ?, '${ph("0822")}', 0, 'standard', 'vitest', 'new')`,
      [em("cross-aff")],
    );
    const forged = await as(superCookie)
      .post(`/api/admin/leads/${crossLead}/convert`)
      .send({ target: "client", confirm_phone_link: true, adu_plan_id: planId });
    expect(forged.status).toBe(409);
    expect(forged.body.error).toBe("errors.emailExistsAffiliate");
  });

  it("contact intent=partner creates pending affiliate, no lead", async () => {
    const email = em("contact-partner");
    const res = await request(app).post("/api/public/contact").send({
      full_name: "Contact Partner",
      email,
      phone: ph("0840"),
      intent: "partner",
      preferred_language: "en",
      sms_transactional_consent: true,
      sms_marketing_consent: false,
      referral_code: parentCode,
    });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("partner_affiliate");
    expect(res.body.affiliate_id).toBeTruthy();
    expect(res.body.lead_id).toBeUndefined();
    const [affRows] = await db.query(
      `SELECT status, parent_affiliate_id, slug FROM affiliates WHERE id = ?`,
      [res.body.affiliate_id],
    );
    expect((affRows as any[])[0].status).toBe("pending");
    expect(Number((affRows as any[])[0].parent_affiliate_id)).toBe(parentAffId);
    expect((affRows as any[])[0].slug).toBe("contact-partner");
    const [leadRows] = await db.query(`SELECT id FROM leads WHERE email = ?`, [email]);
    expect((leadRows as any[]).length).toBe(0);
  });

  it("partners referral 409 when email already a client", async () => {
    await insertId(
      `INSERT INTO clients
         (email, first_name, last_name, phone, preferred_language, status)
       VALUES (?, 'Taken', 'Client', '${ph("0830")}', 'en', 'prospect')`,
      [em("taken-client")],
    );
    const res = await request(app).post("/api/public/partner-referral").send({
      full_name: "Taken Person",
      email: em("taken-client"),
      phone: ph("0831"),
      preferred_language: "en",
    });
    expect(res.status).toBe(409);
    // Public forms never reveal which role matched (staff get a duplicate_blocked alert).
    expect(res.body.error).toBe("errors.personExistsPublic");
  });

  it("permissions: agent can client convert, not affiliate", async () => {
    const clientLead = await insertId(
      `INSERT INTO leads
         (first_name, last_name, full_name, email, phone, soft_pull_consent, mode, source, status)
       VALUES ('Ag', 'Client', 'Ag Client', ?, '${ph("0800")}', 0, 'standard', 'vitest', 'new')`,
      [em("agent-client")],
    );
    expect(
      (
        await as(agentCookie)
          .post(`/api/admin/leads/${clientLead}/convert`)
          .send({ target: "client", adu_plan_id: planId })
      ).status,
    ).toBe(201);

    const affLead = await insertId(
      `INSERT INTO leads
         (first_name, last_name, full_name, email, phone, soft_pull_consent, mode, source, status)
       VALUES ('Ag', 'Aff', 'Ag Aff', ?, '${ph("0801")}', 0, 'standard', 'partner_referral', 'new')`,
      [em("agent-aff")],
    );
    expect(
      (
        await as(agentCookie)
          .post(`/api/admin/leads/${affLead}/convert`)
          .send({ target: "affiliate", status: "active" })
      ).status,
    ).toBe(403);
  });
});
