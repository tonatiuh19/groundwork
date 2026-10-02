import { describe, expect, it } from "vitest";
import crypto from "crypto";
import {
  mcpOauthReturnPathAllowed,
  mcpRedirectUriAllowed,
  mcpRedirectUriOkForRegistration,
  mcpToolsListForClaude,
  mcpWriteConfirmed,
  parseBearerAuthorization,
  sanitizeMcpJsonRpcForClaude,
  verifyPkceS256,
} from "./index";

describe("MCP OAuth helpers", () => {
  it("parses Bearer tokens case-insensitively", () => {
    expect(parseBearerAuthorization("Bearer abc.def")).toBe("abc.def");
    expect(parseBearerAuthorization("bearer abc.def")).toBe("abc.def");
    expect(parseBearerAuthorization("BEARER abc.def")).toBe("abc.def");
    expect(parseBearerAuthorization("Bearer  abc.def  ")).toBe("abc.def");
    expect(parseBearerAuthorization("Basic abc")).toBeNull();
    expect(parseBearerAuthorization("Bearer")).toBeNull();
    expect(parseBearerAuthorization("Bearer undefined")).toBeNull();
    expect(parseBearerAuthorization(undefined)).toBeNull();
  });

  it("verifies PKCE S256", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = crypto
      .createHash("sha256")
      .update(verifier, "utf8")
      .digest("base64url");
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
    expect(verifyPkceS256("wrong", challenge)).toBe(false);
  });

  it("allows known Claude/Cursor redirects and rejects arbitrary https", () => {
    expect(
      mcpRedirectUriOkForRegistration("https://claude.ai/api/mcp/auth_callback"),
    ).toBe(true);
    expect(
      mcpRedirectUriOkForRegistration("https://claude.ai/api/mcp/auth_callback/v2"),
    ).toBe(true);
    expect(
      mcpRedirectUriOkForRegistration("https://www.cursor.com/agents/mcp/oauth/callback"),
    ).toBe(true);
    expect(
      mcpRedirectUriOkForRegistration("https://claude.ai/evil"),
    ).toBe(false);
    expect(
      mcpRedirectUriOkForRegistration("https://claude.ai/api/other"),
    ).toBe(false);
    expect(
      mcpRedirectUriOkForRegistration("https://evil.example/steal"),
    ).toBe(false);
    expect(
      mcpRedirectUriAllowed("https://claude.ai/api/mcp/auth_callback", []),
    ).toBe(true);
    expect(mcpRedirectUriAllowed("https://evil.example/x", [])).toBe(false);
  });

  it("allows loopback path matches ignoring port", () => {
    expect(
      mcpRedirectUriAllowed("http://127.0.0.1:54321/callback", [
        "http://127.0.0.1/callback",
      ]),
    ).toBe(true);
  });

  it("only allows MCP authorize/consent return paths after login", () => {
    expect(
      mcpOauthReturnPathAllowed(
        "/api/mcp/oauth/authorize?client_id=abc&state=1",
      ),
    ).toBe(true);
    expect(
      mcpOauthReturnPathAllowed(
        "/admin/mcp-consent?client_id=abc&redirect_uri=x",
      ),
    ).toBe(true);
    expect(mcpOauthReturnPathAllowed("/admin")).toBe(false);
    expect(mcpOauthReturnPathAllowed("//evil.example")).toBe(false);
    expect(mcpOauthReturnPathAllowed("/api/mcp/oauth/authorize/../team")).toBe(
      false,
    );
  });
  it("requires both confirm=true and confirm_phrase=CONFIRM for writes", () => {
    expect(mcpWriteConfirmed({})).toBe(false);
    expect(mcpWriteConfirmed({ confirm: true })).toBe(false);
    expect(mcpWriteConfirmed({ confirm_phrase: "CONFIRM" })).toBe(false);
    expect(mcpWriteConfirmed({ confirm: false, confirm_phrase: "CONFIRM" })).toBe(
      false,
    );
    expect(mcpWriteConfirmed({ confirm: true, confirm_phrase: "confirm" })).toBe(
      false,
    );
    expect(mcpWriteConfirmed({ confirm: true, confirm_phrase: "CONFIRM" })).toBe(
      true,
    );
    expect(mcpWriteConfirmed({ confirm: "true", confirm_phrase: "CONFIRM" })).toBe(
      true,
    );
  });
});

describe("Claude MCP tools/list sanitizer", () => {
  it("strips execution, annotations, title, and $schema", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      result: {
        tools: [
          {
            name: "search_leads",
            title: "Search",
            description: "Search leads",
            inputSchema: {
              $schema: "http://json-schema.org/draft-07/schema#",
              type: "object",
              properties: { q: { type: "string" } },
              additionalProperties: {},
            },
            annotations: { readOnlyHint: true },
            execution: { taskSupport: "forbidden" },
          },
        ],
      },
    });
    const out = JSON.parse(sanitizeMcpJsonRpcForClaude(raw));
    expect(out.result.tools).toEqual([
      {
        name: "search_leads",
        description: "Search leads",
        inputSchema: {
          type: "object",
          properties: { q: { type: "string" } },
        },
      },
    ]);
  });

  it("collapses initialize tools.listChanged to bare tools capability", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "groundwork-capital", version: "1.0.0" },
      },
    });
    const out = JSON.parse(sanitizeMcpJsonRpcForClaude(raw));
    expect(out.result.capabilities.tools).toEqual({});
  });

  it("builds Claude-safe tool list entries", () => {
    const tools = mcpToolsListForClaude([
      {
        name: "dashboard_summary",
        description: "Dashboard",
        inputSchema: {
          $schema: "x",
          type: "object",
          properties: {},
          additionalProperties: {},
        },
      },
    ]);
    expect(tools[0]).toEqual({
      name: "dashboard_summary",
      description: "Dashboard",
      inputSchema: {
        type: "object",
        properties: {},
      },
    });
    expect(tools[0]).not.toHaveProperty("execution");
  });
});
