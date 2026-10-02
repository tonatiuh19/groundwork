/**
 * MCP OAuth + tool edge cases against shared TiDB.
 * Fixtures: @example.com only; cleaned via cleanupPortalFixturesByPrefix.
 */
import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
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
const prefix = `gwmcp-${Date.now()}-`;
const em = (name: string) => `${prefix}${name}@example.com`;
const redirectUri = "https://claude.ai/api/mcp/auth_callback";

async function insertId(sql: string, params: any[]): Promise<number> {
  const [r] = await db.execute(sql, params);
  return Number((r as { insertId: number }).insertId);
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
  const clientIdStr = `${prefix}client`;

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
      `INSERT INTO admins (email, first_name, last_name, role, status)
       VALUES (?, 'Mcp', 'Agent', 'agent', 'active')`,
      [em("agent")],
    );
    agentCookie = await makeAdminSession(agentId);

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
