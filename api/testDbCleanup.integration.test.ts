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
    const unknownId = await insertId(`INSERT INTO conversation_unknown_contacts (phone_e164, ofg_number_id) VALUES ('+13105550100', ?)`, [lineId]);
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
    return { adminId, affId, clientId, lineId, unknownId, lineConv, contactId, contactConv, templateId, statusId, dedupeId, bellId, eventId, billingActionId, cardLinkId };
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
