import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { __testClearEmailDryRuns, __testGetEmailDryRuns, createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

describe.runIf(hasDb)("people context: conversation names, last text/call, agreement v3 re-sign", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwpctx-${stamp}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const digits = String(stamp).slice(-7);
  const affPhone = `+1951${digits}`;
  const ins = async (sql: string, p: unknown[]) => Number(((await db.execute(sql, p as any[])) as any)[0].insertId);
  const sha = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
  let adminCookie = "";
  let affCookie = "";
  let affId = 0;

  beforeAll(async () => {
    process.env.VITEST = "true";
    const adminId = await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Ctx', 'Admin', 'super_admin', 'active')`, [em("admin")]);
    const t = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [adminId, sha(t)]);
    adminCookie = `gw_admin_sid=${t}`;
    const lineId = await ins(
      `INSERT INTO admin_phone_numbers (e164, friendly_name, assigned_admin_id, is_active, capabilities_json) VALUES (?, 'Ctx line', ?, 1, JSON_OBJECT('sms', TRUE, 'voice', TRUE))`,
      [`+1888${digits}`, adminId],
    );
    affId = await ins(
      `INSERT INTO affiliates (email, first_name, last_name, phone, status, referral_code, approved_at, subscription_price_cents) VALUES (?, 'Jaz', 'Tea', ?, 'active', ?, NOW(), 1999)`,
      [em("jaz"), affPhone, `GWX${digits}`],
    );
    const at = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO affiliate_sessions (affiliate_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [affId, sha(at)]);
    affCookie = `gw_affiliate_sid=${at}`;
    // She texts our line from her number, but the thread isn't linked to any record ("unknown").
    const unknownId = await ins(
      `INSERT INTO conversation_unknown_contacts (phone_e164, ofg_number_id, status, last_message_at, last_message_preview, unread_count) VALUES (?, ?, 'open', NOW(), 'hi from Jaz', 1)`,
      [affPhone, lineId],
    );
    const convId = await ins(
      `INSERT INTO conversations (unknown_contact_id, channel, status, ofg_number_id, assigned_admin_id, last_message_at) VALUES (?, 'sms', 'open', ?, ?, NOW())`,
      [unknownId, lineId, adminId],
    );
    await ins(
      `INSERT INTO conversation_messages (conversation_id, channel, direction, body, from_address, to_address) VALUES (?, 'sms', 'inbound', 'hi from Jaz', ?, ?)`,
      [convId, affPhone, `+1888${digits}`],
    );
    // She signed v2 before v3 was published.
    await db.execute(
      `INSERT INTO affiliate_agreements (affiliate_id, template_version, lang, status, legal_name, address, email, subscription_price_cents, body_sha256, signature_image)
       VALUES (?, 2, 'en', 'signed', 'Jaz Tea', '1 Test Way', ?, 1999, ?, 'data:image/png;base64,AA==')`,
      [affId, em("jaz"), sha("v2")],
    );
  });

  afterAll(async () => {
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("an unknown thread from an affiliate's number shows her name, role and others", async () => {
    const r = await request(app).get("/api/admin/conversations?view=all&limit=100").set("Cookie", adminCookie).expect(200);
    const row = (r.body.contacts as any[]).find((c) => c.kind === "unknown" && String(c.phone) === affPhone);
    expect(row).toBeTruthy();
    expect(row.display_name).toBe("Jaz Tea");
    expect(row.match).toMatchObject({ role: "affiliate", id: affId, name: "Jaz Tea" });
  });

  it("inbox search finds an unlinked thread by the owner's name", async () => {
    const r = await request(app).get(`/api/admin/conversations?view=all&q=${encodeURIComponent("Jaz Tea")}`).set("Cookie", adminCookie).expect(200);
    expect((r.body.contacts as any[]).some((c) => c.kind === "unknown" && String(c.phone) === affPhone)).toBe(true);
    const none = await request(app).get(`/api/admin/conversations?view=all&q=${encodeURIComponent(`${prefix}nobody`)}`).set("Cookie", adminCookie).expect(200);
    expect((none.body.contacts as any[]).some((c) => String(c.phone) === affPhone)).toBe(false);
  });

  it("last text / last call: on the affiliates list and for one phone", async () => {
    const one = await request(app).get(`/api/admin/last-touch?phone=${encodeURIComponent(affPhone)}`).set("Cookie", adminCookie).expect(200);
    expect(one.body.last_sms).toMatchObject({ direction: "inbound", preview: expect.stringContaining("hi from Jaz") });
    expect(one.body.last_call).toBeNull();
    const list = await request(app).get(`/api/admin/affiliates?q=${encodeURIComponent(em("jaz"))}`).set("Cookie", adminCookie).expect(200);
    const mine = (list.body.affiliates as any[]).find((a) => a.id === affId);
    expect(mine?.last_sms?.direction).toBe("inbound");
  });

  it("agreement v3: v2 signers are 'outdated', can sign again, and staff can ask them to re-sign", async () => {
    const ob = await request(app).get("/api/affiliate/onboarding?lang=en").set("Cookie", affCookie).expect(200);
    expect(ob.body.state).toMatchObject({ agreement_signed: true, agreement_version: 2, agreement_outdated: true });
    expect(ob.body.state.agreement_current_version).toBeGreaterThanOrEqual(3);
    expect(String(ob.body.template.body)).toMatch(/within 5 business days/);
    // Signing again is no longer "already signed" (it fails validation on the empty body instead).
    const sign = await request(app).post("/api/affiliate/onboarding/agreement").set("Cookie", affCookie).send({});
    expect(sign.body.error).not.toBe("errors.agreementAlreadySigned");

    const out = await request(app).get("/api/admin/affiliate-agreement/outdated").set("Cookie", adminCookie).expect(200);
    expect(out.body.count).toBeGreaterThanOrEqual(1);
    await request(app).post("/api/admin/affiliate-agreement/resign-notice").set("Cookie", adminCookie).send({}).expect(400);
    __testClearEmailDryRuns();
    const sent = await request(app).post("/api/admin/affiliate-agreement/resign-notice").set("Cookie", adminCookie).send({ confirm: true }).expect(200);
    expect(sent.body.sent).toBeGreaterThanOrEqual(1);
    const mail = __testGetEmailDryRuns().find((m: any) => m.to === em("jaz")) as any;
    expect(String(mail?.subject)).toMatch(/Updated affiliate agreement/);
    expect(String(mail?.html)).toMatch(/5 business days/);
  });

  it("FAQ says 5 business days after the loan funds, and free days start on approval", async () => {
    const r = await request(app).get("/api/affiliate/faqs").set("Cookie", affCookie).expect(200);
    const when = (r.body.faqs as any[]).find((f) => f.question_en === "When do I get paid?");
    expect(when.answer_en).toMatch(/within 5 business days after the loan funds/);
    const sub = (r.body.faqs as any[]).find((f) => /platform subscription/.test(f.question_en));
    expect(sub.answer_en).toMatch(/start the day Groundwork approves you/);
  });
});
