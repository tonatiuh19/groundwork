import "dotenv/config";
import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

/** MCP: inbox across unknown numbers, reading and replying with a dry run; STOP is respected. */
describe.runIf(hasDb)("MCP inbox tools", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const prefix = `gwmcpin-${Date.now()}-`;
  const phone = `+1555${String(Date.now()).slice(-7)}`;
  let cookie = "";
  let agent = "";
  let lineId = 0;
  let unknownId = 0;
  let convId = 0;
  const ins = async (sql: string, p: unknown[]) => Number(((await db.execute(sql, p as any[])) as any)[0].insertId);
  const session = async (id: number) => {
    const t = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [id, crypto.createHash("sha256").update(t).digest("hex")]);
    return `gw_admin_sid=${t}`;
  };
  let rpc = 1;
  const call = async (name: string, args: Record<string, unknown>, c = cookie) => {
    const r = await request(app).post("/api/mcp").set("Cookie", c).set("Accept", "application/json, text/event-stream").set("Content-Type", "application/json").send({ jsonrpc: "2.0", id: rpc++, method: "tools/call", params: { name, arguments: args } });
    const body = r.body && r.body.result ? r.body : r.text.includes("data: ") ? JSON.parse(String(r.text).split("\n").find((l) => l.startsWith("data: "))!.slice(6)) : r.body;
    const text = body?.result?.content?.[0]?.text;
    let out: any = body;
    if (text != null) {
      try {
        out = JSON.parse(text);
      } catch {
        out = { error: text };
      }
    }
    return { status: r.status, failed: Boolean(body?.result?.isError), out };
  };

  beforeAll(async () => {
    process.env.VITEST = "true";
    const superId = await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'In', 'Box', 'super_admin', 'active')`, [`${prefix}s@example.com`]);
    cookie = await session(superId);
    lineId = await ins(`INSERT INTO admin_phone_numbers (e164, friendly_name, assigned_admin_id, is_active) VALUES (?, ?, ?, 1)`, [`+1555${String(Date.now() + 1).slice(-7)}`, `${prefix}line`, superId]);
    agent = await session(await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'In', 'Agent', 'agent', 'active')`, [`${prefix}a@example.com`]));
    unknownId = await ins(`INSERT INTO conversation_unknown_contacts (phone_e164, display_name, status, ofg_number_id) VALUES (?, ?, 'open', ?)`, [phone, `${prefix}Iridio`, lineId]);
    convId = await ins(`INSERT INTO conversations (unknown_contact_id, channel, status, ofg_number_id, last_message_at, last_message_preview, unread_count) VALUES (?, 'sms', 'open', ?, NOW(), ?, 1)`, [unknownId, lineId, `${prefix}hello`]);
    await db.execute(`INSERT INTO conversation_messages (conversation_id, direction, channel, body) VALUES (?, 'inbound', 'sms', ?)`, [convId, `${prefix}hello`]);
  });
  afterAll(async () => {
    await db.execute(`DELETE FROM sms_opt_outs WHERE phone_last10 = ?`, [phone.slice(-10)]);
    await db.execute(`DELETE FROM conversation_messages WHERE conversation_id = ?`, [convId]);
    await db.execute(`DELETE FROM conversations WHERE id = ?`, [convId]);
    await db.execute(`DELETE FROM conversation_unknown_contacts WHERE id = ?`, [unknownId]);
    await db.execute(`DELETE FROM conversation_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE ofg_number_id = ?)`, [lineId]);
    await db.execute(`DELETE FROM conversations WHERE ofg_number_id = ?`, [lineId]);
    await db.execute(`DELETE FROM conversation_unknown_contacts WHERE ofg_number_id = ?`, [lineId]);
    await db.execute(`DELETE FROM admin_phone_numbers WHERE id = ?`, [lineId]);
    await cleanupPortalFixturesByPrefix(db, prefix);
    await db.end();
  });

  it("finds and reads an unknown number's thread", async () => {
    const { out } = await call("list_inbox", { q: prefix });
    expect(out.threads.map((t: any) => t.conversation_id)).toContain(convId);
    expect(out.threads.find((t: any) => t.conversation_id === convId)).toMatchObject({ kind: "unknown", phone, unread: 1 });
    const read = await call("get_thread", { conversation_id: convId });
    expect(read.out.messages[0]).toMatchObject({ direction: "inbound", body: `${prefix}hello` });
    expect((await call("get_thread", { conversation_id: 2147480000 })).failed).toBe(true);
  });

  it("reply needs a dry run first and sends nothing until confirmed; a wrong phrase stays a preview", async () => {
    const count = async () => Number(((await db.query(`SELECT COUNT(*) n FROM conversation_messages WHERE conversation_id = ?`, [convId])) as any)[0][0].n);
    const preview = await call("reply_to_thread", { conversation_id: convId, body: "Hi" });
    expect(preview.out.preview).toBe(true);
    expect(preview.out.preview_data).toMatchObject({ to: phone, body: "Hi", latest_inbound: { body: `${prefix}hello` } });
    const wrong = await call("reply_to_thread", { conversation_id: convId, body: "Hi", confirm: true, confirm_phrase: "yes" });
    expect(wrong.out.preview).toBe(true);
    expect(await count()).toBe(1);
    const sent = await call("reply_to_thread", { conversation_id: convId, body: "Hi", confirm: true, confirm_phrase: "CONFIRM" });
    expect(sent.out.sent).toBe(true);
    expect(sent.out.conversation_id).toBe(convId);
    expect(await count()).toBe(2);
  });

  it("never texts someone who replied STOP", async () => {
    await db.execute(`INSERT IGNORE INTO sms_opt_outs (phone_last10, keyword) VALUES (?, 'STOP')`, [phone.slice(-10)]);
    const r = await call("reply_to_thread", { conversation_id: convId, body: "Hi", confirm: true, confirm_phrase: "CONFIRM" });
    expect(r.failed).toBe(true);
    expect(r.out.error).toMatch(/STOP/);
  });

  it("call insights work by thread; reports answer; non super admins are refused", async () => {
    expect((await call("get_call_insights", { conversation_id: convId })).failed).toBe(false);
    expect((await call("get_call_insights", {})).failed).toBe(true);
    expect(Array.isArray((await call("get_city_report", {})).out.cities)).toBe(true);
    expect(Array.isArray((await call("list_qr_codes", {})).out.codes)).toBe(true);
    expect((await call("list_mail_folders", {})).failed).toBe(true);
    expect((await call("list_inbox", {}, agent)).status).toBe(401);
  });
});
