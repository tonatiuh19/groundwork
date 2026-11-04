import "dotenv/config";
import crypto from "crypto";
import type { ResultSetHeader } from "mysql2";
import { afterAll, describe, expect, it } from "vitest";
import {
  cleanupPortalFixturesByPrefix,
  createIntegrationTestPool,
  findTestFixturePrefixes,
  sweepTestFixtures,
} from "./testDbCleanup";
import { __testInsertAdminInAppNotification } from "./index";

/**
 * The cleanup helper itself: every fixture shape the suites create (including
 * rows whose FK is SET NULL and FK-less logs) must be gone afterwards, and
 * rows outside the prefix must never be touched.
 */
describe.skipIf(!process.env.DB_HOST)("testDbCleanup", () => {
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwclean-${stamp}-`;
  const insertId = async (sql: string, params: unknown[]) =>
    Number(((await db.query(sql, params)) as unknown as [ResultSetHeader])[0].insertId);
  const count = async (sql: string, params: unknown[]) =>
    Number(((await db.query(sql, params)) as any)[0][0].n);

  let bystanderId = 0;
  const bystanderEmail = `gwclean-bystander-${stamp}@example.com`;

  afterAll(async () => {
    try {
      await db.query(`DELETE FROM admins WHERE email = ?`, [bystanderEmail]);
      await cleanupPortalFixturesByPrefix(db, prefix);
      await cleanupPortalFixturesByPrefix(db, `gwclean-${stamp - 3 * 3_600_000}-`);
    } finally {
      await db.end();
    }
  });

  /** One fixture of every kind the suites create; returns their ids. */
  const seed = async (p: string) => {
    const e = (n: string) => `${p}${n}@example.com`;
    const adminId = await insertId(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Clean', 'Test', 'agent', 'active')`, [e("admin")]);
    const affId = await insertId(
      `INSERT INTO affiliates (email, first_name, last_name, status, referral_code) VALUES (?, 'Clean', 'Aff', 'active', ?)`,
      [e("aff"), `C${crypto.randomBytes(5).toString("hex").toUpperCase()}`],
    );
    const clientId = await insertId(`INSERT INTO clients (first_name, last_name, email, status, affiliate_id) VALUES ('Clean', 'Client', ?, 'prospect', ?)`, [e("client"), affId]);
    await insertId(`INSERT INTO projects (public_id, client_id, affiliate_id) VALUES (?, ?, ?)`, [`C${crypto.randomBytes(6).toString("hex").toUpperCase()}`, clientId, affId]);
    const lineId = await insertId(
      `INSERT INTO admin_phone_numbers (e164, friendly_name, assigned_admin_id, is_active) VALUES (?, 'Clean line', ?, 1)`,
      [`+1555${crypto.randomInt(1_000_000, 9_999_999)}`, adminId],
    );
    const unknownId = await insertId(`INSERT INTO conversation_unknown_contacts (phone_e164, ofg_number_id) VALUES ('+15555550100', ?)`, [lineId]);
    const lineConv = await insertId(`INSERT INTO conversations (channel, ofg_number_id, unknown_contact_id) VALUES ('sms', ?, ?)`, [lineId, unknownId]);
    await insertId(`INSERT INTO conversation_messages (conversation_id, channel, direction, body) VALUES (?, 'sms', 'inbound', 'hi')`, [lineConv]);
    const contactId = await insertId(`INSERT INTO contacts (first_name, last_name, email, created_by_admin_id) VALUES ('Clean', 'Contact', ?, ?)`, [e("contact"), adminId]);
    const contactConv = await insertId(`INSERT INTO conversations (channel, contact_id) VALUES ('sms', ?)`, [contactId]);
    const templateId = await insertId(`INSERT INTO conversation_templates (title, body_en, created_by_admin_id) VALUES ('Clean tpl', 'Hi', ?)`, [adminId]);
    const statusId = await insertId(`INSERT INTO deal_statuses (label_en, label_es, tone, sort_order) VALUES (?, ?, 'warn', 99)`, [`${p}Status`, `${p}Estado`]);
    const dedupeId = await insertId(
      `INSERT INTO people_dedupe_log (action, entity, record_id, reason) VALUES ('blocked', 'client', ?, ?)`,
      [clientId, `partner referral: Clean <${e("taken")}>`],
    );
    // Bell row about the fixture for an admin outside the prefix (the old
    // real-staff leak shape) — only the body match can remove it, not a cascade.
    const bellId = await insertId(
      `INSERT INTO admin_notifications (admin_id, event_key, title, body) VALUES (?, 'lead_converted', 'Lead converted', ?)`,
      [bystanderId, `Lee (${e("lead")}) → GW-TEST`],
    );
    const eventId = await insertId(
      `INSERT INTO marketing_events (slug, title_en, title_es, city, starts_at, status, created_by_admin_id) VALUES (?, 'Clean event', 'Evento', 'Fontana', NOW() + INTERVAL 3 DAY, 'draft', ?)`,
      [`${p}event`, adminId],
    );
    const billingActionId = await insertId(
      `INSERT INTO billing_admin_actions (member_role, member_id, admin_id, action, reason) VALUES ('affiliate', ?, ?, 'extend', 'cleanup test')`,
      [affId, adminId],
    );
    const cardLinkId = await insertId(
      `INSERT INTO billing_card_links (member_role, member_id, token_hash, created_by_admin_id, expires_at) VALUES ('affiliate', ?, ?, ?, NOW() + INTERVAL 1 DAY)`,
      [affId, crypto.randomBytes(32).toString("hex"), adminId],
    );
    const mailboxId = await insertId(`INSERT INTO mailboxes (email, kind, owner_admin_id) VALUES (?, 'personal', ?)`, [e("box"), adminId]);
    const mailThreadId = await insertId(`INSERT INTO mail_threads (mailbox_id, graph_conversation_id) VALUES (?, ?)`, [mailboxId, `${p}conv`]);
    await insertId(
      `INSERT INTO mail_messages (mailbox_id, thread_id, graph_id, folder, direction, sent_at) VALUES (?, ?, ?, 'inbox', 'inbound', NOW())`,
      [mailboxId, mailThreadId, `${p}msg`],
    );
    const mailDraftId = await insertId(`INSERT INTO mail_drafts (mailbox_id, admin_id, mode, subject) VALUES (?, ?, 'new', ?)`, [mailboxId, adminId, `${p}draft`]);
    // Automation built by fixture staff + a run for the fixture affiliate in it (FK-less subject).
    const flowId = await insertId(`INSERT INTO reminder_flows (name, trigger_event, created_by_admin_id) VALUES (?, 'affiliate_signup', ?)`, [`${p}Flow`, adminId]);
    const flowRunId = await insertId(`INSERT INTO reminder_flow_runs (flow_id, subject_kind, subject_id, status) VALUES (?, 'affiliate', ?, 'stopped')`, [flowId, affId]);
    const caTemplateVersion = Number(((await db.query(`SELECT COALESCE(MAX(version), 0) + 1000 v FROM construction_agreement_templates`)) as any)[0][0].v);
    await insertId(`INSERT INTO construction_agreement_templates (version, body_en, notes) VALUES (?, 'x', ?)`, [caTemplateVersion, `${p}template`]);
    const legalVersion = 7_000_000 + (Number(String(Date.now()).slice(-6)) % 900_000);
    await insertId(`INSERT INTO legal_documents (slug, version, title_en, title_es, body_en, body_es, notes) VALUES ('terms', ?, 't', 't', 'x', 'x', ?)`, [legalVersion, `${p}legal`]);
    await insertId(`INSERT INTO legal_acceptances (person_kind, person_id, slug, version) VALUES ('affiliate', ?, 'terms', ?)`, [affId, legalVersion]);
    const qrId = await insertId(`INSERT INTO qr_links (slug, label, destination_url) VALUES (?, 'x', '/')`, [`${p}qr`]);
    const cityId = await insertId(`INSERT INTO service_cities (name, active) VALUES (?, 0)`, [`${p}city`]);
    const cityPartnerId = await insertId(`INSERT INTO city_partners (email, first_name, company) VALUES (?, 'Cp', 'Cp LLC')`, [`${p}cp@example.com`]);
    await db.execute(`INSERT INTO city_partner_cities (city_partner_id, city_id) VALUES (?, ?)`, [cityPartnerId, cityId]);
    await insertId(`INSERT INTO city_activities (city_id, city_partner_id, occurred_on, activity_type, summary) VALUES (?, ?, CURDATE(), 'call', 'x')`, [cityId, cityPartnerId]);
    // Scorecard rows for the fixture affiliate (FK-less subject).
    await insertId(`INSERT INTO scorecard_weeks (subject_type, subject_id, scorecard, week_start, metrics_json) VALUES ('affiliate', ?, 'affiliate', '2026-01-05', '[]')`, [affId]);
    await insertId(`INSERT INTO scorecard_actions (subject_type, subject_id, scorecard, week_start, kind, body) VALUES ('affiliate', ?, 'affiliate', '2026-01-05', 'note', 'x')`, [affId]);
    await insertId(`INSERT INTO scorecard_time_off (subject_type, subject_id, starts_on, ends_on) VALUES ('affiliate', ?, '2026-01-05', '2026-01-06')`, [affId]);
    await insertId(`INSERT INTO scorecard_activities (subject_type, subject_id, kind, occurred_at) VALUES ('affiliate', ?, 'event_held', NOW())`, [affId]);
    return { qrId, cityId, cityPartnerId, legalVersion, caTemplateVersion, flowId, flowRunId, mailDraftId, mailboxId, mailThreadId, adminId, affId, clientId, lineId, unknownId, lineConv, contactId, contactConv, templateId, statusId, dedupeId, bellId, eventId, billingActionId, cardLinkId };
  };

  const remaining = async (f: Awaited<ReturnType<typeof seed>>) => ({
    admins: await count(`SELECT COUNT(*) n FROM admins WHERE id = ?`, [f.adminId]),
    affiliates: await count(`SELECT COUNT(*) n FROM affiliates WHERE id = ?`, [f.affId]),
    clients: await count(`SELECT COUNT(*) n FROM clients WHERE id = ?`, [f.clientId]),
    projects: await count(`SELECT COUNT(*) n FROM projects WHERE client_id = ?`, [f.clientId]),
    line: await count(`SELECT COUNT(*) n FROM admin_phone_numbers WHERE id = ?`, [f.lineId]),
    unknown: await count(`SELECT COUNT(*) n FROM conversation_unknown_contacts WHERE id = ?`, [f.unknownId]),
    threads: await count(`SELECT COUNT(*) n FROM conversations WHERE id IN (?, ?)`, [f.lineConv, f.contactConv]),
    messages: await count(`SELECT COUNT(*) n FROM conversation_messages WHERE conversation_id = ?`, [f.lineConv]),
    contact: await count(`SELECT COUNT(*) n FROM contacts WHERE id = ?`, [f.contactId]),
    template: await count(`SELECT COUNT(*) n FROM conversation_templates WHERE id = ?`, [f.templateId]),
    status: await count(`SELECT COUNT(*) n FROM deal_statuses WHERE id = ?`, [f.statusId]),
    dedupe: await count(`SELECT COUNT(*) n FROM people_dedupe_log WHERE id = ?`, [f.dedupeId]),
    bell: await count(`SELECT COUNT(*) n FROM admin_notifications WHERE id = ?`, [f.bellId]),
    event: await count(`SELECT COUNT(*) n FROM marketing_events WHERE id = ?`, [f.eventId]),
    billingAction: await count(`SELECT COUNT(*) n FROM billing_admin_actions WHERE id = ?`, [f.billingActionId]),
    cardLink: await count(`SELECT COUNT(*) n FROM billing_card_links WHERE id = ?`, [f.cardLinkId]),
    mailbox: await count(`SELECT COUNT(*) n FROM mailboxes WHERE id = ?`, [f.mailboxId]),
    mailThread: await count(`SELECT COUNT(*) n FROM mail_threads WHERE id = ?`, [f.mailThreadId]),
    mailMessages: await count(`SELECT COUNT(*) n FROM mail_messages WHERE thread_id = ?`, [f.mailThreadId]),
    mailDraft: await count(`SELECT COUNT(*) n FROM mail_drafts WHERE id = ?`, [f.mailDraftId]),
    flow: await count(`SELECT COUNT(*) n FROM reminder_flows WHERE id = ?`, [f.flowId]),
    legalDoc: await count(`SELECT COUNT(*) n FROM legal_documents WHERE slug = 'terms' AND version = ?`, [f.legalVersion]),
    legalAccept: await count(`SELECT COUNT(*) n FROM legal_acceptances WHERE person_kind = 'affiliate' AND person_id = ?`, [f.affId]),
    caTemplate: await count(`SELECT COUNT(*) n FROM construction_agreement_templates WHERE version = ?`, [f.caTemplateVersion]),
    flowRun: await count(`SELECT COUNT(*) n FROM reminder_flow_runs WHERE id = ?`, [f.flowRunId]),
    qrLink: await count(`SELECT COUNT(*) n FROM qr_links WHERE id = ?`, [f.qrId]),
    city: await count(`SELECT COUNT(*) n FROM service_cities WHERE id = ?`, [f.cityId]),
    cityPartner: await count(`SELECT COUNT(*) n FROM city_partners WHERE id = ?`, [f.cityPartnerId]),
    cityActivity: await count(`SELECT COUNT(*) n FROM city_activities WHERE city_id = ?`, [f.cityId]),
    scorecards: await count(
      `SELECT (SELECT COUNT(*) FROM scorecard_weeks WHERE subject_type = 'affiliate' AND subject_id = ?)
            + (SELECT COUNT(*) FROM scorecard_actions WHERE subject_type = 'affiliate' AND subject_id = ?)
            + (SELECT COUNT(*) FROM scorecard_time_off WHERE subject_type = 'affiliate' AND subject_id = ?)
            + (SELECT COUNT(*) FROM scorecard_activities WHERE subject_type = 'affiliate' AND subject_id = ?) AS n`,
      [f.affId, f.affId, f.affId, f.affId],
    ),
  });
  const allZero = (r: Record<string, number>) => Object.fromEntries(Object.keys(r).map((k) => [k, 0]));

  it("removes every fixture shape, including SET NULL children and FK-less logs", async () => {
    bystanderId = await insertId(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'By', 'Stander', 'agent', 'active')`, [bystanderEmail]);
    const f = await seed(prefix);
    // A non-prefixed lookalike must survive.
    const keepId = await insertId(`INSERT INTO conversation_templates (title, body_en) VALUES (?, 'keep')`, [`gwclean-keep-${stamp}`]);
    try {
      const before = await remaining(f);
      expect(Object.values(before).every((n) => n >= 1)).toBe(true);
      await cleanupPortalFixturesByPrefix(db, prefix);
      const after = await remaining(f);
      expect(after).toEqual(allZero(after));
      expect(await count(`SELECT COUNT(*) n FROM conversation_templates WHERE id = ?`, [keepId])).toBe(1);
    } finally {
      await db.query(`DELETE FROM conversation_templates WHERE id = ?`, [keepId]);
    }
  });

  it("sandbox: bell rows are never written for real staff, only @example admins", async () => {
    const [[real]] = (await db.query(`SELECT id FROM admins WHERE email NOT LIKE '%@example.%' AND status = 'active' ORDER BY id LIMIT 1`)) as any;
    if (real) {
      const id = await __testInsertAdminInAppNotification({ adminId: Number(real.id), eventKey: "lead_converted", title: `${prefix}guard`, body: `${prefix}guard` });
      expect(id).toBeNull();
      expect(await count(`SELECT COUNT(*) n FROM admin_notifications WHERE admin_id = ? AND title = ?`, [real.id, `${prefix}guard`])).toBe(0);
    }
    const testAdmin = await insertId(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Bell', 'Test', 'agent', 'active')`, [`${prefix}bell@example.com`]);
    const id = await __testInsertAdminInAppNotification({ adminId: testAdmin, eventKey: "lead_converted", title: "guard", body: null });
    expect(id).toBeGreaterThan(0);
  });

  it("refuses empty / short prefixes", async () => {
    await expect(cleanupPortalFixturesByPrefix(db, "")).rejects.toThrow(/refusing/);
    await expect(cleanupPortalFixturesByPrefix(db, "gw-")).rejects.toThrow(/refusing/);
  });

  it("sweeper finds interrupted runs by prefix and only sweeps stamps the filter allows", async () => {
    const stalePrefix = `gwclean-${stamp - 3 * 3_600_000}-`;
    const stale = await seed(stalePrefix);
    const fresh = await seed(prefix);
    const found = await findTestFixturePrefixes(db);
    expect(found.has(stalePrefix)).toBe(true);
    expect(found.has(prefix)).toBe(true);

    const swept = await sweepTestFixtures(db, (s) => s < stamp - 2 * 3_600_000);
    expect(swept).toContain(stalePrefix);
    expect(swept).not.toContain(prefix);
    const staleLeft = await remaining(stale);
    expect(staleLeft).toEqual(allZero(staleLeft));
    expect((await remaining(fresh)).admins).toBe(1);
    await cleanupPortalFixturesByPrefix(db, prefix);
  });
});
