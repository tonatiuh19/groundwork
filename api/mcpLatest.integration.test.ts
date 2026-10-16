import "dotenv/config";
import crypto from "crypto";
import type { ResultSetHeader } from "mysql2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { __testClearSmsDryRuns, createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

/**
 * MCP parity for the latest features: lead scopes + touches, deal status /
 * client updates, affiliate onboarding + sponsors, two-level commissions,
 * event media / QR, phone line modes, templates, and thread-line sending.
 * Writes always dry-run first; SMS/email are dry-run (Vitest sandbox).
 */
describe.runIf(hasDb)("MCP tools for latest features (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwmcp2-${stamp}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const tail = String(100000 + Math.floor(Math.random() * 899999));
  const personalE164 = `+1555${tail}1`;
  const sharedE164 = `+1555${tail}2`;
  let superCookie = "";
  let superId = 0;
  let clientId = 0;
  let affId = 0;
  let subId = 0;
  let statusId = 0;
  let eventId = 0;
  const lineIds: number[] = [];
  let rpc = 1;

  const insertId = async (sql: string, params: unknown[]) => {
    const [r] = await db.execute(sql, params as any[]);
    return Number((r as ResultSetHeader).insertId);
  };
  /** tools/call → parsed JSON payload (handles JSON or SSE framing). */
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await request(app)
      .post("/api/mcp")
      .set("Cookie", superCookie)
      .set("Accept", "application/json, text/event-stream")
      .set("Content-Type", "application/json")
      .send({ jsonrpc: "2.0", id: rpc++, method: "tools/call", params: { name, arguments: args } });
    expect(r.status).toBe(200);
    let body = r.body && r.body.result ? r.body : null;
    if (!body) {
      const line = String(r.text).split("\n").find((l) => l.startsWith("data: "));
      body = JSON.parse(line!.slice(6));
    }
    const text = body.result.content[0].text;
    return { isError: Boolean(body.result.isError), data: JSON.parse(text) };
  };
  const confirm = { confirm: true, confirm_phrase: "CONFIRM" };

  beforeAll(async () => {
    process.env.VITEST = "true";
    superId = await insertId(
      `INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Mcp', 'Super', 'super_admin', 'active')`,
      [em("super")],
    );
    const token = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, ?)`, [
      superId,
      crypto.createHash("sha256").update(token).digest("hex"),
      new Date(Date.now() + 86_400_000),
    ]);
    superCookie = `gw_admin_sid=${token}`;
    const code = () => `T${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
    affId = await insertId(
      `INSERT INTO affiliates (email, first_name, last_name, phone, status, referral_code) VALUES (?, 'Ana', 'Sponsor', ?, 'active', ?)`,
      [em("aff"), `949${tail}1`, code()],
    );
    subId = await insertId(
      `INSERT INTO affiliates (email, first_name, last_name, status, referral_code, parent_affiliate_id) VALUES (?, 'Sam', 'Sub', 'active', ?, ?)`,
      [em("sub"), code(), affId],
    );
    clientId = await insertId(
      `INSERT INTO clients (first_name, last_name, email, phone, status, affiliate_id) VALUES ('Mia', 'Client', ?, ?, 'prospect', ?)`,
      [em("client"), `+1951${tail}3`, affId],
    );
    const projectId = await insertId(
      `INSERT INTO projects (public_id, client_id, affiliate_id, closer_affiliate_id, parent_affiliate_id, sq_ft, commission_plan) VALUES (?, ?, ?, ?, ?, 445, 'two_level')`,
      [`T${crypto.randomBytes(6).toString("hex").toUpperCase()}`, clientId, subId, subId, affId],
    );
    await insertId(
      `INSERT INTO affiliate_commissions (affiliate_id, role, project_id, client_id, amount_cents, status) VALUES (?, 'parent', ?, ?, 133500, 'approved')`,
      [affId, projectId, clientId],
    );
    statusId = await insertId(
      `INSERT INTO deal_statuses (label_en, label_es, tone, sort_order) VALUES (?, ?, 'bad', 999)`,
      [`${prefix}Not enough equity`, `${prefix}Equity insuficiente`],
    );
    eventId = await insertId(
      `INSERT INTO marketing_events (slug, status, starts_at, city, title_en, title_es) VALUES (?, 'published', ?, 'Fontana', 'Past MCP event', 'Evento MCP')`,
      [`${prefix}past`, new Date(Date.now() - 5 * 86_400_000)],
    );
    await insertId(
      `INSERT INTO event_media (event_id, kind, url, embed_provider, is_highlight) VALUES (?, 'embed', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'youtube', 1)`,
      [eventId],
    );
    // Super admin: personal line + member of a shared line; the client's thread lives on the shared line.
    const personal = await insertId(
      `INSERT INTO admin_phone_numbers (e164, friendly_name, assigned_admin_id, is_active, line_mode) VALUES (?, 'MCP personal', ?, 1, 'personal')`,
      [personalE164, superId],
    );
    const shared = await insertId(
      `INSERT INTO admin_phone_numbers (e164, friendly_name, assigned_admin_id, is_active, line_mode) VALUES (?, 'MCP shared', NULL, 1, 'shared')`,
      [sharedE164],
    );
    lineIds.push(personal, shared);
    await db.query(`INSERT INTO phone_line_members (line_id, admin_id, ring_browser) VALUES (?, ?, 1)`, [shared, superId]);
    await insertId(
      `INSERT INTO conversations (client_id, channel, status, ofg_number_id, last_message_at) VALUES (?, 'sms', 'open', ?, NOW())`,
      [clientId, shared],
    );
  });

  afterAll(async () => {
    try {
      await db.query(`DELETE FROM conversation_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE ofg_number_id IN (?))`, [lineIds]);
      await db.query(`DELETE FROM conversations WHERE ofg_number_id IN (?)`, [lineIds]);
      await db.query(`DELETE FROM admin_phone_numbers WHERE id IN (?)`, [lineIds]);
      await db.query(`DELETE FROM marketing_events WHERE id = ?`, [eventId]);
      await cleanupPortalFixturesByPrefix(db, prefix);
      await db.query(`DELETE FROM deal_statuses WHERE id = ?`, [statusId]);
    } finally {
      await db.end();
    }
  });

  it("lists the new tools", async () => {
    const r = await request(app)
      .post("/api/mcp")
      .set("Cookie", superCookie)
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: rpc++, method: "tools/list", params: {} });
    const raw = r.body?.result ? r.body : JSON.parse(String(r.text).split("\n").find((l) => l.startsWith("data: "))!.slice(6));
    const names = raw.result.tools.map((t: { name: string }) => t.name);
    for (const n of ["list_deal_statuses", "set_client_deal_status", "add_client_update", "set_affiliate_subscription_price", "set_affiliate_sponsor", "get_phone_line", "list_message_templates"]) {
      expect(names).toContain(n);
    }
  });

  it("deal status + updates: dry-run first, then writes and shows on get_client", async () => {
    const dry = await call("set_client_deal_status", { client_id: clientId, deal_status: `${prefix}Not enough equity`, note: "Equity too low" });
    expect(dry.data.preview).toBe(true);
    const [[before]] = (await db.query(`SELECT deal_status_id FROM clients WHERE id = ?`, [clientId])) as any;
    expect(before.deal_status_id).toBeNull();

    __testClearSmsDryRuns();
    const done = await call("set_client_deal_status", { client_id: clientId, deal_status: `${prefix}Not enough equity`, note: "Equity too low", ...confirm });
    expect(done.isError).toBe(false);
    await call("add_client_update", { client_id: clientId, body: "Docs received", share_with_affiliate: true, ...confirm });
    const client = await call("get_client", { client_id: clientId });
    expect(client.data.deal_status.id).toBe(statusId);
    expect(client.data.referring_affiliate.id).toBe(affId);
    expect(client.data.updates.map((u: { body: string }) => u.body)).toEqual(expect.arrayContaining(["Docs received", "Equity too low"]));
    const statuses = await call("list_deal_statuses");
    expect(statuses.data.statuses.some((s: { id: number }) => s.id === statusId)).toBe(true);
  });

  it("affiliates: onboarding state, price, sponsor rules, commissions payout readiness", async () => {
    const a = await call("get_affiliate", { affiliate_id: subId });
    expect(a.data.sponsor).toMatchObject({ id: affId });
    expect(a.data.onboarding).toMatchObject({ agreement_signed: false, payout_ready: false });

    await call("set_affiliate_subscription_price", { affiliate_id: affId, price_cents: 4900, ...confirm });
    expect((await call("get_affiliate", { affiliate_id: affId })).data.onboarding.subscription_price_cents).toBe(4900);

    const loop = await call("set_affiliate_sponsor", { affiliate_id: affId, sponsor_affiliate_id: subId, ...confirm });
    expect(loop.isError).toBe(true);
    expect(JSON.stringify(loop.data)).toContain("errors.sponsorCycle");

    const comm = await call("list_commissions", { affiliate_id: affId, role: "parent" });
    expect(comm.data.commissions[0]).toMatchObject({ role: "parent", payout_ready: false });
    const pay = await call("update_commission_status", { commission_id: comm.data.commissions[0].id, status: "paid", ...confirm });
    expect(pay.isError).toBe(true);
    expect(JSON.stringify(pay.data)).toContain("affiliateOnboardingIncomplete");
  });

  it("leads: active/converted scopes with last text + call", async () => {
    await insertId(
      `INSERT INTO leads (full_name, email, phone, property_address, status, source) VALUES ('Lee Active', ?, ?, '1 Test', 'new', 'vitest')`,
      [em("leadA"), `+1951${tail}7`],
    );
    await insertId(
      `INSERT INTO leads (full_name, email, phone, property_address, status, source, client_id) VALUES ('Lee Converted', ?, ?, '1 Test', 'new', 'vitest', ?)`,
      [em("leadB"), `+1951${tail}8`, clientId],
    );
    const active = await call("search_leads", { q: prefix, view: "active" });
    expect(active.data.leads.map((l: { email: string }) => l.email)).toEqual([em("leadA")]);
    expect(active.data.leads[0]).toHaveProperty("last_sms");
    const converted = await call("search_leads", { q: prefix, view: "converted" });
    expect(converted.data.leads.map((l: { email: string }) => l.email)).toEqual([em("leadB")]);
  });

  it("events: past flag, media, QR link", async () => {
    const ev = await call("get_event", { event_id: eventId });
    expect(ev.data.is_past).toBe(true);
    expect(ev.data.qr_url).toMatch(new RegExp(`/e/${prefix}past$`));
    expect(ev.data.media[0]).toMatchObject({ kind: "embed", embed_provider: "youtube", is_highlight: true });
    const list = await call("list_events", { q: prefix });
    expect(list.data.events[0]).toMatchObject({ is_past: true, media_count: 1 });
  });

  it("phone lines + templates + sending from the thread's line", async () => {
    const line = await call("get_phone_line", { e164: sharedE164 });
    expect(line.data.line).toMatchObject({ line_mode: "shared" });
    const mine = await call("list_brand_phone_numbers");
    expect(mine.data.numbers.map((n: { e164: string }) => n.e164).slice(0, 2)).toEqual([personalE164, sharedE164]);
    const tpl = await call("list_message_templates");
    expect(Array.isArray(tpl.data.templates)).toBe(true);
    // Client's thread is on the shared line → preview From = shared, not the personal line.
    const dry = await call("send_sms", { client_id: clientId, body: "Hi from MCP" });
    expect(JSON.stringify(dry.data)).toContain(sharedE164);
    expect(JSON.stringify(dry.data)).not.toContain(personalE164);
  });
});
