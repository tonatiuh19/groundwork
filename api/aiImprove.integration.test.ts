import "dotenv/config";
import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { __testSetAssistantApi, createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

/** Wiring only (rules are unit tested in aiImprove.test.ts): staff session required, fake Claude, nothing sent. */
describe.skipIf(!hasDb)("Improve with AI endpoint (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const prefix = `gwai-${Date.now()}-`;
  let cookie = "";

  beforeAll(async () => {
    process.env.VITEST = "true";
    __testSetAssistantApi({ beta: { messages: { create: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "Good morning, {{first_name}}!" }] }) } } });
    const [r] = (await db.execute(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Ai', 'Agent', 'agent', 'active')`, [`${prefix}agent@example.com`])) as any;
    const t = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [r.insertId, crypto.createHash("sha256").update(t).digest("hex")]);
    cookie = `gw_admin_sid=${t}`;
  });

  afterAll(async () => {
    __testSetAssistantApi(null);
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("any staff member gets the rewrite; no session is refused", async () => {
    const ok = await request(app).post("/api/admin/ai/improve-text").set("Cookie", cookie).send({ text: "morning {{first_name}}", kind: "sms" }).expect(200);
    expect(ok.body.text).toBe("Good morning, {{first_name}}!");
    await request(app).post("/api/admin/ai/improve-text").send({ text: "morning", kind: "sms" }).expect(401);
  });
});
