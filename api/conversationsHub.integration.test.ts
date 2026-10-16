/**
 * Conversations Contact Hub — access gate, send dry-run, inbound webhook dry path.
 *
 * Fixtures use @example.com / @example.test only. Cleanup in afterAll.
 * VITEST always dry-runs Twilio SMS (never hits network).
 */
import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { createServer, __testGetEmailDryRuns, __testClearEmailDryRuns } from "./index";
import {
  cleanupPortalFixturesByPrefix,
  createIntegrationTestPool,
} from "./testDbCleanup";


const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
const app = createServer();
const db = createIntegrationTestPool();
const stamp = Date.now();
const prefix = `gwconv-${stamp}-`;
const em = (name: string) => `${prefix}${name}@example.com`;

async function makeSession(adminId: number): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  await db.execute(
    `INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, ?)`,
    [
      adminId,
      crypto.createHash("sha256").update(token).digest("hex"),
      new Date(Date.now() + 86_400_000),
    ],
  );
  return `gw_admin_sid=${token}`;
}

async function insertId(sql: string, params: any[]): Promise<number> {
  const [r] = await db.execute(sql, params);
  return Number((r as ResultSetHeader).insertId);
}

describe.runIf(hasDb)("conversations contact hub", () => {
  let agentId = 0;
  let otherId = 0;
  let agentCookie = "";
  let otherCookie = "";
  let phoneNumberId = 0;
  let clientId = 0;
  const ofgE164 = `+1555${String(stamp).slice(-7)}`;

  beforeAll(async () => {
    process.env.VITEST = "true";
    __testClearEmailDryRuns();

    agentId = await insertId(
      `INSERT INTO admins
         (email, first_name, last_name, role, status, preferred_language, phone,
          notification_prefs_json)
       VALUES (?, 'Conv', 'Agent', 'agent', 'active', 'en', '+15551234001', ?)`,
      [
        em("agent"),
        JSON.stringify({
          email: { inbound_sms: true },
          sms: { inbound_sms: true },
        }),
      ],
    );
    agentCookie = await makeSession(agentId);

    otherId = await insertId(
      `INSERT INTO admins
         (email, first_name, last_name, role, status, preferred_language)
       VALUES (?, 'Conv', 'Other', 'agent', 'active', 'en')`,
      [em("other")],
    );
    otherCookie = await makeSession(otherId);

    phoneNumberId = await insertId(
      `INSERT INTO admin_phone_numbers
         (e164, friendly_name, assigned_admin_id, is_active, capabilities_json)
       VALUES (?, 'Vitest Groundwork', ?, 1, JSON_OBJECT('sms', TRUE, 'voice', TRUE))`,
      [ofgE164, agentId],
    );

    clientId = await insertId(
      `INSERT INTO clients
         (first_name, last_name, email, phone, status, preferred_language)
       VALUES ('Conv', 'Client', ?, '+15559876001', 'prospect', 'en')`,
      [em("client")],
    );
  }, 60_000);

  afterAll(async () => {
    await db
      .query(
        `DELETE FROM conversation_messages WHERE conversation_id IN (
           SELECT id FROM conversations WHERE ofg_number_id = ? OR assigned_admin_id IN (?, ?)
         )`,
        [phoneNumberId, agentId, otherId],
      )
      .catch(() => {});
    await db
      .query(
        `DELETE FROM conversations WHERE ofg_number_id = ? OR assigned_admin_id IN (?, ?)
           OR client_id = ? OR unknown_contact_id IN (
             SELECT id FROM (
               SELECT id FROM conversation_unknown_contacts WHERE ofg_number_id = ?
             ) t
           )`,
        [phoneNumberId, agentId, otherId, clientId, phoneNumberId],
      )
      .catch(() => {});
    await db
      .query(`DELETE FROM conversation_unknown_contacts WHERE ofg_number_id = ?`, [
        phoneNumberId,
      ])
      .catch(() => {});
    await db
      .query(`DELETE FROM contacts WHERE created_by_admin_id IN (?, ?)`, [
        agentId,
        otherId,
      ])
      .catch(() => {});
    if (phoneNumberId) {
      await db
        .query(`DELETE FROM admin_phone_numbers WHERE id = ?`, [phoneNumberId])
        .catch(() => {});
    }
    await cleanupPortalFixturesByPrefix(db, prefix);
    await db.end().catch(() => {});
  });

  it("denies Conversations without an assigned brand number", async () => {
    const res = await request(app)
      .get("/api/admin/conversations")
      .set("Cookie", otherCookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("conversations_number_required");
  });

  it("reports access enabled for numbered staff", async () => {
    const res = await request(app)
      .get("/api/admin/conversations/access")
      .set("Cookie", agentCookie);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(Array.isArray(res.body.numbers)).toBe(true);
    expect(res.body.numbers.length).toBeGreaterThan(0);
  });

  it("returns nav badge unread total", async () => {
    const res = await request(app)
      .get("/api/admin/conversations/badge")
      .set("Cookie", agentCookie);
    expect(res.status).toBe(200);
    expect(typeof res.body.unread_total).toBe("number");
  });

  it("paginates inbox with SQL LIMIT/OFFSET (UNION hub)", async () => {
    const extraClientId = await insertId(
      `INSERT INTO clients
         (first_name, last_name, email, phone, status, preferred_language)
       VALUES ('Page', 'Two', ?, '+15550009988', 'prospect', 'en')`,
      [`${prefix}page2@example.com`],
    );
    try {
      await insertId(
        `INSERT INTO conversations
           (client_id, channel, status, ofg_number_id, assigned_admin_id,
            last_message_at, last_message_preview, unread_count)
         VALUES (?, 'sms', 'open', ?, ?, DATE_SUB(NOW(), INTERVAL 2 MINUTE), 'older', 0)`,
        [clientId, phoneNumberId, agentId],
      );
      await insertId(
        `INSERT INTO conversations
           (client_id, channel, status, ofg_number_id, assigned_admin_id,
            last_message_at, last_message_preview, unread_count)
         VALUES (?, 'sms', 'open', ?, ?, NOW(), 'newer', 0)`,
        [extraClientId, phoneNumberId, agentId],
      );

      const page1 = await request(app)
        .get("/api/admin/conversations?view=all&limit=1&page=1")
        .set("Cookie", agentCookie);
      expect(page1.status).toBe(200);
      expect(page1.body.contacts).toHaveLength(1);
      expect(page1.body.pagination.page).toBe(1);
      expect(page1.body.pagination.limit).toBe(1);
      expect(page1.body.pagination.total).toBeGreaterThanOrEqual(2);
      expect(page1.body.pagination.totalPages).toBeGreaterThanOrEqual(2);

      const page2 = await request(app)
        .get("/api/admin/conversations?view=all&limit=1&page=2")
        .set("Cookie", agentCookie);
      expect(page2.status).toBe(200);
      expect(page2.body.contacts).toHaveLength(1);
      expect(page2.body.pagination.page).toBe(2);
      expect(
        `${page1.body.contacts[0].kind}:${page1.body.contacts[0].contact_id}`,
      ).not.toBe(
        `${page2.body.contacts[0].kind}:${page2.body.contacts[0].contact_id}`,
      );
      // Newest preview first
      expect(page1.body.contacts[0].contact_id).toBe(extraClientId);
    } finally {
      await db
        .query(`DELETE FROM conversation_messages WHERE conversation_id IN (
          SELECT id FROM conversations WHERE client_id = ?
        )`, [extraClientId])
        .catch(() => {});
      await db
        .query(`DELETE FROM conversations WHERE client_id = ?`, [extraClientId])
        .catch(() => {});
      await db.query(`DELETE FROM clients WHERE id = ?`, [extraClientId]).catch(() => {});
    }
  });

  it("me includes conversations_enabled for assignee", async () => {
    const res = await request(app)
      .get("/api/admin/auth/me")
      .set("Cookie", agentCookie);
    expect(res.status).toBe(200);
    expect(res.body.user.conversations_enabled).toBe(true);
    expect(Array.isArray(res.body.user.assigned_phone_numbers)).toBe(true);
    expect(res.body.user.assigned_phone_numbers.length).toBeGreaterThan(0);
  });

  it("me reports conversations_enabled false without number", async () => {
    const res = await request(app)
      .get("/api/admin/auth/me")
      .set("Cookie", otherCookie);
    expect(res.status).toBe(200);
    expect(res.body.user.conversations_enabled).toBe(false);
  });

  it("send SMS dry-runs under VITEST (provider_message_id dry-run-*)", async () => {
    const res = await request(app)
      .post("/api/admin/conversations/send")
      .set("Cookie", agentCookie)
      .send({
        client_id: clientId,
        body: "Hello from Groundwork vitest",
        channel: "sms",
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.conversation_id).toBeGreaterThan(0);
    expect(String(res.body.provider_status || "")).toMatch(/queued|sent|dry/i);

    const [msgs] = await db.query<RowDataPacket[]>(
      `SELECT provider_message_id, direction, body FROM conversation_messages
       WHERE conversation_id = ? ORDER BY id DESC LIMIT 1`,
      [res.body.conversation_id],
    );
    expect(msgs[0]?.provider_message_id).toMatch(/^dry-run-/);
    expect(msgs[0]?.direction).toBe("outbound");
    expect(String(msgs[0]?.body)).toContain("vitest");
  });

  it("queues unknown inbound via webhook (dry path) and notifies assignee", async () => {
    __testClearEmailDryRuns();
    const unknownPhone = `+1555${String(Date.now()).slice(-7)}`;
    const sid = `SMvitest${Date.now()}`;

    const wh = await request(app)
      .post("/api/webhooks/twilio/sms")
      .type("form")
      .send({
        From: unknownPhone,
        To: ofgE164,
        Body: "Hello from unknown",
        MessageSid: sid,
      });
    expect(wh.status).toBe(200);

    const inbox = await request(app)
      .get("/api/admin/conversations")
      .query({ view: "unknown" })
      .set("Cookie", agentCookie);
    expect(inbox.status).toBe(200);
    const unknown = (inbox.body.contacts || []).find(
      (c: any) =>
        c.kind === "unknown" &&
        String(c.phone || "").includes(unknownPhone.slice(-7)),
    );
    expect(unknown).toBeTruthy();

    const emails = __testGetEmailDryRuns();
    expect(
      emails.some(
        (e) =>
          String(e.subject || "").toLowerCase().includes("sms") &&
          String(e.to).includes("agent"),
      ),
    ).toBe(true);
  });

  it("converts phone-only CRM contact to client (null email allowed)", async () => {
    const phone = `+1555${String(Date.now()).slice(-7)}`;
    const contactId = await insertId(
      `INSERT INTO contacts
         (first_name, last_name, phone, preferred_language, created_by_admin_id, assigned_admin_id)
       VALUES ('Phone', 'Convert', ?, 'en', ?, ?)`,
      [phone, agentId, agentId],
    );
    let newClientId = 0;
    try {
      const res = await request(app)
        .post(`/api/admin/contacts/${contactId}/convert`)
        .set("Cookie", agentCookie);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.client_id).toBeGreaterThan(0);
      newClientId = Number(res.body.client_id);
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT email, phone, status FROM clients WHERE id = ? LIMIT 1`,
        [newClientId],
      );
      expect(rows[0]?.email == null || rows[0]?.email === "").toBe(true);
      expect(String(rows[0]?.phone || "")).toContain(phone.slice(-7));
      expect(rows[0]?.status).toBe("prospect");
    } finally {
      if (newClientId) {
        await db
          .query(`UPDATE contacts SET converted_client_id = NULL WHERE id = ?`, [
            contactId,
          ])
          .catch(() => {});
        await db.query(`DELETE FROM clients WHERE id = ?`, [newClientId]).catch(() => {});
      }
      await db.query(`DELETE FROM contacts WHERE id = ?`, [contactId]).catch(() => {});
    }
  });

  it("rejects ofg_number_id not assigned to the sender (no silent From fallback)", async () => {
    const orphanId = await insertId(
      `INSERT INTO admin_phone_numbers
         (e164, friendly_name, assigned_admin_id, is_active, capabilities_json)
       VALUES (?, 'Orphan Line', NULL, 1, ?)`,
      [`+1555${String(Date.now()).slice(-7)}`, JSON.stringify({ sms: true })],
    );
    try {
      const res = await request(app)
        .post("/api/admin/conversations/send")
        .set("Cookie", agentCookie)
        .send({
          client_id: clientId,
          body: "wrong from line",
          channel: "sms",
          ofg_number_id: orphanId,
        });
      expect(res.status).toBe(400);
    } finally {
      await db
        .query(`DELETE FROM admin_phone_numbers WHERE id = ?`, [orphanId])
        .catch(() => {});
    }
  });

  it("get/put call-forwarding for numbered staff", async () => {
    const get = await request(app)
      .get("/api/voice/call-forwarding")
      .set("Cookie", agentCookie);
    expect(get.status).toBe(200);
    expect(get.body.success).toBe(true);

    const put = await request(app)
      .put("/api/voice/call-forwarding")
      .set("Cookie", agentCookie)
      .send({ enabled: true, phone: "+15551234999" });
    expect(put.status).toBe(200);
    expect(put.body.call_forwarding_enabled).toBe(true);
    expect(put.body.call_forwarding_phone).toBe("+15551234999");

    const denied = await request(app)
      .get("/api/voice/call-forwarding")
      .set("Cookie", otherCookie);
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("conversations_number_required");
  });

  it("lists conversation templates for any staff session", async () => {
    const res = await request(app)
      .get("/api/admin/conversation-templates")
      .set("Cookie", agentCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.templates)).toBe(true);
    expect(res.body.templates.length).toBeGreaterThan(0);
    expect(res.body.templates[0]).toMatchObject({
      title: expect.any(String),
      body_en: expect.any(String),
      is_active: true,
    });
  });

  it("supports inbox views, q search, assign-to-me, and voice availability", async () => {
    const send = await request(app)
      .post("/api/admin/conversations/send")
      .set("Cookie", agentCookie)
      .send({ client_id: clientId, body: "parity inbox", channel: "sms" });
    expect(send.status).toBe(200);

    const mine = await request(app)
      .get("/api/admin/conversations")
      .query({ view: "mine", q: "Conv" })
      .set("Cookie", agentCookie);
    expect(mine.status).toBe(200);
    expect(mine.body.contacts.some((c: any) => c.client_id === clientId)).toBe(
      true,
    );

    const assign = await request(app)
      .post(`/api/admin/conversations/contact/client/${clientId}/assign`)
      .set("Cookie", agentCookie)
      .send({});
    expect(assign.status).toBe(200);
    expect(assign.body.assigned_admin_id).toBe(agentId);

    const avail = await request(app)
      .post("/api/voice/availability")
      .set("Cookie", agentCookie)
      .send({ available: true });
    expect(avail.status).toBe(200);
    expect(avail.body.available).toBe(true);

    const token = await request(app)
      .post("/api/voice/token")
      .set("Cookie", agentCookie)
      .send({});
    expect(token.status).toBe(200);
    expect(token.body.token).toMatch(/^vitest-voice-token-/);

    const vm = await request(app)
      .get("/api/voice/voicemail-settings")
      .set("Cookie", agentCookie);
    expect(vm.status).toBe(200);
    expect(vm.body.success).toBe(true);
  });

  it("unknown link / create-prospect / dismiss", async () => {
    const phone = `+1555${String(stamp).slice(-6)}88`;
    const unknownId = await insertId(
      `INSERT INTO conversation_unknown_contacts
         (phone_e164, ofg_number_id, status, last_message_at, last_message_preview, unread_count)
       VALUES (?, ?, 'open', NOW(), 'hi', 1)`,
      [phone, phoneNumberId],
    );
    await insertId(
      `INSERT INTO conversations
         (unknown_contact_id, channel, status, ofg_number_id, assigned_admin_id, last_message_at)
       VALUES (?, 'sms', 'open', ?, ?, NOW())`,
      [unknownId, phoneNumberId, agentId],
    );

    const prospectPhone = `+1555${String(stamp).slice(-6)}77`;
    const unknownProspect = await insertId(
      `INSERT INTO conversation_unknown_contacts
         (phone_e164, ofg_number_id, status, last_message_at, unread_count)
       VALUES (?, ?, 'open', NOW(), 0)`,
      [prospectPhone, phoneNumberId],
    );
    await insertId(
      `INSERT INTO conversations
         (unknown_contact_id, channel, status, ofg_number_id, last_message_at)
       VALUES (?, 'sms', 'open', ?, NOW())`,
      [unknownProspect, phoneNumberId],
    );

    const link = await request(app)
      .post(`/api/admin/conversations/unknown/${unknownId}/link`)
      .set("Cookie", agentCookie)
      .send({ client_id: clientId });
    expect(link.status).toBe(200);
    expect(link.body.client_id).toBe(clientId);

    const created = await request(app)
      .post(`/api/admin/conversations/unknown/${unknownProspect}/create-prospect`)
      .set("Cookie", agentCookie)
      .send({ first_name: "Unk", last_name: "Prospect" });
    expect(created.status).toBe(200);
    expect(created.body.client_id).toBeGreaterThan(0);
    const createdClientId = Number(created.body.client_id);

    const dismissId = await insertId(
      `INSERT INTO conversation_unknown_contacts
         (phone_e164, ofg_number_id, status, last_message_at, unread_count)
       VALUES (?, ?, 'open', NOW(), 0)`,
      [`+1555${String(stamp).slice(-6)}66`, phoneNumberId],
    );
    const dismiss = await request(app)
      .post(`/api/admin/conversations/unknown/${dismissId}/dismiss`)
      .set("Cookie", agentCookie)
      .send({});
    expect(dismiss.status).toBe(200);

    await db.query(`DELETE FROM clients WHERE id = ?`, [createdClientId]).catch(() => {});
  });

  it("leads: last text/call columns, Conversations lead search, prospect from lead leaves Active", async () => {
    const leadPhone = `+1555${String(stamp).slice(-6)}55`;
    const leadEmail = em("leadtouch");
    const leadId = await insertId(
      `INSERT INTO leads (full_name, email, phone, property_address, status, source)
       VALUES ('Maya Touch Tester', ?, ?, '1 Test Way', 'new', 'vitest')`,
      [leadEmail, leadPhone],
    );
    const unknownId = await insertId(
      `INSERT INTO conversation_unknown_contacts
         (phone_e164, ofg_number_id, status, last_message_at, unread_count)
       VALUES (?, ?, 'open', NOW(), 0)`,
      [leadPhone, phoneNumberId],
    );
    const convId = await insertId(
      `INSERT INTO conversations
         (unknown_contact_id, channel, status, ofg_number_id, assigned_admin_id, last_message_at)
       VALUES (?, 'sms', 'open', ?, ?, NOW())`,
      [unknownId, phoneNumberId, agentId],
    );
    await db.execute(
      `INSERT INTO conversation_messages (conversation_id, direction, channel, body, from_address, to_address, created_at)
       VALUES (?, 'outbound', 'sms', 'old text', ?, ?, NOW() - INTERVAL 2 DAY),
              (?, 'inbound', 'sms', 'Yes please   call me', ?, ?, NOW() - INTERVAL 1 HOUR),
              (?, 'outbound', 'call', NULL, ?, ?, NOW() - INTERVAL 3 HOUR)`,
      [convId, ofgE164, leadPhone, convId, leadPhone, ofgE164, convId, ofgE164, leadPhone],
    );

    const active = await request(app)
      .get(`/api/admin/leads?view=active&q=${encodeURIComponent(leadEmail)}`)
      .set("Cookie", agentCookie)
      .expect(200);
    expect(active.body.leads).toHaveLength(1);
    const row = active.body.leads[0];
    expect(row.last_sms).toMatchObject({
      direction: "inbound",
      preview: "Yes please call me",
      thread: { kind: "unknown", id: unknownId },
    });
    expect(row.last_call).toMatchObject({ direction: "outbound", duration_sec: null });

    // Default view stays "all" for older callers (MCP).
    const legacy = await request(app)
      .get(`/api/admin/leads?q=${encodeURIComponent(leadEmail)}`)
      .set("Cookie", agentCookie)
      .expect(200);
    expect(legacy.body.view).toBe("all");

    const search = await request(app)
      .get(`/api/admin/conversations/lead-search?q=${encodeURIComponent("Touch Tester")}`)
      .set("Cookie", agentCookie)
      .expect(200);
    const hit = search.body.leads.find((l: { lead_id: number }) => l.lead_id === leadId);
    expect(hit).toMatchObject({ unknown_contact_id: unknownId, client_id: null });
    const byDigits = await request(app)
      .get(`/api/admin/conversations/lead-search?q=${leadPhone.slice(-7)}`)
      .set("Cookie", agentCookie)
      .expect(200);
    expect(byDigits.body.leads.some((l: { lead_id: number }) => l.lead_id === leadId)).toBe(true);
    const tooShort = await request(app)
      .get(`/api/admin/conversations/lead-search?q=M`)
      .set("Cookie", agentCookie)
      .expect(200);
    expect(tooShort.body.leads).toEqual([]);

    // Prospect without typing anything: details come from the lead, lead is linked.
    const created = await request(app)
      .post(`/api/admin/conversations/unknown/${unknownId}/create-prospect`)
      .set("Cookie", agentCookie)
      .send({});
    expect(created.status).toBe(200);
    expect(created.body.lead_id).toBe(leadId);
    const clientId = Number(created.body.client_id);
    const [crow] = (await db.query(`SELECT first_name, last_name, email FROM clients WHERE id = ?`, [clientId])) as any;
    expect(crow[0]).toMatchObject({ first_name: "Maya", last_name: "Touch Tester", email: leadEmail });

    const afterActive = await request(app)
      .get(`/api/admin/leads?view=active&q=${encodeURIComponent(leadEmail)}`)
      .set("Cookie", agentCookie)
      .expect(200);
    expect(afterActive.body.leads).toHaveLength(0);
    const converted = await request(app)
      .get(`/api/admin/leads?view=converted&q=${encodeURIComponent(leadEmail)}`)
      .set("Cookie", agentCookie)
      .expect(200);
    expect(converted.body.leads[0]).toMatchObject({ id: leadId, client_id: clientId });
    // Thread now belongs to the client, and the touch link follows it.
    expect(converted.body.leads[0].last_sms.thread).toEqual({ kind: "client", id: clientId });

    await db.query(`DELETE FROM leads WHERE id = ?`, [leadId]).catch(() => {});
    await db.query(`DELETE FROM clients WHERE id = ?`, [clientId]).catch(() => {});
  });

  it("logs outbound voice calls into conversation_messages", async () => {
    const res = await request(app)
      .post("/api/voice/log")
      .set("Cookie", agentCookie)
      .send({
        phone: "+15559876001",
        client_id: clientId,
        duration: 42,
        call_status: "completed",
        call_sid: `CAvitest${stamp}`,
        direction: "outbound",
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT channel, call_duration_sec, provider_message_id
       FROM conversation_messages
       WHERE provider_message_id = ? LIMIT 1`,
      [`CAvitest${stamp}`],
    );
    expect(rows[0]?.channel).toBe("call");
    expect(Number(rows[0]?.call_duration_sec)).toBe(42);
  });

  it("recording-status marks transcript pending and transcription webhook stores text", async () => {
    const callSid = `CArec${stamp}`;
    const recordingSid = `RErec${stamp}`;
    const convId = await insertId(
      `INSERT INTO conversations
         (client_id, channel, status, ofg_number_id, assigned_admin_id, last_message_at)
       VALUES (?, 'call', 'open', ?, ?, NOW())`,
      [clientId, phoneNumberId, agentId],
    );
    const msgId = await insertId(
      `INSERT INTO conversation_messages
         (conversation_id, direction, channel, body, provider_message_id, provider_status,
          metadata_json)
       VALUES (?, 'inbound', 'call', 'Incoming call', ?, 'completed', ?)`,
      [
        convId,
        callSid,
        JSON.stringify({ is_voicemail: true }),
      ],
    );

    const rec = await request(app)
      .post("/api/voice/recording-status")
      .type("form")
      .send({
        CallSid: callSid,
        RecordingSid: recordingSid,
        RecordingUrl: "https://api.twilio.com/2010-04-01/Accounts/ACxxx/Recordings/RErec",
        RecordingDuration: "12",
        RecordingStatus: "completed",
      });
    expect(rec.status).toBe(204);

    const [afterRec] = await db.query<RowDataPacket[]>(
      `SELECT recording_url, call_duration_sec, metadata_json
       FROM conversation_messages WHERE id = ? LIMIT 1`,
      [msgId],
    );
    expect(afterRec[0]?.recording_url).toContain("Recordings/RErec");
    expect(Number(afterRec[0]?.call_duration_sec)).toBe(12);
    const pendingMeta =
      typeof afterRec[0]?.metadata_json === "string"
        ? JSON.parse(String(afterRec[0].metadata_json))
        : afterRec[0]?.metadata_json;
    expect(pendingMeta?.transcript_status).toBe("pending");
    expect(pendingMeta?.recording_sid).toBe(recordingSid);
    expect(pendingMeta?.is_voicemail).toBe(true);

    __testClearEmailDryRuns();
    const tx = await request(app)
      .post("/api/voice/transcription")
      .type("form")
      .send({
        CallSid: callSid,
        RecordingSid: recordingSid,
        TranscriptionStatus: "completed",
        TranscriptionText: "Hello this is a voicemail transcript",
      });
    expect(tx.status).toBe(204);

    const [afterTx] = await db.query<RowDataPacket[]>(
      `SELECT body, metadata_json FROM conversation_messages WHERE id = ? LIMIT 1`,
      [msgId],
    );
    const readyMeta =
      typeof afterTx[0]?.metadata_json === "string"
        ? JSON.parse(String(afterTx[0].metadata_json))
        : afterTx[0]?.metadata_json;
    expect(readyMeta?.transcript_status).toBe("ready");
    expect(readyMeta?.transcript).toBe("Hello this is a voicemail transcript");
    expect(readyMeta?.voicemail_transcript_emailed_at).toBeTruthy();
    expect(String(afterTx[0]?.body || "")).toContain("Voicemail:");
    expect(String(afterTx[0]?.body || "")).toContain("Hello this is a voicemail");
    const mailed = __testGetEmailDryRuns().filter(
      (e) =>
        String(e.to).includes("agent") &&
        String(e.html || e.subject || "").includes(
          "Hello this is a voicemail transcript",
        ),
    );
    expect(mailed).toHaveLength(1);

    const retry = await request(app)
      .post("/api/voice/transcription")
      .type("form")
      .send({
        CallSid: callSid,
        RecordingSid: recordingSid,
        TranscriptionStatus: "completed",
        TranscriptionText: "Hello this is a voicemail transcript",
      });
    expect(retry.status).toBe(204);
    expect(
      __testGetEmailDryRuns().filter((e) =>
        String(e.html || "").includes("Hello this is a voicemail transcript"),
      ),
    ).toHaveLength(1);
  });

  it("rejects internal notes for CRM contacts and allows media-only SMS", async () => {
    const contactId = await insertId(
      `INSERT INTO contacts
         (first_name, last_name, phone, preferred_language, created_by_admin_id, assigned_admin_id)
       VALUES ('Media', 'Contact', ?, 'en', ?, ?)`,
      [`+1555${String(stamp).slice(-6)}55`, agentId, agentId],
    );
    try {
      const note = await request(app)
        .post("/api/admin/conversations/send")
        .set("Cookie", agentCookie)
        .send({
          contact_id: contactId,
          body: "secret note",
          channel: "internal",
          is_internal_note: true,
        });
      expect(note.status).toBe(400);

      const blob =
        "https://public.blob.vercel-storage.com/conversations/mms/vitest.jpg";
      const mediaOnly = await request(app)
        .post("/api/admin/conversations/send")
        .set("Cookie", agentCookie)
        .send({
          client_id: clientId,
          body: "",
          channel: "sms",
          media_url: blob,
          media_content_type: "image/jpeg",
        });
      expect(mediaOnly.status).toBe(200);
      expect(mediaOnly.body.ok).toBe(true);

      const badHost = await request(app)
        .post("/api/admin/conversations/send")
        .set("Cookie", agentCookie)
        .send({
          client_id: clientId,
          body: "x",
          channel: "sms",
          media_url: "https://evil.example.com/x.jpg",
        });
      expect(badHost.status).toBe(400);
    } finally {
      await db.query(`DELETE FROM contacts WHERE id = ?`, [contactId]).catch(() => {});
    }
  });

  it("media proxy rejects SSRF hosts and missing url", async () => {
    const missing = await request(app)
      .get("/api/conversations/media")
      .set("Cookie", agentCookie);
    expect(missing.status).toBe(400);

    const evil = await request(app)
      .get(
        `/api/conversations/media?url=${encodeURIComponent(
          "https://evil.example.com/secret.mp3",
        )}`,
      )
      .set("Cookie", agentCookie);
    expect(evil.status).toBe(400);

    const unauth = await request(app).get(
      `/api/conversations/media?url=${encodeURIComponent(
        "https://api.twilio.com/2010-04-01/Accounts/ACxx/Recordings/RExx",
      )}`,
    );
    expect([401, 403]).toContain(unauth.status);
  });

  it("voice/log creates outbound call row with CallSid for recording attach", async () => {
    const callSid = `CAlog${stamp}`;
    const res = await request(app)
      .post("/api/voice/log")
      .set("Cookie", agentCookie)
      .send({
        phone: "+15551234567",
        duration: 18,
        call_status: "completed",
        call_sid: callSid,
        client_id: clientId,
        direction: "outbound",
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT m.channel, m.direction, m.call_duration_sec, m.provider_message_id,
              cv.client_id
       FROM conversation_messages m
       JOIN conversations cv ON cv.id = m.conversation_id
       WHERE m.provider_message_id = ? LIMIT 1`,
      [callSid],
    );
    expect(rows[0]?.channel).toBe("call");
    expect(rows[0]?.direction).toBe("outbound");
    expect(Number(rows[0]?.call_duration_sec)).toBe(18);
    expect(Number(rows[0]?.client_id || 0)).toBe(clientId);

    // Recording callback can attach by CallSid
    const rec = await request(app)
      .post("/api/voice/recording-status")
      .type("form")
      .send({
        CallSid: callSid,
        RecordingSid: `RElog${stamp}`,
        RecordingUrl:
          "https://api.twilio.com/2010-04-01/Accounts/ACxxx/Recordings/RElog",
        RecordingDuration: "18",
        RecordingStatus: "completed",
      });
    expect(rec.status).toBe(204);
    const [after] = await db.query<RowDataPacket[]>(
      `SELECT recording_url, metadata_json FROM conversation_messages
       WHERE provider_message_id = ? LIMIT 1`,
      [callSid],
    );
    expect(String(after[0]?.recording_url || "")).toContain("Recordings/RElog");
    const meta =
      typeof after[0]?.metadata_json === "string"
        ? JSON.parse(String(after[0].metadata_json))
        : after[0]?.metadata_json;
    expect(meta?.transcript_status).toBe("pending");
  });

  it("transcription failed marks transcript_status failed without wiping body", async () => {
    const callSid = `CAfail${stamp}`;
    const convId = await insertId(
      `INSERT INTO conversations
         (client_id, channel, status, ofg_number_id, assigned_admin_id, last_message_at)
       VALUES (?, 'call', 'open', ?, ?, NOW())`,
      [clientId, phoneNumberId, agentId],
    );
    const msgId = await insertId(
      `INSERT INTO conversation_messages
         (conversation_id, direction, channel, body, provider_message_id, provider_status,
          metadata_json)
       VALUES (?, 'inbound', 'call', 'Incoming call', ?, 'completed', ?)`,
      [
        convId,
        callSid,
        JSON.stringify({
          recording_sid: `REfail${stamp}`,
          transcript_status: "pending",
        }),
      ],
    );
    const tx = await request(app)
      .post("/api/voice/transcription")
      .type("form")
      .send({
        CallSid: callSid,
        RecordingSid: `REfail${stamp}`,
        TranscriptionStatus: "failed",
        TranscriptionText: "",
      });
    expect(tx.status).toBe(204);
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT body, metadata_json FROM conversation_messages WHERE id = ? LIMIT 1`,
      [msgId],
    );
    expect(String(rows[0]?.body || "")).toBe("Incoming call");
    const meta =
      typeof rows[0]?.metadata_json === "string"
        ? JSON.parse(String(rows[0].metadata_json))
        : rows[0]?.metadata_json;
    expect(meta?.transcript_status).toBe("failed");
    expect(meta?.transcript).toBeUndefined();
  });

  it("unknown link requires client_id and denies other staff without number", async () => {
    const unkId = await insertId(
      `INSERT INTO conversation_unknown_contacts
         (phone_e164, display_name, ofg_number_id, status, unread_count, last_message_at)
       VALUES (?, 'Unk Link', ?, 'open', 1, NOW())`,
      [`+1555${String(stamp).slice(-7)}99`, phoneNumberId],
    );
    await insertId(
      `INSERT INTO conversations
         (unknown_contact_id, channel, status, ofg_number_id, assigned_admin_id, last_message_at)
       VALUES (?, 'sms', 'open', ?, ?, NOW())`,
      [unkId, phoneNumberId, agentId],
    );
    try {
      const missing = await request(app)
        .post(`/api/admin/conversations/unknown/${unkId}/link`)
        .set("Cookie", agentCookie)
        .send({});
      expect(missing.status).toBe(400);

      const denied = await request(app)
        .post(`/api/admin/conversations/unknown/${unkId}/link`)
        .set("Cookie", otherCookie)
        .send({ client_id: clientId });
      expect(denied.status).toBe(403);

      const ok = await request(app)
        .post(`/api/admin/conversations/unknown/${unkId}/link`)
        .set("Cookie", agentCookie)
        .send({ client_id: clientId });
      expect(ok.status).toBe(200);
      expect(ok.body.ok).toBe(true);
    } finally {
      await db
        .query(`DELETE FROM conversations WHERE unknown_contact_id = ?`, [unkId])
        .catch(() => {});
      await db
        .query(`DELETE FROM conversation_unknown_contacts WHERE id = ?`, [unkId])
        .catch(() => {});
    }
  });
});
