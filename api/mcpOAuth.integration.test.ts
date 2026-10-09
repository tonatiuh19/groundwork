/**
 * MCP OAuth + tool edge cases against shared TiDB.
 * Fixtures: @example.com only; cleaned via cleanupPortalFixturesByPrefix.
 */
import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { RowDataPacket } from "mysql2/promise";
import { __testClearEmailDryRuns, createServer } from "./index";
import {
  cleanupPortalFixturesByPrefix,
  createIntegrationTestPool,
} from "./testDbCleanup";

const hasDb = Boolean(
  process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME,
);
const app = createServer();
const db = createIntegrationTestPool();
const stamp = Date.now();
const prefix = `gwmcp-${stamp}-`;
const em = (name: string) => `${prefix}${name}@example.com`;
const redirectUri = "https://claude.ai/api/mcp/auth_callback";
// Unique E.164 (avoid collisions with other suites / leftover rows).
const ofgE164 = `+1555${String(stamp).slice(-6)}${String(Math.floor(Math.random() * 9) + 1)}`;

async function insertId(sql: string, params: any[]): Promise<number> {
  const [r] = await db.execute(sql, params);
  return Number((r as { insertId: number }).insertId);
}

function mcpText(body: unknown): string {
  return JSON.stringify(body);
}

async function makeAdminSession(adminId: number) {
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

function pkcePair() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier, "utf8")
    .digest("base64url");
  return { verifier, challenge };
}

