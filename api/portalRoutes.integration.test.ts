/**
 * Route-coverage + audit-hardening integration tests.
 *
 * Covers the admin/affiliate/contractor/client routes that only had happy-path
 * coverage, plus: milestone state machine (incl. a real race), contract PDFs
 * (role + IDOR), Vercel Blob photo uploads (mocked), /r/:code rate limit and
 * OTP anti-enumeration / delivery-failure handling.
 *
 * Fixtures use @example.com only and are removed in afterAll via
 * cleanupPortalFixturesByPrefix. Emails always dry-run under VITEST.
 */
import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

const putMock = vi.hoisted(() => vi.fn());
vi.mock("@vercel/blob", () => ({ put: putMock }));

import {
  __testClearEmailDryRuns,
  __testForceEmailFailure,
  __testGetEmailDryRuns,
  createServer,
} from "./index";
import {
  cleanupPortalFixturesByPrefix,
  createIntegrationTestPool,
  withSystemSettingsLock,
} from "./testDbCleanup";

// Unique-per-run test phones: the one-person-per-phone rule must never match other suites or real rows.
const RUN_PHONE = String(100 + Math.floor(Math.random() * 900));
const ph = (last4: string) => `949${RUN_PHONE}${last4}`;

const hasDb = Boolean(
  process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME,
);
const app = createServer();
const db = createIntegrationTestPool();
const stamp = Date.now();
const prefix = `gwrte-${stamp}-`;
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
});

/** GET that buffers binary bodies (supertest does not buffer application/pdf). */
async function getBin(cookie: string, url: string) {
  const res = await request(app)
    .get(url)
    .set("Cookie", cookie)
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
  const buf = res.body as Buffer;
  const isPdf = String(res.headers["content-type"] || "").startsWith(
    "application/pdf",
  );
  return {
    status: res.status,
    headers: res.headers,
    buf,
    json: isPdf ? null : JSON.parse(buf.toString("utf8") || "{}"),
  };
}

const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(64, 1),
]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 2),
]);

