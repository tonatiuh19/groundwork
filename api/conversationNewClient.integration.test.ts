import "dotenv/config";
import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

/**
 * Clients → Call / Message on a client nobody has texted yet: the thread opens empty with the client's
 * phone (the dialpad fills it). A client whose thread lives on another staff member's line stays private.
 */
describe.skipIf(!hasDb)("Conversations: first contact with a client (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwconvnew-${stamp}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const phone = (n: number) => `+1555${String(stamp + n).slice(-7)}`;
  const ins = async (sql: string, p: unknown[]) => Number(((await db.execute(sql, p as any[])) as any)[0].insertId);
  const staff = async (n: string, withLine: boolean, lineN: number) => {
    const id = await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, ?, 'Conv', 'agent', 'active')`, [em(n), n]);
    const t = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [id, crypto.createHash("sha256").update(t).digest("hex")]);
    const lineId = withLine ? await ins(`INSERT INTO admin_phone_numbers (e164, friendly_name, assigned_admin_id, is_active) VALUES (?, ?, ?, 1)`, [phone(lineN), `${prefix}${n}`, id]) : 0;
    return { cookie: `gw_admin_sid=${t}`, lineId };
  };
  let daniel = { cookie: "", lineId: 0 };
  let other = { cookie: "", lineId: 0 };
  let noLine = { cookie: "", lineId: 0 };
  let newClient = 0;
  let othersClient = 0;

  beforeAll(async () => {
    process.env.VITEST = "true";
    daniel = await staff("daniel", true, 1);
    other = await staff("other", true, 2);
    noLine = await staff("noline", false, 0);
    newClient = await ins(`INSERT INTO clients (first_name, last_name, email, phone, status) VALUES ('Katharine', 'New', ?, ?, 'prospect')`, [em("kat"), phone(10)]);
    othersClient = await ins(`INSERT INTO clients (first_name, last_name, email, phone, status) VALUES ('Private', 'Thread', ?, ?, 'active')`, [em("priv"), phone(11)]);
    await db.execute(`INSERT INTO conversations (client_id, channel, status, ofg_number_id, assigned_admin_id) VALUES (?, 'sms', 'open', ?, NULL)`, [othersClient, other.lineId]);
  });

  afterAll(async () => {
    try {
      await db.execute(`DELETE FROM conversations WHERE client_id IN (?, ?)`, [newClient, othersClient]);
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  const timeline = (cookie: string, id: number) => request(app).get(`/api/admin/conversations/contact/client/${id}/timeline`).set("Cookie", cookie);

  it("a client nobody has texted opens as an empty thread with their phone (Call fills the dialpad)", async () => {
    const r = await timeline(daniel.cookie, newClient).expect(200);
    expect(r.body.contact).toMatchObject({ phone: phone(10), first_name: "Katharine" });
    expect(r.body.threads).toEqual([]);
    expect(r.body.messages).toEqual([]);
  });

  it("a thread on another staff member's line stays private; staff without a line can't open Conversations", async () => {
    await timeline(daniel.cookie, othersClient).expect(404);
    await timeline(other.cookie, othersClient).expect(200);
    expect((await timeline(noLine.cookie, newClient)).status).toBeGreaterThanOrEqual(400);
  });
});
