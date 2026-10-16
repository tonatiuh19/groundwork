import "dotenv/config";
import crypto from "crypto";
import type { ResultSetHeader } from "mysql2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  __testClearSmsDryRuns,
  __testGetSmsDryRuns,
  __testSetTwilioNumbersApi,
  createServer,
} from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

/**
 * Personal vs shared lines: who sees, who sends, which number customers hear
 * from, what rings, offboarding fallback, and connecting numbers from Twilio.
 * Twilio number management is stubbed; SMS/email are dry-run (Vitest sandbox).
 */
describe.runIf(hasDb)("phone line modes (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwmode-${stamp}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  // Random tail: parallel suites must never collide on unique phone numbers.
  const tail = String(100000 + Math.floor(Math.random() * 899999));
  const sharedE164 = `+1555${tail}1`;
  const personalE164 = `+1555${tail}2`;
  const ownerCell = `+1949${tail}3`;
  const clientPhone = `+1951${tail}4`;
  const freshPhone = `+1951${tail}5`;
  const lineIds: number[] = [];
  let sharedId = 0;
  let personalId = 0;
  let superId = 0;
  let adminId = 0;
  let ownerId = 0;
  let otherId = 0;
  const cookie: Record<string, string> = {};
  let clientId = 0;

  const insertId = async (sql: string, params: unknown[]) => {
    const [r] = await db.execute(sql, params as any[]);
    return Number((r as ResultSetHeader).insertId);
  };
  const session = async (id: number) => {
    const token = crypto.randomBytes(32).toString("hex");
    await db.execute(
      `INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, ?)`,
      [id, crypto.createHash("sha256").update(token).digest("hex"), new Date(Date.now() + 86_400_000)],
    );
    return `gw_admin_sid=${token}`;
  };
  const as = (who: string) => ({
    get: (u: string) => request(app).get(u).set("Cookie", cookie[who]),
    post: (u: string) => request(app).post(u).set("Cookie", cookie[who]),
    put: (u: string) => request(app).put(u).set("Cookie", cookie[who]),
    patch: (u: string) => request(app).patch(u).set("Cookie", cookie[who]),
  });
  const twilio = (path: string, body: Record<string, string>) => request(app).post(path).type("form").send(body);
  const smsFrom = (to: string) => __testGetSmsDryRuns().filter((m) => m.to.endsWith(to.slice(-10))).pop()?.from;

  beforeAll(async () => {
    process.env.VITEST = "true";
    const admin = (n: string, role: string) =>
      insertId(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, ?, 'Test', ?, 'active')`, [em(n), n, role]);
    superId = await admin("super", "super_admin");
    adminId = await admin("admin", "admin");
    ownerId = await admin("owner", "agent");
    otherId = await admin("other", "agent");
    for (const [k, id] of [["super", superId], ["admin", adminId], ["owner", ownerId], ["other", otherId]] as const) {
      cookie[k] = await session(id);
    }
    sharedId = await insertId(
      `INSERT INTO admin_phone_numbers (e164, friendly_name, assigned_admin_id, is_active, line_mode) VALUES (?, 'Test shared', ?, 1, 'shared')`,
      [sharedE164, superId],
    );
    personalId = await insertId(
      `INSERT INTO admin_phone_numbers (e164, friendly_name, assigned_admin_id, is_active, line_mode) VALUES (?, 'Test personal', ?, 1, 'personal')`,
      [personalE164, ownerId],
    );
    lineIds.push(sharedId, personalId);
    // Owner + other agent are members of the shared line.
    await db.query(`INSERT INTO phone_line_members (line_id, admin_id, ring_browser) VALUES (?, ?, 1), (?, ?, 1)`, [sharedId, ownerId, sharedId, otherId]);
    clientId = await insertId(
      `INSERT INTO clients (first_name, last_name, email, phone, status) VALUES ('Carla', 'Client', ?, ?, 'prospect')`,
      [em("client"), clientPhone],
    );
    // Existing customer thread lives on the shared line (unassigned, 2 unread).
    await insertId(
      `INSERT INTO conversations (client_id, channel, status, ofg_number_id, last_message_at, unread_count) VALUES (?, 'sms', 'open', ?, NOW(), 2)`,
      [clientId, sharedId],
    );
  });

  afterAll(async () => {
    try {
      __testSetTwilioNumbersApi({ list: async () => [], update: async () => undefined });
      if (lineIds.length) {
        await db.query(`DELETE FROM conversation_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE ofg_number_id IN (?))`, [lineIds]);
        await db.query(`DELETE FROM conversations WHERE ofg_number_id IN (?)`, [lineIds]);
        await db.query(`DELETE FROM conversation_unknown_contacts WHERE ofg_number_id IN (?)`, [lineIds]);
        await db.query(`DELETE FROM admin_phone_numbers WHERE id IN (?)`, [lineIds]);
      }
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("settings: personal lines need an owner and drop members", async () => {
    const base = { ring_numbers: [], ring_timeout_sec: 25, voicemail_greeting_en: null, voicemail_greeting_es: null };
    const noOwner = await as("super").put(`/api/admin/phone-lines/${personalId}`).send({ ...base, line_mode: "personal", assigned_admin_id: null, members: [] });
    expect(noOwner.body.error).toBe("validation.personalLineOwner");
    const saved = await as("super")
      .put(`/api/admin/phone-lines/${personalId}`)
      .send({
        ...base,
        line_mode: "personal",
        assigned_admin_id: ownerId,
        members: [{ admin_id: otherId, ring_browser: true }],
        ring_numbers: [{ label: "Owner cell", e164: ownerCell, is_active: true }],
      })
      .expect(200);
    expect(saved.body.line.line_mode).toBe("personal");
    expect(saved.body.members).toEqual([]); // personal lines have no members
    await as("owner").put(`/api/admin/phone-lines/${personalId}`).send({ ...base, line_mode: "personal", assigned_admin_id: ownerId, members: [] }).expect(403);
  });

  it("visibility: owner + all admins see a personal line; other agents don't", async () => {
    const inbox = async (who: string) => {
      const r = await as(who).get("/api/admin/conversations/access").expect(200);
      return r.body;
    };
    // Sending lines: the owner's personal line comes first, then the shared line.
    const owner = await inbox("owner");
    expect(owner.numbers.map((n: { id: number }) => n.id).slice(0, 2)).toEqual([personalId, sharedId]);
    // An admin with no lines of their own still gets Conversations (coverage).
    expect((await inbox("admin")).enabled).toBe(true);

    // Inbound text on the personal line creates an unknown thread there.
    await twilio("/api/webhooks/twilio/sms", { From: freshPhone, To: personalE164, Body: "Hi, is this Owner?", MessageSid: `SM${stamp}a` });
    const [[u]] = (await db.query(`SELECT id FROM conversation_unknown_contacts WHERE ofg_number_id = ? LIMIT 1`, [personalId])) as any;
    expect(u).toBeTruthy();
    const timeline = (who: string) => as(who).get(`/api/admin/conversations/contact/unknown/${u.id}/timeline`);
    expect((await timeline("owner")).status).toBe(200);
    expect((await timeline("admin")).status).toBe(200);
    expect((await timeline("super")).status).toBe(200);
    expect((await timeline("other")).status).not.toBe(200);
  });

  it("sending: replies use the thread's line; new conversations use the owner's line", async () => {
    __testClearSmsDryRuns();
    // Owner replies to the shared-line customer without choosing a number → shared line.
    await as("owner").post("/api/admin/conversations/send").send({ client_id: clientId, channel: "sms", body: "Following up" }).expect(200);
    expect(smsFrom(clientPhone)).toBe(sharedE164);

    // Brand-new number → the owner's personal line.
    const brandNew = `+1951${tail}6`;
    await as("owner").post("/api/admin/conversations/start").send({ phone: brandNew, body: "Hello!" }).expect(200);
    expect(smsFrom(brandNew)).toBe(personalE164);

    // Explicit line must be one you can see.
    const denied = await as("other").post("/api/admin/conversations/send").send({ client_id: clientId, channel: "sms", body: "x", ofg_number_id: personalId });
    expect(denied.status).toBe(400);

    // Admin covering: reply in the personal-line thread goes out from that line.
    const [[u]] = (await db.query(`SELECT id FROM conversation_unknown_contacts WHERE ofg_number_id = ? LIMIT 1`, [personalId])) as any;
    await as("admin").post("/api/admin/conversations/send").send({ unknown_contact_id: u.id, channel: "sms", body: "Covering for Owner" }).expect(200);
    expect(smsFrom(freshPhone)).toBe(personalE164);
  });

  it("calls: caller ID follows the thread; personal lines ring only the owner", async () => {
    const known = await twilio("/api/voice/twiml", { To: clientPhone, From: `client:admin_${ownerId}` }).expect(200);
    expect(known.text).toContain(`callerId="${sharedE164}"`);
    const unknownNumber = await twilio("/api/voice/twiml", { To: `+1951${tail}7`, From: `client:admin_${ownerId}` }).expect(200);
    expect(unknownNumber.text).toContain(`callerId="${personalE164}"`);

    await db.query(`UPDATE admins SET voice_available = 1 WHERE id IN (?, ?)`, [ownerId, otherId]);
    const ring = await twilio("/api/voice/incoming", { To: personalE164, From: `+1310${tail}8`, CallSid: `CA${stamp}p` }).expect(200);
    expect(ring.text).toContain(`<Client>admin_${ownerId}</Client>`);
    expect(ring.text).not.toContain(`admin_${otherId}`);
    expect(ring.text).toMatch(new RegExp(`/api/voice/screen"[^>]*>\\${ownerCell}</Number>`));

    const shared = await twilio("/api/voice/incoming", { To: sharedE164, From: `+1310${tail}8`, CallSid: `CA${stamp}s` }).expect(200);
    expect(shared.text).toContain(`<Client>admin_${ownerId}</Client>`);
    expect(shared.text).toContain(`<Client>admin_${otherId}</Client>`);

    // No greeting set → the matched EN/ES default pair (never the legacy single-language setting).
    const vm = await twilio("/api/voice/dial-status", { To: sharedE164, From: `+1310${tail}8`, DialCallStatus: "no-answer", CallSid: `CA${stamp}v` }).expect(200);
    expect(vm.text).toContain("Thank you for calling Groundwork Capital.");
    expect(vm.text).toContain("Gracias por llamar a Groundwork Capital.");
    expect(vm.text).not.toContain("Hello, you have reached Groundwork Capital");
  });

  it("start conversation (lead quick text / New message): existing thread's line wins over the personal line", async () => {
    __testClearSmsDryRuns();
    // Carla's thread is on the shared line; the owner's default is their personal line.
    await as("owner").post("/api/admin/conversations/start").send({ phone: clientPhone, body: "Quick follow-up" }).expect(200);
    expect(smsFrom(clientPhone)).toBe(sharedE164);
    // Explicit choice still wins, but must be a line you can see.
    await as("owner").post("/api/admin/conversations/start").send({ phone: clientPhone, body: "From mine", ofg_number_id: personalId }).expect(200);
    expect(smsFrom(clientPhone)).toBe(personalE164);
    const denied = await as("other").post("/api/admin/conversations/start").send({ phone: `+1951${tail}9`, body: "x", ofg_number_id: personalId });
    expect(denied.status).toBe(400);
  });

  it("badge: shared-line members count unassigned threads on that line", async () => {
    const before = (await as("other").get("/api/admin/conversations/badge").expect(200)).body.unread_total;
    const c2 = await insertId(
      `INSERT INTO clients (first_name, last_name, email, phone, status) VALUES ('Bea', 'Badge', ?, ?, 'prospect')`,
      [em("badge"), `+1951${tail}0`],
    );
    await insertId(
      `INSERT INTO conversations (client_id, channel, status, ofg_number_id, last_message_at, unread_count) VALUES (?, 'sms', 'open', ?, NOW(), 3)`,
      [c2, sharedId],
    );
    const after = (await as("other").get("/api/admin/conversations/badge").expect(200)).body.unread_total;
    expect(after - before).toBe(3);
  });

  it("offboarding: deactivated owner → alert, needs_owner flag, calls fall back (owner never rung)", async () => {
    const r = await as("super").patch(`/api/admin/staff/${ownerId}`).send({ status: "inactive" }).expect(200);
    expect(r.body.lines_needing_owner.map((l: { id: number }) => l.id)).toContain(personalId);
    const list = await as("super").get("/api/admin/phone-numbers").expect(200);
    expect(list.body.numbers.find((n: { id: number }) => n.id === personalId).needs_owner).toBe(true);
    const settings = await as("super").get(`/api/admin/phone-lines/${personalId}`).expect(200);
    expect(settings.body.now.needs_owner).toBe(true);

    const call = await twilio("/api/voice/incoming", { To: personalE164, From: `+1310${tail}9`, CallSid: `CA${stamp}o` }).expect(200);
    expect(call.text).not.toContain(`admin_${ownerId}`);
    expect(call.text).toMatch(/<Dial|<Record/);
    expect(call.text).not.toContain("<Hangup");

    // Reassign → no longer flagged.
    await as("super")
      .put(`/api/admin/phone-lines/${personalId}`)
      .send({ line_mode: "personal", assigned_admin_id: otherId, members: [], ring_numbers: [], ring_timeout_sec: 25, voicemail_greeting_en: null, voicemail_greeting_es: null })
      .expect(200);
    const after = await as("super").get("/api/admin/phone-numbers").expect(200);
    expect(after.body.numbers.find((n: { id: number }) => n.id === personalId).needs_owner).toBe(false);
  });

  it("connect / disconnect Twilio numbers (stubbed Twilio)", async () => {
    const freshSid = `PN${"a".repeat(32)}`;
    const busySid = `PN${"b".repeat(32)}`;
    const updates: Array<{ sid: string; fields: Record<string, string> }> = [];
    const numbers = [
      { sid: freshSid, phoneNumber: `+1626${tail}1`, friendlyName: "Fresh", smsUrl: "", voiceUrl: "", capabilities: { sms: true, voice: true } },
      { sid: busySid, phoneNumber: `+1626${tail}2`, friendlyName: "Encore line", smsUrl: "https://portal.encoremortgage.org/api/webhooks/inbound-sms", voiceUrl: "https://portal.encoremortgage.org/api/voice/incoming", capabilities: { sms: true, voice: true } },
    ];
    __testSetTwilioNumbersApi({
      list: async () => numbers,
      update: async (sid, fields) => {
        updates.push({ sid, fields });
        const n = numbers.find((x) => x.sid === sid)!;
        if ("smsUrl" in fields) n.smsUrl = fields.smsUrl;
        if ("voiceUrl" in fields) n.voiceUrl = fields.voiceUrl;
      },
    });
    await as("other").get("/api/admin/phone-lines/available").expect(403);
    const avail = await as("super").get("/api/admin/phone-lines/available").expect(200);
    const busy = avail.body.numbers.find((n: { sid: string }) => n.sid === busySid);
    expect(busy).toMatchObject({ in_use_elsewhere: true, current_host: "portal.encoremortgage.org" });

    const noOwner = await as("super").post("/api/admin/phone-lines/connect").send({ sid: freshSid, line_mode: "personal" });
    expect(noOwner.body.error).toBe("validation.personalLineOwner");
    const blocked = await as("super").post("/api/admin/phone-lines/connect").send({ sid: busySid, line_mode: "shared" });
    expect(blocked.status).toBe(409);
    expect(updates).toHaveLength(0); // nothing changed in Twilio

    const ok = await as("super").post("/api/admin/phone-lines/connect").send({ sid: freshSid, line_mode: "personal", assigned_admin_id: adminId }).expect(201);
    lineIds.push(ok.body.line.id);
    expect(ok.body.line).toMatchObject({ line_mode: "personal", assigned_admin_id: adminId });
    expect(updates[0].fields.voiceUrl).toMatch(/\/api\/voice\/incoming$/);
    expect(updates[0].fields.smsUrl).toMatch(/\/api\/webhooks\/twilio\/sms$/);
    // Connected numbers drop off the available list.
    const again = await as("super").get("/api/admin/phone-lines/available").expect(200);
    expect(again.body.numbers.some((n: { sid: string }) => n.sid === freshSid)).toBe(false);

    const taken = await as("super").post("/api/admin/phone-lines/connect").send({ sid: busySid, line_mode: "shared", take_over: true }).expect(201);
    lineIds.push(taken.body.line.id);

    // Disconnect: exact number required; clears our webhooks; primary is protected.
    await as("super").post(`/api/admin/phone-lines/${ok.body.line.id}/disconnect`).send({ confirm: "wrong" }).expect(400);
    await as("super").post(`/api/admin/phone-lines/${ok.body.line.id}/disconnect`).send({ confirm: `+1626${tail}1` }).expect(200);
    expect(numbers[0].voiceUrl).toBe("");
    const [[row]] = (await db.query(`SELECT is_active FROM admin_phone_numbers WHERE id = ?`, [ok.body.line.id])) as any;
    expect(Number(row.is_active)).toBe(0);
    await db.query(`UPDATE admin_phone_numbers SET is_primary = 1 WHERE id = ?`, [taken.body.line.id]);
    const primary = await as("super").post(`/api/admin/phone-lines/${taken.body.line.id}/disconnect`).send({ confirm: `+1626${tail}2` });
    expect(primary.body.error).toBe("errors.cannotDisconnectPrimary");
    await db.query(`UPDATE admin_phone_numbers SET is_primary = 0 WHERE id = ?`, [taken.body.line.id]);
  });
});
