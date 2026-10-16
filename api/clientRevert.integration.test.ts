import "dotenv/config";
import crypto from "crypto";
import type { ResultSetHeader } from "mysql2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

/**
 * "Move back to Leads" — undo a client conversion. Every origin (lead,
 * Conversations unknown, CRM contact, created directly), what is kept
 * (threads, notes, affiliate), what is removed (client, empty project, unused
 * invite), the real-progress blockers, permissions, dry runs and MCP.
 */
describe.runIf(hasDb)("client → lead revert (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwrevert-${stamp}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const tail = String(100000 + Math.floor(Math.random() * 899999));
  const ph = (d: number) => `+1951${tail}${d}`;
  const lineE164 = `+1555${tail}9`;
  let superId = 0;
  let superCookie = "";
  let agentCookie = "";
  let lineId = 0;
  let affId = 0;
  let rpc = 1;

  const insertId = async (sql: string, params: unknown[]) =>
    Number(((await db.execute(sql, params as any[])) as unknown as [ResultSetHeader])[0].insertId);
  const one = async (sql: string, params: unknown[]) => ((await db.query(sql, params)) as any)[0][0];
  const count = async (sql: string, params: unknown[]) => Number((await one(sql, params)).n);
  const session = async (adminId: number) => {
    const token = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, ?)`, [
      adminId,
      crypto.createHash("sha256").update(token).digest("hex"),
      new Date(Date.now() + 86_400_000),
    ]);
    return `gw_admin_sid=${token}`;
  };
  const as = (c: string) => ({
    get: (u: string) => request(app).get(u).set("Cookie", c),
    post: (u: string) => request(app).post(u).set("Cookie", c),
    patch: (u: string) => request(app).patch(u).set("Cookie", c),
  });
  const inboundSms = (from: string, body: string) =>
    request(app)
      .post("/api/webhooks/twilio/sms")
      .type("form")
      .send({ From: from, To: lineE164, Body: body, MessageSid: `SM${crypto.randomBytes(8).toString("hex")}` })
      .expect(200);
  const directClient = (n: string, phone: string | null, email: string | null = em(n)) =>
    insertId(
      `INSERT INTO clients (first_name, last_name, email, phone, status, affiliate_id) VALUES ('Direct', ?, ?, ?, 'prospect', ?)`,
      [n, email, phone, affId],
    );

  beforeAll(async () => {
    process.env.VITEST = "true";
    superId = await insertId(
      `INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Rev', 'Super', 'super_admin', 'active')`,
      [em("super")],
    );
    const agentId = await insertId(
      `INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Rev', 'Agent', 'agent', 'active')`,
      [em("agent")],
    );
    superCookie = await session(superId);
    agentCookie = await session(agentId);
    lineId = await insertId(
      `INSERT INTO admin_phone_numbers (e164, friendly_name, assigned_admin_id, line_mode, is_active) VALUES (?, 'Revert test line', ?, 'personal', 1)`,
      [lineE164, superId],
    );
    affId = await insertId(
      `INSERT INTO affiliates (email, first_name, last_name, status, referral_code) VALUES (?, 'Ref', 'Aff', 'active', ?)`,
      [em("aff"), `R${crypto.randomBytes(5).toString("hex").toUpperCase()}`],
    );
  });

  afterAll(async () => {
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("lead origin: lead returns to Active; threads, notes and affiliate kept; client, project and invite removed", async () => {
    const leadId = await insertId(
      `INSERT INTO leads (first_name, last_name, full_name, email, phone, status, affiliate_id) VALUES ('Lena', 'Lead', 'Lena Lead', ?, ?, 'new', ?)`,
      [em("lead"), ph(1), affId],
    );
    const conv = await as(superCookie).post(`/api/admin/leads/${leadId}/convert`).send({ target: "client" }).expect(201);
    const clientId = Number(conv.body.client_id);
    await as(superCookie).post(`/api/admin/clients/${clientId}/updates`).send({ body: "Internal: wrong person", share_with_affiliate: false }).expect(201);
    await inboundSms(ph(1), "Hi, any news?");
    const thread = await one(`SELECT id FROM conversations WHERE client_id = ? LIMIT 1`, [clientId]);
    expect(thread).toBeTruthy();

    // Agents can convert, but only super_admin / admin can undo.
    await as(agentCookie).get(`/api/admin/clients/${clientId}/revert-preview`).expect(403);
    await as(agentCookie).post(`/api/admin/clients/${clientId}/revert-to-lead`).send({}).expect(403);

    const preview = await as(superCookie).get(`/api/admin/clients/${clientId}/revert-preview`).expect(200);
    expect(preview.body.plan).toMatchObject({ origin: "lead", blockers: [], counts: { projects: 1, invites: 1, notes: 1 } });
    expect(preview.body.plan.leads[0].id).toBe(leadId);
    expect(preview.body.plan.counts.conversations).toBeGreaterThanOrEqual(1);

    // dry_run changes nothing.
    await as(superCookie).post(`/api/admin/clients/${clientId}/revert-to-lead`).send({ dry_run: true }).expect(200);
    expect(await count(`SELECT COUNT(*) n FROM clients WHERE id = ?`, [clientId])).toBe(1);
    await as(superCookie).post(`/api/admin/clients/${clientId}/revert-to-lead`).send({ lead_status: "spam" }).expect(400);

    const res = await as(superCookie)
      .post(`/api/admin/clients/${clientId}/revert-to-lead`)
      .send({ lead_status: "contacted", reason: "Converted the wrong person" })
      .expect(200);
    expect(res.body.result.lead_id).toBe(leadId);

    expect(await count(`SELECT COUNT(*) n FROM clients WHERE id = ?`, [clientId])).toBe(0);
    expect(await count(`SELECT COUNT(*) n FROM projects WHERE client_id = ?`, [clientId])).toBe(0);
    expect(await count(`SELECT COUNT(*) n FROM client_portal_invites WHERE client_id = ?`, [clientId])).toBe(0);
    const lead = await one(`SELECT client_id, status, notes, affiliate_id FROM leads WHERE id = ?`, [leadId]);
    expect(lead).toMatchObject({ client_id: null, status: "contacted", affiliate_id: affId });
    expect(lead.notes).toContain(`Moved back from client #${clientId}`);
    expect(lead.notes).toContain("Converted the wrong person");
    expect(lead.notes).toContain("Internal: wrong person");

    // The thread and its messages survive, now on the lead's phone (unknown contact on the same line).
    const moved = await one(`SELECT client_id, unknown_contact_id, ofg_number_id FROM conversations WHERE id = ?`, [thread.id]);
    expect(moved).toMatchObject({ client_id: null, ofg_number_id: lineId });
    expect(moved.unknown_contact_id).toBeTruthy();
    expect(await count(`SELECT COUNT(*) n FROM conversation_messages WHERE conversation_id = ?`, [thread.id])).toBeGreaterThanOrEqual(1);

    const active = await as(superCookie).get(`/api/admin/leads?view=active&q=${encodeURIComponent(em("lead"))}`).expect(200);
    const row = active.body.leads.find((l: { id: number }) => l.id === leadId);
    expect(row).toBeTruthy();
    expect(row.last_sms?.thread?.kind).toBe("unknown");

    const audit = await one(`SELECT action, entity, target_entity, target_id, admin_id, snapshot_json FROM people_dedupe_log WHERE action = 'revert' AND record_id = ?`, [clientId]);
    expect(audit).toMatchObject({ action: "revert", entity: "client", target_entity: "lead", target_id: leadId, admin_id: superId });
    const snap = typeof audit.snapshot_json === "string" ? JSON.parse(audit.snapshot_json) : audit.snapshot_json;
    expect(snap.removed.email).toBe(em("lead"));
    expect(snap.projects).toHaveLength(1);

    // Staff alert lands in the (test) super admin's bell only.
    expect(await count(`SELECT COUNT(*) n FROM admin_notifications WHERE admin_id = ? AND title LIKE 'Conversion undone%'`, [superId])).toBe(1);

    // Re-converting later works normally.
    await as(superCookie).post(`/api/admin/leads/${leadId}/convert`).send({ target: "client" }).expect(201);
  });

  it("Conversations origin: unknown contact reopened with the thread and an internal note", async () => {
    await inboundSms(ph(2), "Hello, I saw your ad");
    const unknown = await one(`SELECT id FROM conversation_unknown_contacts WHERE ofg_number_id = ? AND phone_e164 = ?`, [lineId, ph(2)]);
    const made = await as(superCookie)
      .post(`/api/admin/conversations/unknown/${unknown.id}/create-prospect`)
      .send({ first_name: "Una", last_name: "Known", email: em("unknown") })
      .expect(200);
    const clientId = Number(made.body.client_id);
    await as(superCookie).post(`/api/admin/clients/${clientId}/updates`).send({ body: "Spoke once, not interested yet", share_with_affiliate: false }).expect(201);

    const preview = await as(superCookie).get(`/api/admin/clients/${clientId}/revert-preview`).expect(200);
    expect(preview.body.plan).toMatchObject({ origin: "unknown", unknown_contact_ids: [Number(unknown.id)], blockers: [] });

    const res = await as(superCookie).post(`/api/admin/clients/${clientId}/revert-to-lead`).send({}).expect(200);
    expect(res.body.result).toMatchObject({ lead_id: null, unknown_contact_id: Number(unknown.id) });
    expect(await one(`SELECT status, linked_client_id FROM conversation_unknown_contacts WHERE id = ?`, [unknown.id])).toMatchObject({
      status: "open",
      linked_client_id: null,
    });
    const thread = await one(`SELECT id FROM conversations WHERE unknown_contact_id = ? LIMIT 1`, [unknown.id]);
    expect(thread).toBeTruthy();
    const note = await one(
      `SELECT body FROM conversation_messages WHERE conversation_id = ? AND direction = 'internal' ORDER BY id DESC LIMIT 1`,
      [thread.id],
    );
    expect(note.body).toContain("Spoke once, not interested yet");
    expect(await count(`SELECT COUNT(*) n FROM clients WHERE id = ?`, [clientId])).toBe(0);
  });

  it("CRM contact origin: contact un-converted and threads moved back to it", async () => {
    const contactId = await insertId(
      `INSERT INTO contacts (first_name, last_name, email, phone, created_by_admin_id) VALUES ('Cora', 'Contact', ?, ?, ?)`,
      [em("contact"), ph(3), superId],
    );
    const convId = await insertId(`INSERT INTO conversations (channel, ofg_number_id, contact_id) VALUES ('sms', ?, ?)`, [lineId, contactId]);
    await insertId(`INSERT INTO conversation_messages (conversation_id, channel, direction, body) VALUES (?, 'sms', 'inbound', 'hey')`, [convId]);
    const made = await as(superCookie).post(`/api/admin/contacts/${contactId}/convert`).send({}).expect(200);
    const clientId = Number(made.body.client_id);
    expect(await one(`SELECT client_id FROM conversations WHERE id = ?`, [convId])).toMatchObject({ client_id: clientId });

    const res = await as(superCookie).post(`/api/admin/clients/${clientId}/revert-to-lead`).send({}).expect(200);
    expect(res.body.plan.origin).toBe("contact");
    expect(res.body.result.contact_id).toBe(contactId);
    expect(await one(`SELECT converted_client_id, converted_at FROM contacts WHERE id = ?`, [contactId])).toMatchObject({
      converted_client_id: null,
      converted_at: null,
    });
    expect(await one(`SELECT client_id, contact_id FROM conversations WHERE id = ?`, [convId])).toMatchObject({ client_id: null, contact_id: contactId });
  });

  it("created directly: a new lead is made from the client's info (affiliate kept)", async () => {
    const clientId = await directClient("direct", ph(4));
    await db.execute(`UPDATE clients SET admin_notes = 'Met at the Fontana event' WHERE id = ?`, [clientId]);
    const res = await as(superCookie).post(`/api/admin/clients/${clientId}/revert-to-lead`).send({}).expect(200);
    expect(res.body.plan.origin).toBe("new_lead");
    const lead = await one(`SELECT email, phone, status, source, affiliate_id, notes FROM leads WHERE id = ?`, [res.body.result.lead_id]);
    expect(lead).toMatchObject({ email: em("direct"), phone: ph(4), status: "contacted", source: "client_revert", affiliate_id: affId });
    expect(lead.notes).toContain("Met at the Fontana event");
  });

  it("blocks once real work exists, and changes nothing", async () => {
    const check = async (setup: (clientId: number) => Promise<unknown>, blocker: string, n: string) => {
      const clientId = await directClient(n, ph(5 + ["portal", "progress", "contractor"].indexOf(n)));
      await setup(clientId);
      const p = await as(superCookie).get(`/api/admin/clients/${clientId}/revert-preview`).expect(200);
      expect(p.body.plan.blockers).toContain(blocker);
      const r = await as(superCookie).post(`/api/admin/clients/${clientId}/revert-to-lead`).send({}).expect(409);
      expect(r.body.error).toBe("errors.clientRevertBlocked");
      expect(r.body.blockers).toContain(blocker);
      expect(await count(`SELECT COUNT(*) n FROM clients WHERE id = ?`, [clientId])).toBe(1);
      return clientId;
    };
    const project = (clientId: number, extra = "") =>
      insertId(`INSERT INTO projects (public_id, client_id, affiliate_id${extra ? ", " + extra.split("=")[0] : ""}) VALUES (?, ?, ?${extra ? ", ?" : ""})`, [
        `R${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
        clientId,
        affId,
        ...(extra ? [extra.split("=")[1]] : []),
      ]);
    await check((id) => db.execute(`UPDATE clients SET last_login_at = NOW() WHERE id = ?`, [id]), "portal_used", "portal");
    await check((id) => project(id, "milestone=financing"), "projects_in_progress", "progress");
    const contractorId = await insertId(
      `INSERT INTO contractors (email, first_name, last_name, status) VALUES (?, 'Con', 'Tractor', 'active')`,
      [em("contractor")],
    );
    await check((id) => project(id, `contractor_id=${contractorId}`), "contractor_assigned", "contractor");
    const noInfo = await directClient("noinfo", null, null);
    const p = await as(superCookie).get(`/api/admin/clients/${noInfo}/revert-preview`).expect(200);
    expect(p.body.plan.blockers).toContain("missing_contact_info");
    await db.execute(`DELETE FROM clients WHERE id = ?`, [noInfo]);
  });

  it("MCP revert_client_to_lead: dry-run shows the plan, CONFIRM executes", async () => {
    const clientId = await directClient("mcp", ph(8));
    const call = async (args: Record<string, unknown>) => {
      const r = await request(app)
        .post("/api/mcp")
        .set("Cookie", superCookie)
        .set("Accept", "application/json, text/event-stream")
        .set("Content-Type", "application/json")
        .send({ jsonrpc: "2.0", id: rpc++, method: "tools/call", params: { name: "revert_client_to_lead", arguments: args } });
      expect(r.status).toBe(200);
      let body = r.body && r.body.result ? r.body : null;
      if (!body) body = JSON.parse(String(r.text).split("\n").find((l) => l.startsWith("data: "))!.slice(6));
      return JSON.parse(body.result.content[0].text);
    };
    const dry = await call({ client_id: clientId, lead_status: "new" });
    expect(JSON.stringify(dry)).toContain("new_lead");
    expect(await count(`SELECT COUNT(*) n FROM clients WHERE id = ?`, [clientId])).toBe(1);
    const done = await call({ client_id: clientId, lead_status: "new", reason: "MCP undo", confirm: true, confirm_phrase: "CONFIRM" });
    expect(JSON.stringify(done)).toContain("\"reverted\":true");
    expect(await count(`SELECT COUNT(*) n FROM clients WHERE id = ?`, [clientId])).toBe(0);
    expect(await one(`SELECT status FROM leads WHERE email = ?`, [em("mcp")])).toMatchObject({ status: "new" });
  });
});
