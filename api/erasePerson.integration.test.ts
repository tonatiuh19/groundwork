import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { __testSetBillingApi, createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";
import { makeFakeBilling } from "./testFakeBilling";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
const RUN = String(100 + Math.floor(Math.random() * 900));

describe.runIf(hasDb)("erase a person + staff record search", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwerase-${stamp}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const billing = makeFakeBilling();
  const cookies: Record<string, string> = {};
  const ins = async (sql: string, p: unknown[]) => Number(((await db.execute(sql, p as any[])) as any)[0].insertId);
  const count = async (sql: string, p: unknown[]) => Number(((await db.query(sql, p as any[])) as any)[0][0].n);

  beforeAll(async () => {
    process.env.VITEST = "true";
    __testSetBillingApi(billing.fake);
    for (const role of ["admin", "agent"]) {
      const id = await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, ?, 'Er', ?, 'active')`, [em(role), role, role]);
      const t = crypto.randomBytes(32).toString("hex");
      await db.execute(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [id, crypto.createHash("sha256").update(t).digest("hex")]);
      cookies[role] = `gw_admin_sid=${t}`;
    }
  });

  afterAll(async () => {
    __testSetBillingApi(null);
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("client: preview lists what goes; delete erases projects, appointments, lead and the record", async () => {
    const leadId = await ins(`INSERT INTO leads (full_name, first_name, last_name, email, phone, status) VALUES ('Cleo Client', 'Cleo', 'Client', ?, ?, 'qualified')`, [em("cleo"), `951${RUN}0001`]);
    const clientId = await ins(`INSERT INTO clients (first_name, last_name, email, status, lead_id, city) VALUES ('Cleo', 'Client', ?, 'active', ?, 'Fontana')`, [em("cleo"), leadId]);
    await db.execute(`UPDATE leads SET client_id = ? WHERE id = ?`, [clientId, leadId]);
    const projectId = await ins(`INSERT INTO projects (public_id, client_id) VALUES (?, ?)`, [`GW-E${String(stamp).slice(-6)}`, clientId]);
    await ins(`INSERT INTO project_milestone_events (project_id, to_milestone) VALUES (?, 'lead')`, [projectId]);
    await ins(
      `INSERT INTO appointments (title, kind, starts_at, ends_at, timezone, location_type, client_id, ics_uid) VALUES (?, 'call', NOW() + INTERVAL 1 DAY, NOW() + INTERVAL 25 HOUR, 'America/Los_Angeles', 'phone', ?, ?)`,
      [`${prefix}appt`, clientId, `${prefix}appt@test`],
    );

    // Search finds the client and the project (agents see clients + leads + projects per their perms).
    const s = await request(app).get(`/api/admin/search/records?q=${encodeURIComponent("Cleo Cli")}`).set("Cookie", cookies.admin).expect(200);
    expect(s.body.clients.some((c: any) => c.id === clientId)).toBe(true);
    expect(s.body.projects.some((p: any) => p.id === projectId)).toBe(true);
    expect((await request(app).get("/api/admin/search/records?q=C").set("Cookie", cookies.admin).expect(200)).body.clients).toEqual([]);

    await request(app).get(`/api/admin/people/client/${clientId}/erase-preview`).set("Cookie", cookies.agent).expect(403);
    const pv = await request(app).get(`/api/admin/people/client/${clientId}/erase-preview`).set("Cookie", cookies.admin).expect(200);
    expect(pv.body.person).toMatchObject({ entity: "client", name: "Cleo Client" });
    expect(pv.body.counts).toMatchObject({ projects: 1, appointments: 1, leads: 1 });

    await request(app).delete(`/api/admin/people/client/${clientId}`).set("Cookie", cookies.admin).send({}).expect(400);
    await request(app).delete(`/api/admin/people/client/${clientId}`).set("Cookie", cookies.admin).send({ confirm: true, reason: "test record" }).expect(200);
    expect(await count(`SELECT COUNT(*) n FROM clients WHERE id = ?`, [clientId])).toBe(0);
    expect(await count(`SELECT COUNT(*) n FROM projects WHERE id = ?`, [projectId])).toBe(0);
    expect(await count(`SELECT COUNT(*) n FROM project_milestone_events WHERE project_id = ?`, [projectId])).toBe(0);
    expect(await count(`SELECT COUNT(*) n FROM leads WHERE id = ?`, [leadId])).toBe(0);
    expect(await count(`SELECT COUNT(*) n FROM appointments WHERE title = ?`, [`${prefix}appt`])).toBe(0);
    expect(await count(`SELECT COUNT(*) n FROM people_dedupe_log WHERE action = 'delete' AND entity = 'client' AND record_id = ?`, [clientId])).toBe(1);
    await request(app).get(`/api/admin/people/client/${clientId}/erase-preview`).set("Cookie", cookies.admin).expect(404);
  });

  it("affiliate: subscription canceled + customer removed; referred homeowner and sub-affiliate kept, unlinked", async () => {
    const affId = await ins(
      `INSERT INTO affiliates (email, first_name, last_name, status, referral_code, approved_at, billing_customer_id, billing_subscription_id, billing_status, billing_card_last4)
       VALUES (?, 'Ava', 'Gone', 'active', ?, NOW(), 'cus_gwerase', 'sub_gwerase', 'trialing', '4242')`,
      [em("ava"), `GWE${String(stamp).slice(-7)}`],
    );
    const subId = await ins(`INSERT INTO affiliates (email, first_name, last_name, status, referral_code, parent_affiliate_id) VALUES (?, 'Sub', 'Kept', 'active', ?, ?)`, [
      em("sub"),
      `GWS${String(stamp).slice(-7)}`,
      affId,
    ]);
    const referred = await ins(`INSERT INTO clients (first_name, last_name, email, status, affiliate_id) VALUES ('Ref', 'Erred', ?, 'active', ?)`, [em("ref"), affId]);
    billing.subs.set("sub_gwerase", { id: "sub_gwerase", status: "trialing", items: { data: [] } } as any);
    (billing.fake.subscriptions as any).cancel = async (id: string) => ((billing.calls["subscriptions.cancel"] ||= []).push(id), { id, status: "canceled" });
    (billing.fake.customers as any).del = async (id: string) => ((billing.calls["customers.del"] ||= []).push(id), { id, deleted: true });

    const pv = await request(app).get(`/api/admin/people/affiliate/${affId}/erase-preview`).set("Cookie", cookies.admin).expect(200);
    expect(pv.body).toMatchObject({ subscription: true, kept: { referred_clients: 1, sub_affiliates: 1 } });
    await request(app).delete(`/api/admin/people/affiliate/${affId}`).set("Cookie", cookies.admin).send({ confirm: true }).expect(200);
    expect(billing.calls["subscriptions.cancel"]).toContain("sub_gwerase");
    expect(billing.calls["customers.del"]).toContain("cus_gwerase");
    expect(await count(`SELECT COUNT(*) n FROM affiliates WHERE id = ?`, [affId])).toBe(0);
    const [[c]] = (await db.query(`SELECT affiliate_id FROM clients WHERE id = ?`, [referred])) as any;
    expect(c.affiliate_id).toBeNull();
    const [[s]] = (await db.query(`SELECT parent_affiliate_id FROM affiliates WHERE id = ?`, [subId])) as any;
    expect(s.parent_affiliate_id).toBeNull();
  });

  it("contractor: application + documents + draws erased; assigned projects kept and unassigned", async () => {
    const kId = await ins(`INSERT INTO contractors (email, first_name, last_name, status, preferred_language) VALUES (?, 'Kit', 'Gone', 'active', 'en')`, [em("kit")]);
    await ins(`INSERT INTO contractor_applications (contractor_id, application_number, status) VALUES (?, ?, 'draft')`, [kId, `CPQ-2026-E${String(stamp).slice(-5)}`]);
    const ownerClient = await ins(`INSERT INTO clients (first_name, last_name, email, status) VALUES ('Own', 'Er', ?, 'active')`, [em("own")]);
    const pId = await ins(`INSERT INTO projects (public_id, client_id, contractor_id) VALUES (?, ?, ?)`, [`GW-K${String(stamp).slice(-6)}`, ownerClient, kId]);
    await ins(`INSERT INTO draw_requests (project_id, contractor_id, amount_cents, status) VALUES (?, ?, 50000, 'submitted')`, [pId, kId]);

    const pv = await request(app).get(`/api/admin/people/contractor/${kId}/erase-preview`).set("Cookie", cookies.admin).expect(200);
    expect(pv.body.counts).toMatchObject({ draws: 1 });
    expect(pv.body.kept).toMatchObject({ assigned_projects: 1 });
    await request(app).delete(`/api/admin/people/contractor/${kId}`).set("Cookie", cookies.admin).send({ confirm: true }).expect(200);
    expect(await count(`SELECT COUNT(*) n FROM contractors WHERE id = ?`, [kId])).toBe(0);
    expect(await count(`SELECT COUNT(*) n FROM contractor_applications WHERE contractor_id = ?`, [kId])).toBe(0);
    expect(await count(`SELECT COUNT(*) n FROM draw_requests WHERE project_id = ?`, [pId])).toBe(0);
    const [[p]] = (await db.query(`SELECT contractor_id FROM projects WHERE id = ?`, [pId])) as any;
    expect(p.contractor_id).toBeNull();
  });

  it("appointments: staff can attach (and clear) who it's for when editing", async () => {
    const cId = await ins(`INSERT INTO clients (first_name, last_name, email, status) VALUES ('Appt', 'Owner', ?, 'active')`, [em("apo")]);
    const r = await request(app)
      .post("/api/admin/appointments")
      .set("Cookie", cookies.admin)
      .send({ kind: "call", date: "2030-01-15", start: "10:00", duration_minutes: 30, timezone: "America/Los_Angeles", location_type: "phone", title: `${prefix}link`, attendees: [] })
      .expect(201);
    const id = r.body.appointment.id;
    await request(app).patch(`/api/admin/appointments/${id}`).set("Cookie", cookies.admin).send({ client_id: cId, lead_id: null, project_id: null }).expect(200);
    const [[a]] = (await db.query(`SELECT client_id FROM appointments WHERE id = ?`, [id])) as any;
    expect(Number(a.client_id)).toBe(cId);
    await request(app).patch(`/api/admin/appointments/${id}`).set("Cookie", cookies.admin).send({ client_id: null, lead_id: null, project_id: null }).expect(200);
    const [[b]] = (await db.query(`SELECT client_id FROM appointments WHERE id = ?`, [id])) as any;
    expect(b.client_id).toBeNull();
  });
});
