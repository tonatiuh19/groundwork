import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createServer } from "./index";
import {
  cleanupPortalFixturesByPrefix,
  createIntegrationTestPool,
} from "./testDbCleanup";

// Unique-per-run test phones: the one-person-per-phone rule must never match other suites or real rows.
const RUN_PHONE = String(100 + Math.floor(Math.random() * 900));
const ph = (last4: string) => `949${RUN_PHONE}${last4}`;

const app = createServer();
const db = createIntegrationTestPool();
const prefix = `gwcamp-${Date.now()}-`;
const em = (name: string) => `${prefix}${name}@example.com`;

async function makeSession(id: number): Promise<string> {
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
  get: (u: string) => request(app).get(u).set("Cookie", cookie),
  post: (u: string) => request(app).post(u).set("Cookie", cookie),
  patch: (u: string) => request(app).patch(u).set("Cookie", cookie),
  delete: (u: string) => request(app).delete(u).set("Cookie", cookie),
});

describe("campaigns hub (integration)", () => {
  let cookie = "";
  let adminId = 0;
  let campaignId = 0;
  let eventId = 0;

  beforeAll(async () => {
    process.env.VITEST = "true";
    adminId = await insertId(
      `INSERT INTO admins (email, first_name, last_name, role, status)
       VALUES (?, 'Camp', 'Admin', 'super_admin', 'active')`,
      [em("admin")],
    );
    cookie = await makeSession(adminId);

    eventId = await insertId(
      `INSERT INTO marketing_events
         (slug, status, starts_at, city, title_en, title_es, created_by_admin_id)
       VALUES (?, 'published', '2026-10-07 02:00:00', 'Fontana',
               'ADU Discovery Night', 'Noche de ADU', ?)`,
      [`${prefix}fontana`, adminId],
    );

    await insertId(
      `INSERT INTO leads
         (full_name, email, phone, property_address, soft_pull_consent,
          sms_marketing_consent, mode, event_id, source, preferred_language,
          status, created_at)
       VALUES ('Consent Lead', ?, '${ph("0101")}', '1 Main St', 0, 1, 'event', ?,
               'test', 'en', 'new', '2026-10-06 18:00:00')`,
      [em("consent"), eventId],
    );
    await insertId(
      `INSERT INTO leads
         (full_name, email, phone, property_address, soft_pull_consent,
          sms_marketing_consent, mode, event_id, source, preferred_language,
          status, created_at)
       VALUES ('No Consent Lead', ?, '${ph("0102")}', '2 Main St', 0, 0, 'event', ?,
               'test', 'es', 'new', '2026-10-07 12:00:00')`,
      [em("noconsent"), eventId],
    );
  }, 60_000);

  afterAll(async () => {
    if (campaignId) {
      await db.query(`DELETE FROM campaigns WHERE id = ?`, [campaignId]).catch(() => {});
    }
    await db
      .query(`DELETE FROM leads WHERE email LIKE ?`, [`${prefix}%@example.com`])
      .catch(() => {});
    if (eventId) {
      await db
        .query(`DELETE FROM marketing_events WHERE id = ?`, [eventId])
        .catch(() => {});
    }
    await cleanupPortalFixturesByPrefix(db, prefix);
    await db.end();
  });

  it("creates Fontana CTA preset, previews audience list, and dry-runs", async () => {
    const created = await as(cookie).post("/api/admin/campaigns").send({
      name: "Fontana test follow-up",
      audience_kind: "leads",
      audience_filter: { event_id: eventId },
      channels: { email: true, sms: true },
      preset: "fontana_followup",
    });
    expect(created.status).toBe(201);
    campaignId = Number(created.body.campaign.id);
    expect(created.body.campaign.audience_filter.event_id).toBe(eventId);
    expect(created.body.campaign.templates.length).toBeGreaterThanOrEqual(5);
    const opener = created.body.campaign.templates.find(
      (t: { role: string }) => t.role === "opener",
    );
    expect(opener?.subject_en).toMatch(/pick your next step/i);
    expect(String(opener?.email_html_en || "")).toMatch(/free credit report/i);
    expect(String(opener?.sms_body_en || "")).toMatch(/get-credit-report/i);

    const preview = await as(cookie)
      .post(`/api/admin/campaigns/${campaignId}/preview`)
      .send({});
    expect(preview.status).toBe(200);
    expect(preview.body.preview.total).toBeGreaterThanOrEqual(2);
    expect(preview.body.preview.sms_eligible).toBeGreaterThanOrEqual(1);
    expect(preview.body.preview.sms_skipped_no_consent).toBeGreaterThanOrEqual(
      1,
    );
    expect(Array.isArray(preview.body.preview.sample)).toBe(true);
    expect(preview.body.preview.sample.length).toBeGreaterThanOrEqual(2);
    expect(preview.body.preview.sample_truncated).toBe(false);
    expect(preview.body.preview.sample[0]).toMatchObject({
      name: expect.any(String),
      lang: expect.stringMatching(/^(en|es)$/),
    });

    const dry = await as(cookie)
      .post(`/api/admin/campaigns/${campaignId}/send`)
      .send({ dry_run: true });
    expect(dry.status).toBe(200);
    expect(dry.body.dry_run).toBe(true);
    expect(dry.body.stats.sms_skipped_no_consent).toBeGreaterThanOrEqual(1);
    expect(dry.body.stats.email_dry_run).toBeGreaterThanOrEqual(2);
  });
});
