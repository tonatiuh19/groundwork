import "dotenv/config";
import crypto from "crypto";
import type { ResultSetHeader } from "mysql2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  __testSetTwilioVoiceHttp,
  __testClearEmailDryRuns,
  __testClearSmsDryRuns,
  __testGetEmailDryRuns,
  __testGetSmsDryRuns,
  createServer,
} from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

describe.runIf(hasDb)("phone lines, deal status, templates (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwline-${stamp}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  // Random digits: parallel suites must never collide on the unique e164.
  const rnd7 = () => String(1000000 + Math.floor(Math.random() * 8999999));
  const lineE164 = `+1555${rnd7()}`;
  const cellE164 = `+1949${rnd7()}`;
  let lineId = 0;
  let superId = 0;
  let agentId = 0;
  let otherAgentId = 0;
  let superCookie = "";
  let agentCookie = "";
  let otherCookie = "";
  let clientId = 0;
  let affCookie = "";
  const statusIds: number[] = [];
  const templateIds: number[] = [];

  const insertId = async (sql: string, params: unknown[]) => {
    const [r] = await db.execute(sql, params as any[]);
    return Number((r as ResultSetHeader).insertId);
  };
  const session = async (actor: "admin" | "affiliate", id: number) => {
    const token = crypto.randomBytes(32).toString("hex");
    await db.execute(
      `INSERT INTO \`${actor}_sessions\` (\`${actor}_id\`, token_hash, expires_at) VALUES (?, ?, ?)`,
      [id, crypto.createHash("sha256").update(token).digest("hex"), new Date(Date.now() + 86_400_000)],
    );
    return `gw_${actor}_sid=${token}`;
  };
  const as = (c: string) => ({
    get: (u: string) => request(app).get(u).set("Cookie", c),
    post: (u: string) => request(app).post(u).set("Cookie", c),
    put: (u: string) => request(app).put(u).set("Cookie", c),
    patch: (u: string) => request(app).patch(u).set("Cookie", c),
  });
  const twilio = (path: string, body: Record<string, string>) => request(app).post(path).type("form").send(body);

  beforeAll(async () => {
    process.env.VITEST = "true";
    const admin = (n: string, role: string) =>
      insertId(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, ?, 'Test', ?, 'active')`, [em(n), n, role]);
    superId = await admin("super", "super_admin");
    agentId = await admin("agent", "agent");
    otherAgentId = await admin("other", "agent");
    superCookie = await session("admin", superId);
    agentCookie = await session("admin", agentId);
    otherCookie = await session("admin", otherAgentId);
    lineId = await insertId(
      `INSERT INTO admin_phone_numbers (e164, friendly_name, assigned_admin_id, is_active) VALUES (?, 'Test line', ?, 1)`,
      [lineE164, superId],
    );
    const code = `T${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
    const affId = await insertId(
      `INSERT INTO affiliates (email, first_name, last_name, phone, status, referral_code) VALUES (?, 'Ana', 'Aff', ?, 'active', ?)`,
      [em("aff"), `949${String(stamp).slice(-7)}`, code],
    );
    affCookie = await session("affiliate", affId);
    clientId = await insertId(
      `INSERT INTO clients (first_name, last_name, email, status, affiliate_id) VALUES ('Maria', 'Lopez', ?, 'prospect', ?)`,
      [em("client"), affId],
    );
    await insertId(
      `INSERT INTO projects (public_id, client_id, affiliate_id, closer_affiliate_id) VALUES (?, ?, ?, ?)`,
      [`T${crypto.randomBytes(6).toString("hex").toUpperCase()}`, clientId, affId, affId],
    );
  });

  afterAll(async () => {
    try {
      if (lineId) {
        // Calls/texts on the test line create threads — remove them before the line.
        await db.query(`DELETE FROM conversation_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE ofg_number_id = ?)`, [lineId]);
        await db.query(`DELETE FROM conversations WHERE ofg_number_id = ?`, [lineId]);
        await db.query(`DELETE FROM conversation_unknown_contacts WHERE ofg_number_id = ?`, [lineId]);
        await db.query(`DELETE FROM admin_phone_numbers WHERE id = ?`, [lineId]);
      }
      if (templateIds.length) await db.query(`DELETE FROM conversation_templates WHERE id IN (?)`, [templateIds]);
      await cleanupPortalFixturesByPrefix(db, prefix);
      if (statusIds.length) await db.query(`DELETE FROM deal_statuses WHERE id IN (?)`, [statusIds]);
    } finally {
      await db.end();
    }
  });

  it("line settings: managers only, validated ring phones, membership grants access", async () => {
    await as(agentCookie).get(`/api/admin/phone-lines/${lineId}`).expect(403);
    const base = {
      line_mode: "shared",
      assigned_admin_id: superId,
      members: [{ admin_id: agentId, ring_browser: true }],
      ring_numbers: [{ label: "Super cell", e164: cellE164, is_active: true }],
      ring_timeout_sec: 20,
      voicemail_greeting_en: "Hi, you reached the test line.",
      voicemail_greeting_es: "Hola, llamó a la línea de prueba.",
    };
    const loop = await as(superCookie).put(`/api/admin/phone-lines/${lineId}`).send({ ...base, ring_numbers: [{ label: "Loop", e164: lineE164, is_active: true }] });
    expect(loop.body.error).toBe("validation.ringNumberLoop");
    const bad = await as(superCookie).put(`/api/admin/phone-lines/${lineId}`).send({ ...base, ring_numbers: [{ label: "", e164: "123", is_active: true }] });
    expect(bad.body.error).toBe("validation.ringNumberInvalid");
    const saved = await as(superCookie).put(`/api/admin/phone-lines/${lineId}`).send(base).expect(200);
    expect(saved.body.members.map((m: { admin_id: number }) => m.admin_id)).toEqual([agentId]);
    expect(saved.body.line).toMatchObject({ ring_timeout_sec: 20, voicemail_greeting_es: base.voicemail_greeting_es });

    const memberAccess = await as(agentCookie).get("/api/admin/conversations/access").expect(200);
    expect(memberAccess.body.numbers.some((n: { id: number }) => n.id === lineId)).toBe(true);
    const outsider = await as(otherCookie).get("/api/admin/conversations/access").expect(200);
    expect(outsider.body.numbers.some((n: { id: number }) => n.id === lineId)).toBe(false);
  });

  it("inbound: rings online member browsers + screened phones; never hangs up", async () => {
    await db.query(`UPDATE admins SET voice_available = 1 WHERE id = ?`, [agentId]);
    const ring = await twilio("/api/voice/incoming", { To: lineE164, From: "+15550001111", CallSid: `CA${stamp}a` }).expect(200);
    expect(ring.text).toContain(`<Client>admin_${agentId}</Client>`);
    expect(ring.text).toMatch(new RegExp(`<Number url="[^"]*/api/voice/screen"[^>]*>\\${cellE164}</Number>`));
    expect(ring.text).toContain('timeout="20"');
    expect(ring.text).not.toContain("<Hangup");

    // Nobody online and no phones → straight to the bilingual voicemail.
    await db.query(`UPDATE admins SET voice_available = 0 WHERE id = ?`, [agentId]);
    await db.query(`UPDATE phone_line_ring_numbers SET is_active = 0 WHERE line_id = ?`, [lineId]);
    const vm = await twilio("/api/voice/incoming", { To: lineE164, From: "+15550001111", CallSid: `CA${stamp}b` }).expect(200);
    expect(vm.text).toContain("Hi, you reached the test line.");
    expect(vm.text).toContain("Hola, llamó a la línea de prueba.");
    expect(vm.text).toContain("<Record");
    expect(vm.text).not.toContain("<Hangup");

    // No answer → same voicemail.
    const noAnswer = await twilio("/api/voice/dial-status", { To: lineE164, DialCallStatus: "no-answer", CallSid: `CA${stamp}c` }).expect(200);
    expect(noAnswer.text).toContain("Hola, llamó a la línea de prueba.");
    expect(noAnswer.text).toContain("<Record");

    // Screening: press 1 connects, anything else drops only that leg.
    const screen = await twilio("/api/voice/screen", {}).expect(200);
    expect(screen.text).toContain("<Gather");
    expect(screen.text).toContain("Oprima 1");
    expect((await twilio("/api/voice/screen-accept", { Digits: "1" })).text).toBe("<Response/>");
    expect((await twilio("/api/voice/screen-accept", { Digits: "2" })).text).toContain("<Hangup/>");
  });

  it("deal status: separate list, logged, notifies the affiliate; internal notes stay internal", async () => {
    await as(agentCookie).post("/api/admin/deal-statuses").send({ label_en: "x", tone: "warn" }).expect(403);
    const created = await as(superCookie)
      .post("/api/admin/deal-statuses")
      .send({ label_en: `${prefix}Not enough equity`, label_es: `${prefix}Equity insuficiente`, tone: "bad" })
      .expect(201);
    const status = created.body.statuses.find((s: { label_en: string }) => s.label_en.startsWith(prefix));
    statusIds.push(status.id);

    __testClearEmailDryRuns();
    __testClearSmsDryRuns();
    const set = await as(superCookie)
      .patch(`/api/admin/clients/${clientId}/deal-status`)
      .send({ deal_status_id: status.id, note: "Equity is below the minimum.", notify_affiliate: true })
      .expect(200);
    expect(set.body.updates[0]).toMatchObject({ kind: "deal_status", visibility: "affiliate", body: "Equity is below the minimum." });
    expect(set.body.updates[0].notified_at).toBeTruthy();
    expect(__testGetSmsDryRuns().some((m) => m.body.includes("Not enough equity") && m.body.includes("Maria L."))).toBe(true);
    expect(__testGetEmailDryRuns().some((m) => m.to === em("aff") && m.html.includes("Equity is below the minimum."))).toBe(true);
    // Account status untouched.
    const [[c]] = (await db.query(`SELECT status, deal_status_id FROM clients WHERE id = ?`, [clientId])) as any;
    expect(c).toMatchObject({ status: "prospect", deal_status_id: status.id });

    await as(superCookie).post(`/api/admin/clients/${clientId}/updates`).send({ body: "Internal: call back Friday", share_with_affiliate: false }).expect(201);
    await as(superCookie).post(`/api/admin/clients/${clientId}/updates`).send({ body: "Docs received, thank you!", share_with_affiliate: true }).expect(201);

    const aff = await as(affCookie).get("/api/affiliate/clients").expect(200);
    const row = aff.body.clients.find((r: { client_id: number }) => r.client_id === clientId);
    expect(row.deal_status_en).toContain("Not enough equity");
    const bodies = row.updates.map((u: { body: string | null }) => u.body);
    expect(bodies).toContain("Docs received, thank you!");
    expect(bodies).not.toContain("Internal: call back Friday");

    const board = await as(superCookie).get(`/api/admin/clients/${clientId}`).expect(200);
    expect(board.body.client.deal_status_tone).toBe("bad");

    // Clients list carries the badge fields (Clients + Projects pages).
    const list = await as(superCookie).get(`/api/admin/clients?q=${encodeURIComponent(em("client"))}`).expect(200);
    const listed = list.body.clients.find((r: { id: number }) => r.id === clientId);
    expect(listed).toMatchObject({ deal_status_id: status.id, deal_status_tone: "bad" });
    expect(listed.deal_status_en).toContain("Not enough equity");
    expect(listed.deal_status_es).toBeTruthy();
  });

  it("call transcripts: text arrives in the Twilio callback (nested or flat), matched by job or recording", async () => {
    const recA = `RE${crypto.randomBytes(16).toString("hex")}`;
    const recB = `RE${crypto.randomBytes(16).toString("hex")}`;
    const recC = `RE${crypto.randomBytes(16).toString("hex")}`;
    const convId = await insertId(
      `INSERT INTO conversations (client_id, channel, status, ofg_number_id, last_message_at) VALUES (?, 'call', 'open', ?, NOW())`,
      [clientId, lineId],
    );
    const msg = (rec: string, job: string | null) =>
      insertId(
        `INSERT INTO conversation_messages (conversation_id, direction, channel, body, recording_url, metadata_json)
         VALUES (?, 'outbound', 'call', 'Voice call — 60s (completed)', ?, ?)`,
        [convId, `https://api.twilio.com/2010-04-01/Accounts/ACx/Recordings/${rec}`, JSON.stringify({ recording_sid: rec, transcript_status: "pending", transcript_job_id: job })],
      );
    const a = await msg(recA, `voice_transcription_${stamp}a`);
    const b = await msg(recB, null);
    const c = await msg(recC, `voice_transcription_${stamp}c`);
    const meta = async (id: number) => {
      const [[r]] = (await db.query(`SELECT metadata_json FROM conversation_messages WHERE id = ?`, [id])) as any;
      return typeof r.metadata_json === "string" ? JSON.parse(r.metadata_json) : r.metadata_json;
    };
    // Stub Twilio's job lookup: only these jobs exist, each tied to its recording.
    const jobs: Record<string, string> = {
      [`voice_transcription_${stamp}a`]: recA,
      [`voice_transcription_${stamp}b`]: recB,
      [`voice_transcription_${stamp}c`]: recC,
    };
    const prevSid = process.env.TWILIO_ACCOUNT_SID;
    const prevTok = process.env.TWILIO_AUTH_TOKEN;
    process.env.TWILIO_ACCOUNT_SID = prevSid || "ACtest";
    process.env.TWILIO_AUTH_TOKEN = prevTok || "test-token";
    const ours = process.env.TWILIO_ACCOUNT_SID;
    __testSetTwilioVoiceHttp(async (input) => {
      const id = decodeURIComponent(String(input).split("/").pop() || "");
      const rec = jobs[id];
      if (!rec) return new Response(JSON.stringify({ code: 20404 }), { status: 404 });
      return new Response(
        JSON.stringify({ operationId: id, status: "COMPLETED", transcription: { id, sourceId: rec, accountId: ours, status: "COMPLETED" } }),
        { status: 200 },
      );
    });
    const sentences = [
      { text: "Hi, Daniel from Groundwork.", audioChannelIndex: 1, startTimeSeconds: 0 },
      { text: "Hola, gracias.", audioChannelIndex: 2, startTimeSeconds: 2 },
    ];
    const participants = [
      { address: "client:admin_1", audioChannelIndex: 1 },
      { address: "+17605550100", audioChannelIndex: 2 },
    ];
    // Nested shape (like the real job) matched by job id.
    await request(app)
      .post("/api/voice/call-transcript")
      .send({ operationId: `voice_transcription_${stamp}a`, status: "COMPLETED", transcription: { id: `voice_transcription_${stamp}a`, sourceId: recA, status: "COMPLETED", sentences, participants } })
      .expect(200);
    const ma = await meta(a);
    expect(ma.transcript_status).toBe("ready");
    expect(ma.transcript).toBe("Agent: Hi, Daniel from Groundwork.\nCaller: Hola, gracias.");

    // Flat shape, no job id stored → matched by recording sid.
    await request(app).post("/api/voice/call-transcript").send({ id: `voice_transcription_${stamp}b`, sourceId: recB, status: "completed", sentences }).expect(200);
    expect((await meta(b)).transcript_status).toBe("ready");

    // Completed with no speech → not stuck in pending.
    await request(app).post("/api/voice/call-transcript").send({ id: `voice_transcription_${stamp}c`, sourceId: recC, status: "completed", sentences: [] }).expect(200);
    const mc = await meta(c);
    expect(mc.transcript_status).not.toBe("pending");
    expect(mc.transcript_error).toBe("no_speech");

    // Forged callback: unknown job id → Twilio says 404 → ignored.
    const recD = `RE${crypto.randomBytes(16).toString("hex")}`;
    const d = await msg(recD, null);
    await request(app).post("/api/voice/call-transcript").send({ id: "voice_transcription_forged", sourceId: recD, status: "completed", sentences }).expect(200);
    expect((await meta(d)).transcript_status).toBe("pending");
    // Real job, but for a different recording → ignored.
    await request(app).post("/api/voice/call-transcript").send({ id: `voice_transcription_${stamp}a`, sourceId: recD, status: "completed", sentences }).expect(200);
    expect((await meta(d)).transcript_status).toBe("pending");

    // Other accounts are ignored.
    await request(app).post("/api/voice/call-transcript").send({ id: `voice_transcription_${stamp}a`, accountId: "ACsomeoneelse", status: "completed", sentences: [{ text: "x", audioChannelIndex: 1 }] }).expect(200);
    expect((await meta(a)).transcript).toBe("Agent: Hi, Daniel from Groundwork.\nCaller: Hola, gracias.");
    __testSetTwilioVoiceHttp(null);
    if (prevSid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
    if (prevTok === undefined) delete process.env.TWILIO_AUTH_TOKEN;
  });

  it("templates: agents can create (with category); usage is counted", async () => {
    const r = await as(agentCookie)
      .post("/api/admin/conversation-templates")
      .send({ title: `${prefix}Docs`, body_en: "Hi {{first_name}}, please send your documents.", category: "documents" })
      .expect(201);
    templateIds.push(r.body.template.id);
    expect(r.body.template.category).toBe("documents");
    await as(agentCookie).post(`/api/admin/conversation-templates/${r.body.template.id}/used`).expect(200);
    const list = await as(agentCookie).get("/api/admin/conversation-templates?all=1").expect(200);
    expect(list.body.templates.find((x: { id: number }) => x.id === r.body.template.id).usage_count).toBe(1);
    await as(agentCookie).patch(`/api/admin/conversation-templates/${r.body.template.id}`).send({ category: "nope" }).expect(400);
  });
});