describe.runIf(hasDb)("MCP OAuth + tools (integration)", () => {
  let superId = 0;
  let superCookie = "";
  let agentId = 0;
  let agentCookie = "";
  let leadId = 0;
  let clientId = "";
  let phoneNumberId = 0;
  let gwClientId = 0;
  const clientIdStr = `${prefix}client`;

  async function mintBearer(): Promise<string> {
    const { verifier, challenge } = pkcePair();
    const approve = await request(app)
      .post("/api/admin/mcp/oauth/approve")
      .set("Cookie", superCookie)
      .send({
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        approve: true,
      });
    const code = new URL(approve.body.redirect_to).searchParams.get("code");
    const tokenRes = await request(app)
      .post("/api/mcp/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      });
    return String(tokenRes.body.access_token || "");
  }

  beforeAll(async () => {
    process.env.VITEST = "true";
    __testClearEmailDryRuns();

    superId = await insertId(
      `INSERT INTO admins (email, first_name, last_name, role, status)
       VALUES (?, 'Mcp', 'Super', 'super_admin', 'active')`,
      [em("super")],
    );
    superCookie = await makeAdminSession(superId);

    agentId = await insertId(
      `INSERT INTO admins (email, first_name, last_name, role, status, phone)
       VALUES (?, 'Mcp', 'Agent', 'agent', 'active', '+15550108888')`,
      [em("agent")],
    );
    agentCookie = await makeAdminSession(agentId);

    phoneNumberId = await insertId(
      `INSERT INTO admin_phone_numbers
         (e164, friendly_name, assigned_admin_id, is_active, capabilities_json)
       VALUES (?, 'MCP Vitest Line', ?, 1, ?)`,
      [ofgE164, agentId, JSON.stringify({ sms: true })],
    );

    gwClientId = await insertId(
      `INSERT INTO clients
         (first_name, last_name, email, phone, status, preferred_language)
       VALUES ('Mcp', 'GwClient', ?, '+15550107777', 'prospect', 'en')`,
      [em("gwclient")],
    );

    leadId = await insertId(
      `INSERT INTO leads
         (full_name, first_name, last_name, email, phone, status, mode, preferred_language,
          soft_pull_consent, ip_address, user_agent)
       VALUES ('Mcp Lead', 'Mcp', 'Lead', ?, '555-0100', 'new', 'standard', 'en', 0, '127.0.0.1', 'vitest')`,
      [em("lead")],
    );

    await db.execute(
      `INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris_json)
       VALUES (?, 'Vitest MCP', ?)`,
      [clientIdStr, JSON.stringify([redirectUri])],
    );
    clientId = clientIdStr;
  });

  afterAll(async () => {
    try {
      await db
        .query(
          `DELETE FROM conversation_messages WHERE conversation_id IN (
             SELECT id FROM conversations
             WHERE ofg_number_id = ? OR client_id = ? OR assigned_admin_id IN (?, ?)
                OR contact_id IN (SELECT id FROM contacts WHERE LOWER(email) LIKE ?)
           )`,
          [phoneNumberId, gwClientId, superId, agentId, `${prefix}%@example.com`],
        )
        .catch(() => {});
      await db
        .query(
          `DELETE FROM conversations
           WHERE ofg_number_id = ? OR client_id = ? OR assigned_admin_id IN (?, ?)
              OR contact_id IN (SELECT id FROM contacts WHERE LOWER(email) LIKE ?)`,
          [phoneNumberId, gwClientId, superId, agentId, `${prefix}%@example.com`],
        )
        .catch(() => {});
      // Phone-only convert clients have NULL email — not covered by email-prefix cleanup.
      await db
        .query(
          `UPDATE contacts SET converted_client_id = NULL
           WHERE created_by_admin_id IN (?, ?) OR assigned_admin_id IN (?, ?)`,
          [superId, agentId, superId, agentId],
        )
        .catch(() => {});
      await db
        .query(
          `DELETE FROM clients
           WHERE assigned_admin_id IN (?, ?)
             AND (email IS NULL OR email = '')
             AND first_name IN ('Phone', 'Mcp')`,
          [superId, agentId],
        )
        .catch(() => {});
      await db
        .query(
          `DELETE FROM contacts
           WHERE created_by_admin_id IN (?, ?) OR assigned_admin_id IN (?, ?)`,
          [superId, agentId, superId, agentId],
        )
        .catch(() => {});
      if (phoneNumberId) {
        await db
          .query(`DELETE FROM admin_phone_numbers WHERE id = ?`, [phoneNumberId])
          .catch(() => {});
      }
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
      __testClearEmailDryRuns();
    }
  });

  it("rejects MCP endpoint for non-super_admin cookie", async () => {
    const res = await request(app)
      .post("/api/mcp")
      .set("Cookie", agentCookie)
      .set("Accept", "application/json")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(res.status).toBe(401);
  });

  it("rejects DCR with arbitrary Claude path", async () => {
    const res = await request(app)
      .post("/api/mcp/oauth/register")
      .send({
        client_name: "evil",
        redirect_uris: ["https://claude.ai/steal"],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_redirect_uri");
  });

  it("registers public client and completes PKCE OAuth for super_admin", async () => {
    const { verifier, challenge } = pkcePair();
    const state = "st-" + crypto.randomBytes(4).toString("hex");

    const auth = await request(app)
      .get("/api/mcp/oauth/authorize")
      .query({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
      });
    expect(auth.status).toBe(302);
    expect(String(auth.headers.location)).toContain("/admin/mcp-consent");

    const approve = await request(app)
      .post("/api/admin/mcp/oauth/approve")
      .set("Cookie", superCookie)
      .send({
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        state,
        approve: true,
      });
    expect(approve.status).toBe(200);
    expect(approve.body.redirect_to).toContain("code=");
    const code = new URL(approve.body.redirect_to).searchParams.get("code");
    expect(code).toBeTruthy();

    const token = await request(app)
      .post("/api/mcp/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      });
    expect(token.status).toBe(200);
    expect(token.body.access_token).toBeTruthy();
    expect(token.body.refresh_token).toBeTruthy();
    expect(token.body.expires_in).toBe(3600);

    const [rows] = await db.query(
      `SELECT refresh_expires_at FROM mcp_oauth_tokens
       WHERE admin_id = ? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1`,
      [superId],
    );
    const refreshExp = (rows as { refresh_expires_at: Date }[])[0]
      ?.refresh_expires_at;
    expect(refreshExp).toBeTruthy();
    expect(new Date(refreshExp).getTime()).toBeGreaterThan(
      Date.now() + 20 * 24 * 3600_000,
    );

    const refresh = await request(app)
      .post("/api/mcp/oauth/token")
      .type("form")
      .send({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: token.body.refresh_token,
      });
    expect(refresh.status).toBe(200);
    expect(refresh.body.access_token).toBeTruthy();
    expect(refresh.body.refresh_token).not.toBe(token.body.refresh_token);

    // Expired refresh rejected
    await db.execute(
      `UPDATE mcp_oauth_tokens SET refresh_expires_at = DATE_SUB(NOW(), INTERVAL 1 DAY)
       WHERE admin_id = ? AND revoked_at IS NULL`,
      [superId],
    );
    const expired = await request(app)
      .post("/api/mcp/oauth/token")
      .type("form")
      .send({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: refresh.body.refresh_token,
      });
    expect(expired.status).toBe(400);
    expect(expired.body.error).toBe("invalid_grant");
  });

  it("dry-runs writes without confirm; get_lead omits ip_address", async () => {
    const tools = await request(app)
      .get("/api/admin/mcp/tools")
      .set("Cookie", superCookie);
    expect(tools.status).toBe(200);
    const createStaff = (tools.body.tools as { name: string; inputSchema: any }[]).find(
      (t) => t.name === "create_staff",
    );
    expect(createStaff?.inputSchema?.properties?.role?.enum).not.toContain(
      "super_admin",
    );

    // Re-issue a fresh token for tool calls (prior test expired refresh)
    const { verifier, challenge } = pkcePair();
    const approve = await request(app)
      .post("/api/admin/mcp/oauth/approve")
      .set("Cookie", superCookie)
      .send({
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        approve: true,
      });
    const code = new URL(approve.body.redirect_to).searchParams.get("code");
    const tokenRes = await request(app)
      .post("/api/mcp/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      });
    const bearer = tokenRes.body.access_token as string;
    expect(bearer).toBeTruthy();

    const mcpHeaders = {
      Authorization: `Bearer ${bearer}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    };

    const dry = await request(app)
      .post("/api/mcp")
      .set(mcpHeaders)
      .send({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "create_staff",
          arguments: {
            email: em("newstaff"),
            first_name: "New",
            last_name: "Staff",
            role: "admin",
            confirm_phrase: "CONFIRM",
          },
        },
      });
    expect(dry.status).toBe(200);
    const dryText = JSON.stringify(dry.body);
    expect(dryText).toMatch(/preview|CONFIRM|confirm/i);
    const [staffAfterDry] = await db.query(
      `SELECT id FROM admins WHERE email = ? LIMIT 1`,
      [em("newstaff")],
    );
    expect((staffAfterDry as unknown[]).length).toBe(0);

    const getLead = await request(app)
      .post("/api/mcp")
      .set(mcpHeaders)
      .send({
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: {
          name: "get_lead",
          arguments: { lead_id: leadId },
        },
      });
    expect(getLead.status).toBe(200);
    const leadPayload = JSON.stringify(getLead.body);
    expect(leadPayload).toContain("Mcp Lead");
    expect(leadPayload).not.toContain("127.0.0.1");
    expect(leadPayload).not.toContain("\"vitest\"");

    const toolNames = (tools.body.tools as { name: string }[]).map((t) => t.name);
    for (const n of [
      "search_contacts",
      "send_sms",
      "send_contact_sms",
      "list_sms",
      "list_brand_phone_numbers",
      "list_ofg_phone_numbers",
      "send_whatsapp",
      "get_call_insights",
    ]) {
      expect(toolNames).toContain(n);
    }

    const contactDry = await request(app)
      .post("/api/mcp")
      .set(mcpHeaders)
      .send({
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: {
          name: "create_contact",
          arguments: {
            first_name: "Mcp",
            last_name: "Contact",
            email: em("contact"),
            phone: "+15550109999",
          },
        },
      });
    expect(contactDry.status).toBe(200);
    const contactDryText = JSON.stringify(contactDry.body);
    expect(contactDryText).toMatch(/preview|CONFIRM|confirm/i);
    const [contactsAfterDry] = await db.query(
      `SELECT id FROM contacts WHERE email = ? LIMIT 1`,
      [em("contact")],
    );
    expect((contactsAfterDry as unknown[]).length).toBe(0);

    const contactCreate = await request(app)
      .post("/api/mcp")
      .set(mcpHeaders)
      .send({
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: {
          name: "create_contact",
          arguments: {
            first_name: "Mcp",
            last_name: "Contact",
            email: em("contact"),
            phone: "+15550109999",
            confirm: true,
            confirm_phrase: "CONFIRM",
          },
        },
      });
    expect(contactCreate.status).toBe(200);
    expect(JSON.stringify(contactCreate.body)).toMatch(/created|contact/i);
    const [contactsAfter] = await db.query(
      `SELECT id FROM contacts WHERE email = ? LIMIT 1`,
      [em("contact")],
    );
    expect((contactsAfter as unknown[]).length).toBe(1);

    const wa = await request(app)
      .post("/api/mcp")
      .set(mcpHeaders)
      .send({
        jsonrpc: "2.0",
        id: 14,
        method: "tools/call",
        params: {
          name: "send_whatsapp",
          arguments: {
            client_id: 1,
            body: "hi",
            confirm: true,
            confirm_phrase: "CONFIRM",
          },
        },
      });
    expect(wa.status).toBe(200);
    expect(JSON.stringify(wa.body)).toMatch(/whatsapp_not_configured/i);

    const phones = await request(app)
      .post("/api/mcp")
      .set(mcpHeaders)
      .send({
        jsonrpc: "2.0",
        id: 15,
        method: "tools/call",
        params: {
          name: "list_brand_phone_numbers",
          arguments: { all: true },
        },
      });
    expect(phones.status).toBe(200);
    expect(JSON.stringify(phones.body)).toMatch(/twilio_configured|numbers/i);
  });

  it("conversations MCP edge cases: no-line, from override, convert, list, duplicates", async () => {
    const bearer = await mintBearer();
    expect(bearer).toBeTruthy();
    const mcpHeaders = {
      Authorization: `Bearer ${bearer}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    };
    const call = (id: number, name: string, args: Record<string, unknown>) =>
      request(app)
        .post("/api/mcp")
        .set(mcpHeaders)
        .send({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name, arguments: args },
        });

    // Super has no brand line → send_sms fails clearly
    const noLine = await call(20, "send_sms", {
      client_id: gwClientId,
      body: "should fail",
      confirm: true,
      confirm_phrase: "CONFIRM",
    });
    expect(noLine.status).toBe(200);
    expect(mcpText(noLine.body)).toMatch(/conversations_number_required|no assigned/i);

    // Dry-run with from_phone_number_id shows that From line
    const drySms = await call(21, "send_sms", {
      client_id: gwClientId,
      body: "Hello MCP edge",
      from_phone_number_id: phoneNumberId,
    });
    expect(drySms.status).toBe(200);
    const drySmsText = mcpText(drySms.body);
    expect(drySmsText).toMatch(/preview|CONFIRM/i);
    expect(drySmsText).toContain(ofgE164);

    // Confirm send via override → Twilio dry-run SID
    const sent = await call(22, "send_sms", {
      client_id: gwClientId,
      body: "Hello MCP edge confirm",
      from_phone_number_id: phoneNumberId,
      confirm: true,
      confirm_phrase: "CONFIRM",
    });
    expect(sent.status).toBe(200);
    const sentText = mcpText(sent.body);
    expect(sentText).toMatch(/sent["\\\s:]*true/i);
    expect(sentText).toMatch(/dry-run-|queued|provider_status/i);

    const [msgs] = await db.query<RowDataPacket[]>(
      `SELECT m.provider_message_id, m.body, m.direction
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.client_id = ?
       ORDER BY m.id DESC LIMIT 1`,
      [gwClientId],
    );
    expect(msgs[0]?.provider_message_id).toMatch(/^dry-run-/);
    expect(String(msgs[0]?.body || "")).toContain("MCP edge confirm");

    // list_sms / get_conversation see the message
    const listed = await call(23, "list_sms", { client_id: gwClientId, limit: 10 });
    expect(listed.status).toBe(200);
    expect(mcpText(listed.body)).toContain("MCP edge confirm");

    const alias = await call(24, "get_conversation", { client_id: gwClientId });
    expect(alias.status).toBe(200);
    expect(mcpText(alias.body)).toContain("MCP edge confirm");

    // get_call_insights empty-safe
    const insights = await call(25, "get_call_insights", { client_id: gwClientId });
    expect(insights.status).toBe(200);
    expect(mcpText(insights.body)).toMatch(/call_insights_enabled|calls/i);

    // search_contacts finds created contact
    const search = await call(26, "search_contacts", { q: "Mcp Contact" });
    expect(search.status).toBe(200);
    expect(mcpText(search.body)).toMatch(/contact|Mcp/i);

    const [crows] = await db.query<RowDataPacket[]>(
      `SELECT id FROM contacts WHERE email = ? LIMIT 1`,
      [em("contact")],
    );
    const contactId = Number(crows[0]?.id || 0);
    expect(contactId).toBeGreaterThan(0);

    // Duplicate create without confirm_duplicate fails on confirm
    const dup = await call(27, "create_contact", {
      first_name: "Mcp",
      last_name: "Dup",
      email: em("contact"),
      phone: "+15550109999",
      confirm: true,
      confirm_phrase: "CONFIRM",
    });
    expect(dup.status).toBe(200);
    expect(mcpText(dup.body)).toMatch(/duplicate|confirm_duplicate/i);

    // send_contact_sms dry-run + confirm
    const contactSmsDry = await call(28, "send_contact_sms", {
      contact_id: contactId,
      body: "Contact SMS preview",
      from_phone_number_id: phoneNumberId,
    });
    expect(contactSmsDry.status).toBe(200);
    expect(mcpText(contactSmsDry.body)).toMatch(/preview|CONFIRM/i);

    const contactSms = await call(29, "send_contact_sms", {
      contact_id: contactId,
      body: "Contact SMS sent",
      from_phone_number_id: phoneNumberId,
      confirm: true,
      confirm_phrase: "CONFIRM",
    });
    expect(contactSms.status).toBe(200);
    expect(mcpText(contactSms.body)).toMatch(/sent|contact_id/i);

    // convert_contact dry-run then confirm
    const convertDry = await call(30, "convert_contact", { contact_id: contactId });
    expect(convertDry.status).toBe(200);
    expect(mcpText(convertDry.body)).toMatch(/preview|CONFIRM/i);

    const convert = await call(31, "convert_contact", {
      contact_id: contactId,
      confirm: true,
      confirm_phrase: "CONFIRM",
    });
    expect(convert.status).toBe(200);
    expect(mcpText(convert.body)).toMatch(/converted|client_id|linked_existing/i);

    const [converted] = await db.query<RowDataPacket[]>(
      `SELECT converted_client_id FROM contacts WHERE id = ? LIMIT 1`,
      [contactId],
    );
    expect(converted[0]?.converted_client_id).toBeTruthy();

    // send_contact_sms after convert should refuse
    const afterConvert = await call(32, "send_contact_sms", {
      contact_id: contactId,
      body: "nope",
      from_phone_number_id: phoneNumberId,
      confirm: true,
      confirm_phrase: "CONFIRM",
    });
    expect(afterConvert.status).toBe(200);
    expect(mcpText(afterConvert.body)).toMatch(/converted|send_sms/i);

    // staff SMS via to_admin_id
    const staffSms = await call(33, "send_sms", {
      to_admin_id: agentId,
      body: "Staff ping",
      from_phone_number_id: phoneNumberId,
      confirm: true,
      confirm_phrase: "CONFIRM",
    });
    expect(staffSms.status).toBe(200);
    expect(mcpText(staffSms.body)).toMatch(/staff|sent/i);

    // send_contact_email dry-run (no send without confirm)
    const emailDry = await call(34, "send_contact_email", {
      contact_id: contactId,
      subject: "Hi",
      body: "Hello contact",
    });
    // contact already converted → should error
    expect(emailDry.status).toBe(200);
    expect(mcpText(emailDry.body)).toMatch(/converted|not found|preview/i);

    // Phone-only convert (no email) — Optimum parity
    const phoneOnlyCreate = await call(35, "create_contact", {
      first_name: "Phone",
      last_name: "Only",
      phone: `+1555${String(Date.now()).slice(-7)}`,
      confirm: true,
      confirm_phrase: "CONFIRM",
    });
    expect(phoneOnlyCreate.status).toBe(200);
    expect(mcpText(phoneOnlyCreate.body)).toMatch(/created|contact/i);
    const [phoneContactRows] = await db.query<RowDataPacket[]>(
      `SELECT id, phone FROM contacts
       WHERE first_name = 'Phone' AND last_name = 'Only'
         AND created_by_admin_id = ? AND converted_client_id IS NULL
       ORDER BY id DESC LIMIT 1`,
      [superId],
    );
    const phoneContactId = Number(phoneContactRows[0]?.id || 0);
    expect(phoneContactId).toBeGreaterThan(0);

    const phoneConvert = await call(36, "convert_contact", {
      contact_id: phoneContactId,
      confirm: true,
      confirm_phrase: "CONFIRM",
    });
    expect(phoneConvert.status).toBe(200);
    expect(mcpText(phoneConvert.body)).toMatch(/converted|client_id/i);
    const [phoneConverted] = await db.query<RowDataPacket[]>(
      `SELECT converted_client_id FROM contacts WHERE id = ? LIMIT 1`,
      [phoneContactId],
    );
    const phoneClientId = Number(phoneConverted[0]?.converted_client_id || 0);
    expect(phoneClientId).toBeGreaterThan(0);
    const [phoneClient] = await db.query<RowDataPacket[]>(
      `SELECT email, phone FROM clients WHERE id = ? LIMIT 1`,
      [phoneClientId],
    );
    expect(phoneClient[0]?.email == null || phoneClient[0]?.email === "").toBe(
      true,
    );
    expect(String(phoneClient[0]?.phone || "")).toBeTruthy();
  });

  it("lists connections for super_admin and supports revoke", async () => {
    const list = await request(app)
      .get("/api/admin/me/mcp-connections")
      .set("Cookie", superCookie);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.connections)).toBe(true);
    expect(list.body.connections.length).toBeGreaterThan(0);
    expect(list.body.connections[0]).toHaveProperty("refresh_expires_at");

    const id = list.body.connections[0].id as number;
    const rev = await request(app)
      .delete(`/api/admin/me/mcp-connections/${id}`)
      .set("Cookie", superCookie);
    expect(rev.status).toBe(200);

    const agentList = await request(app)
      .get("/api/admin/me/mcp-connections")
      .set("Cookie", agentCookie);
    expect(agentList.status).toBe(403);
  });
});