describe.runIf(hasDb)("portal routes + audit hardening (integration)", () => {
  let superCookie = "";
  let agentCookie = "";
  let financeCookie = "";
  let contentCookie = "";
  let affId = 0;
  let affCookie = "";
  let affCode = "";
  let ctrId = 0;
  let ctrCookie = "";
  let ctr2Cookie = "";
  let clientId = 0;
  let clientCookie = "";
  let client2Cookie = "";
  let planId = 0;
  let projectId = "";
  let contractId = 0;

  beforeAll(async () => {
    process.env.VITEST = "true";
    __testClearEmailDryRuns();
    const mkAdmin = (name: string, role: string) =>
      insertId(
        `INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, ?, 'Route', ?, 'active')`,
        [em(name), name, role],
      );
    superCookie = await makeSession(
      "admin",
      await mkAdmin("super", "super_admin"),
    );
    agentCookie = await makeSession("admin", await mkAdmin("agent", "agent"));
    financeCookie = await makeSession(
      "admin",
      await mkAdmin("finance", "finance"),
    );
    contentCookie = await makeSession(
      "admin",
      await mkAdmin("content", "content"),
    );

    affCode = crypto.randomBytes(4).toString("hex").toUpperCase();
    affId = await insertId(
      `INSERT INTO affiliates (email, first_name, last_name, status, referral_code) VALUES (?, 'Ada', 'Aff', 'active', ?)`,
      [em("aff"), affCode],
    );
    affCookie = await makeSession("affiliate", affId);
    ctrId = await insertId(
      `INSERT INTO contractors (email, first_name, last_name, company, status) VALUES (?, 'Cole', 'Builder', 'Cole Builds', 'active')`,
      [em("ctr")],
    );
    ctrCookie = await makeSession("contractor", ctrId);
    const ctr2Id = await insertId(
      `INSERT INTO contractors (email, first_name, last_name, status) VALUES (?, 'Cora', 'Other', 'active')`,
      [em("ctr2")],
    );
    ctr2Cookie = await makeSession("contractor", ctr2Id);
    clientId = await insertId(
      `INSERT INTO clients (email, first_name, last_name, status, affiliate_id) VALUES (?, 'Hana', 'Home', 'prospect', ?)`,
      [em("client"), affId],
    );
    clientCookie = await makeSession("client", clientId);
    const client2Id = await insertId(
      `INSERT INTO clients (email, first_name, last_name, status) VALUES (?, 'Olga', 'Other', 'prospect')`,
      [em("client2")],
    );
    client2Cookie = await makeSession("client", client2Id);

    const [plans] = await db.query(
      `SELECT id FROM adu_plans WHERE code = 'fontana-1br' LIMIT 1`,
    );
    planId = Number((plans as { id: number }[])[0].id);

    const created = await as(superCookie)
      .post("/api/admin/projects")
      .send({
        client_id: clientId,
        adu_plan_id: planId,
        property_address: "1 Test Way",
      });
    expect(created.status).toBe(201);
    projectId = created.body.project_public_id;
  });

  afterAll(async () => {
    try {
      __testForceEmailFailure(false);
      delete process.env.BLOB_READ_WRITE_TOKEN;
      delete process.env.REFERRAL_RATE_LIMIT_MAX;
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
      __testClearEmailDryRuns();
    }
  });

  // ── Public ─────────────────────────────────────────────────────────────────

  it("public plans list hides commission data; bad invite tokens 404", async () => {
    const res = await request(app).get("/api/public/plans");
    expect(res.status).toBe(200);
    expect(res.body.plans.length).toBeGreaterThanOrEqual(3);
    expect(res.body.plans[0]).not.toHaveProperty("default_commission_cents");
    expect(
      (await request(app).get("/api/public/contractor-invite/not-a-token"))
        .status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post("/api/public/contractor-invite/accept")
          .send({ token: "x" })
      ).status,
    ).toBe(404);
  });

  // ── Admin: plans / leads ────────────────────────────────────────────────────

  it("admin plans: readable by all staff, editable only with plans.write, validated", async () => {
    const list = await as(agentCookie).get("/api/admin/plans");
    expect(list.status).toBe(200);
    const plan = list.body.plans.find((p: any) => p.id === planId);
    const original = plan.description;
    expect(
      (
        await as(agentCookie)
          .patch(`/api/admin/plans/${planId}`)
          .send({ description: "nope" })
      ).status,
    ).toBe(403);
    expect(
      (
        await as(contentCookie)
          .patch(`/api/admin/plans/${planId}`)
          .send({ bedrooms: 99 })
      ).body.error,
    ).toBe("validation.invalidField");
    expect(
      (
        await as(contentCookie)
          .patch("/api/admin/plans/999999999")
          .send({ description: "x" })
      ).status,
    ).toBe(404);
    expect(
      (await as(contentCookie).patch("/api/admin/plans/abc").send({})).body
        .error,
    ).toBe("validation.invalidId");
    try {
      const ok = await as(contentCookie)
        .patch(`/api/admin/plans/${planId}`)
        .send({ description: `route-${stamp}` });
      expect(ok.status).toBe(200);
      const after = await as(superCookie).get("/api/admin/plans");
      expect(
        after.body.plans.find((p: any) => p.id === planId).description,
      ).toBe(`route-${stamp}`);
    } finally {
      await db.execute(`UPDATE adu_plans SET description = ? WHERE id = ?`, [
        original,
        planId,
      ]);
    }
  });

  it("admin leads: filter, patch, convert (atomic) and role gates", async () => {
    const mkLead = (name: string) =>
      insertId(
        `INSERT INTO leads (first_name, last_name, full_name, email, phone, property_address, affiliate_id, status)
         VALUES ('Lea', ?, ?, ?, '${ph("0000")}', '9 Lead St', ?, 'new')`,
        [name, `Lea ${name}`, em(`lead-${name}`), affId],
      );
    const leadA = await mkLead("A");
    const leadB = await mkLead("B");

    expect((await as(financeCookie).get("/api/admin/leads")).status).toBe(403);
    expect((await as(contentCookie).get("/api/admin/leads")).status).toBe(403);
    const byQ = await as(agentCookie).get(
      `/api/admin/leads?q=${encodeURIComponent(prefix)}`,
    );
    expect(byQ.status).toBe(200);
    expect(byQ.body.leads.map((l: any) => l.id)).toEqual(
      expect.arrayContaining([leadA, leadB]),
    );
    const byStatus = await as(agentCookie).get(
      `/api/admin/leads?status=new&q=${encodeURIComponent(prefix)}`,
    );
    expect(byStatus.body.leads.every((l: any) => l.status === "new")).toBe(
      true,
    );
    const badStatus = await as(agentCookie).get(
      `/api/admin/leads?status=bogus&q=${encodeURIComponent(prefix)}`,
    );
    expect(badStatus.status).toBe(200); // unknown filter is ignored, not an error
    // LIKE wildcards are escaped: a bare % must not match everything
    const wild = await as(agentCookie).get("/api/admin/leads?q=%25");
    expect(
      wild.body.leads.every((l: any) => JSON.stringify(l).includes("%")),
    ).toBe(true);

    expect(
      (
        await as(agentCookie)
          .patch(`/api/admin/leads/${leadA}`)
          .send({ status: "bogus" })
      ).body.error,
    ).toBe("validation.invalidField");
    expect(
      (
        await as(agentCookie)
          .patch(`/api/admin/leads/${leadA}`)
          .send({ status: "contacted", notes: "called" })
      ).status,
    ).toBe(200);
    expect(
      (
        await as(agentCookie)
          .patch("/api/admin/leads/999999999")
          .send({ notes: "x" })
      ).status,
    ).toBe(404);

    // convert: finance lacks projects.write; unknown 404; bad plan rolls back; success; replay 409
    expect(
      (
        await as(financeCookie)
          .post(`/api/admin/leads/${leadA}/convert`)
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await as(agentCookie)
          .post("/api/admin/leads/999999999/convert")
          .send({})
      ).status,
    ).toBe(404);
    const badPlan = await as(agentCookie)
      .post(`/api/admin/leads/${leadA}/convert`)
      .send({ adu_plan_id: 999999 });
    expect(badPlan.status).toBe(400);
    expect(badPlan.body.error).toBe("errors.invalidReference");
    const [[stillOpen]] = (await db.query(
      `SELECT client_id FROM leads WHERE id = ?`,
      [leadA],
    )) as any;
    expect(stillOpen.client_id).toBeNull();
    const [clientRows] = (await db.query(
      `SELECT id FROM clients WHERE email = ?`,
      [em("lead-A")],
    )) as any;
    expect(clientRows).toHaveLength(0); // the failed convert left no orphan client

    const conv = await as(agentCookie)
      .post(`/api/admin/leads/${leadA}/convert`)
      .send({ adu_plan_id: planId });
    expect(conv.status).toBe(201);
    expect(conv.body.project_public_id).toMatch(/^GW-/);
    expect(
      (await as(agentCookie).post(`/api/admin/leads/${leadA}/convert`).send({}))
        .body.error,
    ).toBe("errors.leadAlreadyConverted");
    const [[lead]] = (await db.query(
      `SELECT status, client_id FROM leads WHERE id = ?`,
      [leadA],
    )) as any;
    expect(lead.status).toBe("qualified");
    expect(lead.client_id).toBe(conv.body.client_id);
  });

  // ── Admin: people ──────────────────────────────────────────────────────────

  it("admin affiliates: search, slug rules, approvals gate, suspension kills the session", async () => {
    expect((await as(contentCookie).get("/api/admin/affiliates")).status).toBe(
      403,
    );
    const list = await as(financeCookie).get(
      `/api/admin/affiliates?q=${encodeURIComponent(prefix)}`,
    );
    expect(list.status).toBe(200);
    const row = list.body.affiliates.find((a: any) => a.id === affId);
    expect(row).toMatchObject({
      click_count: expect.anything(),
      client_count: expect.anything(),
    });

    expect(
      (
        await as(agentCookie)
          .patch(`/api/admin/affiliates/${affId}`)
          .send({ notes: "n" })
      ).status,
    ).toBe(403);
    // Server slugifies input; junk that collapses to <3 chars → slugFormat; reserved words blocked.
    expect(
      (
        await as(superCookie)
          .patch(`/api/admin/affiliates/${affId}`)
          .send({ slug: "!!" })
      ).body.error,
    ).toBe("validation.slugFormat");
    expect(
      (
        await as(superCookie)
          .patch(`/api/admin/affiliates/${affId}`)
          .send({ slug: "admin" })
      ).body.error,
    ).toBe("validation.slugReserved");
    // "A B!" slugifies to a valid vanity slug
    expect(
      (
        await as(superCookie)
          .patch(`/api/admin/affiliates/${affId}`)
          .send({ slug: "A B!" })
      ).status,
    ).toBe(200);
    expect(
      (
        await as(superCookie)
          .patch("/api/admin/affiliates/999999999")
          .send({ notes: "x" })
      ).status,
    ).toBe(404);
    const slug = `${prefix}slug`;
    expect(
      (
        await as(superCookie)
          .patch(`/api/admin/affiliates/${affId}`)
          .send({ slug })
      ).status,
    ).toBe(200);
    const overview = await as(affCookie).get("/api/affiliate/overview");
    expect(overview.body.affiliate.tracking_url).toMatch(
      new RegExp(`/r/${slug}$`),
    );

    // duplicate slug → friendly 409 (errors.slugTaken), never a raw driver error
    const otherAff = await insertId(
      `INSERT INTO affiliates (email, first_name, last_name, status, referral_code) VALUES (?, 'Dup', 'Slug', 'active', ?)`,
      [em("aff2"), crypto.randomBytes(4).toString("hex").toUpperCase()],
    );
    const dup = await as(superCookie)
      .patch(`/api/admin/affiliates/${otherAff}`)
      .send({ slug });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("errors.slugTaken");

    // Vanity slug must not equal another affiliate's referral_code (lookup ambiguity)
    const codeClash = await as(superCookie)
      .patch(`/api/admin/affiliates/${otherAff}`)
      .send({ slug: String(affCode).toLowerCase() });
    expect(codeClash.status).toBe(409);
    expect(codeClash.body.error).toBe("errors.slugTaken");

    // suspension immediately invalidates the live session
    const tempCookie = await makeSession("affiliate", otherAff);
    expect((await as(tempCookie).get("/api/affiliate/overview")).status).toBe(
      200,
    );
    expect(
      (
        await as(superCookie)
          .patch(`/api/admin/affiliates/${otherAff}`)
          .send({ status: "suspended" })
      ).status,
    ).toBe(200);
    expect((await as(tempCookie).get("/api/affiliate/overview")).status).toBe(
      401,
    );
  });

  it("admin contractors: list/search, invited cannot be force-activated, deactivation kills the session", async () => {
    expect((await as(contentCookie).get("/api/admin/contractors")).status).toBe(
      403,
    );
    const list = await as(agentCookie).get(
      `/api/admin/contractors?q=${encodeURIComponent(prefix)}`,
    );
    expect(list.body.contractors.some((c: any) => c.id === ctrId)).toBe(true);

    const invitedId = await insertId(
      `INSERT INTO contractors (email, first_name, last_name, status) VALUES (?, 'Ivy', 'Inv', 'invited')`,
      [em("ctr-invited")],
    );
    expect(
      (
        await as(superCookie)
          .patch(`/api/admin/contractors/${invitedId}`)
          .send({ status: "active" })
      ).body.error,
    ).toBe("errors.contractorInvited");
    // Any status change while invited is locked (including pending); use the invite flow instead.
    expect(
      (
        await as(superCookie)
          .patch(`/api/admin/contractors/${invitedId}`)
          .send({ status: "pending" })
      ).status,
    ).toBe(409);
    expect(
      (
        await as(superCookie)
          .patch(`/api/admin/contractors/${invitedId}`)
          .send({ status: "pending" })
      ).body.error,
    ).toBe("errors.contractorInvited");
    expect(
      (
        await as(superCookie)
          .patch("/api/admin/contractors/999999999")
          .send({ notes: "x" })
      ).status,
    ).toBe(404);
    expect(
      (
        await as(agentCookie)
          .patch(`/api/admin/contractors/${ctrId}`)
          .send({ notes: "x" })
      ).status,
    ).toBe(403);

    const throwaway = await insertId(
      `INSERT INTO contractors (email, first_name, last_name, status) VALUES (?, 'Tmp', 'Ctr', 'active')`,
      [em("ctr-tmp")],
    );
    const tmpCookie = await makeSession("contractor", throwaway);
    expect((await as(tmpCookie).get("/api/contractor/projects")).status).toBe(
      200,
    );
    await as(superCookie)
      .patch(`/api/admin/contractors/${throwaway}`)
      .send({ status: "inactive", notes: "left" });
    expect((await as(tmpCookie).get("/api/contractor/projects")).status).toBe(
      401,
    );
  });

  it("admin clients: create/patch/search/portal-invite with validation and role gates", async () => {
    expect(
      (await as(financeCookie).post("/api/admin/clients").send({})).status,
    ).toBe(403);
    expect(
      (
        await as(agentCookie)
          .post("/api/admin/clients")
          .send({ email: "nope", first_name: "A", last_name: "B" })
      ).body.error,
    ).toBe("validation.emailInvalid");
    const created = await as(agentCookie)
      .post("/api/admin/clients")
      .send({
        email: em("newclient"),
        first_name: "New",
        last_name: "Client",
        preferred_language: "es",
        city: "Fontana",
      });
    expect(created.status).toBe(201);
    const dup = await as(agentCookie)
      .post("/api/admin/clients")
      .send({ email: em("newclient"), first_name: "New", last_name: "Client" });
    expect(dup.status).toBe(409);
    // One role per person: the shared check reports who already owns the email.
    expect(dup.body.error).toBe("errors.personExists");
    expect(dup.body.match).toMatchObject({ entity: "client", by: "email" });

    const found = await as(financeCookie).get(
      `/api/admin/clients?q=${encodeURIComponent(em("newclient"))}`,
    );
    expect(found.body.clients).toHaveLength(1);
    expect(found.body.clients[0].project_count).toBe(0);

    const id = created.body.client_id;
    expect(
      (
        await as(agentCookie)
          .patch("/api/admin/clients/999999999")
          .send({ admin_notes: "x" })
      ).status,
    ).toBe(404);
    expect(
      (
        await as(agentCookie)
          .patch(`/api/admin/clients/${id}`)
          .send({ status: "bogus" })
      ).status,
    ).toBe(400);
    expect(
      (
        await as(agentCookie)
          .patch(`/api/admin/clients/${id}`)
          .send({ first_name: "" })
      ).status,
    ).toBe(400);
    expect(
      (
        await as(agentCookie)
          .patch(`/api/admin/clients/${id}`)
          .send({ admin_notes: "vip", preferred_language: "en" })
      ).status,
    ).toBe(200);

    __testClearEmailDryRuns();
    expect(
      (
        await as(agentCookie)
          .post(`/api/admin/clients/${id}/portal-invite`)
          .send({})
      ).status,
    ).toBe(200);
    const mail = __testGetEmailDryRuns().find((m) => m.to === em("newclient"));
    expect(mail?.html).toContain("/client/invite/");
    expect(
      (
        await as(agentCookie)
          .post("/api/admin/clients/999999999/portal-invite")
          .send({})
      ).status,
    ).toBe(404);
    await as(superCookie)
      .patch(`/api/admin/clients/${id}`)
      .send({ status: "suspended" });
    expect(
      (
        await as(agentCookie)
          .post(`/api/admin/clients/${id}/portal-invite`)
          .send({})
      ).body.error,
    ).toBe("errors.authInactive");
  });

  // ── Admin: projects / milestones ───────────────────────────────────────────

  it("admin projects: list filters + role-scoped finance columns + create/detail validation", async () => {
    const q = encodeURIComponent(projectId);
    const asAgent = await as(agentCookie).get(`/api/admin/projects?q=${q}`);
    expect(asAgent.body.projects).toHaveLength(1);
    expect(asAgent.body.projects[0]).not.toHaveProperty("sale_price_cents");
    const asFinance = await as(financeCookie).get(
      `/api/admin/projects?q=${q}&milestone=lead`,
    );
    expect(asFinance.body.projects).toHaveLength(1);
    expect(asFinance.body.projects[0]).toHaveProperty("sale_price_cents");
    expect(
      (
        await as(financeCookie).get(
          `/api/admin/projects?q=${q}&milestone=closed`,
        )
      ).body.projects,
    ).toHaveLength(0);
    // unknown milestone filter is ignored (still returns the match)
    expect(
      (
        await as(financeCookie).get(
          `/api/admin/projects?q=${q}&milestone=bogus`,
        )
      ).body.projects,
    ).toHaveLength(1);
    expect((await as(contentCookie).get("/api/admin/projects")).status).toBe(
      403,
    );

    expect(
      (
        await as(agentCookie)
          .post("/api/admin/projects")
          .send({ client_id: 999999999 })
      ).body.error,
    ).toBe("errors.invalidReference");
    expect(
      (
        await as(agentCookie)
          .post("/api/admin/projects")
          .send({ client_id: "abc" })
      ).body.error,
    ).toBe("validation.invalidId");
    expect(
      (
        await as(agentCookie)
          .post("/api/admin/projects")
          .send({ client_id: clientId, adu_plan_id: 999999 })
      ).body.error,
    ).toBe("errors.invalidReference");
    expect(
      (
        await as(financeCookie)
          .post("/api/admin/projects")
          .send({ client_id: clientId })
      ).status,
    ).toBe(403);

    expect(
      (await as(agentCookie).get("/api/admin/projects/x")).body.error,
    ).toBe("validation.invalidId");
    expect(
      (await as(agentCookie).get("/api/admin/projects/GW-NOPE0000")).status,
    ).toBe(404);
    expect(
      (
        await as(agentCookie)
          .patch("/api/admin/projects/GW-NOPE0000")
          .send({ notes: "x" })
      ).status,
    ).toBe(404);
  });

  it("milestone state machine via the API: illegal jumps 409 with no partial write; legal path records events", async () => {
    const patch = (body: object) =>
      as(superCookie).patch(`/api/admin/projects/${projectId}`).send(body);

    // lead → in_build is illegal; the contractor assignment in the same request must not be applied
    const jump = await patch({ contractor_id: ctrId, milestone: "in_build" });
    expect(jump.status).toBe(409);
    expect(jump.body.error).toBe("errors.invalidTransition");
    expect(
      (await as(superCookie).get(`/api/admin/projects/${projectId}`)).body
        .project.contractor_id,
    ).toBeNull();
    expect((await patch({ milestone: "closed" })).status).toBe(409);

    // same-milestone patch is a no-op (no event)
    expect((await patch({ milestone: "lead", notes: "hello" })).status).toBe(
      200,
    );

    expect((await patch({ milestone: "financing" })).status).toBe(200);
    expect((await patch({ milestone: "closed" })).status).toBe(409);
    expect(
      (
        await patch({
          milestone: "contracted",
          contractor_id: ctrId,
          contractor_cost_cents: 5_000_000,
        })
      ).status,
    ).toBe(200);
    expect((await patch({ milestone: "in_build" })).status).toBe(200);
    expect((await patch({ milestone: "closed" })).status).toBe(200);

    // the audited hole: closed → lead
    const reopen = await patch({ milestone: "lead" });
    expect(reopen.status).toBe(409);
    expect(reopen.body.error).toBe("errors.invalidTransition");
    expect((await patch({ milestone: "cancelled" })).status).toBe(409);

    // closed → in_build (re-open one step) → cancelled → (closed illegal) → lead
    expect((await patch({ milestone: "in_build" })).status).toBe(200);
    expect((await patch({ milestone: "cancelled" })).status).toBe(200);
    expect((await patch({ milestone: "closed" })).status).toBe(409);
    const back = await patch({ milestone: "lead" });
    expect(back.status).toBe(200);
    expect(back.body.events.map((e: any) => e.to_milestone)).toEqual([
      "lead",
      "financing",
      "contracted",
      "in_build",
      "closed",
      "in_build",
      "cancelled",
      "lead",
    ]);
  });

  it("concurrent milestone moves from the same state: exactly one wins", async () => {
    const created = await as(superCookie)
      .post("/api/admin/projects")
      .send({ client_id: clientId, adu_plan_id: planId });
    const id = created.body.project_public_id;
    const go = (body: object) =>
      as(superCookie).patch(`/api/admin/projects/${id}`).send(body);
    expect(
      (
        await go({
          milestone: "contracted",
          contractor_id: ctrId,
          contractor_cost_cents: 1_000_000,
        })
      ).status,
    ).toBe(200);

    // in_build and financing are mutually unreachable from each other, so
    // whichever commits first makes the other illegal — never both succeed.
    const results = await Promise.all([
      go({ milestone: "in_build" }),
      go({ milestone: "financing" }),
    ]);
    const wins = results.filter((r) => r.status === 200);
    const losses = results.filter((r) => r.status === 409);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect(
      losses.every((r) => r.body.error === "errors.invalidTransition"),
    ).toBe(true);

    const final = (await as(superCookie).get(`/api/admin/projects/${id}`)).body;
    // one event per accepted move: lead (create) + contracted + the winner
    expect(final.events).toHaveLength(3);
    expect(final.events[2].to_milestone).toBe(final.project.milestone);
  });

  it("transactions never starve the connection pool (regression: settings read inside withTx)", async () => {
    // Test pool size is 2; 5 simultaneous transactional writes used to deadlock
    // because each held a connection while asking the pool for a second one.
    const regs = await Promise.all(
      [1, 2, 3, 4, 5].map((i) =>
        as(affCookie)
          .post("/api/affiliate/clients")
          .send({
            first_name: "Pool",
            last_name: `Race${i}`,
            email: em(`pool${i}`),
            // Distinct people need distinct phones (one person per phone).
            phone: ph(`12${30 + i}`),
            property_address: `${i} Pool Ave`,
            homeowner_consent: true,
          }),
      ),
    );
    expect(regs.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
  }, 60_000);

  // ── Contracts + PDFs ───────────────────────────────────────────────────────

  it("contracts: generate/patch rules, then PDFs are role-scoped, IDOR-safe and localised", async () => {
    const gen = (kind?: string) =>
      as(superCookie)
        .post(`/api/admin/projects/${projectId}/contracts`)
        .send(kind ? { kind } : {});
    expect(
      (
        await as(financeCookie)
          .post(`/api/admin/projects/${projectId}/contracts`)
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await as(superCookie)
          .post("/api/admin/projects/GW-NOPE0000/contracts")
          .send({})
      ).status,
    ).toBe(404);

    // project is back at `lead` with a contractor assigned earlier
    const made = await gen();
    expect(made.status).toBe(201);
    contractId = made.body.id;
    const terms = await gen("affiliate_terms");
    expect(terms.status).toBe(201);

    // PATCH rules
    expect(
      (
        await as(superCookie)
          .patch(`/api/admin/contracts/${contractId}`)
          .send({ storage_url: "http://x.test/a.pdf" })
      ).body.error,
    ).toBe("validation.photoUrl");
    expect(
      (
        await as(superCookie)
          .patch("/api/admin/contracts/999999999")
          .send({ status: "sent" })
      ).status,
    ).toBe(404);
    expect(
      (
        await as(contentCookie)
          .patch(`/api/admin/contracts/${contractId}`)
          .send({ status: "sent" })
      ).status,
    ).toBe(403);

    // PDF: admin (any staff with projects.read) — content lacks it
    const admin = await getBin(
      agentCookie,
      `/api/admin/contracts/${contractId}/pdf?lang=es`,
    );
    expect(admin.status).toBe(200);
    expect(admin.headers["content-type"]).toContain("application/pdf");
    expect(admin.headers["content-disposition"]).toContain(
      `contract-${projectId}-${contractId}.pdf`,
    );
    expect(admin.headers["cache-control"]).toContain("no-store");
    expect(admin.buf.subarray(0, 8).toString()).toBe("%PDF-1.4");
    expect(admin.buf.toString("latin1")).toContain(
      "Resumen del contrato de construcci\\363n",
    );
    const en = await getBin(
      superCookie,
      `/api/admin/contracts/${contractId}/pdf`,
    );
    expect(en.buf.toString("latin1")).toContain(
      "(Construction Agreement Summary)",
    );
    expect(
      (await getBin(contentCookie, `/api/admin/contracts/${contractId}/pdf`))
        .status,
    ).toBe(403);
    expect(
      (await getBin("", `/api/admin/contracts/${contractId}/pdf`)).status,
    ).toBe(401);
    expect(
      (await getBin(superCookie, "/api/admin/contracts/999999999/pdf")).status,
    ).toBe(404);
    expect(
      (await getBin(superCookie, "/api/admin/contracts/abc/pdf")).json.error,
    ).toBe("validation.invalidId");

    // homeowner: own contract yes, others no, affiliate terms never
    expect(
      (await getBin(clientCookie, `/api/client/documents/${contractId}/pdf`))
        .status,
    ).toBe(200);
    expect(
      (await getBin(client2Cookie, `/api/client/documents/${contractId}/pdf`))
        .status,
    ).toBe(404);
    expect(
      (await getBin(clientCookie, `/api/client/documents/${terms.body.id}/pdf`))
        .status,
    ).toBe(404);
    expect(
      (await getBin(affCookie, `/api/client/documents/${contractId}/pdf`))
        .status,
    ).toBe(401);
    const docs = await as(clientCookie).get("/api/client/documents");
    expect(docs.body.documents.map((d: any) => d.id)).toContain(contractId);
    expect(docs.body.documents.map((d: any) => d.id)).not.toContain(
      terms.body.id,
    );

    // contractor: only contractor_client on their own project
    expect(
      (await getBin(ctrCookie, `/api/contractor/contracts/${contractId}/pdf`))
        .status,
    ).toBe(200);
    expect(
      (await getBin(ctr2Cookie, `/api/contractor/contracts/${contractId}/pdf`))
        .status,
    ).toBe(404);
    expect(
      (
        await getBin(
          ctrCookie,
          `/api/contractor/contracts/${terms.body.id}/pdf`,
        )
      ).status,
    ).toBe(404);

    // status lifecycle: sent → signed → immutable; void hides from client + contractor
    expect(
      (
        await as(superCookie)
          .patch(`/api/admin/contracts/${contractId}`)
          .send({
            status: "sent",
            storage_url: "https://files.example.com/c.pdf",
          })
      ).status,
    ).toBe(200);
    expect(
      (
        await as(superCookie)
          .patch(`/api/admin/contracts/${contractId}`)
          .send({ status: "signed" })
      ).status,
    ).toBe(200);
    const [[signed]] = (await db.query(
      `SELECT signed_at FROM project_contracts WHERE id = ?`,
      [contractId],
    )) as any;
    expect(signed.signed_at).not.toBeNull();
    expect(
      (
        await as(superCookie)
          .patch(`/api/admin/contracts/${contractId}`)
          .send({ status: "void" })
      ).body.error,
    ).toBe("errors.invalidTransition");
    const voidable = await gen();
    await as(superCookie)
      .patch(`/api/admin/contracts/${voidable.body.id}`)
      .send({ status: "void" });
    expect(
      (
        await getBin(
          clientCookie,
          `/api/client/documents/${voidable.body.id}/pdf`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await getBin(
          ctrCookie,
          `/api/contractor/contracts/${voidable.body.id}/pdf`,
        )
      ).status,
    ).toBe(404);
    // admin can still render a void contract (audit trail)
    expect(
      (
        await getBin(
          superCookie,
          `/api/admin/contracts/${voidable.body.id}/pdf`,
        )
      ).status,
    ).toBe(200);

    // a contract without a stored snapshot cannot be rendered
    await db.execute(
      `UPDATE project_contracts SET payload_json = NULL WHERE id = ?`,
      [terms.body.id],
    );
    expect(
      (await getBin(superCookie, `/api/admin/contracts/${terms.body.id}/pdf`))
        .status,
    ).toBe(404);
  });

  // ── Photos: allow-list + Vercel Blob upload ────────────────────────────────

  it("photo URL allow-list also honours PHOTO_URL_ALLOWED_HOSTS", async () => {
    const post = (url: string) =>
      as(ctrCookie)
        .post(`/api/contractor/projects/${projectId}/photos`)
        .send({ storage_url: url });
    expect((await post("https://cdn.photos.test/a.jpg")).body.error).toBe(
      "validation.photoUrl",
    );
    process.env.PHOTO_URL_ALLOWED_HOSTS = "cdn.photos.test";
    try {
      expect((await post("https://cdn.photos.test/a.jpg")).status).toBe(201);
      expect(
        (await post("https://cdn.photos.test.evil.io/a.jpg")).body.error,
      ).toBe("validation.photoUrl");
    } finally {
      delete process.env.PHOTO_URL_ALLOWED_HOSTS;
    }
  });

  it("photo upload: storage gate, type sniffing, size cap, ownership, blob call", async () => {
    const up = (
      cookie: string,
      body: Buffer | string,
      type: string,
      id = projectId,
      qs = "",
    ) =>
      request(app)
        .post(`/api/contractor/projects/${id}/photos/upload${qs}`)
        .set("Cookie", cookie)
        .set("Content-Type", type)
        .send(body);
    putMock.mockReset();
    putMock.mockResolvedValue({
      url: "https://store1.public.blob.vercel-storage.com/projects/x-abc.jpg",
    });

    delete process.env.BLOB_READ_WRITE_TOKEN;
    const missing = await up(ctrCookie, JPEG, "image/jpeg");
    expect(missing.status).toBe(503);
    expect(missing.body.error).toBe("errors.storageNotConfigured");
    expect(putMock).not.toHaveBeenCalled();

    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    expect(
      (
        await request(app)
          .post(`/api/contractor/projects/${projectId}/photos/upload`)
          .set("Content-Type", "image/jpeg")
          .send(JPEG)
      ).status,
    ).toBe(401);
    expect((await up(clientCookie, JPEG, "image/jpeg")).status).toBe(401);
    expect((await up(ctr2Cookie, JPEG, "image/jpeg")).status).toBe(404); // not their project
    expect((await up(ctrCookie, "hello", "text/plain")).body.error).toBe(
      "validation.photoFile",
    ); // unsupported type
    expect((await up(ctrCookie, PNG, "image/jpeg")).body.error).toBe(
      "validation.photoFile",
    ); // header lies
    expect(
      (
        await up(
          ctrCookie,
          Buffer.from("<script>alert(1)</script>"),
          "image/png",
        )
      ).body.error,
    ).toBe("validation.photoFile");
    expect(
      (await up(ctrCookie, Buffer.alloc(0), "image/jpeg")).body.error,
    ).toBe("validation.photoFile");
    const big = Buffer.concat([JPEG, Buffer.alloc(4 * 1024 * 1024)]);
    const tooBig = await up(ctrCookie, big, "image/jpeg");
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.error).toBe("errors.payloadTooLarge");
    expect(putMock).not.toHaveBeenCalled();

    const ok = await up(
      ctrCookie,
      JPEG,
      "image/jpeg",
      projectId,
      `?caption=${encodeURIComponent("Slab poured")}`,
    );
    expect(ok.status).toBe(201);
    expect(ok.body.storage_url).toBe(
      "https://store1.public.blob.vercel-storage.com/projects/x-abc.jpg",
    );
    expect(putMock).toHaveBeenCalledTimes(1);
    const [pathname, body, opts] = putMock.mock.calls[0];
    expect(pathname).toMatch(
      new RegExp(`^projects/${projectId}/\\d+-[a-f0-9]{12}\\.jpg$`),
    );
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(opts).toMatchObject({
      access: "public",
      token: "test-token",
      contentType: "image/jpeg",
    });
    const [[row]] = (await db.query(
      `SELECT storage_url, caption FROM project_photos WHERE id = ?`,
      [ok.body.id],
    )) as any;
    expect(row).toEqual({
      storage_url:
        "https://store1.public.blob.vercel-storage.com/projects/x-abc.jpg",
      caption: "Slab poured",
    });
    const png = await up(ctrCookie, PNG, "image/png");
    expect(png.status).toBe(201);
    expect(putMock.mock.calls[1][0]).toMatch(/\.png$/);

    // blob returning a non-https URL is refused and nothing is stored
    putMock.mockResolvedValueOnce({ url: "http://insecure.example/x.jpg" });
    const [[before]] = (await db.query(
      `SELECT COUNT(*) AS n FROM project_photos`,
    )) as any;
    expect((await up(ctrCookie, JPEG, "image/jpeg")).body.error).toBe(
      "errors.storageFailed",
    );
    const [[after]] = (await db.query(
      `SELECT COUNT(*) AS n FROM project_photos`,
    )) as any;
    expect(Number(after.n)).toBe(Number(before.n));

    // cancelled projects reject uploads
    await db.execute(
      `UPDATE projects SET milestone = 'cancelled' WHERE public_id = ?`,
      [projectId],
    );
    expect((await up(ctrCookie, JPEG, "image/jpeg")).body.error).toBe(
      "errors.projectNotActive",
    );
    await db.execute(
      `UPDATE projects SET milestone = 'lead' WHERE public_id = ?`,
      [projectId],
    );

    const photos = await as(ctrCookie).get("/api/contractor/photos");
    expect(photos.body.photos.length).toBeGreaterThanOrEqual(3);
  });

  it("admin self profile: patch fields + avatar blob upload", async () => {
    const me = await as(agentCookie).get("/api/admin/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toContain("@example.com");
    expect(me.body.user).toHaveProperty("phone");
    expect(me.body.user).toHaveProperty("avatar_url");

    expect(
      (await as(agentCookie).patch("/api/admin/me").send({})).body.error,
    ).toBe("validation.invalidField");
    expect(
      (await as(agentCookie).patch("/api/admin/me").send({ phone: "123" })).body
        .error,
    ).toBe("validation.phoneMin");
    expect(
      (await request(app).patch("/api/admin/me").send({ first_name: "X" }))
        .status,
    ).toBe(401);

    const patched = await as(agentCookie)
      .patch("/api/admin/me")
      .send({
        first_name: "Agent",
        last_name: "Profile",
        phone: ph("1212"),
        preferred_language: "es",
      });
    expect(patched.status).toBe(200);
    expect(patched.body.user).toMatchObject({
      first_name: "Agent",
      last_name: "Profile",
      phone: ph("1212"),
      preferred_language: "es",
    });
    expect(patched.body.user).not.toHaveProperty("email", undefined);

    const clearPhone = await as(agentCookie)
      .patch("/api/admin/me")
      .send({ phone: "" });
    expect(clearPhone.status).toBe(200);
    expect(clearPhone.body.user.phone).toBeNull();

    putMock.mockReset();
    putMock.mockResolvedValue({
      url: "https://store1.public.blob.vercel-storage.com/avatars/admins/1-abc.jpg",
    });
    const up = (cookie: string, body: Buffer | string, type: string) =>
      request(app)
        .post("/api/admin/me/avatar")
        .set("Cookie", cookie)
        .set("Content-Type", type)
        .send(body);

    delete process.env.BLOB_READ_WRITE_TOKEN;
    const missing = await up(agentCookie, JPEG, "image/jpeg");
    expect(missing.status).toBe(503);
    expect(missing.body.error).toBe("errors.storageNotConfigured");

    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    expect((await up(clientCookie, JPEG, "image/jpeg")).status).toBe(401);
    expect((await up(agentCookie, PNG, "image/jpeg")).body.error).toBe(
      "validation.photoFile",
    );

    const ok = await up(agentCookie, JPEG, "image/jpeg");
    expect(ok.status).toBe(200);
    expect(ok.body.user.avatar_url).toBe(
      "https://store1.public.blob.vercel-storage.com/avatars/admins/1-abc.jpg",
    );
    expect(putMock).toHaveBeenCalledTimes(1);
    const [pathname, body, opts] = putMock.mock.calls[0];
    expect(pathname).toMatch(/^avatars\/admins\/\d+\/\d+-[a-f0-9]{12}\.jpg$/);
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(opts).toMatchObject({
      access: "public",
      token: "test-token",
      contentType: "image/jpeg",
    });

    await as(agentCookie)
      .patch("/api/admin/me")
      .send({
        preferred_language: "en",
        first_name: "Agent",
        last_name: "One",
      });
  });

  // ── Draws / commissions / staff / settings ─────────────────────────────────

  it("admin draws + commissions lists: filters and role gates; commission patch guards", async () => {
    expect((await as(contentCookie).get("/api/admin/draws")).status).toBe(403);
    expect(
      (await as(agentCookie).get("/api/admin/draws?status=submitted")).status,
    ).toBe(200);
    expect(
      (await as(agentCookie).get("/api/admin/draws?status=bogus")).status,
    ).toBe(200);
    expect(
      (
        await as(financeCookie)
          .patch("/api/admin/draws/999999999")
          .send({ status: "approved" })
      ).status,
    ).toBe(404);
    expect(
      (
        await as(financeCookie)
          .patch("/api/admin/draws/1")
          .send({ status: "pending" })
      ).status,
    ).toBe(400);

    expect((await as(agentCookie).get("/api/admin/commissions")).status).toBe(
      403,
    );
    const filtered = await as(financeCookie).get(
      "/api/admin/commissions?status=void",
    );
    expect(filtered.status).toBe(200);
    expect(
      filtered.body.commissions.every((c: any) => c.status === "void"),
    ).toBe(true);
    expect(
      (await as(financeCookie).get("/api/admin/commissions?status=bogus"))
        .status,
    ).toBe(200);
    expect(
      (
        await as(financeCookie)
          .patch("/api/admin/commissions/999999999")
          .send({ status: "approved" })
      ).status,
    ).toBe(404);
    expect(
      (
        await as(agentCookie)
          .patch("/api/admin/commissions/1")
          .send({ status: "approved" })
      ).status,
    ).toBe(403);
    expect(
      (
        await as(financeCookie)
          .patch("/api/admin/commissions/1")
          .send({ expected_pay_at: "tomorrow" })
      ).status,
    ).toBe(400);
  });

  it("commission edits: amount becomes the project override; pending → approved; invalid jumps 409", async () => {
    const pid = `GW-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const [[cl]] = (await db.query(`SELECT id FROM clients WHERE email = ?`, [
      em("client2"),
    ])) as any;
    const projectDbId = await insertId(
      `INSERT INTO projects (public_id, client_id, affiliate_id, adu_plan_id, milestone, sq_ft)
       VALUES (?, ?, ?, ?, 'lead', 550)`,
      [pid, cl.id, affId, planId],
    );
    const commissionId = await insertId(
      `INSERT INTO affiliate_commissions (affiliate_id, project_id, client_id, amount_cents, status)
       VALUES (?, ?, ?, 550000, 'pending')`,
      [affId, projectDbId, cl.id],
    );
    const patch = (body: object) =>
      as(financeCookie)
        .patch(`/api/admin/commissions/${commissionId}`)
        .send(body);
    expect((await patch({ status: "paid" })).status).toBe(409); // pending → paid is not allowed
    expect(
      (
        await patch({
          amount_cents: 123_400,
          notes: "adjusted",
          expected_pay_at: "2026-12-01",
        })
      ).status,
    ).toBe(200);
    const [[p]] = (await db.query(
      `SELECT commission_override_cents, affiliate_commission_cents FROM projects WHERE id = ?`,
      [projectDbId],
    )) as any;
    expect(p.commission_override_cents).toBe(123_400);
    expect(p.affiliate_commission_cents).toBe(123_400);
    expect((await patch({ status: "approved" })).status).toBe(200);
    expect((await patch({ status: "pending" })).status).toBe(200); // approved → pending is allowed
    expect((await patch({ status: "void" })).status).toBe(200);
    expect((await patch({ status: "approved" })).status).toBe(409); // void → approved is not
    expect((await patch({ status: "pending" })).status).toBe(200); // void → pending is

    // affiliate sees it (amount + status) but not voided ones
    const mine = await as(affCookie).get("/api/affiliate/commissions");
    expect(mine.status).toBe(200);
    expect(
      mine.body.commissions.find((c: any) => c.id === commissionId)
        ?.amount_cents,
    ).toBe(123_400);
  });

  it("admin staff + settings: list/create/validation and settings round-trip", async () => {
    expect((await as(agentCookie).get("/api/admin/staff")).status).toBe(403);
    const list = await as(superCookie).get("/api/admin/staff");
    expect(list.status).toBe(200);
    expect(list.body.staff.some((s: any) => s.email === em("super"))).toBe(
      true,
    );

    const base = {
      email: em("newstaff"),
      first_name: "New",
      last_name: "Staff",
      role: "agent",
      preferred_language: "es",
    };
    expect(
      (
        await as(superCookie)
          .post("/api/admin/staff")
          .send({ ...base, role: "owner" })
      ).body.error,
    ).toBe("validation.invalidField");
    expect(
      (
        await as(superCookie)
          .post("/api/admin/staff")
          .send({ ...base, email: "bad" })
      ).body.error,
    ).toBe("validation.emailInvalid");
    expect(
      (await as(agentCookie).post("/api/admin/staff").send(base)).status,
    ).toBe(403);
    __testClearEmailDryRuns();
    const created = await as(superCookie).post("/api/admin/staff").send(base);
    expect(created.status).toBe(201);
    expect(
      __testGetEmailDryRuns().some(
        (m) => m.to === base.email && /Te agregaron/.test(m.subject),
      ),
    ).toBe(true);
    const dup = await as(superCookie).post("/api/admin/staff").send(base);
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("errors.duplicate");
    expect(
      (
        await as(superCookie)
          .patch(`/api/admin/staff/${created.body.id}`)
          .send({ role: "finance", phone: ph("0101") })
      ).status,
    ).toBe(200);
    expect(
      (
        await as(superCookie)
          .patch("/api/admin/staff/999999999")
          .send({ role: "agent" })
      ).status,
    ).toBe(404);

    // settings
    expect((await as(agentCookie).get("/api/admin/settings")).status).toBe(403);
    expect(
      (await as(contentCookie).put("/api/admin/settings").send({})).status,
    ).toBe(403);
    await withSystemSettingsLock(db, async () => {
      const before = (await as(financeCookie).get("/api/admin/settings")).body
        .settings;
      try {
        expect(
          (
            await as(financeCookie)
              .put("/api/admin/settings")
              .send({ commission_cents_per_sqft: -1 })
          ).status,
        ).toBe(400);
        expect(
          (
            await as(financeCookie)
              .put("/api/admin/settings")
              .send({ commission_payout_days_after_loan_close: 1.5 })
          ).status,
        ).toBe(400);
        const put = await as(financeCookie)
          .put("/api/admin/settings")
          .send({
            commission_payout_days_after_loan_close: 7,
            commission_cents_per_sqft: 1234,
          });
        expect(put.status).toBe(200);
        expect(
          (await as(superCookie).get("/api/admin/settings")).body.settings,
        ).toEqual({
          commission_payout_days_after_loan_close: 7,
          commission_cents_per_sqft: 1234,
          commission_direct_cents_per_sqft: 1234,
          commission_closer_cents_per_sqft:
            before.commission_closer_cents_per_sqft,
          commission_parent_cents_per_sqft:
            before.commission_parent_cents_per_sqft,
        });
      } finally {
        await as(superCookie).put("/api/admin/settings").send(before);
      }
      expect(
        (await as(superCookie).get("/api/admin/settings")).body.settings,
      ).toEqual(before);
    });
  });

  // ── Affiliate / contractor / client read routes ────────────────────────────

  it("affiliate, contractor and client read routes return scoped shapes (and never leak across owners)", async () => {
    const overview = await as(affCookie).get("/api/affiliate/overview");
    expect(overview.body.stats).toMatchObject({
      clicks: expect.any(Number),
      leads: expect.any(Number),
      clients: expect.any(Number),
      commission_pending_cents: expect.any(Number),
      payout_days: expect.any(Number),
    });
    const affClients = await as(affCookie).get("/api/affiliate/clients");
    expect(
      affClients.body.clients.some((c: any) => c.public_id === projectId),
    ).toBe(true);
    for (const banned of [
      "loan_status",
      "sale_price_cents",
      "contractor_cost_cents",
      "net_profit_cents",
    ]) {
      expect(affClients.body.clients[0]).not.toHaveProperty(banned);
    }
    // an affiliate with no projects sees none of this affiliate's clients
    const strangerId = await insertId(
      `INSERT INTO affiliates (email, first_name, last_name, status, referral_code) VALUES (?, 'Stan', 'Ger', 'active', ?)`,
      [em("stranger"), crypto.randomBytes(4).toString("hex").toUpperCase()],
    );
    const stranger = await as(await makeSession("affiliate", strangerId)).get(
      "/api/affiliate/clients",
    );
    expect(stranger.body.clients).toEqual([]);

    const cProjects = await as(ctrCookie).get("/api/contractor/projects");
    expect(
      cProjects.body.projects.some((p: any) => p.public_id === projectId),
    ).toBe(true);
    expect(
      (await as(ctr2Cookie).get("/api/contractor/projects")).body.projects,
    ).toEqual([]);
    expect(
      (await as(ctr2Cookie).get(`/api/contractor/projects/${projectId}`))
        .status,
    ).toBe(404);
    const detail = await as(ctrCookie).get(
      `/api/contractor/projects/${projectId}`,
    );
    expect(detail.status).toBe(200);
    expect(detail.body.project).not.toHaveProperty("sale_price_cents");
    expect(
      detail.body.contracts.every(
        (c: any) => c.kind === "contractor_client" && c.status !== "void",
      ),
    ).toBe(true);
    expect(
      (await as(ctrCookie).get("/api/contractor/projects/x")).body.error,
    ).toBe("validation.invalidId");
    expect((await as(ctrCookie).get("/api/contractor/draws")).status).toBe(200);
    expect(
      (await as(ctrCookie).post("/api/contractor/draws/999999999/submit"))
        .status,
    ).toBe(404);
    expect(
      (await as(ctrCookie).post("/api/contractor/draws/abc/submit")).body.error,
    ).toBe("validation.invalidId");

    const overviewC = await as(clientCookie).get("/api/client/overview");
    expect(
      overviewC.body.projects.some((p: any) => p.public_id === projectId),
    ).toBe(true);
    for (const banned of [
      "sale_price_cents",
      "contractor_cost_cents",
      "affiliate_commission_cents",
      "net_profit_cents",
    ]) {
      expect(overviewC.body.projects[0]).not.toHaveProperty(banned);
    }
    expect(
      (await as(client2Cookie).get("/api/client/overview")).body.projects.some(
        (p: any) => p.public_id === projectId,
      ),
    ).toBe(false);
  });

  // ── Referral link rate limit ───────────────────────────────────────────────

  it("/api/public/r/:code is rate limited per IP but never a dead link, and stops click inflation", async () => {
    process.env.REFERRAL_RATE_LIMIT_MAX = "3";
    const limited = createServer();
    delete process.env.REFERRAL_RATE_LIMIT_MAX;
    const ip = `203.0.113.${(stamp % 200) + 1}`;
    const [[before]] = (await db.query(
      `SELECT COUNT(*) AS n FROM affiliate_link_clicks WHERE affiliate_id = ?`,
      [affId],
    )) as any;

    const statuses: number[] = [];
    const locations: string[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(limited)
        .get(`/api/public/r/${affCode}`)
        .set("X-Forwarded-For", ip);
      statuses.push(res.status);
      locations.push(String(res.headers.location));
    }
    expect(statuses).toEqual([302, 302, 302, 302, 302, 302]);
    // home/enroll now redirect into SPA /r/{code}
    expect(locations.slice(0, 3).every((l) => l === `/r/${affCode}`)).toBe(
      true,
    );
    expect(locations.slice(3).every((l) => l === "/")).toBe(true);
    const [[after]] = (await db.query(
      `SELECT COUNT(*) AS n FROM affiliate_link_clicks WHERE affiliate_id = ?`,
      [affId],
    )) as any;
    expect(Number(after.n) - Number(before.n)).toBe(3);

    // a different IP is unaffected
    const other = await request(limited)
      .get(`/api/public/r/${affCode}`)
      .set("X-Forwarded-For", "198.51.100.77");
    expect(other.headers.location).toBe(`/r/${affCode}`);
  });

  // ── OTP hardening ──────────────────────────────────────────────────────────

  it("OTP request never reveals account state and never claims 'sent' when delivery fails", async () => {
    const req = (actor: string, email: string) =>
      request(app).post(`/api/${actor}/auth/otp/request`).send({ email });

    // unknown, inactive and suspended all look identical (200 sent) and send nothing
    const suspendedId = await insertId(
      `INSERT INTO affiliates (email, first_name, last_name, status, referral_code) VALUES (?, 'Sus', 'Pended', 'suspended', ?)`,
      [em("suspended"), crypto.randomBytes(4).toString("hex").toUpperCase()],
    );
    expect(suspendedId).toBeGreaterThan(0);
    __testClearEmailDryRuns();
    const unknown = await req("affiliate", em("nobody"));
    const suspended = await req("affiliate", em("suspended"));
    expect(suspended.status).toBe(unknown.status);
    expect(suspended.body).toEqual(unknown.body);
    expect(
      __testGetEmailDryRuns().filter(
        (m) => m.to === em("suspended") || m.to === em("nobody"),
      ),
    ).toHaveLength(0);

    // same for every portal (admin/client inactive rows)
    await db.execute(`UPDATE clients SET status = 'inactive' WHERE id = ?`, [
      clientId,
    ]);
    const inactiveClient = await req("client", em("client"));
    expect(inactiveClient.body).toEqual({ ok: true, sent: true });
    await db.execute(`UPDATE clients SET status = 'prospect' WHERE id = ?`, [
      clientId,
    ]);
    const wrong = await request(app)
      .post("/api/affiliate/auth/otp/verify")
      .send({ email: em("suspended"), code: "000000" });
    const wrongUnknown = await request(app)
      .post("/api/affiliate/auth/otp/verify")
      .send({ email: em("nobody"), code: "000000" });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual(wrongUnknown.body);

    // delivery failure for a real account: 502, code burned, nothing usable left
    __testForceEmailFailure(true);
    try {
      const failed = await req("client", em("client"));
      expect(failed.status).toBe(502);
      expect(failed.body.error).toBe("errors.otpSendFailed");
      const [[open]] = (await db.query(
        `SELECT COUNT(*) AS n FROM client_otp_codes WHERE client_id = ? AND consumed_at IS NULL AND expires_at > NOW()`,
        [clientId],
      )) as any;
      expect(Number(open.n)).toBe(0);
      // unknown emails still answer 200 (no enumeration through the failure path)
      expect((await req("client", em("nobody"))).status).toBe(200);
    } finally {
      __testForceEmailFailure(false);
    }
    // and recovers once the provider is back
    __testClearEmailDryRuns();
    const ok = await req("client", em("client"));
    expect(ok.status).toBe(200);
    expect(__testGetEmailDryRuns().some((m) => m.to === em("client"))).toBe(
      true,
    );
  });
});
