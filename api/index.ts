/**
 * Groundwork Capital — Vercel serverless Express monolith.
 * Keep all runtime API logic inline in this file (no relative value imports).
 * `import type` from shared/ is allowed.
 */
import "dotenv/config";
import crypto from "crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import cors from "cors";
import { z } from "zod";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import rateLimit from "express-rate-limit";
import mysql, {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { Resend } from "resend";
import twilio from "twilio";
import {
  del as delBlob,
  get as getBlob,
  head as headBlob,
  issueSignedToken as issueBlobSignedToken,
  presignUrl as presignBlobUrl,
  put as putBlob,
} from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import type {
  AdminNotificationPrefs,
  AdminNotifyChannel,
  AdminNotifyEventKey,
  AdminNotifyEventToggles,
  AdminNotifyStaffRecipient,
  AdminRole,
  Campaign,
  CampaignAudienceFilter,
  CampaignAudienceKind,
  CampaignAudiencePreview,
  CampaignChannels,
  CampaignTemplate,
  CampaignTemplateRole,
  ContactIntent,
  EventRegistrationStatus,
  LeadAudienceTag,
  LeadMode,
  MarketingEvent,
  MarketingEventStatus,
  PortalActor,
  PortalAuthResponse,
  PortalAuthUser,
  PublicEventView,
  SubmitContactRequest,
  SubmitGetCreditReportLeadRequest,
  SubmitGetCreditReportLeadResponse,
  SubmitLeadRequest,
  SubmitLeadResponse,
  SubmitPartnerReferralRequest,
  SubmitPartnerReferralResponse,
  SubmitSimpleLeadResponse,
  LeadConvertTarget,
  LeadConvertStatus,
  LeadConvertPhoneMatch,
  AdminDuplicatesResponse,
  DedupeEntity,
  DuplicateCluster,
  DuplicateMember,
  PersonEntity,
  PersonMatch,
} from "../shared/api";
import type {
  AdminContractorApplicationView,
  AduProjectType,
  ContractorApplicationData,
  ContractorApplicationDocType,
  ContractorApplicationDocument,
  ContractorApplicationPublicView,
  ContractorApplicationRequirements,
  ContractorApplicationStatus,
  ContractorApplicationTemplates,
  ContractorDocSpec,
  ContractorPortalApplicationSummary,
  InsurancePolicy,
} from "../shared/contractorApplication";

const APP_NAME = "Groundwork Capital";
const APP_URL = (
  process.env.PUBLIC_APP_URL || "https://groundworkcapitalgroup.com"
).replace(/\/$/, "");

// ─── MCP OAuth / Streamable HTTP (super_admin only) ──────────────────────────

/** Canonical public origin — force www (apex 308s break OAuth discovery / DCR). */
function siteOrigin(): string {
  const raw = (
    process.env.PUBLIC_APP_URL || "https://www.groundworkcapitalgroup.com"
  ).replace(/\/$/, "");
  if (
    raw === "https://groundworkcapitalgroup.com" ||
    raw === "http://groundworkcapitalgroup.com"
  ) {
    return "https://www.groundworkcapitalgroup.com";
  }
  return raw;
}

function mcpResourceUrl(): string {
  return `${siteOrigin()}/api/mcp`;
}

/** Product scope — avoid bare "mcp" (Claude may discard token). */
const MCP_SCOPE = "groundwork.admin.read";
const MCP_ACCESS_TTL_SEC = 3600;
const MCP_REFRESH_TTL_SEC = 30 * 24 * 3600;

function mcpOauthAuthorizationServerMetadata() {
  const issuer = mcpResourceUrl();
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    scopes_supported: [MCP_SCOPE],
    resource_indicator_parameter_supported: true,
  };
}

function mcpOauthProtectedResourceMetadata() {
  const resource = mcpResourceUrl();
  return {
    resource,
    authorization_servers: [resource],
    bearer_methods_supported: ["header"],
    scopes_supported: [MCP_SCOPE],
    resource_name: "Groundwork Capital Admin",
  };
}

export function mcpOauthReturnPathAllowed(raw: string): boolean {
  if (!raw.startsWith("/api/mcp/oauth/authorize") && !raw.startsWith("/admin/mcp-consent")) {
    return false;
  }
  try {
    const u = new URL(raw, "https://www.groundworkcapitalgroup.com");
    return (
      u.pathname === "/api/mcp/oauth/authorize" ||
      u.pathname === "/admin/mcp-consent"
    );
  } catch {
    return false;
  }
}

/**
 * Claude (web/mobile connectors) silently drops entire tool catalogs when
 * tools/list includes newer MCP fields (`execution`, `annotations`, `title`,
 * `outputSchema`) or JSON Schema metadata (`$schema`, empty `additionalProperties`).
 * Keep wire responses to { name, description, inputSchema }.
 */
export function sanitizeMcpJsonRpcForClaude(raw: string): string {
  if (
    !raw ||
    (!raw.trimStart().startsWith("{") && !raw.trimStart().startsWith("["))
  ) {
    return raw;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    let changed = false;
    for (const msg of messages) {
      if (!msg || typeof msg !== "object") continue;
      const m = msg as Record<string, unknown>;
      const result = m.result;
      if (!result || typeof result !== "object") continue;
      const r = result as Record<string, unknown>;

      if (Array.isArray(r.tools)) {
        r.tools = r.tools.map((tool) => {
          if (!tool || typeof tool !== "object") return tool;
          const t = tool as Record<string, unknown>;
          const inputSchema: Record<string, unknown> =
            t.inputSchema &&
            typeof t.inputSchema === "object" &&
            !Array.isArray(t.inputSchema)
              ? { ...(t.inputSchema as Record<string, unknown>) }
              : { type: "object", properties: {} };
          delete inputSchema.$schema;
          if (
            inputSchema.additionalProperties &&
            typeof inputSchema.additionalProperties === "object" &&
            !Array.isArray(inputSchema.additionalProperties) &&
            Object.keys(inputSchema.additionalProperties as object).length === 0
          ) {
            delete inputSchema.additionalProperties;
          }
          return {
            name: t.name,
            description: t.description,
            inputSchema,
          };
        });
        changed = true;
      }

      const caps = r.capabilities;
      if (caps && typeof caps === "object") {
        const c = caps as Record<string, unknown>;
        if (c.tools && typeof c.tools === "object" && !Array.isArray(c.tools)) {
          if (Object.keys(c.tools as object).length > 0) {
            c.tools = {};
            changed = true;
          }
        }
      }

      if ("instructions" in r) {
        delete r.instructions;
        changed = true;
      }
    }
    if (!changed) return raw;
    return JSON.stringify(Array.isArray(parsed) ? messages : messages[0]);
  } catch {
    return raw;
  }
}

/** Claude-safe tool list: name + description + plain JSON Schema only. */
export function mcpToolsListForClaude(
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>,
): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  return tools.map((t) => {
    const schema: Record<string, unknown> = { ...(t.inputSchema || {}) };
    delete schema.$schema;
    if (
      schema.additionalProperties &&
      typeof schema.additionalProperties === "object" &&
      !Array.isArray(schema.additionalProperties) &&
      Object.keys(schema.additionalProperties as object).length === 0
    ) {
      delete schema.additionalProperties;
    }
    if (!schema.type) schema.type = "object";
    if (!schema.properties) schema.properties = {};
    return {
      name: t.name,
      description: t.description,
      inputSchema: schema,
    };
  });
}

export function parseBearerAuthorization(
  header: string | undefined | null,
): string | null {
  if (!header) return null;
  const m = String(header).match(/^\s*Bearer\s+(\S+)\s*$/i);
  if (!m) return null;
  const tok = m[1];
  if (!tok || tok === "undefined" || tok === "null") return null;
  return tok;
}

const KNOWN_MCP_REDIRECT_URIS = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
  "http://localhost/callback",
  "http://127.0.0.1/callback",
  "http://localhost/oauth/callback",
  "http://127.0.0.1/oauth/callback",
  "cursor://anysphere.cursor-mcp/oauth/callback",
  "https://www.cursor.com/agents/mcp/oauth/callback",
  "http://localhost:8787/callback",
  "http://127.0.0.1:8787/callback",
];

export function parseMcpRedirectUris(json: unknown): string[] {
  if (Array.isArray(json)) return json.map(String);
  if (typeof json === "string") {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function loopbackRedirectOk(requested: string, registered: string): boolean {
  try {
    const req = new URL(requested);
    const reg = new URL(registered);
    const loopbacks = new Set(["localhost", "127.0.0.1", "[::1]"]);
    if (!loopbacks.has(req.hostname) || !loopbacks.has(reg.hostname)) return false;
    return (
      req.protocol === reg.protocol &&
      req.hostname === reg.hostname &&
      req.pathname === reg.pathname &&
      req.search === reg.search
    );
  } catch {
    return false;
  }
}

/** Allowed https callback path prefixes on Claude / Cursor hosts (not arbitrary paths). */
function mcpHttpsRedirectPathOk(host: string, pathname: string): boolean {
  const h = host.toLowerCase();
  const p = pathname || "/";
  if (
    h === "claude.ai" ||
    h === "www.claude.ai" ||
    h === "claude.com" ||
    h === "www.claude.com"
  ) {
    return (
      p === "/api/mcp/auth_callback" || p.startsWith("/api/mcp/auth_callback/")
    );
  }
  if (h === "cursor.com" || h === "www.cursor.com") {
    return (
      p === "/agents/mcp/oauth/callback" ||
      p.startsWith("/agents/mcp/oauth/callback/")
    );
  }
  return false;
}

/** DCR: Claude/Cursor callback paths, loopback http, or cursor: — never arbitrary https. */
export function mcpRedirectUriOkForRegistration(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === "cursor:") return true;
    if (
      u.protocol === "http:" &&
      (u.hostname === "localhost" ||
        u.hostname === "127.0.0.1" ||
        u.hostname === "[::1]")
    ) {
      return true;
    }
    if (u.protocol === "https:") {
      if (mcpHttpsRedirectPathOk(u.hostname, u.pathname)) return true;
      return KNOWN_MCP_REDIRECT_URIS.some(
        (r) => r === uri || loopbackRedirectOk(uri, r),
      );
    }
    return false;
  } catch {
    return false;
  }
}

export function mcpRedirectUriAllowed(
  requested: string,
  registered: string[],
): boolean {
  if (!requested) return false;
  if (
    registered.some((r) => r === requested || loopbackRedirectOk(requested, r))
  ) {
    return true;
  }
  if (mcpRedirectUriOkForRegistration(requested)) return true;
  return KNOWN_MCP_REDIRECT_URIS.some(
    (r) => r === requested || loopbackRedirectOk(requested, r),
  );
}

export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false;
  const dig = crypto
    .createHash("sha256")
    .update(verifier, "utf8")
    .digest("base64url");
  return dig === challenge;
}

function mcpStr(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/**
 * Writes require BOTH confirm=true and confirm_phrase=CONFIRM.
 * Phrase alone must not execute (models sometimes echo CONFIRM in dry-runs).
 */
export function mcpWriteConfirmed(args: Record<string, unknown>): boolean {
  const confirm = args.confirm;
  const confirmed =
    confirm === true ||
    confirm === 1 ||
    confirm === "1" ||
    (typeof confirm === "string" && confirm.toLowerCase() === "true");
  return confirmed && mcpStr(args.confirm_phrase) === "CONFIRM";
}


/**
 * Origin for portal-facing links (tracking URLs shown in-app).
 * Prefer the request Host so local/dev show localhost, not PUBLIC_APP_URL.
 * Emails keep using APP_URL (must be a public HTTPS host).
 */
function requestPublicOrigin(req: Request): string {
  const xfHost = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0]
    ?.trim();
  const host = xfHost || String(req.headers.host || "").trim();
  if (!host) return APP_URL;
  const xfProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    ?.trim()
    .toLowerCase();
  const proto =
    xfProto === "http" || xfProto === "https"
      ? xfProto
      : req.secure
        ? "https"
        : "http";
  return `${proto}://${host}`.replace(/\/$/, "");
}
/** Hosted logo for emails — use www (apex 308s; many clients skip image redirects). */
const LOGO_URL =
  process.env.EMAIL_LOGO_URL?.trim() ||
  "https://www.groundworkcapitalgroup.com/logos/groundwork-logo.png";
const SUPPORT_EMAIL =
  process.env.SUPPORT_EMAIL?.trim() || "info@groundworkcapitalgroup.com";
const BRAND_INK = "#0e2a4a";
const BRAND_GOLD = "#d9a441";
const BRAND_PAPER = "#f8f5ef";
const BRAND_CHARCOAL = "#1f2430";

/** Same free-score URL as Optimum Credit / OFG. */
const MFSN_FREE_SNAPSHOT_URL =
  "https://app.myfreescorenow.com/credit-snapshot/29544?s=MXxmYWxzZQ%3D%3D";

/**
 * Notification sandbox — on for every Vitest run, and for local QA with
 * NOTIFY_SANDBOX=true. In the sandbox email / SMS / realtime push are recorded
 * as dry-runs (never sent) and staff fan-out only reaches test fixtures
 * (@example.com / @example.test), so real staff never get test alerts.
 */
const NOTIFY_SANDBOX_SAFE_SUFFIXES = ["@example.com", "@example.test"];

export function notifySandbox(): boolean {
  return process.env.VITEST === "true" || process.env.NOTIFY_SANDBOX === "true";
}

export function isSandboxSafeEmail(email: unknown): boolean {
  const e = String(email || "").trim().toLowerCase();
  return NOTIFY_SANDBOX_SAFE_SUFFIXES.some((suffix) => e.endsWith(suffix));
}

/**
 * Live email when Resend is configured. Same rule in local and production.
 * The notification sandbox (VITEST / NOTIFY_SANDBOX) always dry-runs.
 * Set NOTIFY_EMAILS=false to force dry-run.
 */
function shouldDeliverEmail(): boolean {
  if (notifySandbox()) return false;
  if (!String(process.env.RESEND_API_KEY || "").trim()) return false;
  if (process.env.NOTIFY_EMAILS === "false") return false;
  return true;
}

// ─── DB pool ─────────────────────────────────────────────────────────────────

function createPool(): Pool {
  const sslOff = process.env.DB_SSL === "false";
  return mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 4000),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: sslOff ? undefined : { minVersion: "TLSv1.2" },
    waitForConnections: true,
    connectionLimit: process.env.VITEST === "true" ? 2 : 5,
    enableKeepAlive: true,
    timezone: "Z",
  });
}

const pool = createPool();

// ─── Email (Resend) ──────────────────────────────────────────────────────────

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const SMTP_FROM =
  process.env.SMTP_FROM?.trim() ||
  `Groundwork Capital <no-reply@groundworkcapitalgroup.com>`;

type DryRunEmail = {
  to: string | string[];
  subject: string;
  html: string;
  at: string;
};

const emailDryRuns: DryRunEmail[] = [];

export function __testGetEmailDryRuns(): DryRunEmail[] {
  return [...emailDryRuns];
}

/** Test hook: make sendEmail report a provider failure (never set outside tests). */
let testForceEmailFailure = false;
export function __testForceEmailFailure(on: boolean): void {
  testForceEmailFailure = on;
}

export function __testClearEmailDryRuns(): void {
  emailDryRuns.length = 0;
}

type DryRunSms = {
  to: string;
  from: string;
  body: string;
  sid: string;
  at: string;
};

const smsDryRuns: DryRunSms[] = [];

export function __testGetSmsDryRuns(): DryRunSms[] {
  return [...smsDryRuns];
}

export function __testClearSmsDryRuns(): void {
  smsDryRuns.length = 0;
}

function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function logoImgTag() {
  // Hosted HTTPS URL — more reliable than CID across Gmail / Apple Mail / Outlook.
  return `<img src="${escapeHtml(LOGO_URL)}" alt="Groundwork Capital Group" height="44" style="display:block;height:44px;width:auto;border:0;max-width:240px;" />`;
}

async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
}): Promise<{ ok: boolean; id?: string; dryRun?: boolean }> {
  const to = opts.to;
  if (testForceEmailFailure && process.env.VITEST === "true") return { ok: false };
  if (!shouldDeliverEmail() || !resend) {
    emailDryRuns.push({
      to,
      subject: opts.subject,
      html: opts.html,
      at: new Date().toISOString(),
    });
    return { ok: true, dryRun: true };
  }
  const result = await resend.emails.send({
    from: SMTP_FROM,
    to,
    subject: opts.subject,
    html: opts.html,
  });
  if (result.error) {
    console.error("[email] resend error:", result.error);
    return { ok: false };
  }
  return { ok: true, id: result.data?.id };
}

function emailLayout(opts: {
  title: string;
  preheader?: string;
  bodyHtml: string;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const year = new Date().getFullYear();
  const tagline = isEs
    ? "Construye más desde casa"
    : "Build more from home";
  const footer = isEs
    ? `Recibes este correo porque te pusiste en contacto con Groundwork Capital.<br/>© ${year} Groundwork Capital. Todos los derechos reservados.`
    : `You're receiving this email because you reached out to Groundwork Capital.<br/>© ${year} Groundwork Capital. All rights reserved.`;
  return `<!doctype html>
<html lang="${isEs ? "es" : "en"}"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${escapeHtml(opts.title)}</title></head>
<body style="margin:0;padding:0;background:${BRAND_PAPER};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND_CHARCOAL};">
${opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(opts.preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_PAPER};padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid rgba(14,42,74,0.08);box-shadow:0 12px 32px rgba(14,42,74,0.08);">
      <tr><td style="background:${BRAND_PAPER};padding:28px 32px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="vertical-align:middle;">
            ${logoImgTag()}
          </td>
          <td align="right" style="vertical-align:middle;font-size:11px;color:${BRAND_INK};font-weight:600;letter-spacing:0.08em;text-transform:uppercase;padding-left:12px;">${tagline}</td>
        </tr></table>
      </td></tr>
      <tr><td style="height:3px;line-height:3px;font-size:0;background:linear-gradient(90deg,${BRAND_GOLD},#c5a059 50%,${BRAND_GOLD});">&nbsp;</td></tr>
      <tr><td style="padding:36px 32px;background:#ffffff;">${opts.bodyHtml}</td></tr>
      <tr><td style="padding:22px 32px;background:${BRAND_INK};font-size:12px;color:rgba(248,245,239,0.72);text-align:center;line-height:1.65;">
        ${footer}<br/>
        <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND_GOLD};text-decoration:none;">${SUPPORT_EMAIL}</a>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

function emailButton(url: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px;">
  <tr><td style="border-radius:999px;background:${BRAND_GOLD};">
    <a href="${url}" style="display:inline-block;padding:14px 28px;color:${BRAND_INK};text-decoration:none;font-weight:700;font-size:15px;border-radius:999px;">${escapeHtml(label)}</a>
  </td></tr></table>`;
}

function detailRow(label: string, value: string) {
  return `<tr>
    <td style="padding:10px 0;border-bottom:1px solid rgba(14,42,74,0.08);font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:#5c6470;width:36%;">${escapeHtml(label)}</td>
    <td style="padding:10px 0;border-bottom:1px solid rgba(14,42,74,0.08);font-size:15px;color:${BRAND_CHARCOAL};font-weight:600;">${escapeHtml(value)}</td>
  </tr>`;
}

/** Human-readable event start (Pacific time — Groundwork events are in California). */
function formatEventWhen(value: string, lang: "en" | "es"): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Los_Angeles",
  }).format(d);
}

/** Applicant confirmation — warm, premium, on-brand. */
export function tplLeadConfirmation(opts: {
  fullName: string;
  mode: LeadMode;
  eventCity?: string | null;
  eventTitle?: string | null;
  eventLocation?: string | null;
  eventStartsAt?: string | null;
  registrationStatus?: EventRegistrationStatus | null;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const first =
    escapeHtml(opts.fullName.trim().split(/\s+/)[0] || (isEs ? "amigo" : "there"));
  const isEvent = opts.mode === "event";
  const waitlisted = opts.registrationStatus === "waitlisted";
  const city = opts.eventCity ? escapeHtml(opts.eventCity) : "Fontana";
  const title = opts.eventTitle ? escapeHtml(opts.eventTitle) : null;
  const location = opts.eventLocation ? escapeHtml(opts.eventLocation) : city;
  const when = opts.eventStartsAt
    ? escapeHtml(formatEventWhen(opts.eventStartsAt, isEs ? "es" : "en"))
    : null;
  const creditUrl = `${APP_URL}/get-credit-report`;

  const headline = isEvent
    ? waitlisted
      ? isEs
        ? "Estás en la lista de espera."
        : "You're on the waitlist."
      : isEs
        ? "Tu lugar está reservado."
        : "Your spot is saved."
    : isEs
      ? "Estás en la lista."
      : "You're on the list.";

  const sub = isEvent
    ? waitlisted
      ? isEs
        ? `El evento${title ? ` “${title}”` : ""} en ${city} está lleno por ahora. Te avisaremos si se libera un lugar.`
        : `The${title ? ` “${title}”` : ""} event in ${city} is full for now. We'll reach out if a seat opens.`
      : isEs
        ? `Nos vemos en ${location}${when ? ` · ${when}` : ""}. Un miembro del equipo de Groundwork te contactará pronto.`
        : `See you at ${location}${when ? ` · ${when}` : ""}. A Groundwork team member will be in touch soon.`
    : isEs
      ? "Gracias por dar el primer paso. Revisaremos tu solicitud y te guiaremos hacia el siguiente movimiento."
      : "Thanks for taking the first step. We'll review your request and guide you toward the next move.";

  const creditBlock = isEvent
    ? `
    <p style="margin:18px 0 8px;font-size:15px;line-height:1.65;color:${BRAND_CHARCOAL};">
      ${
        isEs
          ? "Mientras tanto, puedes revisar tu reporte de crédito gratis (soft pull — sin impacto a tu puntaje)."
          : "Meanwhile, you can check your free credit report (soft pull — no score impact)."
      }
    </p>
    ${emailButton(creditUrl, isEs ? "Revisar mi crédito gratis" : "Check my free credit report")}`
    : `${emailButton(APP_URL, isEs ? "Volver a Groundwork" : "Back to Groundwork")}`;

  const body = `
    <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND_GOLD};font-weight:700;">Groundwork Capital</p>
    <h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;font-weight:800;color:${BRAND_INK};">${headline}</h1>
    <p style="margin:0 0 14px;font-size:16px;line-height:1.65;color:${BRAND_CHARCOAL};">
      ${isEs ? `Hola ${first},` : `Hi ${first},`}
    </p>
    <p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:${BRAND_CHARCOAL};">${sub}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;background:${BRAND_PAPER};border:1px solid rgba(14,42,74,0.08);border-radius:14px;">
      <tr><td style="padding:18px 20px;">
        <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:#5c6470;font-weight:700;">
          ${isEs ? "Qué sigue" : "What happens next"}
        </p>
        <ol style="margin:0;padding-left:18px;color:${BRAND_CHARCOAL};font-size:15px;line-height:1.7;">
          <li>${isEs ? "Confirmamos tus datos y preferencias." : "We confirm your details and preferences."}</li>
          <li>${isEs ? "Un especialista revisa tu camino de financiamiento ADU." : "A specialist reviews your ADU financing path."}</li>
          <li>${isEs ? "Te contactamos con un plan claro — sin conjeturas." : "We reach out with a clear plan — no guesswork."}</li>
        </ol>
      </td></tr>
    </table>
    <p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#5c6470;">
      ${isEs ? "Mientras tanto, guarda este correo. Estamos construyendo contigo." : "In the meantime, keep this email. We're building with you."}
    </p>
    ${creditBlock}
  `;

  return {
    subject: isEvent
      ? waitlisted
        ? isEs
          ? `Lista de espera · Evento ${city} — Groundwork Capital`
          : `Waitlist · ${city} event — Groundwork Capital`
        : isEs
          ? `Confirmado · Evento ${city} — Groundwork Capital`
          : `You're confirmed · ${city} event — Groundwork Capital`
      : isEs
        ? "Recibimos tu solicitud — Groundwork Capital"
        : "We got your request — Groundwork Capital",
    html: emailLayout({
      title: headline,
      preheader: sub.slice(0, 120),
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

/** Welcome email for /get-credit-report — includes the same MFSN free-score link as OFG. */
export function tplGetCreditReportWelcome(opts: {
  firstName: string;
  mfsnUrl: string;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const name = escapeHtml(opts.firstName || (isEs ? "amigo/a" : "there"));
  const headline = isEs
    ? `Tu reporte de crédito gratis, ${name}`
    : `Your free credit report, ${name}`;
  const intro = isEs
    ? "El siguiente paso es obtener tu snapshot de crédito gratis (soft pull — sin impacto a tu puntaje) con nuestro socio de confianza."
    : "Next step: pull your free credit snapshot (soft pull — no score impact) with our trusted partner.";
  const body = `
    <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND_GOLD};font-weight:700;">Groundwork Capital</p>
    <h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;font-weight:800;color:${BRAND_INK};">${headline}</h1>
    <p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:${BRAND_CHARCOAL};">${intro}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;background:${BRAND_PAPER};border:1px solid rgba(14,42,74,0.08);border-radius:14px;">
      <tr><td style="padding:18px 20px;">
        <p style="margin:0;font-size:14px;line-height:1.6;color:${BRAND_CHARCOAL};">
          <strong style="color:${BRAND_GOLD};">${isEs ? "Soft pull" : "Soft pull"}</strong>
          · ${isEs ? "sin impacto a tu puntaje" : "no score impact"}
        </p>
      </td></tr>
    </table>
    ${emailButton(opts.mfsnUrl, isEs ? "Abrir mi reporte gratis" : "Open my free report")}
    <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#5c6470;">
      ${isEs ? "Si el botón no funciona, copia este enlace:" : "If the button doesn’t work, copy this link:"}<br/>
      <a href="${opts.mfsnUrl}" style="color:${BRAND_INK};word-break:break-all;">${escapeHtml(opts.mfsnUrl)}</a>
    </p>
  `;
  return {
    subject: isEs
      ? "Tu reporte de crédito gratis — Groundwork Capital"
      : "Your free credit report — Groundwork Capital",
    html: emailLayout({
      title: headline,
      preheader: intro.slice(0, 120),
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

/** Staff alert when a new lead lands. */
export function tplStaffLeadAlert(opts: {
  adminFirstName: string;
  lead: {
    id: number;
    full_name: string;
    email: string;
    phone: string;
    property_address: string;
    mode: LeadMode;
    event_city?: string | null;
    event_title?: string | null;
    event_registration_status?: EventRegistrationStatus | null;
    soft_pull_consent: boolean;
  };
  lang?: string;
  kind?: "home" | "get_credit_report" | "contact" | "partner";
}) {
  const isEs = opts.lang === "es";
  const safeName = escapeHtml(
    opts.adminFirstName || (isEs ? "equipo" : "team"),
  );
  const isGcr = opts.kind === "get_credit_report";
  const isContact = opts.kind === "contact";
  const isPartner = opts.kind === "partner";
  const headline = isGcr
    ? isEs
      ? "Nuevo lead · reporte de crédito"
      : "New lead · free credit report"
    : isContact
      ? isEs
        ? "Nuevo mensaje de contacto"
        : "New contact message"
      : isPartner
        ? isEs
          ? "Nuevo socio / referido"
          : "New partner / referral"
        : isEs
          ? "Nuevo lead de Groundwork"
          : "New Groundwork lead";
  const modeLabel = isGcr
    ? "Get credit report"
    : isContact
      ? isEs
        ? "Contacto"
        : "Contact"
      : isPartner
        ? isEs
          ? "Socio / referido"
          : "Partner / referral"
        : opts.lead.mode === "event"
          ? isEs
            ? `Evento${opts.lead.event_city ? ` · ${opts.lead.event_city}` : ""}`
            : `Event${opts.lead.event_city ? ` · ${opts.lead.event_city}` : ""}`
          : isEs
            ? "Crédito / estándar"
            : "Credit / standard";

  const body = `
    <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:${BRAND_INK};">${headline}</h1>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:${BRAND_CHARCOAL};">
      ${isEs ? `Hola ${safeName},` : `Hi ${safeName},`}
      ${isEs ? " llegó un nuevo lead del sitio." : " a new lead just came in from the site."}
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border-radius:14px;border:1px solid rgba(14,42,74,0.08);padding:4px 18px;">
      ${detailRow(isEs ? "Nombre" : "Name", opts.lead.full_name)}
      ${detailRow("Email", opts.lead.email)}
      ${detailRow(isEs ? "Teléfono" : "Phone", opts.lead.phone)}
      ${
        opts.lead.property_address
          ? detailRow(isEs ? "Propiedad" : "Property", opts.lead.property_address)
          : ""
      }
      ${detailRow(isEs ? "Modo" : "Mode", modeLabel)}
      ${
        opts.lead.mode === "event" && opts.lead.event_title
          ? detailRow(isEs ? "Evento" : "Event", opts.lead.event_title)
          : ""
      }
      ${
        opts.lead.mode === "event" && opts.lead.event_registration_status
          ? detailRow(
              isEs ? "Registro" : "Registration",
              opts.lead.event_registration_status === "waitlisted"
                ? isEs
                  ? "Lista de espera"
                  : "Waitlisted"
                : isEs
                  ? "Confirmado"
                  : "Confirmed",
            )
          : ""
      }
      ${detailRow(
        isEs ? "Soft pull" : "Soft pull",
        opts.lead.soft_pull_consent
          ? isEs
            ? "Sí"
            : "Yes"
          : isEs
            ? "No"
            : "No",
      )}
      ${detailRow("Lead ID", String(opts.lead.id))}
    </table>
    ${emailButton(`${APP_URL}/admin/leads`, isEs ? "Abrir leads" : "Open leads")}
    <p style="margin:20px 0 0;font-size:13px;color:#5c6470;">
      ${isEs ? "Responde pronto — el lead ya recibió un correo de confirmación." : "Reply soon — the lead already received a confirmation email."}
    </p>
  `;

  return {
    subject: `${headline}: ${opts.lead.full_name}`.slice(0, 200),
    html: emailLayout({
      title: headline,
      preheader: `${opts.lead.full_name} · ${opts.lead.email}`.slice(0, 120),
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

// ─── Staff notify ────────────────────────────────────────────────────────────

type TeamAdminRecipient = {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  preferred_language: string | null;
  prefs: AdminNotificationPrefs;
};

/** Keep in sync with client/lib/adminNotifyPrefs.ts ADMIN_NOTIFY_EVENT_KEYS. */
const ADMIN_NOTIFY_EVENT_KEYS: AdminNotifyEventKey[] = [
  "lead_submitted",
  "get_credit_report_lead",
  "contact_submitted",
  "partner_referral",
  "affiliate_signup",
  "affiliate_client_registered",
  "client_signup",
  "client_signup_reminder",
  "contractor_signup",
  "contractor_signup_reminder",
  "contractor_application_submitted",
  "contractor_compliance_alert",
  "duplicate_blocked",
  "draw_submitted",
  "lead_converted",
  "client_created",
  "milestone_changed",
  "commission_accrued",
  "contract_sent",
  "inbound_sms",
];

const ADMIN_NOTIFY_EVENT_KEY_SET = new Set<string>(ADMIN_NOTIFY_EVENT_KEYS);

function allAdminNotifyEventsOn(): AdminNotifyEventToggles {
  const out = {} as AdminNotifyEventToggles;
  for (const key of ADMIN_NOTIFY_EVENT_KEYS) out[key] = true;
  return out;
}

function defaultAdminNotificationPrefs(): AdminNotificationPrefs {
  const all = allAdminNotifyEventsOn();
  return {
    email: { ...all },
    in_app: { ...all },
    sms: { ...all },
  };
}

function mergeAdminNotifyChannel(
  raw: unknown,
  defaults: AdminNotifyEventToggles,
): AdminNotifyEventToggles {
  const out = { ...defaults };
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  for (const key of ADMIN_NOTIFY_EVENT_KEYS) {
    if (typeof obj[key] === "boolean") out[key] = obj[key] as boolean;
  }
  return out;
}

function parseAdminNotificationPrefs(raw: unknown): AdminNotificationPrefs {
  const defaults = defaultAdminNotificationPrefs();
  if (!raw) return defaults;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return defaults;
    }
  }
  if (!parsed || typeof parsed !== "object") return defaults;
  const obj = parsed as Record<string, unknown>;
  return {
    email: mergeAdminNotifyChannel(obj.email, defaults.email),
    in_app: mergeAdminNotifyChannel(obj.in_app, defaults.in_app),
    sms: mergeAdminNotifyChannel(obj.sms, defaults.sms),
  };
}

function adminNotifyPrefOn(
  prefs: AdminNotificationPrefs,
  channel: AdminNotifyChannel,
  eventKey: AdminNotifyEventKey,
): boolean {
  return prefs[channel][eventKey] !== false;
}

function isTwilioNotifyConfigured(): boolean {
  // Vitest dry-runs SMS; treat Twilio as configured so channel meta + prefs match delivery.
  if (process.env.VITEST === "true") return true;
  return !!(
    String(process.env.TWILIO_ACCOUNT_SID || "").trim() &&
    String(process.env.TWILIO_AUTH_TOKEN || "").trim()
  );
}

async function adminSmsChannelAvailable(adminId: number): Promise<boolean> {
  if (!isTwilioNotifyConfigured()) return false;
  return (await listAssignedPhoneNumbers(adminId)).length > 0;
}

async function adminNotifyChannelMetaForAdmin(adminId: number) {
  const twilioOk = isTwilioNotifyConfigured();
  const hasNumber = twilioOk
    ? (await listAssignedPhoneNumbers(adminId)).length > 0
    : false;
  const smsOk = twilioOk && hasNumber;
  return {
    email: { available: true as const, disabled_reason: null as string | null },
    in_app: { available: true as const, disabled_reason: null as string | null },
    sms: {
      available: smsOk,
      disabled_reason: smsOk
        ? null
        : !twilioOk
          ? "sms_twilio_not_configured"
          : "sms_ofg_number_required",
    },
  };
}

async function insertAdminInAppNotification(opts: {
  adminId: number;
  eventKey: AdminNotifyEventKey;
  title: string;
  body?: string | null;
  linkUrl?: string | null;
  payload?: Record<string, unknown>;
}): Promise<number | null> {
  try {
    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO admin_notifications
         (admin_id, event_key, title, body, link_url, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        opts.adminId,
        opts.eventKey,
        String(opts.title || "").slice(0, 255),
        opts.body || null,
        opts.linkUrl || null,
        opts.payload ? JSON.stringify(opts.payload) : null,
      ],
    );
    return ins.insertId ? Number(ins.insertId) : null;
  } catch (e: any) {
    console.error(`[notify:in_app] admin ${opts.adminId}:`, e?.message ?? e);
    return null;
  }
}

async function listActiveTeamAdmins(): Promise<TeamAdminRecipient[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, email, first_name, last_name, phone, preferred_language, notification_prefs_json
     FROM admins
     WHERE status = 'active'
       AND role IN ('super_admin', 'admin', 'agent', 'finance', 'content')
       AND email IS NOT NULL AND TRIM(email) <> ''`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    email: String(r.email),
    first_name: String(r.first_name || "Admin"),
    last_name: String(r.last_name || ""),
    phone: r.phone ? String(r.phone) : null,
    preferred_language: (r.preferred_language as string) || "en",
    prefs: parseAdminNotificationPrefs(r.notification_prefs_json),
  }));
}

/** null = all events; else selected keys. Invalid JSON → all (legacy). */
function parseNotifyExtraEvents(raw: unknown): AdminNotifyEventKey[] | null {
  if (raw == null || raw === "") return null;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;
  return parsed
    .map((x) => String(x))
    .filter((k): k is AdminNotifyEventKey => ADMIN_NOTIFY_EVENT_KEY_SET.has(k));
}

/** undefined = omit; null = all; [] = none; else selected keys. */
function normalizeNotifyExtraEventsInput(
  raw: unknown,
): AdminNotifyEventKey[] | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (!Array.isArray(raw)) return undefined;
  return parseNotifyExtraEvents(raw) ?? [];
}

function notifyExtraAllowsEvent(
  events: AdminNotifyEventKey[] | null,
  eventKey: AdminNotifyEventKey,
): boolean {
  if (events == null) return true;
  return events.includes(eventKey);
}

function mapNotifyExtraEmailRow(r: RowDataPacket) {
  return {
    id: Number(r.id),
    email: String(r.email),
    label: r.label == null ? null : String(r.label),
    is_active: Number(r.is_active) === 1,
    events: parseNotifyExtraEvents(r.events_json),
    created_at: r.created_at,
  };
}

async function listExtraNotifyEmails(
  eventKey: AdminNotifyEventKey,
): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT email, events_json FROM admin_notify_extra_emails
     WHERE is_active = 1 AND email IS NOT NULL AND TRIM(email) <> ''`,
  );
  const out: string[] = [];
  for (const r of rows) {
    const email = String(r.email).trim().toLowerCase();
    if (!email) continue;
    if (notifyExtraAllowsEvent(parseNotifyExtraEvents(r.events_json), eventKey)) {
      out.push(email);
    }
  }
  return out;
}

async function deliverAdminNotificationChannels(opts: {
  admin: TeamAdminRecipient;
  eventKey: AdminNotifyEventKey;
  tpl: {
    subject: string;
    html: string;
    linkUrl?: string | null;
    smsBody?: string | null;
    inAppBody?: string | null;
  };
}): Promise<{ email: boolean; in_app: boolean; sms: boolean }> {
  const { admin, eventKey, tpl } = opts;
  const result = { email: false, in_app: false, sms: false };
  const linkUrl = tpl.linkUrl || "/admin";

  if (adminNotifyPrefOn(admin.prefs, "email", eventKey)) {
    try {
      const sent = await sendEmail({
        to: admin.email,
        subject: tpl.subject,
        html: tpl.html,
      });
      if (sent.ok) result.email = true;
    } catch (e: any) {
      console.error(`[notify:${eventKey}:email] ${admin.email}:`, e?.message ?? e);
    }
  }

  if (adminNotifyPrefOn(admin.prefs, "in_app", eventKey) && admin.id > 0) {
    const notifId = await insertAdminInAppNotification({
      adminId: admin.id,
      eventKey,
      title: tpl.subject,
      body: tpl.inAppBody || null,
      linkUrl,
    });
    if (notifId) {
      result.in_app = true;
      await publishAdminBellRealtime(admin.id, {
        notification_id: notifId,
        event_key: eventKey,
      });
    }
  }

  if (
    adminNotifyPrefOn(admin.prefs, "sms", eventKey) &&
    admin.phone &&
    admin.id > 0
  ) {
    try {
      const from = await resolveAssignedSmsFrom(admin.id);
      if (from) {
        const toDigits = normalizePhoneDigits(admin.phone);
        const fromDigits = normalizePhoneDigits(from);
        if (!(toDigits && fromDigits && toDigits === fromDigits)) {
          const smsText = String(
            tpl.smsBody ||
              `${tpl.subject}${tpl.inAppBody ? `: ${tpl.inAppBody}` : ""}`,
          ).slice(0, 320);
          await sendSms({ to: admin.phone, body: smsText, from });
          result.sms = true;
        }
      }
    } catch (e: any) {
      console.error(
        `[notify:${eventKey}:sms] admin ${admin.id}:`,
        e?.message ?? e,
      );
    }
  }

  return result;
}

async function notifyAllTeamAdmins(
  eventKey: AdminNotifyEventKey,
  build: (admin: TeamAdminRecipient) => {
    subject: string;
    html: string;
    linkUrl?: string | null;
    smsBody?: string | null;
    inAppBody?: string | null;
  },
): Promise<number> {
  // Sandbox: never notify (or write in-app rows for) real staff.
  const admins = (await listActiveTeamAdmins()).filter(
    (a) => !notifySandbox() || isSandboxSafeEmail(a.email),
  );
  let sent = 0;
  let sampleTpl: {
    subject: string;
    html: string;
    linkUrl?: string | null;
  } | null = null;
  await Promise.all(
    admins.map(async (admin) => {
      try {
        const tpl = build(admin);
        if (!sampleTpl) {
          sampleTpl = {
            subject: tpl.subject,
            html: tpl.html,
            linkUrl: tpl.linkUrl,
          };
        }
        const delivered = await deliverAdminNotificationChannels({
          admin,
          eventKey,
          tpl,
        });
        if (delivered.email || delivered.in_app || delivered.sms) sent += 1;
      } catch (e: any) {
        console.error(`[notify:admin] ${admin.email}:`, e?.message ?? e);
      }
    }),
  );

  const extras = await listExtraNotifyEmails(eventKey);
  const adminEmails = new Set(admins.map((a) => a.email.toLowerCase()));
  await Promise.all(
    extras
      .filter((e) => !adminEmails.has(e))
      .filter((e) => !notifySandbox() || isSandboxSafeEmail(e))
      .map(async (email) => {
        try {
          const tpl =
            sampleTpl ||
            build({
              id: 0,
              email,
              first_name: "Team",
              last_name: "",
              phone: null,
              preferred_language: "en",
              prefs: defaultAdminNotificationPrefs(),
            });
          const result = await sendEmail({
            to: email,
            subject: tpl.subject,
            html: tpl.html,
          });
          if (result.ok) sent += 1;
        } catch (e: any) {
          console.error(`[notify:extra] ${email}:`, e?.message ?? e);
        }
      }),
  );
  return sent;
}

// ─── Validation helpers ──────────────────────────────────────────────────────

function normalizeEmail(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .slice(0, 255);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseLeadBody(body: any): {
  ok: true;
  data: SubmitLeadRequest;
} | { ok: false; error: string } {
  const full_name = String(body?.full_name || body?.name || "").trim();
  const email = normalizeEmail(body?.email);
  const phone = String(body?.phone || "").trim();
  const property_address = String(
    body?.property_address || body?.address || "",
  ).trim();
  const soft_pull_consent = Boolean(
    body?.soft_pull_consent === true ||
      body?.soft_pull_consent === 1 ||
      body?.soft_pull_consent === "1" ||
      body?.consent === true ||
      body?.consent === "on",
  );
  const sms_marketing_consent = Boolean(
    body?.sms_marketing_consent === true ||
      body?.sms_marketing_consent === 1 ||
      body?.sms_marketing_consent === "1",
  );
  const mode: LeadMode =
    body?.mode === "event" || body?.mode === "standard"
      ? body.mode
      : "standard";
  const event_city = body?.event_city
    ? String(body.event_city).trim().slice(0, 100)
    : null;
  const eventIdNum = Number(body?.event_id);
  const event_id =
    mode === "event" && Number.isInteger(eventIdNum) && eventIdNum > 0
      ? eventIdNum
      : null;
  const source = body?.source ? String(body.source).trim().slice(0, 100) : null;
  const preferred_language =
    body?.preferred_language === "es" || body?.text_language === "es"
      ? ("es" as const)
      : ("en" as const);

  if (!full_name || full_name.length < 2) {
    return { ok: false, error: "validation.nameRequired" };
  }
  if (!isValidEmail(email)) {
    return { ok: false, error: "validation.emailInvalid" };
  }
  if (!phone || phone.replace(/\D/g, "").length < 10) {
    return { ok: false, error: "validation.phoneMin" };
  }
  if (!property_address || property_address.length < 5) {
    return { ok: false, error: "validation.addressRequired" };
  }
  // Event RSVPs never require a credit pull; standard leads still do.
  if (mode === "event") {
    if (event_id == null) {
      return { ok: false, error: "validation.invalidField" };
    }
  } else if (!soft_pull_consent) {
    return { ok: false, error: "validation.consent" };
  }

  return {
    ok: true,
    data: {
      full_name: full_name.slice(0, 200),
      email: email.slice(0, 255),
      phone: phone.slice(0, 40),
      property_address: property_address.slice(0, 500),
      soft_pull_consent,
      sms_marketing_consent,
      preferred_language,
      mode,
      event_city,
      event_id,
      source,
    },
  };
}

function parseGetCreditReportBody(body: any):
  | { ok: true; data: SubmitGetCreditReportLeadRequest }
  | { ok: false; error: string } {
  const first_name = String(body?.first_name || "").trim();
  const last_name = String(body?.last_name || "").trim();
  const email = normalizeEmail(body?.email);
  const phone = String(body?.phone || "").trim();
  const preferred_language =
    body?.preferred_language === "es" || body?.text_language === "es"
      ? ("es" as const)
      : ("en" as const);
  const notes = body?.notes ? String(body.notes).trim().slice(0, 2000) : null;
  const soft_pull_consent = Boolean(
    body?.soft_pull_consent === true ||
      body?.soft_pull_consent === 1 ||
      body?.soft_pull_consent === "1" ||
      body?.consent === true,
  );

  if (!first_name || first_name.length < 1) {
    return { ok: false, error: "validation.firstNameRequired" };
  }
  if (!last_name || last_name.length < 1) {
    return { ok: false, error: "validation.lastNameRequired" };
  }
  if (!isValidEmail(email)) {
    return { ok: false, error: "validation.emailInvalid" };
  }
  if (!phone || phone.replace(/\D/g, "").length < 10) {
    return { ok: false, error: "validation.phoneMin" };
  }
  if (!soft_pull_consent) {
    return { ok: false, error: "validation.consent" };
  }

  return {
    ok: true,
    data: {
      first_name: first_name.slice(0, 100),
      last_name: last_name.slice(0, 100),
      email: email.slice(0, 255),
      phone: phone.slice(0, 40),
      preferred_language,
      soft_pull_consent,
      notes,
    },
  };
}

const CONTACT_INTENTS: ContactIntent[] = [
  "adu_project",
  "financing",
  "partner",
  "general",
];

function parseContactBody(body: any):
  | { ok: true; data: SubmitContactRequest }
  | { ok: false; error: string } {
  const full_name = String(body?.full_name || body?.name || "").trim();
  const email = normalizeEmail(body?.email);
  const phone = String(body?.phone || "").trim();
  const intent = CONTACT_INTENTS.includes(body?.intent)
    ? (body.intent as ContactIntent)
    : null;
  const preferred_language =
    body?.preferred_language === "es" ? ("es" as const) : ("en" as const);
  const sms_transactional_consent = Boolean(
    body?.sms_transactional_consent === true ||
      body?.sms_transactional_consent === 1 ||
      body?.sms_transactional_consent === "1",
  );
  const sms_marketing_consent = Boolean(
    body?.sms_marketing_consent === true ||
      body?.sms_marketing_consent === 1 ||
      body?.sms_marketing_consent === "1",
  );

  if (!full_name || full_name.length < 2) {
    return { ok: false, error: "validation.nameRequired" };
  }
  if (!isValidEmail(email)) {
    return { ok: false, error: "validation.emailInvalid" };
  }
  if (!phone || phone.replace(/\D/g, "").length < 10) {
    return { ok: false, error: "validation.phoneMin" };
  }
  if (!intent) {
    return { ok: false, error: "validation.intentRequired" };
  }
  if (!sms_transactional_consent) {
    return { ok: false, error: "validation.smsTransactional" };
  }

  const rawRef = body?.referral_code != null ? String(body.referral_code).trim() : "";
  const referral_code =
    rawRef && /^[A-Za-z0-9_-]{1,64}$/.test(rawRef) ? rawRef.slice(0, 64) : null;

  return {
    ok: true,
    data: {
      full_name: full_name.slice(0, 200),
      email: email.slice(0, 255),
      phone: phone.slice(0, 40),
      intent,
      preferred_language,
      sms_transactional_consent,
      sms_marketing_consent,
      referral_code,
    },
  };
}

function parsePartnerBody(body: any):
  | { ok: true; data: SubmitPartnerReferralRequest }
  | { ok: false; error: string } {
  const full_name = String(body?.full_name || body?.name || "").trim();
  const email = normalizeEmail(body?.email);
  const phone = String(body?.phone || "").trim();
  const company = body?.company
    ? String(body.company).trim().slice(0, 200)
    : null;
  const notes = body?.notes ? String(body.notes).trim().slice(0, 2000) : null;
  const preferred_language =
    body?.preferred_language === "es" ? ("es" as const) : ("en" as const);
  const rawRef = body?.referral_code != null ? String(body.referral_code).trim() : "";
  const referral_code =
    rawRef && /^[A-Za-z0-9_-]{1,64}$/.test(rawRef) ? rawRef.slice(0, 64) : null;

  if (!full_name || full_name.length < 2) {
    return { ok: false, error: "validation.nameRequired" };
  }
  if (!isValidEmail(email)) {
    return { ok: false, error: "validation.emailInvalid" };
  }
  if (!phone || phone.replace(/\D/g, "").length < 10) {
    return { ok: false, error: "validation.phoneMin" };
  }

  return {
    ok: true,
    data: {
      full_name: full_name.slice(0, 200),
      email: email.slice(0, 255),
      phone: phone.slice(0, 40),
      company,
      notes,
      preferred_language,
      referral_code,
    },
  };
}

/** Parse `company=…` from lead notes (partner_referral historical rows). */
function companyFromLeadNotes(notes: unknown): string | null {
  const m = String(notes || "").match(/company=([^;]+)/i);
  const v = m?.[1]?.trim();
  return v ? v.slice(0, 200) : null;
}

function leadAlreadyConvertedRow(lead: RowDataPacket): boolean {
  return Boolean(
    lead.client_id || lead.converted_affiliate_id || lead.converted_contractor_id,
  );
}

type IdentityEntity = "client" | "affiliate" | "contractor";

async function findIdentityByEmail(
  email: string,
): Promise<{ entity: IdentityEntity; id: number } | null> {
  const e = normalizeEmail(email);
  const [clients] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM clients WHERE email = ? LIMIT 1`,
    [e],
  );
  if (clients[0]) return { entity: "client", id: Number(clients[0].id) };
  const [affs] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM affiliates WHERE email = ? LIMIT 1`,
    [e],
  );
  if (affs[0]) return { entity: "affiliate", id: Number(affs[0].id) };
  const [ctrs] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM contractors WHERE email = ? LIMIT 1`,
    [e],
  );
  if (ctrs[0]) return { entity: "contractor", id: Number(ctrs[0].id) };
  return null;
}

function emailExistsErrorKey(entity: IdentityEntity): string {
  if (entity === "client") return "errors.emailExistsClient";
  if (entity === "affiliate") return "errors.emailExistsAffiliate";
  return "errors.emailExistsContractor";
}

/** Phone match on target table with a different email (decision 7b+c). */
async function findPhoneMatchDifferentEmail(
  entity: IdentityEntity,
  phone: string | null | undefined,
  email: string,
): Promise<LeadConvertPhoneMatch | null> {
  const last10 = normalizePhoneLast10(phone);
  if (!last10) return null;
  const e = normalizeEmail(email);
  const table =
    entity === "client" ? "clients" : entity === "affiliate" ? "affiliates" : "contractors";
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, email, first_name, last_name, phone FROM \`${table}\`
     WHERE (email IS NULL OR email <> ?) AND phone IS NOT NULL AND TRIM(phone) <> ''
     ORDER BY id DESC LIMIT 200`,
    [e],
  );
  for (const r of rows) {
    if (normalizePhoneLast10(String(r.phone || "")) !== last10) continue;
    return {
      entity,
      id: Number(r.id),
      email: r.email == null ? "" : String(r.email),
      name: `${r.first_name || ""} ${r.last_name || ""}`.trim() || String(r.email),
    };
  }
  return null;
}

// ─── People de-duplication (one role per person; email OR phone) ────────────
// Every path that creates a client / affiliate / contractor calls
// assertPersonAvailable() after its own same-role email handling.

const PERSON_ENTITIES: PersonEntity[] = ["client", "affiliate", "contractor"];
const PERSON_TABLE: Record<PersonEntity, "clients" | "affiliates" | "contractors"> = {
  client: "clients",
  affiliate: "affiliates",
  contractor: "contractors",
};
/** Last 10 phone digits in SQL (mirrors normalizePhoneLast10). */
const phone10Sql = (col: string) => `RIGHT(REGEXP_REPLACE(IFNULL(${col}, ''), '[^0-9]', ''), 10)`;
const SHARED_PHONE_REASON_MIN = 5;

/** Existing clients / affiliates / contractors sharing this email or phone. Email matches first. */
async function findPersonMatches(opts: {
  email?: unknown;
  phone?: unknown;
  exclude?: Array<{ entity: PersonEntity; id: number }>;
  exec?: Pool | PoolConnection;
}): Promise<PersonMatch[]> {
  const exec = opts.exec ?? pool;
  const email = opts.email ? normalizeEmail(opts.email) : "";
  const phone10 = normalizePhoneLast10(opts.phone == null ? null : String(opts.phone));
  if (!isValidEmail(email) && !phone10) return [];
  const out: PersonMatch[] = [];
  for (const entity of PERSON_ENTITIES) {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (isValidEmail(email)) {
      conds.push("email = ?");
      params.push(email);
    }
    if (phone10) {
      conds.push(`${phone10Sql("phone")} = ?`);
      params.push(phone10);
    }
    const [rows] = await exec.execute<RowDataPacket[]>(
      `SELECT id, email, first_name, last_name, phone, status
       FROM \`${PERSON_TABLE[entity]}\` WHERE ${conds.join(" OR ")}
       ORDER BY id ASC LIMIT 10`,
      params as any[],
    );
    for (const r of rows) {
      const id = Number(r.id);
      if (opts.exclude?.some((x) => x.entity === entity && x.id === id)) continue;
      const rowEmail = r.email == null ? null : normalizeEmail(r.email);
      out.push({
        entity,
        id,
        name: `${r.first_name || ""} ${r.last_name || ""}`.trim() || rowEmail || `#${id}`,
        email: rowEmail,
        phone: r.phone == null ? null : String(r.phone),
        status: String(r.status || ""),
        by: isValidEmail(email) && rowEmail === email ? "email" : "phone",
      });
    }
  }
  return out.sort((a, b) => (a.by === b.by ? 0 : a.by === "email" ? -1 : 1));
}

type PersonActor = "public" | "affiliate" | "staff";

/**
 * One role per person. Throws 409 when the email or phone already belongs to
 * someone. Staff may pass a shared-phone reason to allow a phone-only match
 * (e.g. a household phone); email matches always block. Public responses never
 * reveal who matched.
 */
async function assertPersonAvailable(opts: {
  email?: unknown;
  phone?: unknown;
  actor: PersonActor;
  sharedPhoneReason?: unknown;
  exclude?: Array<{ entity: PersonEntity; id: number }>;
  exec?: Pool | PoolConnection;
}): Promise<{ phoneOverride: { reason: string; matches: PersonMatch[] } | null }> {
  const matches = await findPersonMatches(opts);
  if (!matches.length) return { phoneOverride: null };
  const first = matches[0];
  if (opts.actor === "public") throw new HttpError(409, "errors.personExistsPublic", { duplicate: first });
  if (opts.actor === "affiliate") {
    throw new HttpError(409, "errors.personExistsAffiliate", { match: { entity: first.entity } });
  }
  if (first.by === "email") throw new HttpError(409, "errors.personExists", { match: first });
  const reason = String(opts.sharedPhoneReason ?? "").trim().slice(0, 500);
  if (reason.length < SHARED_PHONE_REASON_MIN) {
    throw new HttpError(409, "errors.personPhoneMatch", { match: first, can_override: true });
  }
  return { phoneOverride: { reason, matches } };
}

/** Public 409s carry the match for staff alerts only — strip it before responding. */
function stripPublicDuplicate(e: HttpError): HttpError {
  return new HttpError(e.status, e.key);
}

async function logDedupe(opts: {
  action: "merge" | "delete" | "phone_override" | "link" | "dismiss" | "blocked";
  entity: DedupeEntity;
  recordId?: number | null;
  targetEntity?: DedupeEntity | null;
  targetId?: number | null;
  adminId?: number | null;
  reason?: string | null;
  snapshot?: unknown;
  exec?: Pool | PoolConnection;
}) {
  await (opts.exec ?? pool).execute(
    `INSERT INTO people_dedupe_log
       (action, entity, record_id, target_entity, target_id, admin_id, reason, snapshot_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.action,
      opts.entity,
      opts.recordId ?? null,
      opts.targetEntity ?? null,
      opts.targetId ?? null,
      opts.adminId ?? null,
      opts.reason ? String(opts.reason).slice(0, 500) : null,
      opts.snapshot === undefined ? null : JSON.stringify(opts.snapshot),
    ],
  );
}

const dedupeSignature = (keys: string[]) => [...new Set(keys)].sort().join("|").slice(0, 500);

/** After a staff shared-phone override: audit it and keep that cluster out of the review queue. */
async function recordSharedPhoneOverride(opts: {
  entity: PersonEntity;
  id: number;
  override: { reason: string; matches: PersonMatch[] };
  adminId: number | null;
}) {
  for (const m of opts.override.matches) {
    await logDedupe({
      action: "phone_override",
      entity: opts.entity,
      recordId: opts.id,
      targetEntity: m.entity,
      targetId: m.id,
      adminId: opts.adminId,
      reason: opts.override.reason,
    });
  }
  const signature = dedupeSignature([
    `${opts.entity}:${opts.id}`,
    ...opts.override.matches.map((m) => `${m.entity}:${m.id}`),
  ]);
  await pool.execute(
    `INSERT INTO people_dedupe_dismissals (signature, admin_id, reason) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE reason = VALUES(reason)`,
    [signature, opts.adminId, opts.override.reason],
  );
}

/** A public signup / form was refused as a duplicate: audit + tell staff (visitor sees a generic note). */
async function reportBlockedPublicDuplicate(opts: {
  source: string;
  attempted: PersonEntity;
  name: string;
  email: string;
  phone: string | null;
  match: PersonMatch;
}) {
  try {
    await logDedupe({
      action: "blocked",
      entity: opts.match.entity,
      recordId: opts.match.id,
      targetEntity: opts.attempted,
      reason: `${opts.source}: ${opts.name} <${opts.email}>`.slice(0, 500),
    });
  } catch (e: any) {
    console.error("[dedupe] log blocked failed:", e?.message ?? e);
  }
  const path = `/admin/${PERSON_TABLE[opts.match.entity]}/${opts.match.id}`;
  await notifyStaff("duplicate_blocked", (l) => ({
    subject: tr(l, `Duplicate signup blocked · ${opts.name}`, `Registro duplicado bloqueado · ${opts.name}`),
    headline: tr(l, "Someone already on file tried to sign up again", "Alguien ya registrado intentó registrarse de nuevo"),
    paragraphs: [
      tr(
        l,
        `A ${opts.source} submission matched an existing ${opts.match.entity} by ${opts.match.by}. No new record was created.`,
        `Un envío de ${opts.source} coincidió por ${opts.match.by === "email" ? "correo" : "teléfono"} con un registro existente. No se creó un registro nuevo.`,
      ),
    ],
    details: [
      [tr(l, "Submitted", "Enviado"), `${opts.name} · ${opts.email}${opts.phone ? ` · ${opts.phone}` : ""}`],
      [tr(l, "Existing record", "Registro existente"), `${opts.match.entity} #${opts.match.id} · ${opts.match.name}`],
      [tr(l, "Attempted role", "Rol intentado"), opts.attempted],
    ],
    cta: { url: `${APP_URL}${path}`, label: tr(l, "Open existing record", "Abrir registro existente") },
  }));
}

/**
 * Public flows: run the one-role check; on a match, alert staff and rethrow a
 * generic 409 (`errors.personExistsPublic`) that never says who matched.
 */
async function assertPublicPersonAvailable(opts: {
  source: string;
  attempted: PersonEntity;
  name: string;
  email: string;
  phone: string | null;
  exclude?: Array<{ entity: PersonEntity; id: number }>;
}) {
  try {
    await assertPersonAvailable({ email: opts.email, phone: opts.phone, actor: "public", exclude: opts.exclude });
  } catch (e) {
    if (e instanceof HttpError && e.key === "errors.personExistsPublic" && e.data?.duplicate) {
      await reportBlockedPublicDuplicate({ ...opts, match: e.data.duplicate as PersonMatch });
      throw stripPublicDuplicate(e);
    }
    throw e;
  }
}

/** Portal self-signups: true when the person already exists (staff alerted; caller answers outcome "exists"). */
async function isPublicSignupDuplicate(opts: Parameters<typeof assertPublicPersonAvailable>[0]): Promise<boolean> {
  try {
    await assertPublicPersonAvailable(opts);
    return false;
  } catch (e) {
    if (e instanceof HttpError && e.key === "errors.personExistsPublic") return true;
    throw e;
  }
}

/** Editing an email / phone must not collide with another person (one role per person). */
async function assertIdentityEditAllowed(opts: {
  entity: PersonEntity;
  id: number;
  updates: Record<string, any>;
  actor: PersonActor;
  sharedPhoneReason?: unknown;
  adminId?: number | null;
}) {
  // Only values that actually change are checked (saving other fields never trips on legacy duplicates).
  const [cur] = await pool.execute<RowDataPacket[]>(
    `SELECT email, phone FROM \`${PERSON_TABLE[opts.entity]}\` WHERE id = ? LIMIT 1`,
    [opts.id],
  );
  const prevEmail = cur[0]?.email ? normalizeEmail(cur[0].email) : null;
  const prevPhone = normalizePhoneLast10(cur[0]?.phone ?? null);
  const nextEmail = "email" in opts.updates && opts.updates.email ? normalizeEmail(opts.updates.email) : null;
  const nextPhone = "phone" in opts.updates && opts.updates.phone ? String(opts.updates.phone) : null;
  const email = nextEmail && nextEmail !== prevEmail ? nextEmail : null;
  const phone = nextPhone && normalizePhoneLast10(nextPhone) !== prevPhone ? nextPhone : null;
  if (!email && !phone) return;
  const { phoneOverride } = await assertPersonAvailable({
    email,
    phone,
    actor: opts.actor,
    sharedPhoneReason: opts.sharedPhoneReason,
    exclude: [{ entity: opts.entity, id: opts.id }],
  });
  if (phoneOverride) {
    await recordSharedPhoneOverride({
      entity: opts.entity,
      id: opts.id,
      override: phoneOverride,
      adminId: opts.adminId ?? null,
    });
  }
}

// ── Leads: one standard lead per person (repeat submissions merge) ──────────

type PublicLeadInput = {
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  phone: string;
  property_address: string | null;
  soft_pull_consent: boolean;
  sms_marketing_consent?: boolean;
  source: string;
  preferred_language: string;
  notes: string | null;
  affiliate_id: number | null;
  referral_code: string | null;
  status: "new" | "qualified";
  ip: string | null;
  ua: string | null;
};

/**
 * Standard (non-event) public lead: merge into this person's existing lead by
 * email OR phone (bump to the top, count + timestamp, append the submission
 * to notes, fill blanks) instead of inserting a new row. Spam leads never merge.
 */
async function upsertStandardLead(
  input: PublicLeadInput,
  exec: Pool | PoolConnection = pool,
): Promise<{ id: number; merged: boolean }> {
  const email = normalizeEmail(input.email);
  const phone10 = normalizePhoneLast10(input.phone);
  const [found] = await exec.execute<RowDataPacket[]>(
    `SELECT id FROM leads
     WHERE event_id IS NULL AND status <> 'spam'
       AND (email = ? ${phone10 ? `OR ${phone10Sql("phone")} = ?` : ""})
     ORDER BY (email = ?) DESC, id DESC LIMIT 1`,
    phone10 ? [email, phone10, email] : [email, email],
  );
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const entry = [
    `[${stamp} UTC] Resubmitted via ${input.source}`,
    `${input.full_name} · ${email} · ${input.phone}`,
    input.property_address ? `Address: ${input.property_address}` : null,
    input.notes,
  ]
    .filter(Boolean)
    .join(" — ");
  if (found[0]) {
    const id = Number(found[0].id);
    await exec.execute(
      `UPDATE leads SET
         submission_count = submission_count + 1,
         last_submitted_at = NOW(),
         notes = LEFT(CONCAT_WS('\\n', NULLIF(notes, ''), ?), 60000),
         first_name = COALESCE(NULLIF(first_name, ''), ?),
         last_name = COALESCE(NULLIF(last_name, ''), ?),
         property_address = COALESCE(NULLIF(property_address, ''), ?),
         soft_pull_consent = GREATEST(soft_pull_consent, ?),
         sms_marketing_consent = GREATEST(sms_marketing_consent, ?),
         affiliate_id = COALESCE(affiliate_id, ?),
         referral_code = COALESCE(referral_code, ?),
         status = CASE WHEN status = 'closed' THEN 'new' ELSE status END
       WHERE id = ?`,
      [
        entry,
        input.first_name || null,
        input.last_name || null,
        input.property_address,
        input.soft_pull_consent ? 1 : 0,
        input.sms_marketing_consent ? 1 : 0,
        input.affiliate_id,
        input.referral_code,
        id,
      ],
    );
    await linkLeadToPerson(id, exec);
    return { id, merged: true };
  }
  const [ins] = await exec.execute<ResultSetHeader>(
    `INSERT INTO leads (
       first_name, last_name, full_name, email, phone, property_address,
       soft_pull_consent, sms_marketing_consent, mode, source, preferred_language, notes,
       affiliate_id, referral_code, status, ip_address, user_agent
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'standard', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.first_name.slice(0, 100),
      input.last_name.slice(0, 100),
      input.full_name.slice(0, 200),
      email,
      input.phone,
      input.property_address,
      input.soft_pull_consent ? 1 : 0,
      input.sms_marketing_consent ? 1 : 0,
      input.source,
      input.preferred_language === "es" ? "es" : "en",
      input.notes,
      input.affiliate_id,
      input.referral_code,
      input.status,
      input.ip,
      input.ua,
    ],
  );
  const id = Number(ins.insertId);
  await linkLeadToPerson(id, exec);
  return { id, merged: false };
}

/** Point an unlinked lead at the person it already is (so Convert disappears). */
async function linkLeadToPerson(leadId: number, exec: Pool | PoolConnection = pool) {
  const [rows] = await exec.execute<RowDataPacket[]>(
    `SELECT email, phone, client_id, converted_affiliate_id, converted_contractor_id
     FROM leads WHERE id = ? LIMIT 1`,
    [leadId],
  );
  const l = rows[0];
  if (!l || l.client_id || l.converted_affiliate_id || l.converted_contractor_id) return;
  const [m] = await findPersonMatches({ email: l.email, phone: l.phone, exec });
  if (!m) return;
  const col =
    m.entity === "client" ? "client_id" : m.entity === "affiliate" ? "converted_affiliate_id" : "converted_contractor_id";
  await exec.execute(`UPDATE leads SET ${col} = ? WHERE id = ? AND ${col} IS NULL`, [m.id, leadId]);
}

/** Public Partners / contact intent=partner → pending affiliate (no lead). */
async function createPendingPartnerAffiliate(opts: {
  full_name: string;
  email: string;
  phone: string;
  company?: string | null;
  notes?: string | null;
  preferred_language?: "en" | "es";
  referral_code?: string | null;
  notifySource: "partners" | "contact";
}): Promise<{ affiliate_id: number }> {
  const email = normalizeEmail(opts.email);
  const nameParts = opts.full_name.trim().split(/\s+/);
  const firstName = (nameParts[0] || opts.full_name).slice(0, 100);
  const lastName = (nameParts.slice(1).join(" ") || firstName).slice(0, 100);
  const lang = asLang(opts.preferred_language);
  const company = opts.company || null;
  const notes = opts.notes || null;

  const [existing] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM affiliates WHERE email = ? LIMIT 1`,
    [email],
  );
  if (existing.length) throw new HttpError(409, "errors.affiliateExists");
  // One role per person (email OR phone across clients / affiliates / contractors).
  await assertPublicPersonAvailable({
    source: opts.notifySource === "partners" ? "partner referral" : "contact form (partner)",
    attempted: "affiliate",
    name: opts.full_name,
    email,
    phone: opts.phone,
  });

  const parent = await findActiveAffiliateByCode(opts.referral_code);
  const affiliateId = await withNewAffiliateCodes(firstName, lastName, async ({ code, slug }) => {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO affiliates
         (email, first_name, last_name, phone, company, status, preferred_language,
          referral_code, slug, parent_affiliate_id, notes)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      [
        email,
        firstName,
        lastName,
        opts.phone,
        company,
        lang,
        code,
        slug,
        parent?.id ?? null,
        notes,
      ],
    );
    return Number(result.insertId);
  });

  await safeSend(
    email,
    tplPortalNotice({
      lang,
      subject: tr(
        lang,
        "Affiliate application received — Groundwork Capital",
        "Solicitud de afiliado recibida — Groundwork Capital",
      ),
      headline: tr(lang, "You're in the queue.", "Estás en la fila."),
      paragraphs: [
        tr(
          lang,
          `Hi ${firstName}, thanks for applying to the Groundwork affiliate program.`,
          `Hola ${firstName}, gracias por aplicar al programa de afiliados de Groundwork.`,
        ),
        tr(
          lang,
          "Our team reviews every application. Once approved you'll get an email and can sign in with a one-time code — no password needed.",
          "Nuestro equipo revisa cada solicitud. Al aprobarse recibirás un correo y podrás entrar con un código de un solo uso — sin contraseña.",
        ),
      ],
    }),
  );

  await notifyStaff("partner_referral", (l) => ({
    subject: tr(
      l,
      `Partner application (pending affiliate): ${firstName} ${lastName}`,
      `Solicitud de socio (afiliado pendiente): ${firstName} ${lastName}`,
    ),
    headline: tr(
      l,
      "New partner → pending affiliate",
      "Nuevo socio → afiliado pendiente",
    ),
    paragraphs: [
      opts.notifySource === "contact"
        ? tr(
            l,
            "Contact form (intent=partner) created a pending affiliate — review in Admin → Affiliates.",
            "Formulario de contacto (intent=partner) creó un afiliado pendiente — revisa en Admin → Afiliados.",
          )
        : tr(
            l,
            "Partners form created a pending affiliate — review and approve in Admin → Affiliates.",
            "El formulario de socios creó un afiliado pendiente — revisa y aprueba en Admin → Afiliados.",
          ),
    ],
    details: [
      [tr(l, "Name", "Nombre"), `${firstName} ${lastName}`],
      ["Email", email],
      [tr(l, "Phone", "Teléfono"), opts.phone],
      [tr(l, "Company", "Empresa"), company || "—"],
      [
        tr(l, "Parent", "Padre"),
        parent ? `#${parent.id} (${parent.referral_code})` : "—",
      ],
      [tr(l, "Source", "Fuente"), opts.notifySource === "contact" ? "contact" : "partners"],
    ],
    cta: {
      url: `${APP_URL}/admin/affiliates/${affiliateId}`,
      label: tr(l, "Open affiliate", "Abrir afiliado"),
    },
  }));

  return { affiliate_id: affiliateId };
}

export function tplGenericConfirmation(opts: {
  fullName: string;
  kind: "contact" | "partner";
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const first =
    escapeHtml(opts.fullName.trim().split(/\s+/)[0] || (isEs ? "amigo" : "there"));
  const isPartner = opts.kind === "partner";
  const headline = isPartner
    ? isEs
      ? "Gracias por unirte como socio."
      : "Thanks for joining as a partner."
    : isEs
      ? "Recibimos tu mensaje."
      : "We got your message.";
  const sub = isPartner
    ? isEs
      ? "Un miembro del equipo te contactará pronto sobre el programa de referidos."
      : "A team member will reach out soon about the referral program."
    : isEs
      ? "Un especialista de ADU te contactará pronto."
      : "An ADU specialist will be in touch soon.";
  const body = `
    <h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;font-weight:800;color:${BRAND_INK};">${headline}</h1>
    <p style="margin:0 0 14px;font-size:16px;line-height:1.65;color:${BRAND_CHARCOAL};">
      ${isEs ? `Hola ${first},` : `Hi ${first},`}
    </p>
    <p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:${BRAND_CHARCOAL};">${sub}</p>
    ${emailButton(APP_URL, isEs ? "Volver a Groundwork" : "Back to Groundwork")}
  `;
  return {
    subject: isPartner
      ? isEs
        ? "Programa de socios — Groundwork Capital"
        : "Partner program — Groundwork Capital"
      : isEs
        ? "Recibimos tu mensaje — Groundwork Capital"
        : "We got your message — Groundwork Capital",
    html: emailLayout({
      title: headline,
      preheader: sub.slice(0, 120),
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

// ─── Portal auth (passwordless email OTP) ────────────────────────────────────

const OTP_TTL_MIN = 10;
const OTP_MAX_ATTEMPTS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type PortalAuthConfig = {
  table: string;
  otpTable: string;
  sessionTable: string;
  idCol: string;
  cookie: string;
};

const PORTAL_AUTH: Record<PortalActor, PortalAuthConfig> = {
  admin: {
    table: "admins",
    otpTable: "admin_otp_codes",
    sessionTable: "admin_sessions",
    idCol: "admin_id",
    cookie: "gw_admin_sid",
  },
  affiliate: {
    table: "affiliates",
    otpTable: "affiliate_otp_codes",
    sessionTable: "affiliate_sessions",
    idCol: "affiliate_id",
    cookie: "gw_affiliate_sid",
  },
  contractor: {
    table: "contractors",
    otpTable: "contractor_otp_codes",
    sessionTable: "contractor_sessions",
    idCol: "contractor_id",
    cookie: "gw_contractor_sid",
  },
  client: {
    table: "clients",
    otpTable: "client_otp_codes",
    sessionTable: "client_sessions",
    idCol: "client_id",
    cookie: "gw_client_sid",
  },
};

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function generateOtpCode(): string {
  return String(crypto.randomInt(100000, 999999));
}

function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = String(req.headers.cookie || "");
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      // Malformed percent-encoding must not 500 the whole portal — treat as absent.
      continue;
    }
  }
  return out;
}

function readCookie(req: Request, name: string): string | null {
  return parseCookies(req)[name] || null;
}

function setPortalCookie(
  res: Response,
  actor: PortalActor,
  token: string,
  expires: Date,
) {
  const cfg = PORTAL_AUTH[actor];
  const secure =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production";
  const parts = [
    `${cfg.cookie}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expires.toUTCString()}`,
  ];
  if (secure) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

function clearPortalCookie(res: Response, actor: PortalActor) {
  const cfg = PORTAL_AUTH[actor];
  const secure =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production";
  const parts = [
    `${cfg.cookie}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

async function getPortalSessionDays(): Promise<number> {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'portal_session_days' LIMIT 1`,
    );
    const n = Number(rows[0]?.setting_value);
    return Number.isFinite(n) && n > 0 ? n : 30;
  } catch {
    return 30;
  }
}

function tplPortalOtp(opts: {
  firstName: string;
  code: string;
  actor: PortalActor;
  lang: "en" | "es";
}) {
  const isEs = opts.lang === "es";
  const portalLabel =
    opts.actor === "admin"
      ? isEs
        ? "Administración"
        : "Admin"
      : opts.actor === "affiliate"
        ? isEs
          ? "Afiliados"
          : "Affiliate"
        : opts.actor === "contractor"
          ? isEs
            ? "Contratistas"
            : "Contractor"
          : isEs
            ? "Portal del propietario"
            : "Homeowner portal";
  const subject = isEs
    ? `Tu código Groundwork (${portalLabel})`
    : `Your Groundwork sign-in code (${portalLabel})`;
  const greeting = opts.firstName
    ? isEs
      ? `Hola ${escapeHtml(opts.firstName)},`
      : `Hi ${escapeHtml(opts.firstName)},`
    : isEs
      ? "Hola,"
      : "Hi,";
  const html = emailLayout({
    title: subject,
    preheader: opts.code,
    lang: opts.lang,
    bodyHtml: `
      <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:${BRAND_CHARCOAL}">${greeting}</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${BRAND_CHARCOAL}">
        ${
          isEs
            ? `Tu código de acceso a <strong>${escapeHtml(portalLabel)}</strong> es:`
            : `Your <strong>${escapeHtml(portalLabel)}</strong> sign-in code is:`
        }
      </p>
      <p style="margin:0 0 16px;font-size:28px;letter-spacing:0.28em;font-weight:750;color:${BRAND_INK}">${escapeHtml(opts.code)}</p>
      <p style="margin:0;font-size:13px;line-height:1.55;color:#667085">
        ${
          isEs
            ? `Caduca en ${OTP_TTL_MIN} minutos. Si no solicitaste este código, ignora este correo.`
            : `Expires in ${OTP_TTL_MIN} minutes. If you didn’t request this, you can ignore this email.`
        }
      </p>
    `,
  });
  return { subject, html };
}

function toPortalUser(actor: PortalActor, row: RowDataPacket): PortalAuthUser {
  const user: PortalAuthUser = {
    id: Number(row.id),
    email: String(row.email),
    first_name: String(row.first_name || ""),
    last_name: String(row.last_name || ""),
    phone: row.phone == null || row.phone === "" ? null : String(row.phone),
    status: String(row.status || ""),
    preferred_language: row.preferred_language === "es" ? "es" : "en",
    avatar_url:
      row.avatar_url == null || row.avatar_url === ""
        ? null
        : String(row.avatar_url),
  };
  if (actor === "admin" && row.role) {
    user.role = String(row.role) as AdminRole;
  }
  return user;
}

async function loadPortalUser(
  actor: PortalActor,
  req: Request,
): Promise<PortalAuthUser | null> {
  const cfg = PORTAL_AUTH[actor];
  const token = readCookie(req, cfg.cookie);
  if (!token) return null;
  const [sessions] = await pool.execute<RowDataPacket[]>(
    `SELECT s.${cfg.idCol} AS actor_id, a.*
     FROM \`${cfg.sessionTable}\` s
     INNER JOIN \`${cfg.table}\` a ON a.id = s.${cfg.idCol}
     WHERE s.token_hash = ? AND s.is_active = 1 AND s.expires_at > NOW()
     LIMIT 1`,
    [sha256(token)],
  );
  const row = sessions[0];
  if (!row) return null;
  if (!["active", "prospect"].includes(String(row.status))) return null;
  return toPortalUser(actor, row);
}

// ─── Portal feature layer: helpers ───────────────────────────────────────────

type Lang = "en" | "es";
const asLang = (v: unknown): Lang => (v === "es" ? "es" : "en");
const tr = (lang: unknown, en: string, es: string) =>
  lang === "es" ? es : en;

function clientIp(req: Request): string | null {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    null
  );
}

/** Inline copy of shared ADMIN_PERMS (API cannot runtime-import shared/). */
type AdminPerm =
  | "leads"
  | "people.read"
  | "people.write"
  | "approvals"
  | "projects.read"
  | "projects.write"
  | "finance.read"
  | "finance.write"
  | "plans.write"
  | "events"
  | "staff"
  | "settings"
  | "campaigns";

const ADMIN_PERMS: Record<AdminPerm, AdminRole[]> = {
  leads: ["super_admin", "admin", "agent"],
  "people.read": ["super_admin", "admin", "agent", "finance"],
  "people.write": ["super_admin", "admin", "agent"],
  approvals: ["super_admin", "admin"],
  "projects.read": ["super_admin", "admin", "agent", "finance"],
  "projects.write": ["super_admin", "admin", "agent"],
  "finance.read": ["super_admin", "admin", "finance"],
  "finance.write": ["super_admin", "admin", "finance"],
  "plans.write": ["super_admin", "admin", "content"],
  events: ["super_admin", "admin", "content"],
  staff: ["super_admin"],
  settings: ["super_admin", "finance"],
  campaigns: ["super_admin", "admin", "agent", "content"],
};

function adminCan(role: AdminRole | undefined, perm: AdminPerm): boolean {
  return Boolean(role && ADMIN_PERMS[perm].includes(role));
}

function portalUser(res: Response): PortalAuthUser {
  return res.locals.portalUser as PortalAuthUser;
}

function requirePortal(actor: PortalActor) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await loadPortalUser(actor, req);
      if (!user) return res.status(401).json({ error: "errors.unauthorized" });
      res.locals.portalUser = user;
      return next();
    } catch (e: any) {
      console.error(`[${actor}] session check failed:`, e?.message ?? e);
      return res.status(500).json({ error: "errors.server" });
    }
  };
}

function requireAdmin(perm?: AdminPerm) {
  const base = requirePortal("admin");
  return (req: Request, res: Response, next: NextFunction) =>
    base(req, res, () => {
      if (perm && !adminCan(portalUser(res).role, perm)) {
        return res.status(403).json({ error: "errors.forbidden" });
      }
      return next();
    });
}

/** Allow any of the listed perms (e.g. events writers + leads agents for RSVP lists). */
function requireAdminAny(...perms: AdminPerm[]) {
  const base = requirePortal("admin");
  return (req: Request, res: Response, next: NextFunction) =>
    base(req, res, () => {
      const role = portalUser(res).role;
      if (perms.length && !perms.some((p) => adminCan(role, p))) {
        return res.status(403).json({ error: "errors.forbidden" });
      }
      return next();
    });
}

function asDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** DB DATETIME (pool timezone Z) → ISO-8601 UTC string. */
function isoDate(v: unknown): string | null {
  const d = asDate(v);
  return d ? d.toISOString() : null;
}

function eventRegistrationOpen(
  /** status, starts_at, registration_opens_at/closes_at, created_at */
  ev: Record<string, any>,
  now = new Date(),
): boolean {
  if (String(ev.status) !== "published") return false;
  const opens =
    asDate(ev.registration_opens_at) || asDate(ev.created_at) || new Date(0);
  const closes = asDate(ev.registration_closes_at) || asDate(ev.starts_at);
  if (!closes) return false;
  return now.getTime() >= opens.getTime() && now.getTime() <= closes.getTime();
}

function mapMarketingEventRow(
  r: RowDataPacket,
  extras?: { confirmed_count?: number; waitlisted_count?: number },
): MarketingEvent {
  return {
    id: Number(r.id),
    slug: String(r.slug),
    status: String(r.status) as MarketingEventStatus,
    is_featured: Number(r.is_featured) === 1,
    starts_at: isoDate(r.starts_at) as string,
    ends_at: isoDate(r.ends_at),
    registration_opens_at:
      isoDate(r.registration_opens_at),
    registration_closes_at:
      isoDate(r.registration_closes_at),
    capacity: r.capacity == null ? null : Number(r.capacity),
    waitlist_enabled: Number(r.waitlist_enabled) === 1,
    city: String(r.city),
    venue_name: r.venue_name == null ? null : String(r.venue_name),
    venue_address: r.venue_address == null ? null : String(r.venue_address),
    zoom_url: r.zoom_url == null ? null : String(r.zoom_url),
    image_url: r.image_url == null ? null : String(r.image_url),
    title_en: String(r.title_en),
    title_es: String(r.title_es),
    summary_en: r.summary_en == null ? null : String(r.summary_en),
    summary_es: r.summary_es == null ? null : String(r.summary_es),
    body_en: r.body_en == null ? null : String(r.body_en),
    body_es: r.body_es == null ? null : String(r.body_es),
    location_label_en:
      r.location_label_en == null ? null : String(r.location_label_en),
    location_label_es:
      r.location_label_es == null ? null : String(r.location_label_es),
    cta_en: r.cta_en == null ? null : String(r.cta_en),
    cta_es: r.cta_es == null ? null : String(r.cta_es),
    created_at: isoDate(r.created_at) as string,
    updated_at: isoDate(r.updated_at) as string,
    confirmed_count: extras?.confirmed_count,
    waitlisted_count: extras?.waitlisted_count,
    registration_open: eventRegistrationOpen(r),
  };
}

function pickLangField(
  lang: "en" | "es",
  en: unknown,
  es: unknown,
): string | null {
  const primary = lang === "es" ? es : en;
  const fallback = lang === "es" ? en : es;
  const v =
    (primary && String(primary).trim()) ||
    (fallback && String(fallback).trim()) ||
    "";
  return v || null;
}

function toPublicEventView(
  ev: MarketingEvent,
  lang: "en" | "es",
  confirmedCount: number,
): PublicEventView {
  const capacity = ev.capacity;
  return {
    id: ev.id,
    slug: ev.slug,
    city: ev.city,
    starts_at: ev.starts_at,
    ends_at: ev.ends_at,
    capacity,
    waitlist_enabled: ev.waitlist_enabled,
    confirmed_count: confirmedCount,
    spots_remaining:
      capacity == null ? null : Math.max(0, capacity - confirmedCount),
    registration_open: Boolean(ev.registration_open),
    venue_name: ev.venue_name,
    venue_address: ev.venue_address,
    zoom_url: ev.zoom_url,
    image_url: ev.image_url,
    title: pickLangField(lang, ev.title_en, ev.title_es) || ev.title_en,
    summary: pickLangField(lang, ev.summary_en, ev.summary_es),
    body: pickLangField(lang, ev.body_en, ev.body_es),
    location_label: pickLangField(
      lang,
      ev.location_label_en,
      ev.location_label_es,
    ),
    cta: pickLangField(lang, ev.cta_en, ev.cta_es),
  };
}

async function countEventRegistrations(
  eventId: number,
  status: EventRegistrationStatus,
): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM leads
     WHERE event_id = ? AND mode = 'event' AND event_registration_status = ?`,
    [eventId, status],
  );
  return Number(rows[0]?.n || 0);
}

async function loadMarketingEventById(
  id: number,
): Promise<RowDataPacket | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM marketing_events WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows[0] || null;
}

async function loadMarketingEventBySlug(
  slug: string,
): Promise<RowDataPacket | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM marketing_events WHERE slug = ? LIMIT 1`,
    [slug],
  );
  return rows[0] || null;
}

/** Featured published event with open registration, else next open published by starts_at. */
async function loadLiveEventRow(): Promise<RowDataPacket | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM marketing_events
     WHERE status = 'published'
     ORDER BY is_featured DESC, starts_at ASC, id ASC
     LIMIT 20`,
  );
  for (const r of rows) {
    if (eventRegistrationOpen(r)) return r;
  }
  return null;
}

async function clearOtherFeatured(
  exceptId: number | null,
  conn: Pool | PoolConnection = pool,
) {
  if (exceptId == null) {
    await conn.execute(
      `UPDATE marketing_events SET is_featured = 0 WHERE is_featured = 1`,
    );
    return;
  }
  await conn.execute(
    `UPDATE marketing_events SET is_featured = 0 WHERE is_featured = 1 AND id <> ?`,
    [exceptId],
  );
}

function slugifyEvent(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Affiliate vanity slugs for /r/{slug}. Accent-stripped, lowercase, dashed.
 * Canonical list: shared/affiliateSlugReserved.ts (client imports it).
 * This Set must stay identical — enforced by client/lib/affiliateSlug.reserved.spec.ts.
 */
const AFFILIATE_RESERVED_SLUGS = new Set([
  "admin",
  "admins",
  "affiliate",
  "affiliates",
  "api",
  "app",
  "assets",
  "auth",
  "client",
  "clients",
  "contact",
  "contractor",
  "contractors",
  "cron",
  "enroll",
  "event",
  "events",
  "expired",
  "get-credit-report",
  "health",
  "home",
  "invite",
  "join",
  "login",
  "logout",
  "mcp",
  "null",
  "oauth",
  "partners",
  "portal",
  "public",
  "r",
  "signup",
  "static",
  "support",
  "team",
  "undefined",
  "webhook",
  "webhooks",
  "www",
]);

function slugifyAffiliate(raw: string): string {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function isReservedAffiliateSlug(slug: string): boolean {
  return AFFILIATE_RESERVED_SLUGS.has(String(slug || "").toLowerCase());
}

function isValidAffiliateSlugFormat(slug: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{1,62}[a-z0-9])?$/.test(slug) && slug.length >= 3 && slug.length <= 64;
}

function baseSlugFromAffiliateName(firstName: string, lastName: string): string {
  const full = slugifyAffiliate(`${firstName || ""} ${lastName || ""}`);
  if (full.length >= 3) return full.slice(0, 64);
  const first = slugifyAffiliate(firstName);
  if (first.length >= 3) return first.slice(0, 64);
  const last = slugifyAffiliate(lastName);
  if (last.length >= 3) return last.slice(0, 64);
  const fallback = (first || last || "affiliate").slice(0, 60);
  return fallback.length >= 3 ? fallback : `${fallback}-gw`.slice(0, 64);
}

async function affiliateSlugTaken(
  slug: string,
  excludeId?: number,
): Promise<boolean> {
  const [rows] =
    excludeId != null
      ? await pool.execute<RowDataPacket[]>(
          `SELECT id FROM affiliates WHERE slug = ? AND id <> ? LIMIT 1`,
          [slug, excludeId],
        )
      : await pool.execute<RowDataPacket[]>(
          `SELECT id FROM affiliates WHERE slug = ? LIMIT 1`,
          [slug],
        );
  return rows.length > 0;
}

/**
 * Avoid /r/:code ambiguity: lookup matches referral_code (upper) OR slug (lower).
 * A vanity slug must not equal any affiliate's referral_code (case-insensitive).
 */
async function affiliateSlugMatchesReferralCode(
  slug: string,
  excludeId?: number,
): Promise<boolean> {
  const upper = String(slug || "").toUpperCase();
  if (!upper) return false;
  const [rows] =
    excludeId != null
      ? await pool.execute<RowDataPacket[]>(
          `SELECT id FROM affiliates WHERE UPPER(referral_code) = ? AND id <> ? LIMIT 1`,
          [upper, excludeId],
        )
      : await pool.execute<RowDataPacket[]>(
          `SELECT id FROM affiliates WHERE UPPER(referral_code) = ? LIMIT 1`,
          [upper],
        );
  return rows.length > 0;
}

async function affiliateSlugBlocked(
  slug: string,
  excludeId?: number,
): Promise<boolean> {
  if (isReservedAffiliateSlug(slug)) return true;
  if (await affiliateSlugTaken(slug, excludeId)) return true;
  if (await affiliateSlugMatchesReferralCode(slug, excludeId)) return true;
  return false;
}

/** Auto name slug with -2, -3… on collision / reserved base. */
async function allocateUniqueAffiliateSlug(
  firstName: string,
  lastName: string,
): Promise<string> {
  const base = baseSlugFromAffiliateName(firstName, lastName);
  for (let n = 0; n < 500; n++) {
    const suffix = n === 0 ? "" : `-${n + 1}`;
    const candidate = `${base.slice(0, Math.max(3, 64 - suffix.length))}${suffix}`;
    if (!isValidAffiliateSlugFormat(candidate)) continue;
    if (!(await affiliateSlugBlocked(candidate))) return candidate;
  }
  for (let i = 0; i < 8; i++) {
    const candidate = `aff-${randomCode(8).toLowerCase()}`;
    if (!(await affiliateSlugBlocked(candidate))) return candidate;
  }
  throw new Error("could not allocate affiliate slug");
}

/** Normalize manual slug input; null clears. Throws HttpError on bad/reserved. */
function normalizeAffiliateSlugInput(raw: unknown): string | null {
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const slug = slugifyAffiliate(String(raw));
  if (!isValidAffiliateSlugFormat(slug)) {
    throw new HttpError(400, "validation.slugFormat");
  }
  if (isReservedAffiliateSlug(slug)) {
    throw new HttpError(400, "validation.slugReserved");
  }
  return slug;
}

async function assertAffiliateSlugAvailable(
  slug: string | null,
  excludeId?: number,
): Promise<void> {
  if (!slug) return;
  if (await affiliateSlugTaken(slug, excludeId)) {
    throw new HttpError(409, "errors.slugTaken");
  }
  if (await affiliateSlugMatchesReferralCode(slug, excludeId)) {
    throw new HttpError(409, "errors.slugTaken");
  }
}

function isMysqlDupEntry(e: unknown): boolean {
  const err = e as { code?: string; errno?: number };
  return err?.code === "ER_DUP_ENTRY" || err?.errno === 1062;
}

/** True when unique collision is on slug or referral_code (safe to retry allocate). */
function isAffiliateSlugOrReferralDup(e: unknown): boolean {
  if (!isMysqlDupEntry(e)) return false;
  const msg = String(
    (e as { message?: string; sqlMessage?: string })?.sqlMessage ||
      (e as { message?: string })?.message ||
      "",
  );
  return /uq_affiliates_slug|uq_affiliates_referral|for key ['`]?slug|for key ['`]?referral_code/i.test(
    msg,
  );
}

/**
 * Allocate referral_code + vanity slug and run insert; retry on rare unique races.
 * Do not use for email uniqueness failures (those are not retried).
 */
async function withNewAffiliateCodes<T>(
  firstName: string,
  lastName: string,
  insert: (ids: { code: string; slug: string }) => Promise<T>,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < 6; i++) {
    const code = await uniqueReferralCode();
    const slug = await allocateUniqueAffiliateSlug(firstName, lastName);
    try {
      return await insert({ code, slug });
    } catch (e) {
      lastErr = e;
      if (isAffiliateSlugOrReferralDup(e) && i < 5) continue;
      throw e;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("affiliate insert retry exhausted");
}

/**
 * CSRF defense-in-depth on top of SameSite=Lax: cookie-authenticated mutations
 * from a foreign Origin are rejected. Requests without Origin (curl, tests,
 * same-origin navigations) pass.
 */
function csrfOriginGuard(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (!/^\/api\/(admin|affiliate|contractor|client)\//.test(req.path)) {
    return next();
  }
  const origin = req.headers.origin;
  if (!origin) return next();
  try {
    const host = new URL(origin).host;
    const allowed = new Set<string>([String(req.headers.host || "")]);
    try {
      allowed.add(new URL(APP_URL).host);
    } catch {
      /* ignore */
    }
    if (allowed.has(host) || /^localhost(:\d+)?$/.test(host)) return next();
  } catch {
    /* fall through */
  }
  return res.status(403).json({ error: "errors.forbidden" });
}

function handle(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e: any) {
      if (e?.code === "ER_DUP_ENTRY" || e?.errno === 1062) {
        return res.status(409).json({ error: "errors.duplicate" });
      }
      if (
        e?.code === "ER_NO_REFERENCED_ROW_2" ||
        e?.code === "ER_ROW_IS_REFERENCED_2" ||
        e?.errno === 1452 ||
        e?.errno === 1451
      ) {
        return res.status(400).json({ error: "errors.invalidReference" });
      }
      console.error(`[api] ${req.method} ${req.path} failed:`, e?.message ?? e);
      return res.status(500).json({ error: "errors.server" });
    }
  };
}

class HttpError extends Error {
  constructor(
    public status: number,
    public key: string,
    /** Extra JSON merged into the error body (e.g. `{ match }` for duplicates). */
    public data?: Record<string, unknown>,
  ) {
    super(key);
  }
}

/** Wrap a handler so thrown HttpError maps to `{ error, ...data }` with status. */
function route(fn: (req: Request, res: Response) => Promise<unknown>) {
  return handle(async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof HttpError) {
        return res.status(e.status).json({ ...(e.data || {}), error: e.key });
      }
      throw e;
    }
  });
}

function parseId(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, "validation.invalidId");
  return n;
}

function parsePublicId(value: unknown): string {
  const v = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,24}$/.test(v)) throw new HttpError(400, "validation.invalidId");
  return v;
}

// Field parsers for PATCH bodies: only keys present in the body are applied.
type FieldParser = (v: unknown) => { ok: true; value: any } | { ok: false };
const fStr =
  (max: number, opts: { nullable?: boolean; min?: number } = {}): FieldParser =>
  (v) => {
    if (v === null || v === undefined || v === "") {
      return opts.nullable === false || opts.min
        ? { ok: false }
        : { ok: true, value: null };
    }
    const s = String(v).trim();
    if (opts.min && s.length < opts.min) return { ok: false };
    return { ok: true, value: s.slice(0, max) };
  };
const fEnum =
  <T extends string>(values: readonly T[]): FieldParser =>
  (v) =>
    values.includes(v as T) ? { ok: true, value: v } : { ok: false };
const fInt =
  (min = 0, max = 2_000_000_000, nullable = true): FieldParser =>
  (v) => {
    if (v === null || v === "" || v === undefined) {
      return nullable ? { ok: true, value: null } : { ok: false };
    }
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max
      ? { ok: true, value: n }
      : { ok: false };
  };
const fBool: FieldParser = (v) =>
  v === true || v === 1 || v === "1"
    ? { ok: true, value: 1 }
    : v === false || v === 0 || v === "0"
      ? { ok: true, value: 0 }
      : { ok: false };
const fEmail: FieldParser = (v) => {
  const e = normalizeEmail(v);
  return isValidEmail(e) ? { ok: true, value: e } : { ok: false };
};

function parsePatch(
  body: any,
  spec: Record<string, FieldParser>,
): { updates: Record<string, any> } {
  const updates: Record<string, any> = {};
  for (const [key, parser] of Object.entries(spec)) {
    if (!body || !Object.prototype.hasOwnProperty.call(body, key)) continue;
    const parsed = parser(body[key]);
    if (!parsed.ok) throw new HttpError(400, "validation.invalidField");
    updates[key] = parsed.value;
  }
  return { updates };
}

async function applyUpdate(
  conn: Pool | PoolConnection,
  table: string,
  id: number,
  updates: Record<string, any>,
) {
  const keys = Object.keys(updates);
  if (!keys.length) return;
  await conn.execute(
    `UPDATE \`${table}\` SET ${keys.map((k) => `\`${k}\` = ?`).join(", ")} WHERE id = ?`,
    [...keys.map((k) => updates[k]), id],
  );
}

async function withTx<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    try {
      await conn.rollback();
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    conn.release();
  }
}

const ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomCode(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) out += ID_ALPHABET[crypto.randomInt(ID_ALPHABET.length)];
  return out;
}
const newPublicId = () => `GW-${randomCode(8)}`;

async function uniqueReferralCode(): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const code = randomCode(8);
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id FROM affiliates WHERE referral_code = ? LIMIT 1`,
      [code],
    );
    if (!rows.length) return code;
  }
  throw new Error("could not allocate referral code");
}

/** Active affiliate by referral code or slug (lead attribution + click tracking). */
async function findActiveAffiliateByCode(
  raw: unknown,
): Promise<{ id: number; referral_code: string } | null> {
  const code = String(raw || "").trim().slice(0, 64);
  if (!code || !/^[A-Za-z0-9_-]+$/.test(code)) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, referral_code FROM affiliates
     WHERE status = 'active' AND (referral_code = ? OR slug = ?) LIMIT 1`,
    [code.toUpperCase(), code.toLowerCase()],
  );
  return rows[0]
    ? { id: Number(rows[0].id), referral_code: String(rows[0].referral_code) }
    : null;
}

/**
 * Pass the transaction's `conn` when called inside `withTx`: grabbing a second
 * pooled connection while holding one can exhaust the pool and deadlock every
 * request on the instance under concurrency.
 */
async function getSettingInt(
  key: string,
  fallback: number,
  db: Pool | PoolConnection = pool,
): Promise<number> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1`,
      [key],
    );
    const n = Number(rows[0]?.setting_value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

// ── Project economics ───────────────────────────────────────────────────────

/** Net profit = sale − contractor cost − affiliate commission − agent commission. */
export function computeProjectEconomics(p: {
  sale_price_cents: number | null;
  contractor_cost_cents: number | null;
  affiliate_commission_cents: number | null;
  agent_commission_cents: number | null;
  sq_ft: number | null;
}): { net_profit_cents: number | null; net_profit_per_sqft_cents: number | null } {
  if (p.sale_price_cents == null) {
    return { net_profit_cents: null, net_profit_per_sqft_cents: null };
  }
  const net =
    Number(p.sale_price_cents) -
    Number(p.contractor_cost_cents || 0) -
    Number(p.affiliate_commission_cents || 0) -
    Number(p.agent_commission_cents || 0);
  const perSqft =
    p.sq_ft && Number(p.sq_ft) > 0 ? Math.round(net / Number(p.sq_ft)) : null;
  return { net_profit_cents: net, net_profit_per_sqft_cents: perSqft };
}

export type CommissionRateSettings = {
  direct_cents_per_sqft: number;
  closer_cents_per_sqft: number;
  parent_cents_per_sqft: number;
};

export type AffiliateCommissionSplit = {
  total_cents: number;
  closer_cents: number;
  parent_cents: number;
  closer_rate: number;
  parent_rate: number;
  role_closer: "direct" | "closer";
};

/**
 * Affiliate commissions (8A): ignore plan defaults.
 * Direct (no parent): override → sq_ft × direct rate.
 * Split (sub closer): closer $7 + parent $3 per sqft (or proportional from override).
 * 11B: inactive parent → parent share withheld (company); closer keeps their share only.
 */
export function resolveAffiliateCommissionSplit(input: {
  override_cents: number | null;
  sq_ft: number | null;
  has_parent: boolean;
  parent_active: boolean;
  rates: CommissionRateSettings;
}): AffiliateCommissionSplit {
  const sq = Math.max(0, Number(input.sq_ft || 0));
  const { rates } = input;

  if (!input.has_parent) {
    const total =
      input.override_cents != null
        ? Math.max(0, Number(input.override_cents))
        : Math.max(0, Math.round(sq * rates.direct_cents_per_sqft));
    return {
      total_cents: total,
      closer_cents: total,
      parent_cents: 0,
      closer_rate: rates.direct_cents_per_sqft,
      parent_rate: 0,
      role_closer: "direct",
    };
  }

  let closer = Math.max(0, Math.round(sq * rates.closer_cents_per_sqft));
  let parent = Math.max(0, Math.round(sq * rates.parent_cents_per_sqft));
  if (input.override_cents != null) {
    const total = Math.max(0, Number(input.override_cents));
    const denom = rates.closer_cents_per_sqft + rates.parent_cents_per_sqft;
    if (denom > 0) {
      parent = Math.round(total * (rates.parent_cents_per_sqft / denom));
      closer = Math.max(0, total - parent);
    } else {
      closer = total;
      parent = 0;
    }
  }

  if (!input.parent_active) {
    return {
      total_cents: closer,
      closer_cents: closer,
      parent_cents: 0,
      closer_rate: rates.closer_cents_per_sqft,
      parent_rate: rates.parent_cents_per_sqft,
      role_closer: "closer",
    };
  }

  return {
    total_cents: closer + parent,
    closer_cents: closer,
    parent_cents: parent,
    closer_rate: rates.closer_cents_per_sqft,
    parent_rate: rates.parent_cents_per_sqft,
    role_closer: "closer",
  };
}

/** @deprecated Prefer resolveAffiliateCommissionSplit — kept for transitional call sites/tests. */
export function resolveCommissionCents(input: {
  override_cents: number | null;
  plan_default_cents: number | null;
  sq_ft: number | null;
  rate_cents_per_sqft: number;
}): number {
  // 8A: plan defaults no longer win; override → sq_ft × rate.
  void input.plan_default_cents;
  if (input.override_cents != null) return Number(input.override_cents);
  return Math.max(0, Math.round(Number(input.sq_ft || 0) * input.rate_cents_per_sqft));
}

async function loadCommissionRates(
  conn?: Pool | PoolConnection,
): Promise<CommissionRateSettings> {
  const direct = await getSettingInt("commission_direct_cents_per_sqft", 0, conn);
  const legacy = await getSettingInt("commission_cents_per_sqft", 1000, conn);
  return {
    direct_cents_per_sqft: direct > 0 ? direct : legacy,
    closer_cents_per_sqft: await getSettingInt(
      "commission_closer_cents_per_sqft",
      700,
      conn,
    ),
    parent_cents_per_sqft: await getSettingInt(
      "commission_parent_cents_per_sqft",
      300,
      conn,
    ),
  };
}

async function resolveCloserParent(
  conn: Pool | PoolConnection,
  closerId: number | null,
): Promise<{ closer_id: number | null; parent_id: number | null }> {
  if (!closerId) return { closer_id: null, parent_id: null };
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT id, parent_affiliate_id, status FROM affiliates WHERE id = ? LIMIT 1`,
    [closerId],
  );
  const a = rows[0];
  if (!a || String(a.status) !== "active") return { closer_id: null, parent_id: null };
  const closer = Number(a.id);
  let parentId = a.parent_affiliate_id ? Number(a.parent_affiliate_id) : null;
  // Guard self-parent (corrupt data) — treat as top-level direct.
  if (parentId != null && parentId === closer) parentId = null;
  return { closer_id: closer, parent_id: parentId };
}

/** Rates frozen on the project at first accrual; fall back to live Settings once. */
async function resolveProjectCommissionRates(
  conn: Pool | PoolConnection,
  p: RowDataPacket,
  opts?: { persistIfMissing?: boolean },
): Promise<CommissionRateSettings> {
  const hasFrozen =
    p.commission_rate_direct_cents_per_sqft != null &&
    p.commission_rate_closer_cents_per_sqft != null &&
    p.commission_rate_parent_cents_per_sqft != null;
  if (hasFrozen) {
    return {
      direct_cents_per_sqft: Number(p.commission_rate_direct_cents_per_sqft),
      closer_cents_per_sqft: Number(p.commission_rate_closer_cents_per_sqft),
      parent_cents_per_sqft: Number(p.commission_rate_parent_cents_per_sqft),
    };
  }
  const live = await loadCommissionRates(conn);
  // Backfill from existing commission row snapshots when present (legacy deals).
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT role, rate_cents_per_sqft FROM affiliate_commissions
     WHERE project_id = ? AND rate_cents_per_sqft IS NOT NULL
     ORDER BY FIELD(status, 'paid', 'approved', 'pending', 'void'), id DESC`,
    [p.id],
  );
  const rates: CommissionRateSettings = { ...live };
  for (const r of rows) {
    const rate = Number(r.rate_cents_per_sqft);
    if (!Number.isFinite(rate) || rate < 0) continue;
    if (r.role === "direct") rates.direct_cents_per_sqft = rate;
    else if (r.role === "closer") rates.closer_cents_per_sqft = rate;
    else if (r.role === "parent") rates.parent_cents_per_sqft = rate;
  }
  if (opts?.persistIfMissing) {
    await conn.execute(
      `UPDATE projects SET
         commission_rate_direct_cents_per_sqft = ?,
         commission_rate_closer_cents_per_sqft = ?,
         commission_rate_parent_cents_per_sqft = ?
       WHERE id = ? AND commission_rate_direct_cents_per_sqft IS NULL`,
      [
        rates.direct_cents_per_sqft,
        rates.closer_cents_per_sqft,
        rates.parent_cents_per_sqft,
        p.id,
      ],
    );
  }
  return rates;
}

/** YYYY-MM-DD, `days` after `from` (UTC). */
export function addDaysIso(from: Date, days: number): string {
  const d = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

async function projectHasPaidCommission(
  conn: Pool | PoolConnection,
  projectId: number,
): Promise<boolean> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT id FROM affiliate_commissions
     WHERE project_id = ? AND status = 'paid' LIMIT 1`,
    [projectId],
  );
  return Boolean(rows[0]);
}

async function projectCommissionSplit(
  conn: Pool | PoolConnection,
  p: RowDataPacket,
): Promise<AffiliateCommissionSplit | null> {
  const closerId = Number(p.closer_affiliate_id || p.affiliate_id || 0) || null;
  if (!closerId) return null;
  let parentId = p.parent_affiliate_id ? Number(p.parent_affiliate_id) : null;
  if (parentId != null && parentId === closerId) parentId = null;
  let parentActive = false;
  if (parentId) {
    const [par] = await conn.execute<RowDataPacket[]>(
      `SELECT status FROM affiliates WHERE id = ? LIMIT 1`,
      [parentId],
    );
    parentActive = String(par[0]?.status || "") === "active";
  }
  const rates = await resolveProjectCommissionRates(conn, p, {
    persistIfMissing: String(p.loan_status) === "finalized",
  });
  return resolveAffiliateCommissionSplit({
    override_cents: p.commission_override_cents ?? null,
    sq_ft: p.sq_ft ?? null,
    has_parent: Boolean(parentId),
    parent_active: parentActive,
    rates,
  });
}

async function recalcProject(conn: Pool | PoolConnection, projectId: number) {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT p.* FROM projects p WHERE p.id = ? LIMIT 1`,
    [projectId],
  );
  const p = rows[0];
  if (!p) return;
  const paid = await projectHasPaidCommission(conn, projectId);
  // 10A+C: after any payout, freeze project commission used in profit math.
  const split = paid ? null : await projectCommissionSplit(conn, p);
  const affComm = paid
    ? p.affiliate_commission_cents == null
      ? null
      : Number(p.affiliate_commission_cents)
    : split
      ? split.total_cents
      : null;
  const econ = computeProjectEconomics({
    sale_price_cents: p.sale_price_cents ?? null,
    contractor_cost_cents: p.contractor_cost_cents ?? null,
    affiliate_commission_cents: affComm,
    agent_commission_cents: p.agent_commission_cents ?? null,
    sq_ft: p.sq_ft ?? null,
  });
  await conn.execute(
    `UPDATE projects SET affiliate_commission_cents = ?, net_profit_cents = ?,
       net_profit_per_sqft_cents = ? WHERE id = ?`,
    [affComm, econ.net_profit_cents, econ.net_profit_per_sqft_cents, projectId],
  );
  // Keep unpaid commission rows in sync (never mutate paid).
  if (!paid && split) {
    const closerId = Number(p.closer_affiliate_id || p.affiliate_id || 0) || null;
    const parentId = p.parent_affiliate_id ? Number(p.parent_affiliate_id) : null;
    if (closerId && split.closer_cents > 0) {
      await conn.execute(
        `UPDATE affiliate_commissions
         SET amount_cents = ?, sq_ft = ?, rate_cents_per_sqft = ?, role = ?
         WHERE project_id = ? AND affiliate_id = ? AND status IN ('pending','approved')`,
        [
          split.closer_cents,
          p.sq_ft ?? null,
          split.closer_rate,
          split.role_closer,
          projectId,
          closerId,
        ],
      );
    } else if (closerId) {
      await conn.execute(
        `UPDATE affiliate_commissions
         SET status = 'void', notes = 'Commission amount is zero'
         WHERE project_id = ? AND affiliate_id = ? AND status IN ('pending','approved')`,
        [projectId, closerId],
      );
    }
    if (parentId && split.parent_cents > 0) {
      await conn.execute(
        `UPDATE affiliate_commissions
         SET amount_cents = ?, sq_ft = ?, rate_cents_per_sqft = ?, role = 'parent'
         WHERE project_id = ? AND affiliate_id = ? AND status IN ('pending','approved')`,
        [split.parent_cents, p.sq_ft ?? null, split.parent_rate, projectId, parentId],
      );
    } else if (parentId && split.parent_cents <= 0) {
      // 11B: parent inactive — void unpaid parent rows.
      await conn.execute(
        `UPDATE affiliate_commissions
         SET status = 'void', notes = 'Parent affiliate inactive at recalc'
         WHERE project_id = ? AND affiliate_id = ? AND status IN ('pending','approved')`,
        [projectId, parentId],
      );
    }
  }
}

/** After a per-row amount edit on a split deal, refresh project total from live rows. */
async function refreshProjectEconomicsFromCommissionRows(
  conn: Pool | PoolConnection,
  projectId: number,
) {
  if (await projectHasPaidCommission(conn, projectId)) return;
  const [[sumRow]] = (await conn.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(amount_cents), 0) AS n FROM affiliate_commissions
     WHERE project_id = ? AND status IN ('pending','approved','paid')`,
    [projectId],
  )) as unknown as [RowDataPacket[]];
  const affComm = Number(sumRow?.n || 0);
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT * FROM projects WHERE id = ? LIMIT 1`,
    [projectId],
  );
  const p = rows[0];
  if (!p) return;
  const econ = computeProjectEconomics({
    sale_price_cents: p.sale_price_cents ?? null,
    contractor_cost_cents: p.contractor_cost_cents ?? null,
    affiliate_commission_cents: affComm,
    agent_commission_cents: p.agent_commission_cents ?? null,
    sq_ft: p.sq_ft ?? null,
  });
  await conn.execute(
    `UPDATE projects SET affiliate_commission_cents = ?, net_profit_cents = ?,
       net_profit_per_sqft_cents = ? WHERE id = ?`,
    [affComm, econ.net_profit_cents, econ.net_profit_per_sqft_cents, projectId],
  );
}

/**
 * When a parent affiliate's active status flips, re-sync finalized deals so the
 * parent share is voided (inactive) or restored (active) without waiting for
 * an unrelated project edit.
 */
async function resyncProjectsForParentAffiliate(
  conn: Pool | PoolConnection,
  parentAffiliateId: number,
  adminId: number | null,
) {
  const [projects] = await conn.execute<RowDataPacket[]>(
    `SELECT id, loan_status FROM projects WHERE parent_affiliate_id = ?`,
    [parentAffiliateId],
  );
  for (const row of projects) {
    const pid = Number(row.id);
    if (String(row.loan_status) === "finalized") {
      await syncCommissionForLoan(conn, pid, true, adminId);
    } else {
      await recalcProject(conn, pid);
    }
  }
}

/** Create/void affiliate commission row(s) when a loan is finalized / un-finalized. */
async function syncCommissionForLoan(
  conn: Pool | PoolConnection,
  projectId: number,
  finalized: boolean,
  adminId: number | null,
) {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT * FROM projects WHERE id = ? LIMIT 1`,
    [projectId],
  );
  const p = rows[0];
  const closerId = Number(p?.closer_affiliate_id || p?.affiliate_id || 0) || null;
  if (!p || !closerId) return;
  if (finalized) {
    // Freeze rates at first accrual (keep existing snapshot on re-finalize).
    await resolveProjectCommissionRates(conn, p, { persistIfMissing: true });
    await recalcProject(conn, projectId);
    const [fresh] = await conn.execute<RowDataPacket[]>(
      `SELECT * FROM projects WHERE id = ? LIMIT 1`,
      [projectId],
    );
    const proj = fresh[0] || p;
    const split = await projectCommissionSplit(conn, proj);
    let parentId = proj.parent_affiliate_id
      ? Number(proj.parent_affiliate_id)
      : null;
    if (parentId != null && parentId === closerId) parentId = null;
    if (!split || split.total_cents <= 0) {
      await conn.execute(
        `UPDATE affiliate_commissions
         SET status = 'void', notes = 'Commission amount is zero'
         WHERE project_id = ? AND status IN ('pending','approved')`,
        [projectId],
      );
      await conn.execute(
        `UPDATE projects SET commission_expected_pay_at = NULL WHERE id = ?`,
        [projectId],
      );
      return;
    }
    const days = await getSettingInt(
      "commission_payout_days_after_loan_close",
      5,
      conn,
    );
    const expected = addDaysIso(new Date(), days);

    const upsert = async (
      affiliateId: number,
      amount: number,
      rate: number,
      role: "direct" | "closer" | "parent",
    ) => {
      if (amount <= 0) return;
      await conn.execute(
        `INSERT INTO affiliate_commissions
           (affiliate_id, role, project_id, client_id, amount_cents, sq_ft,
            rate_cents_per_sqft, status, expected_pay_at, created_by_admin_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
         ON DUPLICATE KEY UPDATE
           role = IF(status = 'paid', role, VALUES(role)),
           amount_cents = IF(status = 'paid', amount_cents, VALUES(amount_cents)),
           sq_ft = IF(status = 'paid', sq_ft, VALUES(sq_ft)),
           rate_cents_per_sqft = IF(status = 'paid', rate_cents_per_sqft, VALUES(rate_cents_per_sqft)),
           expected_pay_at = IF(status = 'paid', expected_pay_at, VALUES(expected_pay_at)),
           status = IF(status = 'void', 'pending', status)`,
        [
          affiliateId,
          role,
          projectId,
          proj.client_id,
          amount,
          proj.sq_ft ?? null,
          rate,
          expected,
          adminId,
        ],
      );
    };

    await upsert(closerId, split.closer_cents, split.closer_rate, split.role_closer);
    if (parentId && split.parent_cents > 0) {
      await upsert(parentId, split.parent_cents, split.parent_rate, "parent");
    } else if (parentId) {
      await conn.execute(
        `UPDATE affiliate_commissions
         SET status = 'void', notes = 'Parent affiliate inactive — share withheld'
         WHERE project_id = ? AND affiliate_id = ? AND status IN ('pending','approved')`,
        [projectId, parentId],
      );
    }
    await conn.execute(
      `UPDATE projects SET commission_expected_pay_at = ? WHERE id = ?`,
      [expected, projectId],
    );
  } else {
    await conn.execute(
      `UPDATE affiliate_commissions SET status = 'void',
         notes = 'Loan no longer finalized'
       WHERE project_id = ? AND status IN ('pending','approved')`,
      [projectId],
    );
    await conn.execute(
      `UPDATE projects SET
         commission_expected_pay_at = NULL,
         commission_rate_direct_cents_per_sqft = NULL,
         commission_rate_closer_cents_per_sqft = NULL,
         commission_rate_parent_cents_per_sqft = NULL,
         commission_paid_at = NULL
       WHERE id = ?`,
      [projectId],
    );
  }
}

// ── Notices (emails) ────────────────────────────────────────────────────────

type NoticeOpts = {
  lang: Lang;
  subject: string;
  headline: string;
  paragraphs: string[];
  details?: Array<[string, string]>;
  cta?: { url: string; label: string };
};

export function tplPortalNotice(opts: NoticeOpts) {
  const paras = opts.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-size:16px;line-height:1.65;color:${BRAND_CHARCOAL};">${escapeHtml(p)}</p>`,
    )
    .join("");
  const details = opts.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px;background:#fff;border-radius:14px;border:1px solid rgba(14,42,74,0.08);padding:4px 18px;">${opts.details
        .map(([k, v]) => detailRow(k, v))
        .join("")}</table>`
    : "";
  const body = `
    <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND_GOLD};font-weight:700;">Groundwork Capital</p>
    <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;font-weight:800;color:${BRAND_INK};">${escapeHtml(opts.headline)}</h1>
    ${paras}${details}${opts.cta ? emailButton(opts.cta.url, opts.cta.label) : ""}`;
  return {
    subject: opts.subject,
    html: emailLayout({
      title: opts.headline,
      preheader: (opts.paragraphs[0] || "").slice(0, 120),
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

async function safeSend(to: string, tpl: { subject: string; html: string }) {
  try {
    await sendEmail({ to, subject: tpl.subject, html: tpl.html });
  } catch (e: any) {
    console.error(`[notice] ${to}:`, e?.message ?? e);
  }
}

async function notifyStaff(
  eventKey: AdminNotifyEventKey,
  build: (lang: Lang) => Omit<NoticeOpts, "lang">,
) {
  try {
    await notifyAllTeamAdmins(eventKey, (admin) => {
      const lang = asLang(admin.preferred_language);
      const notice = { ...build(lang), lang };
      const tpl = tplPortalNotice(notice);
      const bodyPreview = String(notice.paragraphs?.[0] || "").slice(0, 200);
      return {
        ...tpl,
        linkUrl: notice.cta?.url || "/admin",
        inAppBody: bodyPreview || null,
        smsBody: `${tpl.subject}${bodyPreview ? `: ${bodyPreview}` : ""}`.slice(
          0,
          320,
        ),
      };
    });
  } catch (e: any) {
    console.error(`[notify:${eventKey}]`, e?.message ?? e);
  }
}

const money = (cents: number | null | undefined) =>
  `$${(Number(cents || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;


// ─── Portal feature layer: routes ────────────────────────────────────────────

const PROJECT_ADMIN_SELECT = `
  SELECT p.*,
    CONCAT(c.first_name, ' ', c.last_name) AS client_name,
    c.email AS client_email,
    CONCAT(a.first_name, ' ', a.last_name) AS affiliate_name,
    COALESCE(NULLIF(k.company, ''), CONCAT(k.first_name, ' ', k.last_name)) AS contractor_name,
    pl.name AS plan_name
  FROM projects p
  JOIN clients c ON c.id = p.client_id
  LEFT JOIN affiliates a ON a.id = p.affiliate_id
  LEFT JOIN contractors k ON k.id = p.contractor_id
  LEFT JOIN adu_plans pl ON pl.id = p.adu_plan_id`;

const FINANCE_FIELDS = [
  "sale_price_cents",
  "contractor_cost_cents",
  "affiliate_commission_cents",
  "agent_commission_cents",
  "net_profit_cents",
  "net_profit_per_sqft_cents",
  "commission_override_cents",
  "commission_rate_direct_cents_per_sqft",
  "commission_rate_closer_cents_per_sqft",
  "commission_rate_parent_cents_per_sqft",
] as const;

function shapeAdminProject(row: RowDataPacket, canFinance: boolean) {
  const out: Record<string, any> = { ...row };
  if (!canFinance) for (const f of FINANCE_FIELDS) delete out[f];
  return out;
}

const MILESTONE_VALUES = [
  "lead",
  "financing",
  "contracted",
  "in_build",
  "closed",
  "cancelled",
] as const;
const LOAN_STATUS_VALUES = [
  "not_started",
  "in_process",
  "underwriting",
  "approved",
  "finalized",
  "denied",
  "withdrawn",
] as const;
const fDate: FieldParser = (v) =>
  v === null || v === "" || v === undefined
    ? { ok: true, value: null }
    : /^\d{4}-\d{2}-\d{2}$/.test(String(v))
      ? { ok: true, value: String(v) }
      : { ok: false };
const fLang = fEnum(["en", "es"] as const);

// ── Milestone state machine ─────────────────────────────────────────────────

type Milestone = (typeof MILESTONE_VALUES)[number];

/**
 * Allowed project milestone moves. Forward: next step (financing may be skipped
 * for cash buyers). Backward: one step to correct a mistake. `closed` only
 * re-opens to `in_build`; `cancelled` only re-opens to `lead`; any active stage
 * can be cancelled. A no-op (same milestone) is always allowed.
 */
export const MILESTONE_TRANSITIONS: Record<Milestone, readonly Milestone[]> = {
  lead: ["financing", "contracted", "cancelled"],
  financing: ["lead", "contracted", "cancelled"],
  contracted: ["financing", "in_build", "cancelled"],
  in_build: ["contracted", "closed", "cancelled"],
  closed: ["in_build"],
  cancelled: ["lead"],
};

const isMilestone = (v: unknown): v is Milestone =>
  (MILESTONE_VALUES as readonly string[]).includes(String(v));

/** Throws HttpError(409 errors.invalidTransition) for an illegal milestone move. */
export function assertMilestoneTransition(from: unknown, to: unknown): void {
  if (!isMilestone(from) || !isMilestone(to)) {
    throw new HttpError(400, "validation.invalidField");
  }
  if (from === to) return;
  if (!MILESTONE_TRANSITIONS[from].includes(to)) {
    throw new HttpError(409, "errors.invalidTransition");
  }
}

// ── Photo storage (Vercel Blob) ─────────────────────────────────────────────

const BLOB_PUBLIC_HOST = "public.blob.vercel-storage.com";
const PHOTO_MAX_BYTES = 4 * 1024 * 1024; // Vercel serverless request body cap is 4.5MB
const PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Hosts (and their subdomains) a stored photo URL may point at. */
function photoHostAllowlist(): string[] {
  const extra = String(process.env.PHOTO_URL_ALLOWED_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);
  return [BLOB_PUBLIC_HOST, ...extra];
}

/** https only, no credentials/port, host must be Vercel Blob or PHOTO_URL_ALLOWED_HOSTS. */
export function isAllowedPhotoUrl(raw: unknown): boolean {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 1000) return false;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  return photoHostAllowlist().some((h) => host === h || host.endsWith(`.${h}`));
}

/** Sniff real image type from magic bytes (never trust Content-Type alone). */
export function detectImageType(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mime: "image/png", ext: "png" };
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

// ── Anchor lender sync (optional — needs ANCHOR_API_KEY + ANCHOR_API_BASE) ───

type AnchorHttp = (
  input: string,
  init?: RequestInit,
) => Promise<globalThis.Response>;
let anchorHttp: AnchorHttp = (input, init) => globalThis.fetch(input, init);

/** Test seam for Anchor HTTP (never used in production). */
export function __testSetAnchorHttp(fn: AnchorHttp | null) {
  anchorHttp = fn || ((input, init) => globalThis.fetch(input, init));
}

const ANCHOR_STATUS_MAP: Record<string, (typeof LOAN_STATUS_VALUES)[number]> = {
  not_started: "not_started",
  draft: "not_started",
  new: "not_started",
  in_process: "in_process",
  processing: "in_process",
  in_progress: "in_process",
  underwriting: "underwriting",
  under_writing: "underwriting",
  submitted: "underwriting",
  approved: "approved",
  clear_to_close: "approved",
  finalized: "finalized",
  funded: "finalized",
  closed: "finalized",
  complete: "finalized",
  denied: "denied",
  declined: "denied",
  withdrawn: "withdrawn",
  cancelled: "withdrawn",
  canceled: "withdrawn",
};

/** Map Anchor loan status strings → Groundwork `loan_status`. */
export function mapAnchorLoanStatus(
  raw: unknown,
): (typeof LOAN_STATUS_VALUES)[number] | null {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return ANCHOR_STATUS_MAP[s] || null;
}

function anchorConfig(): { key: string; base: string } | null {
  const key = String(process.env.ANCHOR_API_KEY || "").trim();
  const base = String(process.env.ANCHOR_API_BASE || "")
    .trim()
    .replace(/\/$/, "");
  return key && base ? { key, base } : null;
}

async function fetchAnchorLoanStatus(externalId: string): Promise<{
  loan_status: (typeof LOAN_STATUS_VALUES)[number];
  raw: unknown;
}> {
  const cfg = anchorConfig();
  if (!cfg) throw new HttpError(503, "errors.anchorNotConfigured");
  const url = `${cfg.base}/v1/loans/${encodeURIComponent(externalId)}`;
  let res: globalThis.Response;
  try {
    res = await anchorHttp(url, {
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        Accept: "application/json",
      },
    });
  } catch (e: any) {
    console.error("[anchor] fetch failed:", e?.message ?? e);
    throw new HttpError(502, "errors.anchorSyncFailed");
  }
  if (res.status === 404) throw new HttpError(404, "errors.anchorNotFound");
  if (!res.ok) throw new HttpError(502, "errors.anchorSyncFailed");
  let raw: any;
  try {
    raw = await res.json();
  } catch {
    throw new HttpError(502, "errors.anchorSyncFailed");
  }
  const statusRaw =
    raw?.status ?? raw?.loan_status ?? raw?.data?.status ?? raw?.data?.loan_status;
  const loan_status = mapAnchorLoanStatus(statusRaw);
  if (!loan_status) throw new HttpError(502, "errors.anchorStatusUnknown");
  return { loan_status, raw };
}

/**
 * Pull Anchor loan status into `projects` and sync commission if finalize flips.
 * Returns the updated loan_status.
 */
async function syncProjectAnchor(
  projectId: number,
  adminId: number | null,
): Promise<{
  loan_status: string;
  previous_loan_status: string;
  changed: boolean;
}> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, public_id, loan_status, loan_lender_type, anchor_external_id
     FROM projects WHERE id = ? LIMIT 1`,
    [projectId],
  );
  const p = rows[0];
  if (!p) throw new HttpError(404, "errors.notFound");
  if (String(p.loan_lender_type) !== "anchor") {
    throw new HttpError(400, "errors.anchorLenderRequired");
  }
  const externalId = String(p.anchor_external_id || "").trim();
  if (!externalId) throw new HttpError(400, "errors.anchorIdRequired");

  const { loan_status } = await fetchAnchorLoanStatus(externalId);
  const previous = String(p.loan_status);
  const changed = previous !== loan_status;
  if (!changed) {
    await pool.execute(
      `UPDATE projects SET anchor_last_synced_at = NOW() WHERE id = ?`,
      [projectId],
    );
    return { loan_status, previous_loan_status: previous, changed: false };
  }

  const becameFinalized = loan_status === "finalized" && previous !== "finalized";
  const leftFinalized = previous === "finalized" && loan_status !== "finalized";
  await withTx(async (conn) => {
    await conn.execute(
      `UPDATE projects SET loan_status = ?,
         loan_finalized_at = CASE
           WHEN ? = 1 THEN NOW()
           WHEN ? = 1 THEN NULL
           ELSE loan_finalized_at
         END,
         anchor_last_synced_at = NOW()
       WHERE id = ?`,
      [loan_status, becameFinalized ? 1 : 0, leftFinalized ? 1 : 0, projectId],
    );
    if (becameFinalized) await syncCommissionForLoan(conn, projectId, true, adminId);
    if (leftFinalized) await syncCommissionForLoan(conn, projectId, false, adminId);
    await recalcProject(conn, projectId);
  });
  return { loan_status, previous_loan_status: previous, changed: true };
}

/** Store a public binary on Vercel Blob. Requires BLOB_READ_WRITE_TOKEN (no local fallback). */
async function storePublicBlobFile(
  filename: string,
  body: Buffer,
  mime: string,
): Promise<string> {
  const token = String(process.env.BLOB_READ_WRITE_TOKEN || "").trim();
  if (!token) throw new HttpError(503, "errors.storageNotConfigured");
  const blob = await putBlob(filename, body, {
    access: "public",
    token,
    contentType: mime,
    addRandomSuffix: true,
  });
  if (!/^https:\/\//i.test(blob.url) || blob.url.length > 1000) {
    throw new HttpError(502, "errors.storageFailed");
  }
  return blob.url;
}

async function storeProjectPhotoFile(
  publicId: string,
  body: Buffer,
  mime: string,
  ext: string,
): Promise<string> {
  const filename = `projects/${publicId}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  return storePublicBlobFile(filename, body, mime);
}

async function storeAdminAvatarFile(
  adminId: number,
  body: Buffer,
  mime: string,
  ext: string,
): Promise<string> {
  const filename = `avatars/admins/${adminId}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  return storePublicBlobFile(filename, body, mime);
}

async function storeAffiliateAvatarFile(
  affiliateId: number,
  body: Buffer,
  mime: string,
  ext: string,
): Promise<string> {
  const filename = `avatars/affiliates/${affiliateId}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  return storePublicBlobFile(filename, body, mime);
}

const CLIENT_PORTAL_INVITE_TTL_MS = 5 * 24 * 60 * 60 * 1000;

async function issueClientPortalInvite(
  executor: {
    execute: Pool["execute"];
  },
  opts: {
    clientId: number;
    email: string;
    byType: "system" | "admin" | "affiliate";
    byId: number | null;
  },
): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  await executor.execute(
    `UPDATE client_portal_invites SET expires_at = NOW()
     WHERE client_id = ? AND accepted_at IS NULL AND expires_at > NOW()`,
    [opts.clientId],
  );
  await executor.execute(
    `INSERT INTO client_portal_invites
       (token, client_id, email, created_by_type, created_by_id, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      token,
      opts.clientId,
      opts.email,
      opts.byType,
      opts.byId,
      new Date(Date.now() + CLIENT_PORTAL_INVITE_TTL_MS),
    ],
  );
  return token;
}

async function sendClientPortalInviteEmail(opts: {
  email: string;
  firstName: string;
  lang: Lang;
  token: string;
  publicId?: string | null;
}): Promise<void> {
  const projectBit = opts.publicId
    ? tr(
        opts.lang,
        ` Your project ${opts.publicId} is ready to follow.`,
        ` Tu proyecto ${opts.publicId} ya está listo para seguir.`,
      )
    : "";
  await safeSend(
    opts.email,
    tplPortalNotice({
      lang: opts.lang,
      subject: tr(
        opts.lang,
        "Open your ADU project portal — Groundwork Capital",
        "Abre tu portal de proyecto ADU — Groundwork Capital",
      ),
      headline: tr(
        opts.lang,
        "Your project portal is ready.",
        "Tu portal de proyecto está listo.",
      ),
      paragraphs: [
        tr(
          opts.lang,
          `Hi ${opts.firstName}, accept this invite to open your Groundwork portal.${projectBit}`,
          `Hola ${opts.firstName}, acepta esta invitación para abrir tu portal Groundwork.${projectBit}`,
        ),
        tr(
          opts.lang,
          "This magic link expires in 5 days. After that, sign in with a one-time email code.",
          "Este enlace mágico caduca en 5 días. Después, entra con un código de un solo uso.",
        ),
      ],
      cta: {
        url: `${APP_URL}/client/invite/${opts.token}`,
        label: tr(opts.lang, "Open my portal", "Abrir mi portal"),
      },
    }),
  );
}

/** Flip prospect → active on first successful login (OTP or magic link). */
async function markClientLoggedIn(
  clientId: number,
  currentStatus: string,
): Promise<string> {
  if (currentStatus === "prospect") {
    await pool.execute(
      `UPDATE clients
       SET status = 'active',
           email_verified_at = COALESCE(email_verified_at, NOW()),
           last_login_at = NOW()
       WHERE id = ?`,
      [clientId],
    );
    return "active";
  }
  await pool.execute(`UPDATE clients SET last_login_at = NOW() WHERE id = ?`, [
    clientId,
  ]);
  return currentStatus;
}

async function mintPortalSession(
  req: Request,
  res: Response,
  actor: PortalActor,
  actorId: number,
): Promise<void> {
  const cfg = PORTAL_AUTH[actor];
  const token = crypto.randomBytes(32).toString("hex");
  const days = await getPortalSessionDays();
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    null;
  const ua = String(req.headers["user-agent"] || "").slice(0, 500) || null;
  await pool.execute(
    `INSERT INTO \`${cfg.sessionTable}\`
       (${cfg.idCol}, token_hash, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [actorId, sha256(token), ip, ua, expires],
  );
  setPortalCookie(res, actor, token, expires);
}

async function logAffiliateClick(
  req: Request,
  affiliateId: number,
  landingKey: string,
): Promise<void> {
  try {
    await pool.execute(
      `INSERT INTO affiliate_link_clicks (affiliate_id, landing, ip_address, user_agent, referer)
       VALUES (?, ?, ?, ?, ?)`,
      [
        affiliateId,
        landingKey,
        clientIp(req),
        String(req.headers["user-agent"] || "").slice(0, 500) || null,
        String(req.headers.referer || "").slice(0, 500) || null,
      ],
    );
  } catch (e: any) {
    console.error("[referral] click log failed:", e?.message ?? e);
  }
}

const REFERRAL_LANDINGS: Record<string, string> = {
  home: "/",
  enroll: "/start",
  "get-credit-report": "/get-credit-report",
  contact: "/contact",
  partners: "/partners",
};

// ── Contract PDF (dependency-free, deterministic) ───────────────────────────

type ContractPayload = {
  project?: string;
  generated_on?: string;
  property?: {
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  };
  plan?: {
    name?: string | null;
    sq_ft?: number | null;
    bedrooms?: number | null;
    bathrooms?: number | string | null;
  } | null;
  client?: { name?: string | null; email?: string | null; phone?: string | null };
  contractor?: {
    name?: string | null;
    company?: string | null;
    license?: string | null;
    email?: string | null;
  } | null;
  contract_price_cents?: number | null;
};

const PDF_CP1252: Record<number, number> = {
  0x20ac: 0x80,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
};

/** Escape a string for a PDF literal using WinAnsi (keeps Spanish accents). */
function pdfEscape(input: unknown): string {
  let out = "";
  for (const ch of String(input ?? "")) {
    let code = ch.codePointAt(0) as number;
    if (code === 0x0a || code === 0x0d || code === 0x09) code = 0x20;
    if (PDF_CP1252[code] != null) code = PDF_CP1252[code];
    else if (code < 0x20 || code > 0xff) code = 0x3f;
    if (code === 0x28 || code === 0x29 || code === 0x5c) {
      out += `\\${String.fromCharCode(code)}`;
    } else if (code < 0x20 || code > 0x7e) {
      out += `\\${code.toString(8).padStart(3, "0")}`;
    } else {
      out += String.fromCharCode(code);
    }
  }
  return out;
}

function wrapPdfText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (let w of String(text).split(/\s+/).filter(Boolean)) {
    while (w.length > maxChars) {
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      lines.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur += ` ${w}`;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

const PDF_COPY = {
  en: {
    brand: "Groundwork Capital",
    titles: {
      contractor_client: "Construction Agreement Summary",
      affiliate_terms: "Affiliate Terms Summary",
      other: "Project Document",
    } as Record<string, string>,
    project: "Project",
    status: "Status",
    generated: "Generated",
    property: "Property",
    plan: "ADU plan",
    client: "Client",
    contractor: "Contractor",
    price: "Contract price",
    terms: "Terms",
    statuses: { draft: "Draft", generated: "Generated", sent: "Sent", signed: "Signed", void: "Void" } as Record<string, string>,
    termsBody:
      "This document summarizes the project data recorded by Groundwork Capital on the date above. It becomes binding only when signed by every party below.",
    sign: "Signature",
    date: "Date",
    name: "Name",
    email: "Email",
    phone: "Phone",
    company: "Company",
    license: "License",
    area: "sq ft",
    beds: "bed",
    baths: "bath",
    page: "Page",
    of: "of",
    none: "—",
  },
  es: {
    brand: "Groundwork Capital",
    titles: {
      contractor_client: "Resumen del contrato de construcción",
      affiliate_terms: "Resumen de términos de afiliado",
      other: "Documento del proyecto",
    } as Record<string, string>,
    project: "Proyecto",
    status: "Estado",
    generated: "Generado",
    property: "Propiedad",
    plan: "Plan ADU",
    client: "Cliente",
    contractor: "Contratista",
    price: "Precio del contrato",
    terms: "Términos",
    statuses: { draft: "Borrador", generated: "Generado", sent: "Enviado", signed: "Firmado", void: "Anulado" } as Record<string, string>,
    termsBody:
      "Este documento resume los datos del proyecto registrados por Groundwork Capital en la fecha indicada. Solo es vinculante cuando lo firman todas las partes.",
    sign: "Firma",
    date: "Fecha",
    name: "Nombre",
    email: "Correo",
    phone: "Teléfono",
    company: "Empresa",
    license: "Licencia",
    area: "pies²",
    beds: "rec.",
    baths: "baños",
    page: "Página",
    of: "de",
    none: "—",
  },
} as const;

/** Minimal paginated Letter PDF writer (Helvetica / Helvetica-Bold, WinAnsi). Pure + deterministic. */
type PdfFont = "F1" | "F2";
const PDF_INK = "0.055 0.165 0.29";
const PDF_GOLD = "0.85 0.64 0.25";
const PDF_TEXT = "0.12 0.14 0.19";
const PDF_MUTED = "0.4 0.44 0.52";

function createPdfWriter(opts: { labelWidth?: number; maxChars?: number } = {}) {
  const W = 612;
  const H = 792;
  const M = 54;
  const BOTTOM = 72;
  const MAX_CHARS = opts.maxChars ?? 88;
  const LABEL_W = opts.labelWidth ?? 120;
  const LABEL_CHARS = Math.max(8, Math.floor(LABEL_W / 5.2) - 1);
  const pages: string[][] = [[]];
  let y = H - M;
  const ops = () => pages[pages.length - 1];
  const ensure = (need: number) => {
    if (y - need < BOTTOM) {
      pages.push([]);
      y = H - M;
    }
  };
  const text = (font: PdfFont, size: number, x: number, s: string, rgb = PDF_TEXT) => {
    ops().push(`${rgb} rg BT /${font} ${size} Tf ${x} ${y.toFixed(2)} Td (${pdfEscape(s)}) Tj ET`);
  };
  const line = (x1: number, x2: number, rgb: string, w = 0.75) => {
    ops().push(`${rgb} RG ${w} w ${x1} ${y.toFixed(2)} m ${x2} ${y.toFixed(2)} l S`);
  };
  const heading = (s: string) => {
    ensure(40);
    y -= 14;
    text("F2", 12, M, s, PDF_INK);
    y -= 6;
    line(M, W - M, PDF_GOLD, 1);
    y -= 14;
  };
  const subheading = (s: string) => {
    ensure(28);
    y -= 4;
    text("F2", 10, M, s, PDF_INK);
    y -= 16;
  };
  const row = (label: string, value: unknown, none = "—") => {
    const v = value == null || value === "" ? none : String(value);
    const lines = wrapPdfText(v, MAX_CHARS - 22);
    const labels = LABEL_W > 120 ? wrapPdfText(label, LABEL_CHARS) : [label];
    ensure(Math.max(lines.length, labels.length) * 14 + 2);
    const top = y;
    labels.forEach((l, i) => {
      y = top - i * 14;
      text("F2", 10, M, l);
    });
    y = top;
    for (const l of lines) {
      text("F1", 10, M + LABEL_W, l);
      y -= 14;
    }
    y = Math.min(y, top - labels.length * 14);
  };
  const para = (s: string, size = 10, rgb = PDF_TEXT) => {
    for (const l of wrapPdfText(s, MAX_CHARS)) {
      ensure(14);
      text("F1", size, M, l, rgb);
      y -= 14;
    }
  };
  const title = (kicker: string, s: string) => {
    y -= 10;
    text("F2", 10, M, kicker.toUpperCase(), PDF_GOLD);
    y -= 26;
    for (const l of wrapPdfText(s, 52)) {
      text("F2", 20, M, l, PDF_INK);
      y -= 26;
    }
  };
  const signatureLines = (signers: string[], signLabel: string, dateLabel: string) => {
    ensure(40 + signers.length * 52);
    y -= 24;
    for (const who of signers) {
      y -= 18;
      line(M, M + 260, PDF_TEXT);
      line(M + 300, W - M, PDF_TEXT);
      y -= 12;
      text("F1", 9, M, `${who} — ${signLabel}`, PDF_MUTED);
      text("F1", 9, M + 300, dateLabel, PDF_MUTED);
      y -= 20;
    }
  };
  const finish = (docTitle: string, footer: (page: number, total: number) => string): Buffer => {
    const total = pages.length;
    pages.forEach((pageOps, i) => {
      pageOps.push(
        `${PDF_MUTED} rg BT /F1 8 Tf ${M} 36 Td (${pdfEscape(footer(i + 1, total))}) Tj ET`,
      );
    });
    // Objects: 1 catalog, 2 pages, 3 F1, 4 F2, 5 info, then (content, page) pairs.
    const objs: string[] = [];
    const kids = pages.map((_, i) => `${7 + i * 2} 0 R`).join(" ");
    objs.push("<< /Type /Catalog /Pages 2 0 R >>");
    objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${total} >>`);
    objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    objs.push(`<< /Title (${pdfEscape(docTitle)}) /Producer (Groundwork Capital) >>`);
    pages.forEach((pageOps, i) => {
      const stream = pageOps.join("\n");
      objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      objs.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`,
      );
    });
    let pdf = "%PDF-1.4\n%âãÏÓ\n";
    const offsets: number[] = [];
    objs.forEach((body, i) => {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(pdf, "latin1");
  };
  return { heading, subheading, row, para, title, signatureLines, ensure, finish };
}

/**
 * Render a contract summary as a valid single-font PDF 1.4 (Letter, paginated).
 * Pure and deterministic: same input → same bytes. No external dependencies.
 */
export function buildContractPdf(input: {
  payload: ContractPayload;
  kind: string;
  status: string;
  lang: Lang;
}): Buffer {
  const c = PDF_COPY[input.lang === "es" ? "es" : "en"];
  const p = input.payload || {};
  const pdf = createPdfWriter();
  const row = (label: string, value: unknown) => pdf.row(label, value, c.none);

  pdf.title(c.brand, c.titles[input.kind] || c.titles.other);

  pdf.heading(c.project);
  row(c.project, p.project);
  row(c.status, c.statuses[input.status] || input.status);
  row(c.generated, p.generated_on);

  pdf.heading(c.property);
  const pr = p.property || {};
  row(c.property, pr.address);
  row("", [pr.city, [pr.state, pr.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "));

  if (p.plan) {
    pdf.heading(c.plan);
    row(c.plan, p.plan.name);
    const specs = [
      p.plan.sq_ft != null ? `${p.plan.sq_ft} ${c.area}` : null,
      p.plan.bedrooms != null ? `${p.plan.bedrooms} ${c.beds}` : null,
      p.plan.bathrooms != null ? `${p.plan.bathrooms} ${c.baths}` : null,
    ].filter(Boolean);
    row("", specs.join(" · "));
  }

  pdf.heading(c.client);
  row(c.name, p.client?.name);
  row(c.email, p.client?.email);
  row(c.phone, p.client?.phone);

  if (p.contractor) {
    pdf.heading(c.contractor);
    row(c.name, p.contractor.name);
    row(c.company, p.contractor.company);
    row(c.license, p.contractor.license);
    row(c.email, p.contractor.email);
  }

  pdf.heading(c.price);
  row(
    c.price,
    p.contract_price_cents == null ? null : money(Number(p.contract_price_cents)),
  );

  pdf.heading(c.terms);
  pdf.para(c.termsBody);

  pdf.signatureLines([c.client, ...(p.contractor ? [c.contractor] : [])], c.sign, c.date);

  return pdf.finish(
    `${c.titles[input.kind] || c.titles.other} ${p.project || ""}`.trim(),
    (i, total) => `${c.brand} · ${p.project || ""} · ${c.page} ${i} ${c.of} ${total}`,
  );
}

async function recordMilestone(
  conn: Pool | PoolConnection,
  projectId: number,
  from: string | null,
  to: string,
  byType: "admin" | "affiliate" | "contractor" | "client" | "system",
  byId: number | null,
  note: string | null = null,
) {
  await conn.execute(
    `INSERT INTO project_milestone_events
       (project_id, from_milestone, to_milestone, changed_by_type, changed_by_id, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [projectId, from, to, byType, byId, note],
  );
}

async function createClientWithProject(
  conn: PoolConnection,
  input: {
    email: string;
    first_name: string;
    last_name: string;
    phone: string | null;
    lang: Lang;
    property_address: string | null;
    property_city: string | null;
    property_zip: string | null;
    affiliate_id: number | null;
    lead_id: number | null;
    adu_plan_id: number | null;
    assigned_admin_id: number | null;
    byType: "admin" | "affiliate" | "system";
    byId: number | null;
    existingClientId?: number | null;
  },
): Promise<{ clientId: number; projectId: number; publicId: string }> {
  let clientId = input.existingClientId ?? null;
  if (!clientId) {
    const [c] = await conn.execute<ResultSetHeader>(
      `INSERT INTO clients
         (email, first_name, last_name, phone, preferred_language, status,
          address_line1, city, zip, affiliate_id, assigned_admin_id, lead_id)
       VALUES (?, ?, ?, ?, ?, 'prospect', ?, ?, ?, ?, ?, ?)`,
      [
        input.email,
        input.first_name,
        input.last_name,
        input.phone,
        input.lang,
        input.property_address,
        input.property_city,
        input.property_zip,
        input.affiliate_id,
        input.assigned_admin_id,
        input.lead_id,
      ],
    );
    clientId = Number(c.insertId);
  }
  let sqFt: number | null = null;
  if (input.adu_plan_id) {
    const [pl] = await conn.execute<RowDataPacket[]>(
      `SELECT sq_ft FROM adu_plans WHERE id = ? AND is_active = 1 LIMIT 1`,
      [input.adu_plan_id],
    );
    if (!pl[0]) throw new HttpError(400, "errors.invalidReference");
    sqFt = Number(pl[0].sq_ft);
  }
  const publicId = newPublicId();
  const attr = await resolveCloserParent(conn, input.affiliate_id);
  const [p] = await conn.execute<ResultSetHeader>(
    `INSERT INTO projects
       (public_id, client_id, lead_id, affiliate_id, closer_affiliate_id, parent_affiliate_id,
        assigned_admin_id, adu_plan_id,
        milestone, milestone_changed_at, property_address, property_city, property_zip, sq_ft)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'lead', NOW(), ?, ?, ?, ?)`,
    [
      publicId,
      clientId,
      input.lead_id,
      attr.closer_id,
      attr.closer_id,
      attr.parent_id,
      input.assigned_admin_id,
      input.adu_plan_id,
      input.property_address,
      input.property_city,
      input.property_zip,
      sqFt,
    ],
  );
  const projectId = Number(p.insertId);
  await recordMilestone(conn, projectId, null, "lead", input.byType, input.byId);
  await recalcProject(conn, projectId);
  return { clientId, projectId, publicId };
}

async function loadAdminProjectDetail(publicId: string, canFinance: boolean) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `${PROJECT_ADMIN_SELECT} WHERE p.public_id = ? LIMIT 1`,
    [publicId],
  );
  const project = rows[0];
  if (!project) return null;
  const pid = Number(project.id);
  const [photos] = await pool.execute<RowDataPacket[]>(
    `SELECT id, storage_url, caption, taken_at, created_at FROM project_photos
     WHERE project_id = ? ORDER BY id DESC LIMIT 200`,
    [pid],
  );
  const [draws] = await pool.execute<RowDataPacket[]>(
    `SELECT id, project_id, amount_cents, status, note, reviewed_at, paid_at, created_at
     FROM draw_requests WHERE project_id = ? ORDER BY id DESC`,
    [pid],
  );
  const [contracts] = await pool.execute<RowDataPacket[]>(
    `SELECT id, project_id, kind, status, storage_url, payload_json, generated_at, signed_at, created_at
     FROM project_contracts WHERE project_id = ? ORDER BY id DESC`,
    [pid],
  );
  const [events] = await pool.execute<RowDataPacket[]>(
    `SELECT id, from_milestone, to_milestone, changed_by_type, note, created_at
     FROM project_milestone_events WHERE project_id = ? ORDER BY id ASC`,
    [pid],
  );
  let commission: RowDataPacket | null = null;
  let commissions: RowDataPacket[] = [];
  if (canFinance) {
    const [c] = await pool.execute<RowDataPacket[]>(
      `SELECT ac.*, CONCAT(a.first_name, ' ', a.last_name) AS affiliate_name,
              a.email AS affiliate_email
       FROM affiliate_commissions ac
       JOIN affiliates a ON a.id = ac.affiliate_id
       WHERE ac.project_id = ?
       ORDER BY FIELD(ac.role, 'direct', 'closer', 'parent'), ac.id ASC`,
      [pid],
    );
    commissions = c;
    // Legacy singular field: prefer closer/direct over parent for older UI.
    commission =
      c.find((row) => row.role === "direct" || row.role === "closer") ||
      c[0] ||
      null;
  }
  return {
    project: shapeAdminProject(project, canFinance),
    photos,
    draws,
    contracts,
    events,
    commission,
    commissions,
  };
}

// ─── Contractor prequalification application (CPQ) ──────────────────────────
// Inline mirror of shared/contractorApplication.ts (the API cannot runtime-import
// shared/). api/contractorApplication.test.ts asserts catalog + rule parity.

const CPQ_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CPQ_EXISTING_DUE_DAYS = 30;
const CPQ_UPLOAD_TOKEN_TTL_MS = 15 * 60 * 1000;
const CPQ_DOC_MAX_BYTES = 25 * 1024 * 1024;
const CPQ_DOC_MAX_FILES_PER_TYPE = 12;
const CPQ_TEMPLATE_MAX_BYTES = 4 * 1024 * 1024;
const CPQ_SIGNATURE_MAX_CHARS = 300_000;
const CPQ_MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const CPQ_EDITABLE: ContractorApplicationStatus[] = ["draft", "needs_info"];
const CPQ_TEMPLATE_KEYS = {
  master_contractor_agreement: "cpq_template_master_contractor_agreement",
  background_check_authorization: "cpq_template_background_check_authorization",
} as const;
/** Draft reminders (days after first send): new applicants vs. existing contractors with a deadline. */
const CPQ_REMINDER_DAYS_NEW = [3, 7, 14];
const CPQ_REMINDER_DAYS_EXISTING = [7, 14, 25];
/** After submit: nudges for documents still owed (days after submit). */
const CPQ_REMINDER_DAYS_MISSING_DOCS = [7, 13];
/** Expiring-document reminders (days before expiry). */
const CPQ_EXPIRY_THRESHOLDS = [30, 7, 0];

export const CPQ_CERTIFICATION_VERSION = "2026-10-09";
const CPQ_CERTIFICATION_TEXT: Record<Lang, string> = {
  en: "I certify that all information provided in this application and its attachments is true, complete, and accurate to the best of my knowledge. I understand that any false or misleading information may result in rejection of this application or termination of any agreement. I authorize Groundwork Capital to verify all information, contact references, check license and insurance status, and obtain credit and background reports on the company and its principals. I agree to notify Groundwork Capital within 10 days of any change in license, bond, or insurance status.",
  es: "Certifico que toda la información proporcionada en esta solicitud y sus anexos es verdadera, completa y exacta a mi leal saber y entender. Entiendo que cualquier información falsa o engañosa puede resultar en el rechazo de esta solicitud o la terminación de cualquier acuerdo. Autorizo a Groundwork Capital a verificar toda la información, contactar referencias, revisar el estado de licencias y seguros, y obtener reportes de crédito y antecedentes de la empresa y sus principales. Me comprometo a notificar a Groundwork Capital dentro de 10 días de cualquier cambio en el estado de licencia, fianza o seguro.",
};

export const CPQ_ROWS = {
  recent_projects: 3,
  personnel: 3,
  client_references: 3,
  supplier_references: 2,
} as const;

export const CPQ_DISCLOSURE_KEYS = [
  "osha_citations_3yrs",
  "lawsuits_5yrs",
  "cslb_complaints_5yrs",
  "liens_5yrs",
  "failed_to_complete",
  "bankruptcy_7yrs",
] as const;

export const CPQ_ADU_PROJECT_TYPES: AduProjectType[] = [
  "detached",
  "attached",
  "garage_conversion",
  "jadu",
  "prefab_modular",
  "manufactured",
];

export const CPQ_DOC_SPECS: ContractorDocSpec[] = [
  { key: "cslb_license", requirement: "core", expires: true, multiple: false, sensitive: false },
  { key: "license_bond", requirement: "core", expires: true, multiple: false, sensitive: false },
  { key: "articles_sos", requirement: "approval", expires: false, multiple: true, sensitive: false },
  { key: "business_license", requirement: "approval", expires: true, multiple: true, sensitive: false },
  { key: "w9", requirement: "core", expires: false, multiple: false, sensitive: true },
  { key: "coi_general_liability", requirement: "core", expires: true, multiple: false, sensitive: false },
  { key: "workers_comp", requirement: "core", expires: true, multiple: false, sensitive: false },
  { key: "coi_auto", requirement: "approval", expires: true, multiple: false, sensitive: false },
  { key: "coi_umbrella", requirement: "approval", expires: true, multiple: false, sensitive: false },
  { key: "company_profile", requirement: "approval", expires: false, multiple: false, sensitive: false },
  { key: "portfolio", requirement: "approval", expires: false, multiple: true, sensitive: false },
  { key: "final_inspections", requirement: "approval", expires: false, multiple: true, sensitive: false },
  { key: "financial_statements", requirement: "approval", expires: false, multiple: true, sensitive: true },
  { key: "bank_reference", requirement: "approval", expires: false, multiple: false, sensitive: true },
  { key: "surety_letter", requirement: "approval", expires: false, multiple: false, sensitive: true },
  { key: "iipp", requirement: "approval", expires: false, multiple: false, sensitive: false },
  { key: "emr_osha", requirement: "approval", expires: false, multiple: true, sensitive: false },
  { key: "epa_rrp", requirement: "approval", expires: true, multiple: false, sensitive: false },
  { key: "dir_registration", requirement: "approval", expires: true, multiple: false, sensitive: false },
  { key: "sample_contract", requirement: "approval", expires: false, multiple: false, sensitive: false },
  { key: "warranty_policy", requirement: "approval", expires: false, multiple: false, sensitive: false },
  {
    key: "background_check_authorization",
    requirement: "core",
    expires: false,
    multiple: false,
    sensitive: true,
    template: "background_check_authorization",
  },
  {
    key: "master_contractor_agreement",
    requirement: "core",
    expires: false,
    multiple: false,
    sensitive: false,
    template: "master_contractor_agreement",
  },
];
const CPQ_DOC_SPEC_BY_KEY = new Map(CPQ_DOC_SPECS.map((s) => [s.key, s]));

const cpqPolicy = (): InsurancePolicy => ({
  carrier: "",
  policy_number: "",
  limits: "",
  expires_on: "",
});

export function cpqEmptyData(): ContractorApplicationData {
  return {
    company: {
      legal_name: "",
      dba: "",
      address: "",
      city: "",
      state: "CA",
      zip: "",
      contact_name: "",
      contact_title: "",
      phone: "",
      email: "",
      website: "",
      year_established: "",
      entity_type: "",
      ein: "",
      sos_entity_number: "",
      employee_count: "",
      service_area: "",
    },
    licensing: {
      cslb_license_number: "",
      classifications: "",
      license_expires_on: "",
      qualifier_name: "",
      qualifier_title: "",
      qualifier_status: "",
      bond_company: "",
      bond_number: "",
      bond_amount: "",
      business_license_numbers: "",
      dir_registration_number: "",
      license_disciplined: "",
      epa_rrp_certified: "",
    },
    insurance: {
      general_liability: cpqPolicy(),
      workers_comp: cpqPolicy(),
      commercial_auto: cpqPolicy(),
      umbrella: cpqPolicy(),
      wc_exempt: "",
      builders_risk_available: "",
    },
    experience: {
      years_building_adus: "",
      adus_completed_3yrs: "",
      typical_value_range: "",
      max_concurrent_projects: "",
      project_types: [],
      recent_projects: Array.from({ length: CPQ_ROWS.recent_projects }, () => ({
        address: "",
        type_sqft: "",
        contract_value: "",
        completed_on: "",
      })),
    },
    personnel: Array.from({ length: CPQ_ROWS.personnel }, () => ({
      name: "",
      role: "",
      years_experience: "",
      certifications: "",
    })),
    references: {
      clients: Array.from({ length: CPQ_ROWS.client_references }, () => ({
        name: "",
        project_address: "",
        phone: "",
        email: "",
      })),
      suppliers: Array.from({ length: CPQ_ROWS.supplier_references }, () => ({
        company: "",
        contact_name: "",
        phone: "",
        relationship: "",
      })),
    },
    financial: {
      bank_name: "",
      bank_contact: "",
      bank_phone: "",
      surety_company: "",
      single_bonding_capacity: "",
      aggregate_bonding_capacity: "",
      revenue_recent_year: "",
      revenue_prior_year: "",
    },
    safety: {
      emr: "",
      osha_recordables_3yrs: "",
      safety_officer: "",
      has_iipp: "",
      osha_citations_3yrs: "",
      lawsuits_5yrs: "",
      cslb_complaints_5yrs: "",
      liens_5yrs: "",
      failed_to_complete: "",
      bankruptcy_7yrs: "",
      disclosure_explanation: "",
    },
    warranty: { period: "", terms: "" },
  };
}

const cpqFilled = (v: unknown) => String(v ?? "").trim().length > 0;
const cpqYesNo = (v: unknown) => v === "yes" || v === "no";
const cpqPolicyComplete = (p: InsurancePolicy | undefined) =>
  !!p &&
  cpqFilled(p.carrier) &&
  cpqFilled(p.policy_number) &&
  cpqFilled(p.limits) &&
  cpqFilled(p.expires_on);

/** Mirror of shared contractorApplicationMissingFields. */
export function cpqMissingFields(d: ContractorApplicationData): string[] {
  const out: string[] = [];
  const need = (path: string, ok: boolean) => {
    if (!ok) out.push(path);
  };
  const c = d.company;
  for (const k of [
    "legal_name",
    "address",
    "city",
    "state",
    "zip",
    "contact_name",
    "phone",
    "email",
    "year_established",
    "entity_type",
    "ein",
    "employee_count",
    "service_area",
  ] as const) {
    need(`company.${k}`, cpqFilled(c[k]));
  }
  const l = d.licensing;
  for (const k of [
    "cslb_license_number",
    "classifications",
    "license_expires_on",
    "qualifier_name",
    "qualifier_status",
    "bond_company",
    "bond_number",
    "bond_amount",
  ] as const) {
    need(`licensing.${k}`, cpqFilled(l[k]));
  }
  need("licensing.license_disciplined", cpqYesNo(l.license_disciplined));
  need("licensing.epa_rrp_certified", cpqYesNo(l.epa_rrp_certified));

  const ins = d.insurance;
  need("insurance.wc_exempt", cpqYesNo(ins.wc_exempt));
  need("insurance.builders_risk_available", cpqYesNo(ins.builders_risk_available));
  need("insurance.general_liability", cpqPolicyComplete(ins.general_liability));
  if (ins.wc_exempt !== "yes") {
    need("insurance.workers_comp", cpqPolicyComplete(ins.workers_comp));
  }
  need("insurance.commercial_auto", cpqPolicyComplete(ins.commercial_auto));
  if (cpqFilled(ins.umbrella?.carrier)) {
    need("insurance.umbrella", cpqPolicyComplete(ins.umbrella));
  }

  const e = d.experience;
  for (const k of [
    "years_building_adus",
    "adus_completed_3yrs",
    "typical_value_range",
    "max_concurrent_projects",
  ] as const) {
    need(`experience.${k}`, cpqFilled(e[k]));
  }
  need("experience.project_types", (e.project_types || []).length > 0);
  need(
    "experience.recent_projects",
    (e.recent_projects || []).some(
      (p) =>
        cpqFilled(p.address) &&
        cpqFilled(p.type_sqft) &&
        cpqFilled(p.contract_value) &&
        cpqFilled(p.completed_on),
    ),
  );

  need(
    "personnel",
    (d.personnel || []).some((p) => cpqFilled(p.name) && cpqFilled(p.role)),
  );

  need(
    "references.clients",
    (d.references?.clients || []).filter((r) => cpqFilled(r.name) && cpqFilled(r.phone))
      .length >= CPQ_ROWS.client_references,
  );

  const f = d.financial;
  need("financial.bank_name", cpqFilled(f.bank_name));
  need("financial.bank_phone", cpqFilled(f.bank_phone));
  need("financial.revenue_recent_year", cpqFilled(f.revenue_recent_year));

  const s = d.safety;
  need("safety.has_iipp", cpqYesNo(s.has_iipp));
  for (const k of CPQ_DISCLOSURE_KEYS) need(`safety.${k}`, cpqYesNo(s[k]));
  const anyYes =
    CPQ_DISCLOSURE_KEYS.some((k) => s[k] === "yes") || l.license_disciplined === "yes";
  if (anyYes) need("safety.disclosure_explanation", cpqFilled(s.disclosure_explanation));

  need("warranty.period", cpqFilled(d.warranty.period));
  need("warranty.terms", cpqFilled(d.warranty.terms));
  return out;
}

/** Mirror of shared contractorDocApplicable. */
export function cpqDocApplicable(
  key: ContractorApplicationDocType,
  d: ContractorApplicationData,
): boolean {
  switch (key) {
    case "coi_umbrella":
      return cpqFilled(d.insurance.umbrella?.carrier);
    case "surety_letter":
      return cpqFilled(d.financial.surety_company);
    case "epa_rrp":
      return d.licensing.epa_rrp_certified === "yes";
    case "dir_registration":
      return cpqFilled(d.licensing.dir_registration_number);
    default:
      return true;
  }
}

/** Mirror of shared contractorApplicationRequirements. */
export function cpqRequirements(
  d: ContractorApplicationData,
  templates: ContractorApplicationTemplates,
): ContractorApplicationRequirements {
  return {
    missing_fields: cpqMissingFields(d),
    docs: CPQ_DOC_SPECS.map((spec) => ({
      key: spec.key,
      requirement:
        spec.template && !templates[spec.template] ? "approval" : spec.requirement,
      applicable: cpqDocApplicable(spec.key, d),
    })),
  };
}

// ── Draft normalization (whitelist + length caps; unknown keys dropped) ──────

const CPQ_TEXT_LIMITS: Record<string, number> = {
  disclosure_explanation: 4000,
  terms: 4000,
  service_area: 1000,
  address: 300,
  project_address: 300,
  classifications: 300,
  business_license_numbers: 300,
  certifications: 300,
  email: 255,
  website: 255,
};
const CPQ_YES_NO_KEYS = new Set<string>([
  "license_disciplined",
  "epa_rrp_certified",
  "wc_exempt",
  "builders_risk_available",
  "has_iipp",
  ...CPQ_DISCLOSURE_KEYS,
]);
const CPQ_DATE_KEYS = new Set(["expires_on", "license_expires_on", "completed_on"]);
const CPQ_ENUM_KEYS: Record<string, readonly string[]> = {
  entity_type: ["corporation", "llc", "partnership", "sole_proprietor"],
  qualifier_status: ["active", "inactive"],
};

export function isIsoDateOnly(v: unknown): v is string {
  const s = String(v ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function cpqScalar(key: string, raw: unknown, fallback: string): string {
  if (raw === undefined) return fallback;
  if (raw === null) return "";
  if (typeof raw !== "string" && typeof raw !== "number") return fallback;
  const s = String(raw).trim();
  if (CPQ_YES_NO_KEYS.has(key)) return s === "yes" || s === "no" ? s : "";
  if (CPQ_DATE_KEYS.has(key)) return isIsoDateOnly(s) ? s : "";
  const allowed = CPQ_ENUM_KEYS[key];
  if (allowed) return allowed.includes(s) ? s : "";
  return s.slice(0, CPQ_TEXT_LIMITS[key] ?? 200);
}

function cpqMerge(template: unknown, raw: unknown, base: unknown): unknown {
  if (Array.isArray(template)) {
    return template.map((item, i) =>
      cpqMerge(
        item,
        Array.isArray(raw) ? raw[i] : undefined,
        Array.isArray(base) ? base[i] : undefined,
      ),
    );
  }
  const tpl = template as Record<string, unknown>;
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const b = base && typeof base === "object" ? (base as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const [k, tv] of Object.entries(tpl)) {
    if (k === "project_types") {
      const src = Array.isArray(r[k]) ? r[k] : Array.isArray(b[k]) ? b[k] : [];
      out[k] = CPQ_ADU_PROJECT_TYPES.filter((t) => (src as unknown[]).includes(t));
    } else if (typeof tv === "string") {
      out[k] = cpqScalar(k, r[k], typeof b[k] === "string" ? (b[k] as string) : tv);
    } else {
      out[k] = cpqMerge(tv, r[k], b[k]);
    }
  }
  return out;
}

/** Whitelist `raw` onto `base` (existing draft) with type + length checks. */
export function normalizeCpqData(raw: unknown, base?: unknown): ContractorApplicationData {
  return cpqMerge(cpqEmptyData(), raw, base) as ContractorApplicationData;
}

/** DATE column (pool timezone Z) → `YYYY-MM-DD`. */
const cpqDateOnly = (v: unknown) => isoDate(v)?.slice(0, 10) ?? null;

function parseCpqData(v: unknown): ContractorApplicationData {
  let raw: unknown = v;
  if (typeof v === "string") {
    try {
      raw = JSON.parse(v);
    } catch {
      raw = null;
    }
  }
  return normalizeCpqData(raw ?? {});
}

function parseCpqDocTypes(v: unknown): ContractorApplicationDocType[] {
  let raw: unknown = v;
  if (typeof v === "string") {
    try {
      raw = JSON.parse(v);
    } catch {
      raw = [];
    }
  }
  return Array.isArray(raw)
    ? (raw.filter((k) => CPQ_DOC_SPEC_BY_KEY.has(k)) as ContractorApplicationDocType[])
    : [];
}

/** Pull promoted search/alert columns out of the draft. */
function cpqPromotedColumns(d: ContractorApplicationData) {
  return {
    legal_business_name: d.company.legal_name.slice(0, 200) || null,
    cslb_license_number: d.licensing.cslb_license_number.slice(0, 40) || null,
    cslb_license_expires_on: isIsoDateOnly(d.licensing.license_expires_on)
      ? d.licensing.license_expires_on
      : null,
  };
}

function cpqCanUploadDoc(
  status: ContractorApplicationStatus,
  spec: ContractorDocSpec,
): boolean {
  if (status === "denied") return false;
  // After approval only renewals of expiring documents are accepted.
  if (status === "approved") return spec.expires;
  return true;
}

/** Applicable docs with no live (non-rejected) upload, by requirement level. */
function cpqOutstandingDocs(
  reqs: ContractorApplicationRequirements,
  docs: ReadonlyArray<Record<string, any>>,
  level: "core" | "all",
): ContractorApplicationDocType[] {
  const have = new Set(
    docs.filter((d) => d.status !== "rejected").map((d) => String(d.doc_type)),
  );
  return reqs.docs
    .filter((r) => r.applicable && (level === "all" || r.requirement === "core"))
    .filter((r) => !have.has(r.key))
    .map((r) => r.key);
}

async function cpqTemplates(): Promise<ContractorApplicationTemplates> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (?, ?)`,
    [CPQ_TEMPLATE_KEYS.master_contractor_agreement, CPQ_TEMPLATE_KEYS.background_check_authorization],
  );
  const byKey = new Map(rows.map((r) => [String(r.setting_key), r.setting_value]));
  const pick = (k: string) => {
    const v = String(byKey.get(k) ?? "").trim();
    return /^https:\/\//i.test(v) ? v : null;
  };
  return {
    master_contractor_agreement: pick(CPQ_TEMPLATE_KEYS.master_contractor_agreement),
    background_check_authorization: pick(CPQ_TEMPLATE_KEYS.background_check_authorization),
  };
}

function cpqPrivateBlobToken(): string {
  const token = String(process.env.BLOB_PRIVATE_READ_WRITE_TOKEN || "").trim();
  if (!token) throw new HttpError(503, "errors.storageNotConfigured");
  return token;
}

/** Sniff PDF / image magic bytes (never trust the declared Content-Type alone). */
export function detectCpqDocType(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") {
    return { mime: "application/pdf", ext: "pdf" };
  }
  return detectImageType(buf);
}

async function readPrivateBlobHead(pathname: string, bytes = 16): Promise<Buffer | null> {
  const got = await getBlob(pathname, {
    access: "private",
    token: cpqPrivateBlobToken(),
    useCache: false,
  });
  if (!got || got.statusCode !== 200 || !got.stream) return null;
  const reader = got.stream.getReader();
  const chunks: Buffer[] = [];
  let len = 0;
  try {
    while (len < bytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(Buffer.from(value));
      len += value.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).subarray(0, bytes);
}

/** 302 to a 5-minute presigned GET of a private blob (avoids the 4.5MB function response cap). */
async function redirectToPrivateBlob(res: Response, pathname: string) {
  const token = cpqPrivateBlobToken();
  const validUntil = Date.now() + 5 * 60 * 1000;
  try {
    const signed = await issueBlobSignedToken({
      token,
      pathname,
      operations: ["get"],
      validUntil,
    });
    const { presignedUrl } = await presignBlobUrl(signed, {
      operation: "get",
      pathname,
      access: "private",
      validUntil,
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    return res.redirect(302, presignedUrl);
  } catch (e: any) {
    console.error("[cpq] presign failed:", e?.message ?? e);
    throw new HttpError(502, "errors.storageFailed");
  }
}

async function deletePrivateBlobs(pathnames: string[]) {
  if (!pathnames.length) return;
  try {
    await delBlob(pathnames, { token: cpqPrivateBlobToken() });
  } catch (e: any) {
    // Orphaned private blobs are unreachable without a presign; log and move on.
    console.error("[cpq] blob delete failed:", e?.message ?? e);
  }
}

function cpqApplyUrl(token: string) {
  return `${APP_URL}/contractor/apply/${token}`;
}

async function cpqLogEvent(
  conn: Pool | PoolConnection,
  applicationId: number,
  kind: string,
  actor: { type: "admin" | "contractor" | "system"; adminId?: number | null },
  note?: string | null,
  meta?: Record<string, unknown> | null,
) {
  await conn.execute(
    `INSERT INTO contractor_application_events
       (application_id, kind, actor_type, admin_id, note, meta_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      applicationId,
      kind.slice(0, 40),
      actor.type,
      actor.adminId ?? null,
      note ? String(note).slice(0, 1000) : null,
      meta ? JSON.stringify(meta) : null,
    ],
  );
}

type CpqAppRow = {
  id: number;
  application_number: string;
  status: ContractorApplicationStatus;
  created: boolean;
};

/** Find or create the contractor's (single) application, prefilled from the contractor row. */
async function cpqEnsureApplication(
  conn: Pool | PoolConnection,
  contractorId: number,
  opts: { adminId?: number | null; dueAt?: Date | null } = {},
): Promise<CpqAppRow> {
  const [ex] = await conn.execute<RowDataPacket[]>(
    `SELECT id, application_number, status, due_at FROM contractor_applications
     WHERE contractor_id = ? LIMIT 1`,
    [contractorId],
  );
  if (ex[0]) {
    if (opts.dueAt && !ex[0].due_at && CPQ_EDITABLE.includes(ex[0].status)) {
      await conn.execute(`UPDATE contractor_applications SET due_at = ? WHERE id = ?`, [
        opts.dueAt,
        ex[0].id,
      ]);
    }
    return {
      id: Number(ex[0].id),
      application_number: String(ex[0].application_number),
      status: ex[0].status as ContractorApplicationStatus,
      created: false,
    };
  }
  const [kRows] = await conn.execute<RowDataPacket[]>(
    `SELECT email, first_name, last_name, phone, company, license_number
     FROM contractors WHERE id = ? LIMIT 1`,
    [contractorId],
  );
  const k = kRows[0];
  if (!k) throw new HttpError(404, "errors.notFound");
  const data = normalizeCpqData({
    company: {
      legal_name: k.company || "",
      contact_name: `${k.first_name || ""} ${k.last_name || ""}`.trim(),
      phone: k.phone || "",
      email: k.email || "",
    },
    licensing: { cslb_license_number: k.license_number || "" },
  });
  const year = new Date().getUTCFullYear();
  for (let attempt = 0; attempt < 4; attempt++) {
    const number = `CPQ-${year}-${randomCode(6)}`;
    try {
      const [r] = await conn.execute<ResultSetHeader>(
        `INSERT INTO contractor_applications
           (contractor_id, application_number, status, data_json, legal_business_name,
            cslb_license_number, due_at, created_by_admin_id)
         VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)`,
        [
          contractorId,
          number,
          JSON.stringify(data),
          cpqPromotedColumns(data).legal_business_name,
          cpqPromotedColumns(data).cslb_license_number,
          opts.dueAt ?? null,
          opts.adminId ?? null,
        ],
      );
      const id = Number(r.insertId);
      await cpqLogEvent(
        conn,
        id,
        "created",
        opts.adminId ? { type: "admin", adminId: opts.adminId } : { type: "system" },
      );
      return { id, application_number: number, status: "draft", created: true };
    } catch (e: any) {
      if (!isMysqlDupEntry(e)) throw e;
      // Lost a race on the contractor (unique) — return the winner's row.
      const [again] = await conn.execute<RowDataPacket[]>(
        `SELECT id, application_number, status FROM contractor_applications
         WHERE contractor_id = ? LIMIT 1`,
        [contractorId],
      );
      if (again[0]) {
        return {
          id: Number(again[0].id),
          application_number: String(again[0].application_number),
          status: again[0].status as ContractorApplicationStatus,
          created: false,
        };
      }
      // Otherwise it was an application_number collision — retry with a new code.
    }
  }
  throw new HttpError(500, "errors.server");
}

async function cpqMintToken(conn: Pool | PoolConnection, applicationId: number): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  await conn.execute(
    `DELETE FROM contractor_application_tokens WHERE application_id = ? AND expires_at < NOW()`,
    [applicationId],
  );
  await conn.execute(
    `INSERT INTO contractor_application_tokens (application_id, token_hash, expires_at)
     VALUES (?, ?, ?)`,
    [applicationId, sha256(token), new Date(Date.now() + CPQ_TOKEN_TTL_MS)],
  );
  return token;
}

type CpqEmailVariant =
  | "new"
  | "existing"
  | "reminder"
  | "info_request"
  | "resend"
  | "missing_docs"
  | "expiring";

function cpqDocLabel(lang: Lang, key: string): string {
  const l = CPQ_DOC_LABELS[key as ContractorApplicationDocType];
  return l ? l[lang === "es" ? 1 : 0] : key;
}

async function sendCpqLinkEmail(opts: {
  to: string;
  first: string;
  lang: Lang;
  token: string;
  number: string;
  variant: CpqEmailVariant;
  dueAt?: Date | string | null;
  note?: string | null;
  docTypes?: string[];
  expiring?: Array<{ doc_type: string; expires_on: string }>;
}) {
  const { lang, first } = opts;
  const due = opts.dueAt
    ? new Date(opts.dueAt).toLocaleDateString(lang === "es" ? "es-US" : "en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "America/Los_Angeles",
      })
    : null;
  const docsLine = (opts.docTypes || []).map((k) => `• ${cpqDocLabel(lang, k)}`).join("\n");
  const copy: Record<CpqEmailVariant, { subject: string; headline: string; paragraphs: string[]; cta: string }> = {
    new: {
      subject: tr(lang, "Complete your Groundwork contractor prequalification", "Completa tu precalificación de contratista Groundwork"),
      headline: tr(lang, "Let's get you prequalified.", "Vamos a precalificarte."),
      paragraphs: [
        tr(lang, `Hi ${first}, thanks for your interest in building ADUs with Groundwork Capital. Every contractor on our team completes a short online prequalification: company, licensing, insurance, experience and supporting documents.`, `Hola ${first}, gracias por tu interés en construir ADUs con Groundwork Capital. Todo contratista de nuestro equipo completa una precalificación en línea: empresa, licencias, seguros, experiencia y documentos de respaldo.`),
        tr(lang, "Save and come back anytime — this secure link works for 30 days. Have your CSLB license, bond, W-9 and certificates of insurance handy.", "Guarda y regresa cuando quieras — este enlace seguro funciona por 30 días. Ten a la mano tu licencia CSLB, fianza, W-9 y certificados de seguro."),
      ],
      cta: tr(lang, "Start application", "Iniciar solicitud"),
    },
    existing: {
      subject: tr(lang, "Action needed: Groundwork contractor prequalification", "Acción requerida: precalificación de contratista Groundwork"),
      headline: tr(lang, "Please update your prequalification.", "Actualiza tu precalificación."),
      paragraphs: [
        tr(lang, `Hi ${first}, we're asking every contractor on the Groundwork team to complete our prequalification application${due ? ` by ${due}` : ""}. Your portal access is not affected while you complete it.`, `Hola ${first}, estamos pidiendo a todos los contratistas del equipo Groundwork que completen la solicitud de precalificación${due ? ` antes del ${due}` : ""}. Tu acceso al portal no se ve afectado mientras la completas.`),
        tr(lang, "Save and come back anytime — this secure link works for 30 days.", "Guarda y regresa cuando quieras — este enlace seguro funciona por 30 días."),
      ],
      cta: tr(lang, "Open application", "Abrir solicitud"),
    },
    reminder: {
      subject: tr(lang, "Reminder: finish your Groundwork prequalification", "Recordatorio: termina tu precalificación Groundwork"),
      headline: tr(lang, "You're almost there.", "Ya casi terminas."),
      paragraphs: [
        tr(lang, `Hi ${first}, your prequalification application is still in progress${due ? ` and due ${due}` : ""}. Pick up right where you left off.`, `Hola ${first}, tu solicitud de precalificación sigue en progreso${due ? ` y vence el ${due}` : ""}. Continúa donde la dejaste.`),
      ],
      cta: tr(lang, "Continue application", "Continuar solicitud"),
    },
    info_request: {
      subject: tr(lang, "We need a few more items — Groundwork prequalification", "Necesitamos algunos datos más — precalificación Groundwork"),
      headline: tr(lang, "A few more items, please.", "Unos datos más, por favor."),
      paragraphs: [
        tr(lang, `Hi ${first}, our team reviewed your application and needs the following before we can finish:`, `Hola ${first}, nuestro equipo revisó tu solicitud y necesita lo siguiente para terminar:`),
        ...(opts.note ? [opts.note] : []),
        ...(docsLine ? [docsLine] : []),
      ],
      cta: tr(lang, "Update application", "Actualizar solicitud"),
    },
    resend: {
      subject: tr(lang, "Your Groundwork prequalification link", "Tu enlace de precalificación Groundwork"),
      headline: tr(lang, "Here's your secure link.", "Aquí está tu enlace seguro."),
      paragraphs: [
        tr(lang, `Hi ${first}, here's a fresh link to your prequalification application. It works for 30 days.`, `Hola ${first}, aquí tienes un enlace nuevo a tu solicitud de precalificación. Funciona por 30 días.`),
      ],
      cta: tr(lang, "Open application", "Abrir solicitud"),
    },
    missing_docs: {
      subject: tr(lang, "Documents still needed — Groundwork prequalification", "Documentos pendientes — precalificación Groundwork"),
      headline: tr(lang, "Thanks for applying — a few documents are still missing.", "Gracias por aplicar — faltan algunos documentos."),
      paragraphs: [
        tr(lang, `Hi ${first}, we received your application. Please upload the remaining documents so we can complete the review:`, `Hola ${first}, recibimos tu solicitud. Sube los documentos restantes para completar la revisión:`),
        ...(docsLine ? [docsLine] : []),
      ],
      cta: tr(lang, "Upload documents", "Subir documentos"),
    },
    expiring: {
      subject: tr(lang, "Your insurance or license documents are expiring", "Tus documentos de seguro o licencia están por vencer"),
      headline: tr(lang, "Keep your compliance current.", "Mantén tu cumplimiento al día."),
      paragraphs: [
        tr(lang, `Hi ${first}, the following documents on file with Groundwork are expiring. Please upload the renewal — our agreement requires notice within 10 days of any change.`, `Hola ${first}, los siguientes documentos registrados con Groundwork están por vencer. Sube la renovación — nuestro acuerdo requiere aviso dentro de 10 días de cualquier cambio.`),
        (opts.expiring || [])
          .map((x) => `• ${cpqDocLabel(lang, x.doc_type)} — ${x.expires_on}`)
          .join("\n"),
      ].filter(Boolean),
      cta: tr(lang, "Upload renewal", "Subir renovación"),
    },
  };
  const c = copy[opts.variant];
  await safeSend(
    opts.to,
    tplPortalNotice({
      lang,
      subject: c.subject,
      headline: c.headline,
      paragraphs: c.paragraphs,
      details: [
        [tr(lang, "Application #", "Solicitud #"), opts.number],
        ...(due ? ([[tr(lang, "Due", "Vence"), due]] as Array<[string, string]>) : []),
      ],
      cta: { url: cpqApplyUrl(opts.token), label: c.cta },
    }),
  );
}

/**
 * Create (if needed) + mint a link + email it. `existing` contractors (already
 * active) get a soft 30-day deadline; portal access is never revoked by it.
 */
async function sendContractorApplicationLink(opts: {
  contractorId: number;
  adminId?: number | null;
  variant?: CpqEmailVariant;
  note?: string | null;
  docTypes?: string[];
}): Promise<{ applicationId: number; applicationNumber: string; status: ContractorApplicationStatus }> {
  const [kRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, email, first_name, status, preferred_language FROM contractors WHERE id = ? LIMIT 1`,
    [opts.contractorId],
  );
  const k = kRows[0];
  if (!k) throw new HttpError(404, "errors.notFound");
  const isExisting = String(k.status) === "active";
  const dueAt = isExisting
    ? new Date(Date.now() + CPQ_EXISTING_DUE_DAYS * 24 * 60 * 60 * 1000)
    : null;
  const { app, token, dueRow } = await withTx(async (conn) => {
    const app = await cpqEnsureApplication(conn, opts.contractorId, {
      adminId: opts.adminId,
      dueAt,
    });
    const token = await cpqMintToken(conn, app.id);
    await conn.execute(
      `UPDATE contractor_applications SET sent_at = COALESCE(sent_at, NOW()) WHERE id = ?`,
      [app.id],
    );
    const [d] = await conn.execute<RowDataPacket[]>(
      `SELECT due_at FROM contractor_applications WHERE id = ? LIMIT 1`,
      [app.id],
    );
    await cpqLogEvent(
      conn,
      app.id,
      "link_sent",
      opts.adminId ? { type: "admin", adminId: opts.adminId } : { type: "system" },
      null,
      { variant: opts.variant || (isExisting ? "existing" : "new") },
    );
    return { app, token, dueRow: d[0]?.due_at ?? null };
  });
  const variant: CpqEmailVariant = opts.variant ?? (isExisting ? "existing" : "new");
  await sendCpqLinkEmail({
    to: String(k.email),
    first: String(k.first_name || ""),
    lang: asLang(k.preferred_language),
    token,
    number: app.application_number,
    variant,
    dueAt: dueRow,
    note: opts.note,
    docTypes: opts.docTypes,
  });
  return { applicationId: app.id, applicationNumber: app.application_number, status: app.status };
}

/** "Welcome to the crew" email shared by staff approve, application approve and MCP. */
async function sendContractorApprovedEmail(c: {
  email: string;
  first_name: string;
  preferred_language: unknown;
}) {
  const lang = asLang(c.preferred_language);
  await safeSend(
    String(c.email),
    tplPortalNotice({
      lang,
      subject: tr(
        lang,
        "You're approved — Groundwork contractor portal",
        "Estás aprobado — portal de contratistas Groundwork",
      ),
      headline: tr(lang, "Welcome to the crew.", "Bienvenido al equipo."),
      paragraphs: [
        tr(
          lang,
          `Hi ${c.first_name}, your contractor account is active.`,
          `Hola ${c.first_name}, tu cuenta de contratista está activa.`,
        ),
        tr(
          lang,
          "Sign in with a one-time code to manage projects, photos, and draws.",
          "Entra con un código de un solo uso para gestionar proyectos, fotos y desembolsos.",
        ),
      ],
      cta: {
        url: `${APP_URL}/contractor/login`,
        label: tr(lang, "Open contractor portal", "Abrir portal de contratistas"),
      },
    }),
  );
}

/**
 * Gate pending → active: the prequalification must be approved, unless a
 * super_admin records an override reason (logged on the application).
 */
async function assertContractorActivationAllowed(
  contractorId: number | null,
  user: PortalAuthUser,
  overrideReason: unknown,
): Promise<{ override: string | null }> {
  if (contractorId) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT status FROM contractor_applications WHERE contractor_id = ? LIMIT 1`,
      [contractorId],
    );
    if (rows[0]?.status === "approved") return { override: null };
  }
  const reason = String(overrideReason ?? "").trim().slice(0, 500);
  if (user.role === "super_admin") {
    if (reason.length >= 5) return { override: reason };
    throw new HttpError(409, "errors.contractorOverrideReasonRequired");
  }
  throw new HttpError(409, "errors.contractorApplicationRequired");
}

async function recordContractorActivationOverride(
  contractorId: number,
  adminId: number,
  reason: string,
) {
  const app = await cpqEnsureApplication(pool, contractorId, { adminId });
  await cpqLogEvent(pool, app.id, "activation_override", { type: "admin", adminId }, reason);
}

// ── PDF snapshot ─────────────────────────────────────────────────────────────

const CPQ_DOC_LABELS: Record<ContractorApplicationDocType, [string, string]> = {
  cslb_license: ["CSLB Contractor License (Class B or C-47)", "Licencia de contratista CSLB (Clase B o C-47)"],
  license_bond: ["Contractor's License Bond ($25,000 min.)", "Fianza de licencia de contratista ($25,000 mín.)"],
  articles_sos: ["Articles of Incorporation / Organization & SOS Statement of Info", "Acta constitutiva / organización y declaración SOS"],
  business_license: ["City / County Business License", "Licencia comercial de ciudad / condado"],
  w9: ["W-9 Form", "Formulario W-9"],
  coi_general_liability: ["COI - General Liability (Additional Insured endorsement)", "COI - Responsabilidad general (asegurado adicional)"],
  workers_comp: ["Workers' Comp Certificate or CSLB Exemption", "Certificado de compensación laboral o exención CSLB"],
  coi_auto: ["COI - Commercial Auto", "COI - Auto comercial"],
  coi_umbrella: ["COI - Umbrella / Excess Liability", "COI - Paraguas / responsabilidad excedente"],
  company_profile: ["Company Profile / Resume", "Perfil de la empresa / currículum"],
  portfolio: ["ADU Project Portfolio (photos & details)", "Portafolio de proyectos ADU (fotos y detalles)"],
  final_inspections: ["Final Inspection Sign-offs / Certificates of Occupancy", "Inspecciones finales / certificados de ocupación"],
  financial_statements: ["Financial Statements (last 2 years)", "Estados financieros (últimos 2 años)"],
  bank_reference: ["Bank Reference Letter", "Carta de referencia bancaria"],
  surety_letter: ["Surety Bonding Capacity Letter", "Carta de capacidad de fianza"],
  iipp: ["Injury & Illness Prevention Program (IIPP)", "Programa de prevención de lesiones y enfermedades (IIPP)"],
  emr_osha: ["EMR Letter / Cal/OSHA 300A Logs", "Carta EMR / registros Cal/OSHA 300A"],
  epa_rrp: ["EPA RRP Lead-Safe Certificate", "Certificado EPA RRP de plomo seguro"],
  dir_registration: ["DIR Registration", "Registro DIR"],
  sample_contract: ["Sample Home Improvement Contract", "Contrato modelo de mejoras al hogar"],
  warranty_policy: ["Written Warranty Policy", "Política de garantía por escrito"],
  background_check_authorization: ["Signed Background Check Authorization", "Autorización firmada de verificación de antecedentes"],
  master_contractor_agreement: ["Signed Master Contractor Agreement", "Acuerdo maestro de contratista firmado"],
};

const CPQ_PDF_COPY = {
  en: {
    title: "ADU Contractor Prequalification Application",
    sub: "Accessory Dwelling Unit Construction | State of California",
    hiring: "Hiring company",
    number: "Application #",
    status: "Status",
    received: "Date received",
    sections: {
      company: "1. Company information",
      licensing: "2. Licensing & bonding",
      insurance: "3. Insurance coverage",
      experience: "4. ADU experience",
      personnel: "5. Key personnel",
      references: "6. References",
      financial: "7. Financial information",
      safety: "8. Safety, compliance & disclosures",
      warranty: "9. Warranty",
      documents: "10. Required documents",
      certification: "11. Authorization & certification",
      office: "For office use only",
    },
    redacted: "Restricted — visible to finance-authorized staff only.",
    yes: "Yes",
    no: "No",
    attached: "Attached",
    missing: "Missing",
    na: "N/A",
    signedBy: "Electronically signed by",
    signedAt: "Signed at",
    ip: "IP address",
    version: "Certification version",
    reviewedBy: "Reviewed by",
    reviewDate: "Review date",
    licenseVerified: "License verified",
    insuranceVerified: "Insurance verified",
    decision: "Decision",
    notes: "Notes",
    page: "Page",
    of: "of",
  },
  es: {
    title: "Solicitud de precalificación de contratista ADU",
    sub: "Construcción de unidades de vivienda accesoria | Estado de California",
    hiring: "Empresa contratante",
    number: "Solicitud #",
    status: "Estado",
    received: "Fecha de recepción",
    sections: {
      company: "1. Información de la empresa",
      licensing: "2. Licencias y fianzas",
      insurance: "3. Cobertura de seguros",
      experience: "4. Experiencia en ADU",
      personnel: "5. Personal clave",
      references: "6. Referencias",
      financial: "7. Información financiera",
      safety: "8. Seguridad, cumplimiento y divulgaciones",
      warranty: "9. Garantía",
      documents: "10. Documentos requeridos",
      certification: "11. Autorización y certificación",
      office: "Solo para uso de oficina",
    },
    redacted: "Restringido — visible solo para personal autorizado de finanzas.",
    yes: "Sí",
    no: "No",
    attached: "Adjunto",
    missing: "Faltante",
    na: "N/A",
    signedBy: "Firmado electrónicamente por",
    signedAt: "Firmado el",
    ip: "Dirección IP",
    version: "Versión de certificación",
    reviewedBy: "Revisado por",
    reviewDate: "Fecha de revisión",
    licenseVerified: "Licencia verificada",
    insuranceVerified: "Seguro verificado",
    decision: "Decisión",
    notes: "Notas",
    page: "Página",
    of: "de",
  },
} as const;

/** [en, es] labels for every data field rendered on the PDF. */
const CPQ_FIELD_LABELS: Record<string, [string, string]> = {
  "company.legal_name": ["Legal business name", "Razón social"],
  "company.dba": ["DBA", "Nombre comercial (DBA)"],
  "company.address": ["Business address", "Dirección comercial"],
  "company.city": ["City", "Ciudad"],
  "company.state": ["State", "Estado"],
  "company.zip": ["ZIP", "Código postal"],
  "company.contact_name": ["Primary contact", "Contacto principal"],
  "company.contact_title": ["Title", "Cargo"],
  "company.phone": ["Phone", "Teléfono"],
  "company.email": ["Email", "Correo"],
  "company.website": ["Website", "Sitio web"],
  "company.year_established": ["Year established", "Año de fundación"],
  "company.entity_type": ["Entity type", "Tipo de entidad"],
  "company.ein": ["Federal EIN / Tax ID", "EIN federal / ID fiscal"],
  "company.sos_entity_number": ["CA SOS entity #", "# de entidad CA SOS"],
  "company.employee_count": ["Number of employees", "Número de empleados"],
  "company.service_area": ["Service area", "Área de servicio"],
  "licensing.cslb_license_number": ["CSLB license #", "# de licencia CSLB"],
  "licensing.classifications": ["Classification(s)", "Clasificación(es)"],
  "licensing.license_expires_on": ["License expiration", "Vencimiento de licencia"],
  "licensing.qualifier_name": ["Qualifier (RMO / RME)", "Calificador (RMO / RME)"],
  "licensing.qualifier_title": ["Qualifier title", "Cargo del calificador"],
  "licensing.qualifier_status": ["Qualifier status", "Estado del calificador"],
  "licensing.bond_company": ["License bond company", "Compañía de fianza"],
  "licensing.bond_number": ["Bond number", "Número de fianza"],
  "licensing.bond_amount": ["Bond amount", "Monto de fianza"],
  "licensing.business_license_numbers": ["City / county business license #(s)", "# de licencia comercial"],
  "licensing.dir_registration_number": ["DIR registration #", "# de registro DIR"],
  "licensing.license_disciplined": ["License ever suspended / revoked / disciplined?", "¿Licencia suspendida / revocada / sancionada?"],
  "licensing.epa_rrp_certified": ["EPA RRP Lead-Safe certified?", "¿Certificado EPA RRP de plomo?"],
  "insurance.general_liability": ["General liability", "Responsabilidad general"],
  "insurance.workers_comp": ["Workers' compensation", "Compensación laboral"],
  "insurance.commercial_auto": ["Commercial auto", "Auto comercial"],
  "insurance.umbrella": ["Umbrella / excess", "Paraguas / excedente"],
  "insurance.wc_exempt": ["Exempt from workers' comp?", "¿Exento de compensación laboral?"],
  "insurance.builders_risk_available": ["Builder's risk per project?", "¿Seguro de riesgo de construcción por proyecto?"],
  "experience.years_building_adus": ["Years building ADUs", "Años construyendo ADUs"],
  "experience.adus_completed_3yrs": ["ADUs completed (last 3 yrs)", "ADUs terminados (últimos 3 años)"],
  "experience.typical_value_range": ["Typical project value range", "Rango típico de valor"],
  "experience.max_concurrent_projects": ["Max. concurrent projects", "Máx. proyectos simultáneos"],
  "experience.project_types": ["Project types", "Tipos de proyecto"],
  "experience.recent_projects": ["Recent ADU projects", "Proyectos ADU recientes"],
  personnel: ["Key personnel", "Personal clave"],
  "references.clients": ["Client references", "Referencias de clientes"],
  "references.suppliers": ["Supplier / subcontractor references", "Referencias de proveedores / subcontratistas"],
  "financial.bank_name": ["Bank name", "Banco"],
  "financial.bank_contact": ["Bank contact", "Contacto bancario"],
  "financial.bank_phone": ["Bank phone", "Teléfono del banco"],
  "financial.surety_company": ["Surety company", "Compañía afianzadora"],
  "financial.single_bonding_capacity": ["Single project bonding capacity", "Capacidad de fianza por proyecto"],
  "financial.aggregate_bonding_capacity": ["Aggregate bonding capacity", "Capacidad de fianza total"],
  "financial.revenue_recent_year": ["Annual revenue (most recent year)", "Ingresos anuales (año más reciente)"],
  "financial.revenue_prior_year": ["Annual revenue (prior year)", "Ingresos anuales (año anterior)"],
  "safety.emr": ["Experience Modification Rate (EMR)", "Tasa de modificación de experiencia (EMR)"],
  "safety.osha_recordables_3yrs": ["Cal/OSHA recordable incidents (3 yrs)", "Incidentes registrables Cal/OSHA (3 años)"],
  "safety.safety_officer": ["Safety officer", "Oficial de seguridad"],
  "safety.has_iipp": ["Written IIPP?", "¿IIPP por escrito?"],
  "safety.osha_citations_3yrs": ["Cal/OSHA citations (3 yrs)?", "¿Citaciones Cal/OSHA (3 años)?"],
  "safety.lawsuits_5yrs": ["Lawsuits / arbitrations / judgments (5 yrs)?", "¿Demandas / arbitrajes / sentencias (5 años)?"],
  "safety.cslb_complaints_5yrs": ["CSLB complaints (5 yrs)?", "¿Quejas CSLB (5 años)?"],
  "safety.liens_5yrs": ["Mechanic's liens / stop notices (5 yrs)?", "¿Gravámenes / avisos de paro (5 años)?"],
  "safety.failed_to_complete": ["Ever failed to complete a project?", "¿Alguna vez no terminó un proyecto?"],
  "safety.bankruptcy_7yrs": ["Bankruptcy (7 yrs)?", "¿Bancarrota (7 años)?"],
  "safety.disclosure_explanation": ["Explanation", "Explicación"],
  "warranty.period": ["Workmanship warranty period", "Período de garantía de mano de obra"],
  "warranty.terms": ["Warranty terms / coverage", "Términos / cobertura de garantía"],
};

const CPQ_ENTITY_LABELS: Record<string, [string, string]> = {
  corporation: ["Corporation", "Corporación"],
  llc: ["LLC", "LLC"],
  partnership: ["Partnership", "Sociedad"],
  sole_proprietor: ["Sole proprietorship", "Propietario único"],
};
const CPQ_PROJECT_TYPE_LABELS: Record<AduProjectType, [string, string]> = {
  detached: ["Detached new", "Independiente nuevo"],
  attached: ["Attached", "Adjunto"],
  garage_conversion: ["Garage conversion", "Conversión de garaje"],
  jadu: ["JADU", "JADU"],
  prefab_modular: ["Prefab / modular", "Prefabricado / modular"],
  manufactured: ["Manufactured", "Manufacturado"],
};

export function buildContractorApplicationPdf(input: {
  number: string;
  status: string;
  data: ContractorApplicationData;
  submittedAt: string | null;
  redactFinancial: boolean;
  docs: Array<{ doc_type: string; status: string; expires_on: string | null }>;
  requirements: ContractorApplicationRequirements;
  signer: {
    name: string | null;
    title: string | null;
    email: string | null;
    phone: string | null;
    signed_at: string | null;
    ip: string | null;
    version: string | null;
  };
  office: {
    reviewer: string | null;
    reviewed_at: string | null;
    license_verified: boolean | null;
    insurance_verified: boolean | null;
    decision: string | null;
    notes: string | null;
  };
  lang: Lang;
}): Buffer {
  const L = input.lang === "es" ? 1 : 0;
  const c = CPQ_PDF_COPY[input.lang === "es" ? "es" : "en"];
  const d = input.data;
  const pdf = createPdfWriter({ labelWidth: 200 });
  const label = (path: string) => CPQ_FIELD_LABELS[path]?.[L] ?? path;
  const yn = (v: string) => (v === "yes" ? c.yes : v === "no" ? c.no : "");
  const field = (path: string, value: unknown) => pdf.row(label(path), value);
  const ynField = (path: string, value: string) => pdf.row(label(path), yn(value));
  const join = (...parts: string[]) => parts.map((p) => p.trim()).filter(Boolean).join(" · ");

  pdf.title(c.hiring + ": Groundwork Capital", c.title);
  pdf.para(c.sub, 9, PDF_MUTED);
  pdf.row(c.number, input.number);
  pdf.row(c.status, input.status);
  pdf.row(c.received, input.submittedAt ? input.submittedAt.slice(0, 10) : null);

  pdf.heading(c.sections.company);
  for (const k of Object.keys(d.company) as Array<keyof ContractorApplicationData["company"]>) {
    const v = k === "entity_type" ? CPQ_ENTITY_LABELS[d.company.entity_type]?.[L] ?? "" : d.company[k];
    field(`company.${k}`, v);
  }

  pdf.heading(c.sections.licensing);
  for (const k of Object.keys(d.licensing) as Array<keyof ContractorApplicationData["licensing"]>) {
    if (k === "license_disciplined" || k === "epa_rrp_certified") ynField(`licensing.${k}`, d.licensing[k]);
    else field(`licensing.${k}`, d.licensing[k]);
  }

  pdf.heading(c.sections.insurance);
  for (const k of ["general_liability", "workers_comp", "commercial_auto", "umbrella"] as const) {
    const p = d.insurance[k];
    field(`insurance.${k}`, join(p.carrier, p.policy_number, p.limits, p.expires_on));
  }
  ynField("insurance.wc_exempt", d.insurance.wc_exempt);
  ynField("insurance.builders_risk_available", d.insurance.builders_risk_available);

  pdf.heading(c.sections.experience);
  field("experience.years_building_adus", d.experience.years_building_adus);
  field("experience.adus_completed_3yrs", d.experience.adus_completed_3yrs);
  field("experience.typical_value_range", d.experience.typical_value_range);
  field("experience.max_concurrent_projects", d.experience.max_concurrent_projects);
  field(
    "experience.project_types",
    d.experience.project_types.map((t) => CPQ_PROJECT_TYPE_LABELS[t]?.[L] ?? t).join(", "),
  );
  pdf.subheading(label("experience.recent_projects"));
  d.experience.recent_projects.forEach((p, i) =>
    pdf.row(`${i + 1}`, join(p.address, p.type_sqft, p.contract_value, p.completed_on)),
  );

  pdf.heading(c.sections.personnel);
  d.personnel.forEach((p, i) =>
    pdf.row(`${i + 1}`, join(p.name, p.role, p.years_experience, p.certifications)),
  );

  pdf.heading(c.sections.references);
  pdf.subheading(label("references.clients"));
  d.references.clients.forEach((r, i) =>
    pdf.row(`${i + 1}`, join(r.name, r.project_address, r.phone, r.email)),
  );
  pdf.subheading(label("references.suppliers"));
  d.references.suppliers.forEach((r, i) =>
    pdf.row(`${i + 1}`, join(r.company, r.contact_name, r.phone, r.relationship)),
  );

  pdf.heading(c.sections.financial);
  if (input.redactFinancial) {
    pdf.para(c.redacted, 10, PDF_MUTED);
  } else {
    for (const k of Object.keys(d.financial) as Array<keyof ContractorApplicationData["financial"]>) {
      field(`financial.${k}`, d.financial[k]);
    }
  }

  pdf.heading(c.sections.safety);
  field("safety.emr", d.safety.emr);
  field("safety.osha_recordables_3yrs", d.safety.osha_recordables_3yrs);
  field("safety.safety_officer", d.safety.safety_officer);
  ynField("safety.has_iipp", d.safety.has_iipp);
  for (const k of CPQ_DISCLOSURE_KEYS) ynField(`safety.${k}`, d.safety[k]);
  field("safety.disclosure_explanation", d.safety.disclosure_explanation);

  pdf.heading(c.sections.warranty);
  field("warranty.period", d.warranty.period);
  field("warranty.terms", d.warranty.terms);

  pdf.heading(c.sections.documents);
  for (const r of input.requirements.docs) {
    const rows = input.docs.filter((x) => x.doc_type === r.key && x.status !== "rejected");
    const exp = rows.map((x) => x.expires_on).filter(Boolean)[0];
    const state = !r.applicable ? c.na : rows.length ? c.attached : c.missing;
    pdf.row(CPQ_DOC_LABELS[r.key][L], exp ? `${state} · ${exp}` : state);
  }

  pdf.heading(c.sections.certification);
  pdf.para(CPQ_CERTIFICATION_TEXT[input.lang === "es" ? "es" : "en"], 9);
  const s = input.signer;
  pdf.row(c.signedBy, s.name ? join(s.name, s.title || "") : null);
  pdf.row(label("company.email"), s.email);
  pdf.row(label("company.phone"), s.phone);
  pdf.row(c.signedAt, s.signed_at);
  pdf.row(c.ip, s.ip);
  pdf.row(c.version, s.version);

  pdf.heading(c.sections.office);
  const o = input.office;
  const bool = (v: boolean | null) => (v == null ? null : v ? c.yes : c.no);
  pdf.row(c.reviewedBy, o.reviewer);
  pdf.row(c.reviewDate, o.reviewed_at);
  pdf.row(c.licenseVerified, bool(o.license_verified));
  pdf.row(c.insuranceVerified, bool(o.insurance_verified));
  pdf.row(c.decision, o.decision);
  pdf.row(c.notes, o.notes);

  return pdf.finish(
    `${c.title} ${input.number}`,
    (i, total) => `Groundwork Capital · ${input.number} · ${c.page} ${i} ${c.of} ${total}`,
  );
}

// ── CPQ: shared loaders / mappers ────────────────────────────────────────────

/** Resolve a magic-link token → application + contractor (404 when unknown/expired). */
async function loadCpqByToken(raw: unknown): Promise<RowDataPacket> {
  const t = String(raw || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(t)) throw new HttpError(404, "errors.applicationLinkInvalid");
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT a.*, t.id AS token_id,
            k.email AS k_email, k.first_name AS k_first, k.last_name AS k_last,
            k.company AS k_company, k.status AS k_status, k.preferred_language AS k_lang
     FROM contractor_application_tokens t
     INNER JOIN contractor_applications a ON a.id = t.application_id
     INNER JOIN contractors k ON k.id = a.contractor_id
     WHERE t.token_hash = ? AND t.expires_at > NOW()
     LIMIT 1`,
    [sha256(t)],
  );
  const row = rows[0];
  if (!row || String(row.k_status) === "suspended") {
    throw new HttpError(404, "errors.applicationLinkInvalid");
  }
  await pool.execute(
    `UPDATE contractor_application_tokens SET last_used_at = NOW() WHERE id = ?`,
    [row.token_id],
  );
  return row;
}

async function loadCpqDocs(applicationId: number): Promise<RowDataPacket[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, doc_type, blob_pathname, file_name, mime_type, size_bytes, expires_on, status,
            review_note, created_at
     FROM contractor_application_documents
     WHERE application_id = ? ORDER BY id ASC`,
    [applicationId],
  );
  return rows;
}

function mapCpqDoc(r: RowDataPacket, redact = false): ContractorApplicationDocument {
  return {
    id: Number(r.id),
    doc_type: String(r.doc_type) as ContractorApplicationDocType,
    file_name: redact ? "" : String(r.file_name),
    mime_type: String(r.mime_type),
    size_bytes: Number(r.size_bytes),
    expires_on: r.expires_on ? cpqDateOnly(r.expires_on) : null,
    status: String(r.status) as ContractorApplicationDocument["status"],
    review_note: r.review_note == null ? null : String(r.review_note),
    uploaded_at: new Date(r.created_at).toISOString(),
    ...(redact ? { redacted: true } : {}),
  };
}

const cpqIso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

async function buildCpqPublicView(
  row: RowDataPacket,
  lang: unknown,
): Promise<ContractorApplicationPublicView> {
  const data = parseCpqData(row.data_json);
  const templates = await cpqTemplates();
  const docs = await loadCpqDocs(Number(row.id));
  return {
    ok: true,
    application: {
      application_number: String(row.application_number),
      status: row.status as ContractorApplicationStatus,
      current_step: Number(row.current_step || 0),
      data,
      submitted_at: cpqIso(row.submitted_at),
      due_at: cpqIso(row.due_at),
      info_request_note: row.info_request_note == null ? null : String(row.info_request_note),
      info_request_doc_types: parseCpqDocTypes(row.info_request_doc_types_json),
      signer: {
        signer_name: row.signer_name ?? null,
        signer_title: row.signer_title ?? null,
        signer_email: row.signer_email ?? null,
        signer_phone: row.signer_phone ?? null,
        signed_at: cpqIso(row.signed_at),
      },
      certification_version: CPQ_CERTIFICATION_VERSION,
      certification_text: CPQ_CERTIFICATION_TEXT[asLang(lang ?? row.k_lang)],
    },
    contractor: {
      first_name: String(row.k_first || ""),
      last_name: String(row.k_last || ""),
      email: String(row.k_email || ""),
      company: row.k_company == null ? null : String(row.k_company),
    },
    documents: docs.map((d) => mapCpqDoc(d)),
    requirements: cpqRequirements(data, templates),
    templates,
  };
}

async function loadAdminCpqRow(contractorId: number): Promise<RowDataPacket | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT a.*, k.email AS k_email, k.first_name AS k_first, k.status AS k_status,
            k.preferred_language AS k_lang,
            CONCAT(r.first_name, ' ', r.last_name) AS reviewer_name
     FROM contractor_applications a
     INNER JOIN contractors k ON k.id = a.contractor_id
     LEFT JOIN admins r ON r.id = a.reviewed_by_admin_id
     WHERE a.contractor_id = ? LIMIT 1`,
    [contractorId],
  );
  return rows[0] || null;
}

async function requireAdminCpqRow(contractorId: number): Promise<RowDataPacket> {
  const row = await loadAdminCpqRow(contractorId);
  if (!row) throw new HttpError(404, "errors.applicationNotFound");
  return row;
}

function parseCpqDocTypeList(v: unknown): ContractorApplicationDocType[] {
  return Array.isArray(v)
    ? ([...new Set(v.map(String))].filter((k) =>
        CPQ_DOC_SPEC_BY_KEY.has(k as ContractorApplicationDocType),
      ) as ContractorApplicationDocType[])
    : [];
}

function registerContractorApplicationRoutes(
  app: Express,
  limiters: { lead: ReturnType<typeof rateLimit> },
) {
  // Wizard autosave + uploads need more headroom than one-shot public forms.
  const cpqLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.VITEST === "true" ? 5000 : 400,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "errors.tooMany" },
  });
  const ctr = requirePortal("contractor");
  const base = "/api/public/contractor-application/:token";

  // ── Public (magic link) ───────────────────────────────────────────────────

  app.post(
    "/api/public/contractor-application/resend",
    limiters.lead,
    route(async (req, res) => {
      const email = normalizeEmail(req.body?.email);
      if (!isValidEmail(email)) throw new HttpError(400, "validation.emailInvalid");
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT k.first_name, k.preferred_language, k.status AS k_status,
                a.id AS app_id, a.application_number, a.status AS app_status, a.due_at
         FROM contractors k
         INNER JOIN contractor_applications a ON a.contractor_id = k.id
         WHERE k.email = ? LIMIT 1`,
        [email],
      );
      const r = rows[0];
      if (r && String(r.k_status) !== "suspended" && String(r.app_status) !== "denied") {
        const token = await cpqMintToken(pool, Number(r.app_id));
        await cpqLogEvent(pool, Number(r.app_id), "link_resent", { type: "contractor" });
        await sendCpqLinkEmail({
          to: email,
          first: String(r.first_name || ""),
          lang: asLang(r.preferred_language),
          token,
          number: String(r.application_number),
          variant: "resend",
          dueAt: r.due_at,
        });
      }
      // Same answer either way (no account enumeration).
      res.json({ ok: true });
    }),
  );

  app.get(
    base,
    cpqLimiter,
    route(async (req, res) => {
      const row = await loadCpqByToken(req.params.token);
      // Opening the link proves email ownership — same as accepting the invite.
      if (String(row.k_status) === "invited") {
        await pool.execute(
          `UPDATE contractors SET status = 'pending' WHERE id = ? AND status = 'invited'`,
          [row.contractor_id],
        );
        await pool.execute(
          `UPDATE contractor_invites SET accepted_at = NOW()
           WHERE contractor_id = ? AND accepted_at IS NULL`,
          [row.contractor_id],
        );
        await cpqLogEvent(pool, Number(row.id), "invite_accepted", { type: "contractor" });
      }
      res.json(await buildCpqPublicView(row, req.query.lang));
    }),
  );

  app.put(
    base,
    cpqLimiter,
    route(async (req, res) => {
      const row = await loadCpqByToken(req.params.token);
      if (!CPQ_EDITABLE.includes(row.status)) throw new HttpError(409, "errors.applicationLocked");
      const merged = normalizeCpqData(req.body?.data ?? {}, parseCpqData(row.data_json));
      const rawStep = Number(req.body?.current_step);
      const step = Number.isInteger(rawStep)
        ? Math.min(Math.max(rawStep, 0), 20)
        : Number(row.current_step || 0);
      const promo = cpqPromotedColumns(merged);
      await pool.execute(
        `UPDATE contractor_applications
         SET data_json = ?, current_step = ?, legal_business_name = ?,
             cslb_license_number = ?, cslb_license_expires_on = ?
         WHERE id = ?`,
        [
          JSON.stringify(merged),
          step,
          promo.legal_business_name,
          promo.cslb_license_number,
          promo.cslb_license_expires_on,
          row.id,
        ],
      );
      res.json({ ok: true, requirements: cpqRequirements(merged, await cpqTemplates()) });
    }),
  );

  app.post(
    `${base}/upload-token`,
    cpqLimiter,
    route(async (req, res) => {
      const row = await loadCpqByToken(req.params.token);
      const spec = CPQ_DOC_SPEC_BY_KEY.get(req.body?.doc_type);
      if (!spec) throw new HttpError(400, "validation.invalidField");
      if (!cpqCanUploadDoc(row.status, spec)) throw new HttpError(409, "errors.applicationLocked");
      const contentType = String(req.body?.content_type || "").toLowerCase().trim();
      const ext = CPQ_MIME_EXT[contentType];
      if (!ext) throw new HttpError(400, "validation.documentFile");
      const size = Number(req.body?.size_bytes);
      if (!Number.isInteger(size) || size <= 0 || size > CPQ_DOC_MAX_BYTES) {
        throw new HttpError(400, "validation.documentTooLarge");
      }
      if (spec.multiple) {
        const [[cnt]] = (await pool.execute<RowDataPacket[]>(
          `SELECT COUNT(*) AS n FROM contractor_application_documents
           WHERE application_id = ? AND doc_type = ?`,
          [row.id, spec.key],
        )) as unknown as [RowDataPacket[]];
        if (Number(cnt?.n || 0) >= CPQ_DOC_MAX_FILES_PER_TYPE) {
          throw new HttpError(409, "errors.documentLimit");
        }
      }
      const pathname = `cpq/${row.application_number}/${spec.key}/${Date.now()}-${crypto
        .randomBytes(8)
        .toString("hex")}.${ext}`;
      const clientToken = await generateClientTokenFromReadWriteToken({
        token: cpqPrivateBlobToken(),
        pathname,
        allowedContentTypes: [contentType],
        maximumSizeInBytes: CPQ_DOC_MAX_BYTES,
        validUntil: Date.now() + CPQ_UPLOAD_TOKEN_TTL_MS,
        addRandomSuffix: false,
        allowOverwrite: false,
      });
      res.json({ ok: true, client_token: clientToken, pathname });
    }),
  );

  app.post(
    `${base}/documents`,
    cpqLimiter,
    route(async (req, res) => {
      const row = await loadCpqByToken(req.params.token);
      const spec = CPQ_DOC_SPEC_BY_KEY.get(req.body?.doc_type);
      if (!spec) throw new HttpError(400, "validation.invalidField");
      if (!cpqCanUploadDoc(row.status, spec)) throw new HttpError(409, "errors.applicationLocked");
      const pathname = String(req.body?.pathname || "");
      const prefix = `cpq/${row.application_number}/${spec.key}/`;
      const ext = pathname.split(".").pop() || "";
      if (
        !pathname.startsWith(prefix) ||
        pathname.length > 500 ||
        !/^[A-Za-z0-9/_.-]+$/.test(pathname) ||
        pathname.includes("..")
      ) {
        throw new HttpError(400, "validation.documentFile");
      }
      let expiresOn: string | null = null;
      if (spec.expires) {
        if (!isIsoDateOnly(req.body?.expires_on)) {
          throw new HttpError(400, "validation.expirationRequired");
        }
        expiresOn = String(req.body.expires_on);
      }
      const fileName =
        String(req.body?.file_name || "")
          .replace(/[\u0000-\u001f\u007f"\\/]/g, "")
          .trim()
          .slice(0, 255) || pathname.split("/").pop()!;
      let meta: Awaited<ReturnType<typeof headBlob>>;
      try {
        meta = await headBlob(pathname, { token: cpqPrivateBlobToken() });
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(400, "validation.documentFile");
      }
      const sniff = await readPrivateBlobHead(pathname);
      const kind = sniff ? detectCpqDocType(sniff) : null;
      if (!kind || kind.ext !== ext || meta.size <= 0 || meta.size > CPQ_DOC_MAX_BYTES) {
        await deletePrivateBlobs([pathname]);
        throw new HttpError(400, "validation.documentFile");
      }
      let replaced: string[] = [];
      const docId = await withTx(async (conn) => {
        if (!spec.multiple) {
          const [old] = await conn.execute<RowDataPacket[]>(
            `SELECT id, blob_pathname FROM contractor_application_documents
             WHERE application_id = ? AND doc_type = ? FOR UPDATE`,
            [row.id, spec.key],
          );
          replaced = old.map((o) => String(o.blob_pathname));
          if (old.length) {
            await conn.execute(
              `DELETE FROM contractor_application_documents WHERE application_id = ? AND doc_type = ?`,
              [row.id, spec.key],
            );
          }
        }
        const [r] = await conn.execute<ResultSetHeader>(
          `INSERT INTO contractor_application_documents
             (application_id, doc_type, blob_pathname, blob_url, file_name, mime_type, size_bytes, expires_on)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [row.id, spec.key, pathname, meta.url, fileName, kind.mime, meta.size, expiresOn],
        );
        await cpqLogEvent(conn, Number(row.id), "document_uploaded", { type: "contractor" }, null, {
          doc_type: spec.key,
          replaced: replaced.length,
        });
        return Number(r.insertId);
      });
      await deletePrivateBlobs(replaced);
      const [docRows] = await pool.execute<RowDataPacket[]>(
        `SELECT id, doc_type, blob_pathname, file_name, mime_type, size_bytes, expires_on, status,
                review_note, created_at
         FROM contractor_application_documents WHERE id = ? LIMIT 1`,
        [docId],
      );
      res.status(201).json({ ok: true, document: mapCpqDoc(docRows[0]) });
    }),
  );

  async function loadOwnCpqDoc(row: RowDataPacket, rawId: unknown) {
    const docId = parseId(rawId);
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM contractor_application_documents WHERE id = ? AND application_id = ? LIMIT 1`,
      [docId, row.id],
    );
    if (!rows[0]) throw new HttpError(404, "errors.notFound");
    return rows[0];
  }

  app.patch(
    `${base}/documents/:docId`,
    cpqLimiter,
    route(async (req, res) => {
      const row = await loadCpqByToken(req.params.token);
      const doc = await loadOwnCpqDoc(row, req.params.docId);
      const spec = CPQ_DOC_SPEC_BY_KEY.get(doc.doc_type);
      if (!spec?.expires) throw new HttpError(400, "validation.invalidField");
      if (!cpqCanUploadDoc(row.status, spec) || doc.status === "accepted") {
        throw new HttpError(409, "errors.applicationLocked");
      }
      if (!isIsoDateOnly(req.body?.expires_on)) {
        throw new HttpError(400, "validation.expirationRequired");
      }
      await pool.execute(
        `UPDATE contractor_application_documents SET expires_on = ?, expiry_reminded_days = NULL WHERE id = ?`,
        [req.body.expires_on, doc.id],
      );
      res.json({ ok: true });
    }),
  );

  app.delete(
    `${base}/documents/:docId`,
    cpqLimiter,
    route(async (req, res) => {
      const row = await loadCpqByToken(req.params.token);
      const doc = await loadOwnCpqDoc(row, req.params.docId);
      const removable = ["draft", "needs_info", "submitted", "in_review"].includes(row.status);
      if (!removable || doc.status === "accepted") {
        throw new HttpError(409, "errors.applicationLocked");
      }
      await pool.execute(`DELETE FROM contractor_application_documents WHERE id = ?`, [doc.id]);
      await cpqLogEvent(pool, Number(row.id), "document_removed", { type: "contractor" }, null, {
        doc_type: doc.doc_type,
      });
      await deletePrivateBlobs([String(doc.blob_pathname)]);
      res.json({ ok: true });
    }),
  );

  app.get(
    `${base}/documents/:docId/file`,
    cpqLimiter,
    route(async (req, res) => {
      const row = await loadCpqByToken(req.params.token);
      const doc = await loadOwnCpqDoc(row, req.params.docId);
      await redirectToPrivateBlob(res, String(doc.blob_pathname));
    }),
  );

  app.post(
    `${base}/submit`,
    cpqLimiter,
    route(async (req, res) => {
      const rawToken = String(req.params.token);
      const row = await loadCpqByToken(rawToken);
      if (!CPQ_EDITABLE.includes(row.status)) throw new HttpError(409, "errors.applicationLocked");
      const b = req.body || {};
      if (b.certify !== true) throw new HttpError(400, "validation.certifyRequired");
      const signerName = String(b.signer_name || "").trim().slice(0, 200);
      const signerTitle = String(b.signer_title || "").trim().slice(0, 120);
      const signerEmail = normalizeEmail(b.signer_email);
      const signerPhone = String(b.signer_phone || "").trim().slice(0, 40);
      if (signerName.length < 2) throw new HttpError(400, "validation.signerNameRequired");
      if (!signerTitle) throw new HttpError(400, "validation.signerTitleRequired");
      if (!isValidEmail(signerEmail)) throw new HttpError(400, "validation.emailInvalid");
      if (signerPhone.replace(/\D/g, "").length < 10) throw new HttpError(400, "validation.phoneMin");
      const sig = String(b.signature_image || "");
      const sigMatch = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(sig);
      const sigBuf = sigMatch ? Buffer.from(sigMatch[1], "base64") : null;
      if (
        !sigBuf ||
        sig.length > CPQ_SIGNATURE_MAX_CHARS ||
        sigBuf.length < 100 ||
        detectImageType(sigBuf)?.mime !== "image/png"
      ) {
        throw new HttpError(400, "validation.signatureRequired");
      }
      const lang = asLang(b.lang ?? row.k_lang);
      const data = parseCpqData(row.data_json);
      const reqs = cpqRequirements(data, await cpqTemplates());
      if (reqs.missing_fields.length) {
        return res
          .status(400)
          .json({ error: "validation.applicationIncomplete", missing_fields: reqs.missing_fields });
      }
      const docs = await loadCpqDocs(Number(row.id));
      const missingCore = cpqOutstandingDocs(reqs, docs, "core");
      if (missingCore.length) {
        return res
          .status(400)
          .json({ error: "validation.applicationDocsMissing", missing_docs: missingCore });
      }
      const certText = CPQ_CERTIFICATION_TEXT[lang];
      const resubmitted = row.status === "needs_info";
      await withTx(async (conn) => {
        const [r] = await conn.execute<ResultSetHeader>(
          `UPDATE contractor_applications
           SET status = 'submitted', submitted_at = NOW(),
               signer_name = ?, signer_title = ?, signer_email = ?, signer_phone = ?,
               signature_image = ?, signed_at = NOW(), signed_ip = ?, signed_user_agent = ?,
               certification_version = ?, certification_sha256 = ?,
               info_request_note = NULL, info_request_doc_types_json = NULL,
               reminder_count = 0, last_reminder_at = NULL
           WHERE id = ? AND status IN ('draft', 'needs_info')`,
          [
            signerName,
            signerTitle,
            signerEmail,
            signerPhone,
            sig,
            clientIp(req),
            String(req.headers["user-agent"] || "").slice(0, 500) || null,
            CPQ_CERTIFICATION_VERSION,
            sha256(certText),
            row.id,
          ],
        );
        if (r.affectedRows !== 1) throw new HttpError(409, "errors.applicationLocked");
        await cpqLogEvent(conn, Number(row.id), resubmitted ? "resubmitted" : "submitted", {
          type: "contractor",
        });
      });
      const missingAll = cpqOutstandingDocs(reqs, docs, "all");
      const kLang = asLang(row.k_lang);
      await safeSend(
        String(row.k_email),
        tplPortalNotice({
          lang: kLang,
          subject: tr(
            kLang,
            `Application received — ${row.application_number}`,
            `Solicitud recibida — ${row.application_number}`,
          ),
          headline: tr(kLang, "We received your application.", "Recibimos tu solicitud."),
          paragraphs: [
            tr(
              kLang,
              `Hi ${row.k_first}, thanks for completing the Groundwork prequalification. Our team will verify your license, insurance and references and email you with a decision.`,
              `Hola ${row.k_first}, gracias por completar la precalificación de Groundwork. Nuestro equipo verificará tu licencia, seguros y referencias y te escribirá con una decisión.`,
            ),
            ...(missingAll.length
              ? [
                  tr(
                    kLang,
                    "To finish the review, please upload these documents within 14 days:",
                    "Para terminar la revisión, sube estos documentos dentro de 14 días:",
                  ),
                  missingAll.map((k) => `• ${cpqDocLabel(kLang, k)}`).join("\n"),
                ]
              : []),
          ],
          details: [[tr(kLang, "Application #", "Solicitud #"), String(row.application_number)]],
          cta: {
            url: cpqApplyUrl(rawToken),
            label: missingAll.length
              ? tr(kLang, "Upload documents", "Subir documentos")
              : tr(kLang, "View application", "Ver solicitud"),
          },
        }),
      );
      const company = data.company.legal_name || `${row.k_first} ${row.k_last}`;
      await notifyStaff("contractor_application_submitted", (l) => ({
        subject: tr(
          l,
          `${resubmitted ? "Prequalification resubmitted" : "New prequalification"} · ${company}`,
          `${resubmitted ? "Precalificación reenviada" : "Nueva precalificación"} · ${company}`,
        ),
        headline: tr(l, "Contractor application ready for review", "Solicitud de contratista lista para revisión"),
        paragraphs: [
          tr(
            l,
            "Verify the CSLB license and insurance, review the documents, then approve or request info.",
            "Verifica la licencia CSLB y los seguros, revisa los documentos y aprueba o solicita información.",
          ),
        ],
        details: [
          [tr(l, "Application #", "Solicitud #"), String(row.application_number)],
          [tr(l, "Company", "Empresa"), company],
          ["CSLB", data.licensing.cslb_license_number || "—"],
          [tr(l, "Documents still owed", "Documentos pendientes"), String(missingAll.length)],
        ],
        cta: {
          url: `${APP_URL}/admin/contractors/${row.contractor_id}#application`,
          label: tr(l, "Review application", "Revisar solicitud"),
        },
      }));
      res.json({ ok: true, status: "submitted", missing_docs: missingAll });
    }),
  );

  // ── Contractor portal (signed-in) ─────────────────────────────────────────

  app.get(
    "/api/contractor/application",
    ctr,
    route(async (_req, res) => {
      const user = portalUser(res);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT application_number, status, due_at, submitted_at
         FROM contractor_applications WHERE contractor_id = ? LIMIT 1`,
        [user.id],
      );
      const r = rows[0];
      const body: ContractorPortalApplicationSummary = {
        ok: true,
        application: r
          ? {
              application_number: String(r.application_number),
              status: r.status as ContractorApplicationStatus,
              due_at: cpqIso(r.due_at),
              submitted_at: cpqIso(r.submitted_at),
            }
          : null,
      };
      res.json(body);
    }),
  );

  app.post(
    "/api/contractor/application/link",
    ctr,
    route(async (_req, res) => {
      const user = portalUser(res);
      const appRow = await cpqEnsureApplication(pool, user.id);
      if (appRow.status === "denied") throw new HttpError(409, "errors.applicationLocked");
      const token = await cpqMintToken(pool, appRow.id);
      res.json({ ok: true, path: `/contractor/apply/${token}` });
    }),
  );

  // ── Admin ─────────────────────────────────────────────────────────────────

  app.get(
    "/api/admin/cpq-templates",
    requireAdmin("people.read"),
    route(async (_req, res) => {
      res.json({ ok: true, templates: await cpqTemplates() });
    }),
  );

  app.post(
    "/api/admin/cpq-templates/:kind",
    requireAdmin("approvals"),
    express.raw({ type: "application/pdf", limit: CPQ_TEMPLATE_MAX_BYTES }),
    route(async (req, res) => {
      const kind = String(req.params.kind) as keyof typeof CPQ_TEMPLATE_KEYS;
      const settingKey = CPQ_TEMPLATE_KEYS[kind];
      if (!settingKey) throw new HttpError(400, "validation.invalidField");
      const body = req.body;
      if (!Buffer.isBuffer(body) || detectCpqDocType(body)?.mime !== "application/pdf") {
        throw new HttpError(400, "validation.pdfFile");
      }
      const url = await storePublicBlobFile(
        `cpq-templates/${kind}-${Date.now()}.pdf`,
        body,
        "application/pdf",
      );
      await upsertSystemSetting(settingKey, url);
      res.json({ ok: true, templates: await cpqTemplates() });
    }),
  );

  app.delete(
    "/api/admin/cpq-templates/:kind",
    requireAdmin("approvals"),
    route(async (req, res) => {
      const settingKey = CPQ_TEMPLATE_KEYS[String(req.params.kind) as keyof typeof CPQ_TEMPLATE_KEYS];
      if (!settingKey) throw new HttpError(400, "validation.invalidField");
      await upsertSystemSetting(settingKey, "");
      res.json({ ok: true, templates: await cpqTemplates() });
    }),
  );

  app.post(
    "/api/admin/contractors/application/send-bulk",
    requireAdmin("approvals"),
    route(async (req, res) => {
      const user = portalUser(res);
      const targetsSql = `FROM contractors k
        LEFT JOIN contractor_applications a ON a.contractor_id = k.id
        WHERE k.status = 'active' AND a.id IS NULL`;
      const [[cnt]] = (await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS n ${targetsSql}`,
      )) as unknown as [RowDataPacket[]];
      const total = Number(cnt?.n || 0);
      if (req.body?.confirm !== true) {
        const [sample] = await pool.execute<RowDataPacket[]>(
          `SELECT k.id, k.first_name, k.last_name, k.email, k.company ${targetsSql}
           ORDER BY k.id ASC LIMIT 25`,
        );
        return res.json({ ok: true, dry_run: true, count: total, sample });
      }
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT k.id ${targetsSql} ORDER BY k.id ASC LIMIT 200`,
      );
      let sent = 0;
      let failed = 0;
      for (const r of rows) {
        try {
          await sendContractorApplicationLink({ contractorId: Number(r.id), adminId: user.id });
          sent++;
        } catch (e: any) {
          failed++;
          console.error("[cpq] bulk send failed:", r.id, e?.message ?? e);
        }
      }
      res.json({ ok: true, dry_run: false, count: total, sent, failed, remaining: Math.max(0, total - sent) });
    }),
  );

  app.get(
    "/api/admin/contractors/:id/application",
    requireAdmin("people.read"),
    route(async (req, res) => {
      const user = portalUser(res);
      const id = parseId(req.params.id);
      const [k] = await pool.execute<RowDataPacket[]>(
        `SELECT id FROM contractors WHERE id = ? LIMIT 1`,
        [id],
      );
      if (!k[0]) throw new HttpError(404, "errors.notFound");
      const templates = await cpqTemplates();
      const row = await loadAdminCpqRow(id);
      if (!row) {
        const empty: AdminContractorApplicationView = {
          ok: true,
          application: null,
          documents: [],
          requirements: null,
          events: [],
          templates,
        };
        return res.json(empty);
      }
      const canFinance = adminCan(user.role, "finance.read");
      const data = parseCpqData(row.data_json);
      const requirements = cpqRequirements(data, templates);
      if (!canFinance) data.financial = cpqEmptyData().financial;
      const docs = await loadCpqDocs(Number(row.id));
      const [events] = await pool.execute<RowDataPacket[]>(
        `SELECT e.id, e.kind, e.actor_type, e.note, e.created_at,
                CONCAT(ad.first_name, ' ', ad.last_name) AS actor_name
         FROM contractor_application_events e
         LEFT JOIN admins ad ON ad.id = e.admin_id
         WHERE e.application_id = ? ORDER BY e.id DESC LIMIT 100`,
        [row.id],
      );
      const bit = (v: unknown) => (v == null ? null : Number(v) === 1);
      const view: AdminContractorApplicationView = {
        ok: true,
        application: {
          id: Number(row.id),
          application_number: String(row.application_number),
          status: row.status as ContractorApplicationStatus,
          current_step: Number(row.current_step || 0),
          data,
          financial_redacted: !canFinance,
          submitted_at: cpqIso(row.submitted_at),
          due_at: cpqIso(row.due_at),
          sent_at: cpqIso(row.sent_at),
          last_reminder_at: cpqIso(row.last_reminder_at),
          info_request_note: row.info_request_note == null ? null : String(row.info_request_note),
          info_request_doc_types: parseCpqDocTypes(row.info_request_doc_types_json),
          signer: {
            signer_name: row.signer_name ?? null,
            signer_title: row.signer_title ?? null,
            signer_email: row.signer_email ?? null,
            signer_phone: row.signer_phone ?? null,
            signed_at: cpqIso(row.signed_at),
            signature_image: row.signature_image ?? null,
            signed_ip: row.signed_ip ?? null,
            signed_user_agent: row.signed_user_agent ?? null,
          },
          office: {
            reviewed_by_name: row.reviewer_name ? String(row.reviewer_name).trim() : null,
            reviewed_at: cpqIso(row.reviewed_at),
            license_verified: bit(row.license_verified),
            insurance_verified: bit(row.insurance_verified),
            decision_notes: row.decision_notes == null ? null : String(row.decision_notes),
          },
          created_at: new Date(row.created_at).toISOString(),
        },
        documents: docs.map((d) =>
          mapCpqDoc(d, !canFinance && !!CPQ_DOC_SPEC_BY_KEY.get(d.doc_type)?.sensitive),
        ),
        requirements,
        events: events.map((e) => ({
          id: Number(e.id),
          kind: String(e.kind),
          actor_type: e.actor_type,
          actor_name: e.actor_name ? String(e.actor_name).trim() : null,
          note: e.note == null ? null : String(e.note),
          created_at: new Date(e.created_at).toISOString(),
        })),
        templates,
      };
      res.json(view);
    }),
  );

  app.get(
    "/api/admin/contractors/:id/application/documents/:docId/file",
    requireAdmin("people.read"),
    route(async (req, res) => {
      const user = portalUser(res);
      const row = await requireAdminCpqRow(parseId(req.params.id));
      const [docs] = await pool.execute<RowDataPacket[]>(
        `SELECT doc_type, blob_pathname FROM contractor_application_documents
         WHERE id = ? AND application_id = ? LIMIT 1`,
        [parseId(req.params.docId), row.id],
      );
      const doc = docs[0];
      if (!doc) throw new HttpError(404, "errors.notFound");
      if (CPQ_DOC_SPEC_BY_KEY.get(doc.doc_type)?.sensitive && !adminCan(user.role, "finance.read")) {
        throw new HttpError(403, "errors.forbidden");
      }
      await redirectToPrivateBlob(res, String(doc.blob_pathname));
    }),
  );

  app.get(
    "/api/admin/contractors/:id/application/pdf",
    requireAdmin("people.read"),
    route(async (req, res) => {
      const user = portalUser(res);
      const row = await requireAdminCpqRow(parseId(req.params.id));
      const data = parseCpqData(row.data_json);
      const docs = await loadCpqDocs(Number(row.id));
      const lang = asLang(req.query.lang);
      const bit = (v: unknown) => (v == null ? null : Number(v) === 1);
      const pdf = buildContractorApplicationPdf({
        number: String(row.application_number),
        status: String(row.status),
        data,
        submittedAt: cpqIso(row.submitted_at),
        redactFinancial: !adminCan(user.role, "finance.read"),
        docs: docs.map((d) => ({
          doc_type: String(d.doc_type),
          status: String(d.status),
          expires_on: d.expires_on ? cpqDateOnly(d.expires_on) : null,
        })),
        requirements: cpqRequirements(data, await cpqTemplates()),
        signer: {
          name: row.signer_name ?? null,
          title: row.signer_title ?? null,
          email: row.signer_email ?? null,
          phone: row.signer_phone ?? null,
          signed_at: cpqIso(row.signed_at),
          ip: row.signed_ip ?? null,
          version: row.certification_version ?? null,
        },
        office: {
          reviewer: row.reviewer_name ? String(row.reviewer_name).trim() : null,
          reviewed_at: cpqIso(row.reviewed_at),
          license_verified: bit(row.license_verified),
          insurance_verified: bit(row.insurance_verified),
          decision: ["approved", "denied"].includes(String(row.status)) ? String(row.status) : null,
          notes: row.decision_notes ?? null,
        },
        lang,
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${String(row.application_number).replace(/[^A-Za-z0-9-]/g, "")}.pdf"`,
      );
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.status(200).send(pdf);
    }),
  );

  app.post(
    "/api/admin/contractors/:id/application/send",
    requireAdmin("approvals"),
    route(async (req, res) => {
      const user = portalUser(res);
      const id = parseId(req.params.id);
      const [k] = await pool.execute<RowDataPacket[]>(
        `SELECT status FROM contractors WHERE id = ? LIMIT 1`,
        [id],
      );
      if (!k[0]) throw new HttpError(404, "errors.notFound");
      if (String(k[0].status) === "suspended") throw new HttpError(409, "errors.contractorSuspended");
      const existing = await loadAdminCpqRow(id);
      const st = existing ? (String(existing.status) as ContractorApplicationStatus) : null;
      if (st === "denied") throw new HttpError(409, "errors.applicationLocked");
      const variant: CpqEmailVariant | undefined =
        st === "needs_info"
          ? "info_request"
          : st === "submitted" || st === "in_review"
            ? "missing_docs"
            : st === "approved"
              ? "resend"
              : existing?.sent_at
                ? "reminder"
                : undefined;
      let docTypes: string[] | undefined;
      if (existing && variant === "missing_docs") {
        const data = parseCpqData(existing.data_json);
        docTypes = cpqOutstandingDocs(
          cpqRequirements(data, await cpqTemplates()),
          await loadCpqDocs(Number(existing.id)),
          "all",
        );
      }
      const out = await sendContractorApplicationLink({
        contractorId: id,
        adminId: user.id,
        variant,
        note: variant === "info_request" ? existing?.info_request_note ?? null : null,
        docTypes:
          variant === "info_request"
            ? parseCpqDocTypes(existing?.info_request_doc_types_json)
            : docTypes,
      });
      res.json({ ok: true, application_number: out.applicationNumber, status: out.status });
    }),
  );

  app.patch(
    "/api/admin/contractors/:id/application/review",
    requireAdmin("approvals"),
    route(async (req, res) => {
      const user = portalUser(res);
      const row = await requireAdminCpqRow(parseId(req.params.id));
      if (["approved", "denied"].includes(String(row.status))) {
        throw new HttpError(409, "errors.applicationLocked");
      }
      const triState: FieldParser = (v) =>
        v === null ? { ok: true, value: null } : fBool(v);
      const { updates } = parsePatch(req.body, {
        license_verified: triState,
        insurance_verified: triState,
        decision_notes: fStr(5000),
      });
      updates.reviewed_by_admin_id = user.id;
      updates.reviewed_at = new Date();
      if (String(row.status) === "submitted") updates.status = "in_review";
      await applyUpdate(pool, "contractor_applications", Number(row.id), updates);
      await cpqLogEvent(pool, Number(row.id), "review_updated", { type: "admin", adminId: user.id }, null, {
        fields: Object.keys(updates).filter((k) => !["reviewed_by_admin_id", "reviewed_at"].includes(k)),
      });
      res.json({ ok: true });
    }),
  );

  app.patch(
    "/api/admin/contractors/:id/application/documents/:docId",
    requireAdmin("approvals"),
    route(async (req, res) => {
      const user = portalUser(res);
      const row = await requireAdminCpqRow(parseId(req.params.id));
      const docId = parseId(req.params.docId);
      const status = String(req.body?.status || "");
      if (!["accepted", "rejected", "uploaded"].includes(status)) {
        throw new HttpError(400, "validation.invalidField");
      }
      const note = req.body?.review_note ? String(req.body.review_note).trim().slice(0, 500) : null;
      if (status === "rejected" && !note) throw new HttpError(400, "validation.rejectNoteRequired");
      const [r] = await pool.execute<ResultSetHeader>(
        `UPDATE contractor_application_documents
         SET status = ?, review_note = ?, reviewed_by_admin_id = ?, reviewed_at = NOW()
         WHERE id = ? AND application_id = ?`,
        [status, note, user.id, docId, row.id],
      );
      if (r.affectedRows !== 1) throw new HttpError(404, "errors.notFound");
      if (String(row.status) === "submitted") {
        await pool.execute(
          `UPDATE contractor_applications SET status = 'in_review', reviewed_by_admin_id = ?, reviewed_at = NOW()
           WHERE id = ? AND status = 'submitted'`,
          [user.id, row.id],
        );
      }
      await cpqLogEvent(pool, Number(row.id), `document_${status}`, { type: "admin", adminId: user.id }, note, {
        document_id: docId,
      });
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/admin/contractors/:id/application/request-info",
    requireAdmin("approvals"),
    route(async (req, res) => {
      const user = portalUser(res);
      const contractorId = parseId(req.params.id);
      const row = await requireAdminCpqRow(contractorId);
      if (!["submitted", "in_review", "needs_info"].includes(String(row.status))) {
        throw new HttpError(409, "errors.applicationLocked");
      }
      const note = String(req.body?.note || "").trim().slice(0, 2000);
      if (note.length < 5) throw new HttpError(400, "validation.infoRequestNoteRequired");
      const docTypes = parseCpqDocTypeList(req.body?.doc_types);
      const token = await withTx(async (conn) => {
        await conn.execute(
          `UPDATE contractor_applications
           SET status = 'needs_info', info_request_note = ?, info_request_doc_types_json = ?,
               reviewed_by_admin_id = ?, reviewed_at = NOW(), reminder_count = 0,
               last_reminder_at = NULL, sent_at = NOW()
           WHERE id = ?`,
          [note, JSON.stringify(docTypes), user.id, row.id],
        );
        await cpqLogEvent(conn, Number(row.id), "info_requested", { type: "admin", adminId: user.id }, note, {
          doc_types: docTypes,
        });
        return cpqMintToken(conn, Number(row.id));
      });
      await sendCpqLinkEmail({
        to: String(row.k_email),
        first: String(row.k_first || ""),
        lang: asLang(row.k_lang),
        token,
        number: String(row.application_number),
        variant: "info_request",
        note,
        docTypes,
      });
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/admin/contractors/:id/application/decision",
    requireAdmin("approvals"),
    route(async (req, res) => {
      const user = portalUser(res);
      const contractorId = parseId(req.params.id);
      const row = await requireAdminCpqRow(contractorId);
      const decision = String(req.body?.decision || "");
      if (decision !== "approved" && decision !== "denied") {
        throw new HttpError(400, "validation.invalidField");
      }
      if (!["submitted", "in_review", "needs_info"].includes(String(row.status))) {
        throw new HttpError(409, "errors.applicationLocked");
      }
      const notes = String(req.body?.notes || "").trim().slice(0, 5000) || null;
      const message = String(req.body?.message || "").trim().slice(0, 2000) || null;
      let missing: ContractorApplicationDocType[] = [];
      if (decision === "approved") {
        if (Number(row.license_verified) !== 1 || Number(row.insurance_verified) !== 1) {
          throw new HttpError(409, "errors.applicationVerifyFirst");
        }
        const data = parseCpqData(row.data_json);
        missing = cpqOutstandingDocs(
          cpqRequirements(data, await cpqTemplates()),
          await loadCpqDocs(Number(row.id)),
          "all",
        );
        if (missing.length && !(req.body?.allow_missing === true && (notes?.length ?? 0) >= 5)) {
          return res.status(409).json({ error: "errors.applicationDocsMissing", missing_docs: missing });
        }
      }
      const kStatus = String(row.k_status);
      const activate = decision === "approved" && ["pending", "invited"].includes(kStatus);
      const deactivate = decision === "denied" && ["pending", "invited"].includes(kStatus);
      await withTx(async (conn) => {
        await conn.execute(
          `UPDATE contractor_applications
           SET status = ?, decided_at = NOW(), reviewed_by_admin_id = ?, reviewed_at = NOW(),
               decision_notes = COALESCE(?, decision_notes)
           WHERE id = ?`,
          [decision, user.id, notes, row.id],
        );
        if (activate) {
          await conn.execute(
            `UPDATE contractors SET status = 'active', activated_at = COALESCE(activated_at, NOW())
             WHERE id = ?`,
            [contractorId],
          );
          await conn.execute(
            `UPDATE contractor_invites SET accepted_at = COALESCE(accepted_at, NOW())
             WHERE contractor_id = ? AND accepted_at IS NULL`,
            [contractorId],
          );
        }
        if (deactivate) {
          await conn.execute(`UPDATE contractors SET status = 'inactive' WHERE id = ?`, [contractorId]);
        }
        await cpqLogEvent(conn, Number(row.id), decision, { type: "admin", adminId: user.id }, notes, {
          ...(missing.length ? { approved_with_missing: missing } : {}),
          contractor_status: activate ? "active" : deactivate ? "inactive" : kStatus,
        });
      });
      const lang = asLang(row.k_lang);
      if (activate) {
        await sendContractorApprovedEmail({
          email: String(row.k_email),
          first_name: String(row.k_first || ""),
          preferred_language: row.k_lang,
        });
      } else {
        const approved = decision === "approved";
        await safeSend(
          String(row.k_email),
          tplPortalNotice({
            lang,
            subject: approved
              ? tr(lang, "Your Groundwork prequalification is approved", "Tu precalificación Groundwork está aprobada")
              : tr(lang, "Update on your Groundwork application", "Actualización sobre tu solicitud Groundwork"),
            headline: approved
              ? tr(lang, "You're prequalified.", "Estás precalificado.")
              : tr(lang, "Thank you for applying.", "Gracias por aplicar."),
            paragraphs: [
              approved
                ? tr(
                    lang,
                    `Hi ${row.k_first}, your prequalification ${row.application_number} is approved. Keep your license, bond and insurance current — we'll remind you before anything expires.`,
                    `Hola ${row.k_first}, tu precalificación ${row.application_number} está aprobada. Mantén vigentes tu licencia, fianza y seguros — te recordaremos antes de que algo venza.`,
                  )
                : tr(
                    lang,
                    `Hi ${row.k_first}, after reviewing application ${row.application_number} we're unable to approve it at this time.`,
                    `Hola ${row.k_first}, después de revisar la solicitud ${row.application_number} no podemos aprobarla en este momento.`,
                  ),
              ...(message ? [message] : []),
            ],
            ...(approved
              ? {
                  cta: {
                    url: `${APP_URL}/contractor/login`,
                    label: tr(lang, "Open contractor portal", "Abrir portal de contratistas"),
                  },
                }
              : {}),
          }),
        );
      }
      res.json({
        ok: true,
        status: decision,
        contractor_status: activate ? "active" : deactivate ? "inactive" : kStatus,
      });
    }),
  );

  app.post(
    "/api/admin/contractors/:id/application/reopen",
    requireAdmin("approvals"),
    route(async (req, res) => {
      const user = portalUser(res);
      const contractorId = parseId(req.params.id);
      const row = await requireAdminCpqRow(contractorId);
      if (String(row.status) === "draft") throw new HttpError(409, "errors.applicationLocked");
      const note = String(req.body?.note || "").trim().slice(0, 2000);
      if (note.length < 5) throw new HttpError(400, "validation.infoRequestNoteRequired");
      const token = await withTx(async (conn) => {
        await conn.execute(
          `UPDATE contractor_applications
           SET status = 'draft', submitted_at = NULL, signer_name = NULL, signer_title = NULL,
               signer_email = NULL, signer_phone = NULL, signature_image = NULL, signed_at = NULL,
               signed_ip = NULL, signed_user_agent = NULL, certification_version = NULL,
               certification_sha256 = NULL, decided_at = NULL, info_request_note = ?,
               info_request_doc_types_json = NULL, reminder_count = 0, last_reminder_at = NULL,
               sent_at = NOW()
           WHERE id = ?`,
          [note, row.id],
        );
        if (String(row.status) === "denied" && String(row.k_status) === "inactive") {
          await conn.execute(`UPDATE contractors SET status = 'pending' WHERE id = ?`, [contractorId]);
        }
        await cpqLogEvent(conn, Number(row.id), "reopened", { type: "admin", adminId: user.id }, note, {
          from: String(row.status),
        });
        return cpqMintToken(conn, Number(row.id));
      });
      await sendCpqLinkEmail({
        to: String(row.k_email),
        first: String(row.k_first || ""),
        lang: asLang(row.k_lang),
        token,
        number: String(row.application_number),
        variant: "info_request",
        note,
      });
      res.json({ ok: true });
    }),
  );

  // ── Vercel Cron: reminders, soft deadlines, expiring documents ────────────

  const cron = async (req: Request, res: Response) => {
    try {
      const secret = String(process.env.CRON_SECRET || "").trim();
      if (!secret || String(req.headers.authorization || "") !== `Bearer ${secret}`) {
        return res.status(401).json({ error: "errors.unauthorized" });
      }
      // Tests scope the sweep to their own fixtures (shared DB).
      const emailPrefix =
        process.env.VITEST === "true" && req.query.email_prefix
          ? String(req.query.email_prefix)
          : null;
      res.json({ ok: true, ...(await runContractorApplicationCron(new Date(), emailPrefix)) });
    } catch (e: any) {
      console.error("[cron.contractor-applications] failed:", e?.message ?? e);
      res.status(500).json({ error: "errors.server" });
    }
  };
  // Vercel Cron invokes GET; POST kept for manual runs.
  app.get("/api/cron/contractor-applications", cron);
  app.post("/api/cron/contractor-applications", cron);
}

const CPQ_DAY_MS = 24 * 60 * 60 * 1000;

/** Daily compliance sweep (idempotent; each step caps its batch). */
async function runContractorApplicationCron(now = new Date(), emailPrefix: string | null = null) {
  const out = { reminders: 0, missing_docs: 0, overdue: 0, expiring: 0 };
  const scopeSql = emailPrefix ? " AND k.email LIKE ?" : "";
  const scope = emailPrefix ? [`${emailPrefix.replace(/[%_\\]/g, "\\$&")}%`] : [];
  const daysSince = (v: unknown) => (now.getTime() - new Date(v as string).getTime()) / CPQ_DAY_MS;
  const templates = await cpqTemplates();

  // 1) Draft / needs-info reminders.
  const [drafts] = await pool.execute<RowDataPacket[]>(
    `SELECT a.id, a.application_number, a.sent_at, a.due_at, a.reminder_count, a.status,
            a.info_request_note, k.email, k.first_name, k.preferred_language
     FROM contractor_applications a INNER JOIN contractors k ON k.id = a.contractor_id
     WHERE a.status IN ('draft', 'needs_info') AND a.sent_at IS NOT NULL
       AND k.status IN ('invited', 'pending', 'active')
       AND (a.last_reminder_at IS NULL OR a.last_reminder_at < ?)${scopeSql}
     ORDER BY a.id ASC LIMIT 100`,
    [new Date(now.getTime() - CPQ_DAY_MS), ...scope],
  );
  for (const a of drafts) {
    const plan = a.due_at ? CPQ_REMINDER_DAYS_EXISTING : CPQ_REMINDER_DAYS_NEW;
    const n = Number(a.reminder_count || 0);
    if (n >= plan.length || daysSince(a.sent_at) < plan[n]) continue;
    const token = await cpqMintToken(pool, Number(a.id));
    await pool.execute(
      `UPDATE contractor_applications SET reminder_count = reminder_count + 1, last_reminder_at = ? WHERE id = ?`,
      [now, a.id],
    );
    await cpqLogEvent(pool, Number(a.id), "reminder_sent", { type: "system" });
    await sendCpqLinkEmail({
      to: String(a.email),
      first: String(a.first_name || ""),
      lang: asLang(a.preferred_language),
      token,
      number: String(a.application_number),
      variant: a.status === "needs_info" ? "info_request" : "reminder",
      dueAt: a.due_at,
      note: a.status === "needs_info" ? a.info_request_note : null,
    });
    out.reminders++;
  }

  // 2) Submitted but approval-level documents still owed.
  const [owed] = await pool.execute<RowDataPacket[]>(
    `SELECT a.id, a.application_number, a.submitted_at, a.reminder_count, a.data_json,
            k.email, k.first_name, k.preferred_language
     FROM contractor_applications a INNER JOIN contractors k ON k.id = a.contractor_id
     WHERE a.status IN ('submitted', 'in_review') AND a.submitted_at IS NOT NULL
       AND (a.last_reminder_at IS NULL OR a.last_reminder_at < ?)${scopeSql}
     ORDER BY a.id ASC LIMIT 100`,
    [new Date(now.getTime() - CPQ_DAY_MS), ...scope],
  );
  for (const a of owed) {
    const n = Number(a.reminder_count || 0);
    if (n >= CPQ_REMINDER_DAYS_MISSING_DOCS.length) continue;
    if (daysSince(a.submitted_at) < CPQ_REMINDER_DAYS_MISSING_DOCS[n]) continue;
    const missing = cpqOutstandingDocs(
      cpqRequirements(parseCpqData(a.data_json), templates),
      await loadCpqDocs(Number(a.id)),
      "all",
    );
    if (!missing.length) continue;
    const token = await cpqMintToken(pool, Number(a.id));
    await pool.execute(
      `UPDATE contractor_applications SET reminder_count = reminder_count + 1, last_reminder_at = ? WHERE id = ?`,
      [now, a.id],
    );
    await cpqLogEvent(pool, Number(a.id), "missing_docs_reminder", { type: "system" }, null, {
      doc_types: missing,
    });
    await sendCpqLinkEmail({
      to: String(a.email),
      first: String(a.first_name || ""),
      lang: asLang(a.preferred_language),
      token,
      number: String(a.application_number),
      variant: "missing_docs",
      docTypes: missing,
    });
    out.missing_docs++;
  }

  // 3) Existing contractors past their soft deadline → staff flag (access untouched).
  const [overdue] = await pool.execute<RowDataPacket[]>(
    `SELECT a.id, a.application_number, a.contractor_id, a.due_at,
            k.first_name, k.last_name, k.company
     FROM contractor_applications a INNER JOIN contractors k ON k.id = a.contractor_id
     WHERE a.due_at IS NOT NULL AND a.due_at < ? AND a.overdue_notified_at IS NULL
       AND a.status IN ('draft', 'needs_info')${scopeSql}
     ORDER BY a.id ASC LIMIT 100`,
    [now, ...scope],
  );
  for (const a of overdue) {
    await pool.execute(`UPDATE contractor_applications SET overdue_notified_at = ? WHERE id = ?`, [
      now,
      a.id,
    ]);
    await cpqLogEvent(pool, Number(a.id), "overdue_flagged", { type: "system" });
    const who = String(a.company || `${a.first_name} ${a.last_name}`);
    await notifyStaff("contractor_compliance_alert", (l) => ({
      subject: tr(l, `Prequalification overdue · ${who}`, `Precalificación vencida · ${who}`),
      headline: tr(l, "Contractor missed the prequalification deadline", "Contratista no cumplió la fecha de precalificación"),
      paragraphs: [
        tr(
          l,
          "Portal access was not changed. Follow up, or suspend from the contractor record if needed.",
          "El acceso al portal no cambió. Da seguimiento o suspende desde el registro del contratista si es necesario.",
        ),
      ],
      details: [[tr(l, "Application #", "Solicitud #"), String(a.application_number)]],
      cta: {
        url: `${APP_URL}/admin/contractors/${a.contractor_id}#application`,
        label: tr(l, "Open contractor", "Abrir contratista"),
      },
    }));
    out.overdue++;
  }

  // 4) Expiring license / bond / insurance documents on approved files.
  const horizon = new Date(now.getTime() + CPQ_EXPIRY_THRESHOLDS[0] * CPQ_DAY_MS)
    .toISOString()
    .slice(0, 10);
  const [expiring] = await pool.execute<RowDataPacket[]>(
    `SELECT d.id, d.doc_type, d.expires_on, d.expiry_reminded_days, a.id AS app_id,
            a.application_number, a.contractor_id, k.email, k.first_name, k.last_name,
            k.company, k.preferred_language
     FROM contractor_application_documents d
     INNER JOIN contractor_applications a ON a.id = d.application_id
     INNER JOIN contractors k ON k.id = a.contractor_id
     WHERE a.status = 'approved' AND d.status <> 'rejected' AND d.expires_on IS NOT NULL
       AND d.expires_on <= ? AND k.status = 'active'
       AND (d.expiry_reminded_days IS NULL OR d.expiry_reminded_days > 0)${scopeSql}
     ORDER BY d.expires_on ASC LIMIT 300`,
    [horizon, ...scope],
  );
  const byApp = new Map<number, { row: RowDataPacket; items: Array<{ id: number; doc_type: string; expires_on: string; threshold: number }> }>();
  for (const d of expiring) {
    const exp = cpqDateOnly(d.expires_on) as string;
    const daysLeft = Math.floor((new Date(`${exp}T00:00:00Z`).getTime() - now.getTime()) / CPQ_DAY_MS);
    // Smallest threshold already crossed; skip when that threshold was already sent.
    const threshold = [...CPQ_EXPIRY_THRESHOLDS].reverse().find((t) => daysLeft <= t);
    if (threshold === undefined) continue;
    if (d.expiry_reminded_days != null && Number(d.expiry_reminded_days) <= threshold) continue;
    const g = byApp.get(Number(d.app_id)) || { row: d, items: [] };
    g.items.push({ id: Number(d.id), doc_type: String(d.doc_type), expires_on: exp, threshold });
    byApp.set(Number(d.app_id), g);
  }
  for (const [appId, g] of byApp) {
    for (const it of g.items) {
      await pool.execute(
        `UPDATE contractor_application_documents SET expiry_reminded_days = ? WHERE id = ?`,
        [it.threshold, it.id],
      );
    }
    const token = await cpqMintToken(pool, appId);
    await cpqLogEvent(pool, appId, "expiry_reminder", { type: "system" }, null, {
      doc_types: g.items.map((i) => i.doc_type),
    });
    await sendCpqLinkEmail({
      to: String(g.row.email),
      first: String(g.row.first_name || ""),
      lang: asLang(g.row.preferred_language),
      token,
      number: String(g.row.application_number),
      variant: "expiring",
      expiring: g.items,
    });
    if (g.items.some((i) => i.threshold === 0)) {
      const who = String(g.row.company || `${g.row.first_name} ${g.row.last_name}`);
      await notifyStaff("contractor_compliance_alert", (l) => ({
        subject: tr(l, `Contractor document expired · ${who}`, `Documento de contratista vencido · ${who}`),
        headline: tr(l, "License, bond or insurance on file has expired", "Licencia, fianza o seguro registrado venció"),
        paragraphs: [
          g.items
            .filter((i) => i.threshold === 0)
            .map((i) => `• ${cpqDocLabel(l, i.doc_type)} — ${i.expires_on}`)
            .join("\n"),
        ],
        cta: {
          url: `${APP_URL}/admin/contractors/${g.row.contractor_id}#application`,
          label: tr(l, "Open contractor", "Abrir contratista"),
        },
      }));
    }
    out.expiring++;
  }
  return out;
}

// ─── Duplicates review: queue, merge, delete, dismiss, link ────────────────

const DEDUPE_TABLE: Record<DedupeEntity, "leads" | "clients" | "affiliates" | "contractors"> = {
  lead: "leads",
  client: "clients",
  affiliate: "affiliates",
  contractor: "contractors",
};
const DEDUPE_ENTITIES: DedupeEntity[] = ["lead", "client", "affiliate", "contractor"];
/** Projects that never left the pipeline's first step and hold nothing — safe to drop with their client. */
const EMPTY_PROJECT_SQL = `p.milestone IN ('lead', 'cancelled')
  AND NOT EXISTS (SELECT 1 FROM affiliate_commissions ac WHERE ac.project_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM draw_requests dr WHERE dr.project_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM project_contracts pc WHERE pc.project_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM project_photos ph WHERE ph.project_id = p.id)`;

async function countSql(exec: Pool | PoolConnection, sql: string, params: unknown[]): Promise<number> {
  const [rows] = await exec.execute<RowDataPacket[]>(sql, params as any[]);
  return Number(rows[0]?.n || 0);
}

/** Linked rows (what a merge moves) + reasons a delete is refused. */
export async function dedupeLinksAndBlockers(
  entity: DedupeEntity,
  id: number,
  exec: Pool | PoolConnection = pool,
): Promise<{ links: Record<string, number>; delete_blockers: string[] }> {
  const links: Record<string, number> = {};
  const blockers: string[] = [];
  const c = (sql: string, params: unknown[] = [id]) => countSql(exec, sql, params);
  if (entity === "lead") {
    links.projects = await c(`SELECT COUNT(*) n FROM projects WHERE lead_id = ?`);
    links.clients = await c(`SELECT COUNT(*) n FROM clients WHERE lead_id = ?`);
    return { links, delete_blockers: blockers };
  }
  if (entity === "client") {
    links.projects = await c(`SELECT COUNT(*) n FROM projects WHERE client_id = ?`);
    links.conversations = await c(`SELECT COUNT(*) n FROM conversations WHERE client_id = ?`);
    links.leads = await c(`SELECT COUNT(*) n FROM leads WHERE client_id = ?`);
    const active = await c(`SELECT COUNT(*) n FROM projects p WHERE p.client_id = ? AND NOT (${EMPTY_PROJECT_SQL})`);
    if (active) blockers.push("projects_in_progress");
    if (links.conversations) blockers.push("conversations");
    return { links, delete_blockers: blockers };
  }
  if (entity === "affiliate") {
    links.projects = await c(
      `SELECT COUNT(*) n FROM projects WHERE affiliate_id = ? OR closer_affiliate_id = ? OR parent_affiliate_id = ?`,
      [id, id, id],
    );
    links.commissions = await c(`SELECT COUNT(*) n FROM affiliate_commissions WHERE affiliate_id = ?`);
    links.referred_clients = await c(`SELECT COUNT(*) n FROM clients WHERE affiliate_id = ?`);
    links.sub_affiliates = await c(`SELECT COUNT(*) n FROM affiliates WHERE parent_affiliate_id = ?`);
    links.leads = await c(`SELECT COUNT(*) n FROM leads WHERE affiliate_id = ? OR converted_affiliate_id = ?`, [id, id]);
    if (links.projects) blockers.push("projects");
    if (links.commissions) blockers.push("commissions");
    if (links.referred_clients) blockers.push("referred_clients");
    if (links.sub_affiliates) blockers.push("sub_affiliates");
    return { links, delete_blockers: blockers };
  }
  links.projects = await c(`SELECT COUNT(*) n FROM projects WHERE contractor_id = ?`);
  links.draws = await c(`SELECT COUNT(*) n FROM draw_requests WHERE contractor_id = ?`);
  links.applications = await c(
    `SELECT COUNT(*) n FROM contractor_applications WHERE contractor_id = ? AND status <> 'draft'`,
  );
  links.leads = await c(`SELECT COUNT(*) n FROM leads WHERE converted_contractor_id = ?`);
  if (links.projects) blockers.push("projects");
  if (links.draws) blockers.push("draws");
  if (links.applications) blockers.push("prequalification");
  return { links, delete_blockers: blockers };
}

type DedupeNode = Omit<DuplicateMember, "links" | "delete_blockers"> & { keys: string[] };

/** Pure: group records sharing an email or phone into review clusters (union-find). */
export function buildDuplicateClusters(
  nodes: DedupeNode[],
  dismissed: Set<string> = new Set(),
): Array<Omit<DuplicateCluster, "members"> & { members: DedupeNode[] }> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let cur = x;
    while (parent.get(cur) !== r) {
      const next = parent.get(cur)!;
      parent.set(cur, r);
      cur = next;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const byKey = new Map<string, string>();
  for (const n of nodes) {
    const nk = `${n.entity}:${n.id}`;
    parent.set(nk, nk);
    for (const k of n.keys) {
      const prev = byKey.get(k);
      if (prev) union(nk, prev);
      else byKey.set(k, nk);
    }
  }
  const groups = new Map<string, DedupeNode[]>();
  for (const n of nodes) {
    const root = find(`${n.entity}:${n.id}`);
    groups.set(root, [...(groups.get(root) || []), n]);
  }
  const out: Array<Omit<DuplicateCluster, "members"> & { members: DedupeNode[] }> = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const people = members.filter((m) => m.entity !== "lead");
    const leads = members.filter((m) => m.entity === "lead");
    let kind: DuplicateCluster["kind"];
    if (people.length > 1) {
      const entities = new Set(people.map((p) => p.entity));
      kind = entities.size < people.length ? "same_role" : "cross_role";
    } else if (leads.length > 1) {
      kind = "repeat_leads";
    } else {
      // One person + one lead: fine when the lead already points at that person.
      const p = people[0];
      const l = leads[0];
      if (l.linked && l.linked.entity === p.entity && l.linked.id === p.id) continue;
      kind = "lead_of_person";
    }
    const signature = dedupeSignature(members.map((m) => `${m.entity}:${m.id}`));
    if (dismissed.has(signature)) continue;
    const keyCount = new Map<string, number>();
    for (const m of members) for (const k of m.keys) keyCount.set(k, (keyCount.get(k) || 0) + 1);
    const order: Record<DedupeEntity, number> = { client: 0, affiliate: 1, contractor: 2, lead: 3 };
    out.push({
      signature,
      kind,
      match_keys: [...keyCount.entries()].filter(([, n]) => n > 1).map(([k]) => k),
      members: [...members].sort((a, b) => order[a.entity] - order[b.entity] || a.id - b.id),
    });
  }
  const rank: Record<DuplicateCluster["kind"], number> = {
    same_role: 0,
    cross_role: 1,
    lead_of_person: 2,
    repeat_leads: 3,
  };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

export function dedupeKeys(email: unknown, phone: unknown): string[] {
  const keys: string[] = [];
  const e = email ? normalizeEmail(email) : "";
  if (isValidEmail(e)) keys.push(`e:${e}`);
  const p = normalizePhoneLast10(phone == null ? null : String(phone));
  if (p) keys.push(`p:${p}`);
  return keys;
}

async function loadDedupeNodes(): Promise<DedupeNode[]> {
  const nodes: DedupeNode[] = [];
  const iso = (v: unknown) => new Date(v as string).toISOString();
  const [clients] = await pool.query<RowDataPacket[]>(
    `SELECT id, first_name, last_name, email, phone, status, created_at FROM clients`,
  );
  const [affs] = await pool.query<RowDataPacket[]>(
    `SELECT id, first_name, last_name, email, phone, status, created_at FROM affiliates`,
  );
  const [ctrs] = await pool.query<RowDataPacket[]>(
    `SELECT id, first_name, last_name, email, phone, status, created_at FROM contractors`,
  );
  const [leads] = await pool.query<RowDataPacket[]>(
    `SELECT id, full_name, email, phone, status, created_at, client_id, converted_affiliate_id,
            converted_contractor_id, submission_count
     FROM leads WHERE status <> 'spam' AND event_id IS NULL`,
  );
  const person = (entity: PersonEntity, rows: RowDataPacket[]) => {
    for (const r of rows) {
      nodes.push({
        entity,
        id: Number(r.id),
        name: `${r.first_name || ""} ${r.last_name || ""}`.trim(),
        email: r.email == null ? null : String(r.email),
        phone: r.phone == null ? null : String(r.phone),
        status: String(r.status),
        created_at: iso(r.created_at),
        keys: dedupeKeys(r.email, r.phone),
      });
    }
  };
  person("client", clients);
  person("affiliate", affs);
  person("contractor", ctrs);
  for (const r of leads) {
    const linked: DuplicateMember["linked"] = r.client_id
      ? { entity: "client", id: Number(r.client_id) }
      : r.converted_affiliate_id
        ? { entity: "affiliate", id: Number(r.converted_affiliate_id) }
        : r.converted_contractor_id
          ? { entity: "contractor", id: Number(r.converted_contractor_id) }
          : null;
    nodes.push({
      entity: "lead",
      id: Number(r.id),
      name: String(r.full_name || ""),
      email: r.email == null ? null : String(r.email),
      phone: r.phone == null ? null : String(r.phone),
      status: String(r.status),
      created_at: iso(r.created_at),
      linked,
      submission_count: Number(r.submission_count || 1),
      keys: dedupeKeys(r.email, r.phone),
    });
  }
  return nodes;
}

async function loadDuplicateClusters(): Promise<DuplicateCluster[]> {
  const [dis] = await pool.query<RowDataPacket[]>(`SELECT signature FROM people_dedupe_dismissals`);
  const clusters = buildDuplicateClusters(
    await loadDedupeNodes(),
    new Set(dis.map((d) => String(d.signature))),
  );
  const out: DuplicateCluster[] = [];
  for (const cl of clusters) {
    const members: DuplicateMember[] = [];
    for (const { keys: _keys, ...m } of cl.members) {
      members.push({ ...m, ...(await dedupeLinksAndBlockers(m.entity, m.id)) });
    }
    out.push({ ...cl, members });
  }
  return out;
}

async function loadDedupeRow(entity: DedupeEntity, id: number, exec: Pool | PoolConnection = pool) {
  const [rows] = await exec.execute<RowDataPacket[]>(
    `SELECT * FROM \`${DEDUPE_TABLE[entity]}\` WHERE id = ? LIMIT 1 FOR UPDATE`,
    [id],
  );
  if (!rows[0]) throw new HttpError(404, "errors.notFound");
  return rows[0];
}

const appendNote = (a: unknown, b: string) => [a ? String(a) : "", b].filter(Boolean).join("\n").slice(0, 60000);

/**
 * Merge `removeId` into `keepId` (same entity): move every reference, fill the
 * survivor's blanks, delete the duplicate, audit with a snapshot. `dryRun` only
 * reports what would move and any blockers.
 */
export async function mergeDuplicateRecords(opts: {
  entity: DedupeEntity;
  keepId: number;
  removeId: number;
  adminId: number;
  reason?: string | null;
  dryRun?: boolean;
}): Promise<{ moves: Record<string, number>; blockers: string[]; warnings: string[] }> {
  const { entity, keepId, removeId } = opts;
  if (keepId === removeId) throw new HttpError(400, "validation.invalidField");
  return withTx(async (conn) => {
    const keep = await loadDedupeRow(entity, keepId, conn);
    const rm = await loadDedupeRow(entity, removeId, conn);
    const moves: Record<string, number> = {};
    const blockers: string[] = [];
    const warnings: string[] = [];
    // [table.column, sql] — sql is an UPDATE moving removeId → keepId.
    const plan: Array<[string, string, unknown[]]> = [];
    const mv = (label: string, table: string, col: string, extraWhere = "") =>
      plan.push([label, `UPDATE \`${table}\` SET \`${col}\` = ? WHERE \`${col}\` = ?${extraWhere}`, [keepId, removeId]]);
    const fill: Record<string, unknown> = {};
    const fillBlank = (col: string) => {
      if ((keep[col] == null || keep[col] === "") && rm[col] != null && rm[col] !== "") fill[col] = rm[col];
    };
    let recipientKind: "leads" | "affiliates" | "contractors" | null = null;

    if (entity === "lead") {
      mv("projects.lead_id", "projects", "lead_id");
      mv("clients.lead_id", "clients", "lead_id");
      recipientKind = "leads";
      for (const col of ["first_name", "last_name", "property_address", "affiliate_id", "referral_code", "client_id", "converted_affiliate_id", "converted_contractor_id", "audience_tag"]) fillBlank(col);
      fill.submission_count = Number(keep.submission_count || 1) + Number(rm.submission_count || 1);
      fill.soft_pull_consent = Math.max(Number(keep.soft_pull_consent || 0), Number(rm.soft_pull_consent || 0));
      fill.sms_marketing_consent = Math.max(Number(keep.sms_marketing_consent || 0), Number(rm.sms_marketing_consent || 0));
      fill.notes = appendNote(keep.notes, `[merged lead #${removeId} · ${rm.source || "?"} · ${new Date(rm.created_at).toISOString().slice(0, 10)}] ${rm.full_name} · ${rm.email} · ${rm.phone}${rm.notes ? ` — ${rm.notes}` : ""}`);
      if (keep.event_id == null && rm.event_id != null) blockers.push("event_rsvp");
    } else if (entity === "client") {
      mv("projects.client_id", "projects", "client_id");
      mv("affiliate_commissions.client_id", "affiliate_commissions", "client_id");
      mv("leads.client_id", "leads", "client_id");
      mv("contacts.converted_client_id", "contacts", "converted_client_id");
      mv("conversation_unknown_contacts.linked_client_id", "conversation_unknown_contacts", "linked_client_id");
      mv("conversations.client_id", "conversations", "client_id");
      for (const col of ["email", "phone", "address_line1", "address_line2", "city", "state", "zip", "affiliate_id", "assigned_admin_id", "lead_id", "avatar_url", "email_verified_at"]) fillBlank(col);
      fill.admin_notes = appendNote(keep.admin_notes, `[merged client #${removeId} · ${rm.first_name} ${rm.last_name} · ${rm.email || "no email"} · ${rm.phone || "no phone"}]${rm.admin_notes ? ` ${rm.admin_notes}` : ""}`);
      if (keep.email && rm.email && normalizeEmail(keep.email) !== normalizeEmail(rm.email)) {
        warnings.push("removed_email_login_stops");
      }
    } else if (entity === "affiliate") {
      for (const col of ["affiliate_id", "closer_affiliate_id", "parent_affiliate_id"]) mv(`projects.${col}`, "projects", col);
      mv("clients.affiliate_id", "clients", "affiliate_id");
      mv("leads.affiliate_id", "leads", "affiliate_id");
      mv("leads.converted_affiliate_id", "leads", "converted_affiliate_id");
      mv("affiliates.parent_affiliate_id", "affiliates", "parent_affiliate_id", ` AND id <> ${Number(keepId)}`);
      mv("affiliate_link_clicks.affiliate_id", "affiliate_link_clicks", "affiliate_id");
      mv("affiliate_commissions.affiliate_id", "affiliate_commissions", "affiliate_id");
      recipientKind = "affiliates";
      const clash = await countSql(
        conn,
        `SELECT COUNT(*) n FROM affiliate_commissions a JOIN affiliate_commissions b
           ON a.project_id = b.project_id WHERE a.affiliate_id = ? AND b.affiliate_id = ?`,
        [keepId, removeId],
      );
      if (clash) blockers.push("commission_same_project");
      if (Number(keep.parent_affiliate_id) === removeId) fill.parent_affiliate_id = rm.parent_affiliate_id ?? null;
      for (const col of ["phone", "company", "avatar_url", "bio"]) fillBlank(col);
      fill.notes = appendNote(keep.notes, `[merged affiliate #${removeId} · ${rm.email} · code ${rm.referral_code}${rm.slug ? ` · /r/${rm.slug}` : ""}]${rm.notes ? ` ${rm.notes}` : ""}`);
      warnings.push("removed_tracking_link_stops");
    } else {
      mv("projects.contractor_id", "projects", "contractor_id");
      mv("project_photos.uploaded_by_contractor_id", "project_photos", "uploaded_by_contractor_id");
      mv("draw_requests.contractor_id", "draw_requests", "contractor_id");
      mv("contractor_invites.contractor_id", "contractor_invites", "contractor_id");
      mv("leads.converted_contractor_id", "leads", "converted_contractor_id");
      recipientKind = "contractors";
      const [apps] = await conn.execute<RowDataPacket[]>(
        `SELECT contractor_id, status FROM contractor_applications WHERE contractor_id IN (?, ?)`,
        [keepId, removeId],
      );
      const keepApp = apps.find((a) => Number(a.contractor_id) === keepId);
      const rmApp = apps.find((a) => Number(a.contractor_id) === removeId);
      if (rmApp && !keepApp) mv("contractor_applications.contractor_id", "contractor_applications", "contractor_id");
      else if (rmApp && keepApp && rmApp.status !== "draft") blockers.push("both_prequalified");
      for (const col of ["phone", "company", "license_number", "avatar_url"]) fillBlank(col);
      fill.notes = appendNote(keep.notes, `[merged contractor #${removeId} · ${rm.email}]${rm.notes ? ` ${rm.notes}` : ""}`);
    }

    for (const [label] of plan) {
      const [table, col] = label.split(".");
      moves[label] = await countSql(conn, `SELECT COUNT(*) n FROM \`${table}\` WHERE \`${col}\` = ?`, [removeId]);
    }
    if (recipientKind) {
      moves["campaign_recipients"] = await countSql(
        conn,
        `SELECT COUNT(*) n FROM campaign_send_logs WHERE recipient_kind = ? AND recipient_id = ?`,
        [recipientKind, removeId],
      );
    }
    if (opts.dryRun || blockers.length) {
      return { moves, blockers, warnings };
    }

    // Unique email: free it on the duplicate before the survivor takes it.
    if ("email" in fill) {
      await conn.execute(`UPDATE \`${DEDUPE_TABLE[entity]}\` SET email = NULL WHERE id = ?`, [removeId]);
    }
    for (const [, sql, params] of plan) await conn.execute(sql, params as any[]);
    if (recipientKind) {
      await conn.execute(
        `DELETE s FROM campaign_recipient_state s
         JOIN campaign_recipient_state k
           ON k.campaign_id = s.campaign_id AND k.recipient_kind = s.recipient_kind AND k.recipient_id = ?
         WHERE s.recipient_kind = ? AND s.recipient_id = ?`,
        [keepId, recipientKind, removeId],
      );
      for (const t of ["campaign_recipient_state", "campaign_send_logs"]) {
        await conn.execute(
          `UPDATE ${t} SET recipient_id = ? WHERE recipient_kind = ? AND recipient_id = ?`,
          [keepId, recipientKind, removeId],
        );
      }
    }
    await applyUpdate(conn, DEDUPE_TABLE[entity], keepId, fill);
    await conn.execute(`DELETE FROM \`${DEDUPE_TABLE[entity]}\` WHERE id = ?`, [removeId]);
    await logDedupe({
      action: "merge",
      entity,
      recordId: removeId,
      targetEntity: entity,
      targetId: keepId,
      adminId: opts.adminId,
      reason: opts.reason ?? null,
      snapshot: { removed: rm, moves },
      exec: conn,
    });
    return { moves, blockers, warnings };
  });
}

/** Delete one record if nothing meaningful hangs off it (empty pipeline projects go with a client). */
export async function deleteDuplicateRecord(opts: {
  entity: DedupeEntity;
  id: number;
  adminId: number;
  reason?: string | null;
  dryRun?: boolean;
}): Promise<{ blockers: string[]; removed_projects: number }> {
  return withTx(async (conn) => {
    const row = await loadDedupeRow(opts.entity, opts.id, conn);
    const { delete_blockers } = await dedupeLinksAndBlockers(opts.entity, opts.id, conn);
    const removedProjects =
      opts.entity === "client"
        ? await countSql(conn, `SELECT COUNT(*) n FROM projects p WHERE p.client_id = ? AND ${EMPTY_PROJECT_SQL}`, [opts.id])
        : 0;
    if (opts.dryRun || delete_blockers.length) {
      return { blockers: delete_blockers, removed_projects: removedProjects };
    }
    if (opts.entity === "client") {
      await conn.execute(`DELETE p FROM projects p WHERE p.client_id = ? AND ${EMPTY_PROJECT_SQL}`, [opts.id]);
      await conn.execute(`UPDATE leads SET client_id = NULL WHERE client_id = ?`, [opts.id]);
    }
    if (opts.entity === "affiliate") {
      await conn.execute(`UPDATE leads SET affiliate_id = NULL WHERE affiliate_id = ?`, [opts.id]);
    }
    if (opts.entity === "lead") {
      for (const kind of ["campaign_recipient_state", "campaign_send_logs"]) {
        await conn.execute(`DELETE FROM ${kind} WHERE recipient_kind = 'leads' AND recipient_id = ?`, [opts.id]);
      }
    }
    await conn.execute(`DELETE FROM \`${DEDUPE_TABLE[opts.entity]}\` WHERE id = ?`, [opts.id]);
    await logDedupe({
      action: "delete",
      entity: opts.entity,
      recordId: opts.id,
      adminId: opts.adminId,
      reason: opts.reason ?? null,
      snapshot: { removed: row, removed_projects: removedProjects },
      exec: conn,
    });
    // Leads that pointed at a deleted person can now link to whoever remains.
    if (opts.entity !== "lead") {
      const [orphans] = await conn.execute<RowDataPacket[]>(
        `SELECT id FROM leads WHERE email = ? OR ${phone10Sql("phone")} = ? LIMIT 50`,
        [row.email ? normalizeEmail(row.email) : "", normalizePhoneLast10(row.phone) || "x"],
      );
      for (const o of orphans) await linkLeadToPerson(Number(o.id), conn);
    }
    return { blockers: [], removed_projects: removedProjects };
  });
}

function parseDedupeEntity(v: unknown): DedupeEntity {
  const e = String(v || "") as DedupeEntity;
  if (!DEDUPE_ENTITIES.includes(e)) throw new HttpError(400, "validation.invalidField");
  return e;
}

function registerDuplicatesRoutes(app: Express) {
  app.get(
    "/api/admin/duplicates",
    requireAdmin("people.read"),
    route(async (_req, res) => {
      const clusters = await loadDuplicateClusters();
      const body: AdminDuplicatesResponse = { ok: true, clusters, total: clusters.length };
      res.json(body);
    }),
  );

  app.post(
    "/api/admin/duplicates/merge",
    requireAdmin("approvals"),
    route(async (req, res) => {
      const b = req.body || {};
      const out = await mergeDuplicateRecords({
        entity: parseDedupeEntity(b.entity),
        keepId: parseId(b.keep_id),
        removeId: parseId(b.remove_id),
        adminId: portalUser(res).id,
        reason: b.reason ? String(b.reason).slice(0, 500) : null,
        dryRun: b.dry_run === true,
      });
      if (out.blockers.length && b.dry_run !== true) {
        throw new HttpError(409, "errors.mergeBlocked", { blockers: out.blockers });
      }
      res.json({ ok: true, dry_run: b.dry_run === true, ...out });
    }),
  );

  app.post(
    "/api/admin/duplicates/delete",
    requireAdmin("approvals"),
    route(async (req, res) => {
      const b = req.body || {};
      const out = await deleteDuplicateRecord({
        entity: parseDedupeEntity(b.entity),
        id: parseId(b.id),
        adminId: portalUser(res).id,
        reason: b.reason ? String(b.reason).slice(0, 500) : null,
        dryRun: b.dry_run === true,
      });
      if (out.blockers.length && b.dry_run !== true) {
        throw new HttpError(409, "errors.deleteBlocked", { blockers: out.blockers });
      }
      res.json({ ok: true, dry_run: b.dry_run === true, ...out });
    }),
  );

  app.post(
    "/api/admin/duplicates/dismiss",
    requireAdmin("approvals"),
    route(async (req, res) => {
      const signature = String(req.body?.signature || "").trim();
      const reason = String(req.body?.reason || "").trim().slice(0, 500);
      if (!/^[a-z]+:\d+(\|[a-z]+:\d+)+$/.test(signature) || signature.length > 500) {
        throw new HttpError(400, "validation.invalidField");
      }
      if (reason.length < SHARED_PHONE_REASON_MIN) throw new HttpError(400, "validation.dismissReasonRequired");
      const user = portalUser(res);
      await pool.execute(
        `INSERT INTO people_dedupe_dismissals (signature, admin_id, reason) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE reason = VALUES(reason), admin_id = VALUES(admin_id)`,
        [signature, user.id, reason],
      );
      const [first] = signature.split("|");
      const [entity, id] = first.split(":");
      await logDedupe({
        action: "dismiss",
        entity: parseDedupeEntity(entity),
        recordId: Number(id),
        adminId: user.id,
        reason,
        snapshot: { signature },
      });
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/admin/duplicates/link-lead",
    requireAdmin("leads"),
    route(async (req, res) => {
      const leadId = parseId(req.body?.lead_id);
      const entity = parseDedupeEntity(req.body?.entity);
      if (entity === "lead") throw new HttpError(400, "validation.invalidField");
      const personId = parseId(req.body?.id);
      await loadDedupeRow(entity, personId);
      const col =
        entity === "client" ? "client_id" : entity === "affiliate" ? "converted_affiliate_id" : "converted_contractor_id";
      const [r] = await pool.execute<ResultSetHeader>(
        `UPDATE leads SET client_id = NULL, converted_affiliate_id = NULL, converted_contractor_id = NULL,
           ${col} = ? WHERE id = ?`,
        [personId, leadId],
      );
      if (r.affectedRows !== 1) throw new HttpError(404, "errors.notFound");
      await logDedupe({
        action: "link",
        entity: "lead",
        recordId: leadId,
        targetEntity: entity,
        targetId: personId,
        adminId: portalUser(res).id,
      });
      res.json({ ok: true });
    }),
  );
}

function registerFeatureRoutes(
  app: Express,
  limiters: {
    lead: ReturnType<typeof rateLimit>;
    referral: ReturnType<typeof rateLimit>;
  },
) {
  const aff = requirePortal("affiliate");
  const ctr = requirePortal("contractor");
  const cli = requirePortal("client");

  // ── Public ────────────────────────────────────────────────────────────────

  app.get(
    "/api/public/plans",
    route(async (_req, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, code, name, bedrooms, bathrooms, stories, sq_ft,
                layout_image_url, exterior_image_url, description
         FROM adu_plans WHERE is_active = 1 ORDER BY sort_order, id`,
      );
      res.json({ ok: true, plans: rows });
    }),
  );

  app.post(
    "/api/public/affiliate/signup",
    limiters.lead,
    route(async (req, res) => {
      const b = req.body || {};
      const first = String(b.first_name || "").trim().slice(0, 100);
      const last = String(b.last_name || "").trim().slice(0, 100);
      const email = normalizeEmail(b.email);
      const phone = String(b.phone || "").trim().slice(0, 40);
      const company = b.company ? String(b.company).trim().slice(0, 200) : null;
      const lang = asLang(b.preferred_language);
      if (!first) throw new HttpError(400, "validation.firstNameRequired");
      if (!last) throw new HttpError(400, "validation.lastNameRequired");
      if (!isValidEmail(email)) throw new HttpError(400, "validation.emailInvalid");
      if (phone.replace(/\D/g, "").length < 10) {
        throw new HttpError(400, "validation.phoneMin");
      }
      const [existing] = await pool.execute<RowDataPacket[]>(
        `SELECT id FROM affiliates WHERE email = ? LIMIT 1`,
        [email],
      );
      if (existing.length) throw new HttpError(409, "errors.affiliateExists");
      await assertPublicPersonAvailable({
        source: "affiliate signup",
        attempted: "affiliate",
        name: `${first} ${last}`,
        email,
        phone,
      });

      await withNewAffiliateCodes(first, last, async ({ code, slug }) => {
        await pool.execute(
          `INSERT INTO affiliates
             (email, first_name, last_name, phone, company, status, preferred_language,
              referral_code, slug)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
          [email, first, last, phone, company, lang, code, slug],
        );
      });

      await safeSend(
        email,
        tplPortalNotice({
          lang,
          subject: tr(
            lang,
            "Affiliate application received — Groundwork Capital",
            "Solicitud de afiliado recibida — Groundwork Capital",
          ),
          headline: tr(lang, "You're in the queue.", "Estás en la fila."),
          paragraphs: [
            tr(
              lang,
              `Hi ${first}, thanks for applying to the Groundwork affiliate program.`,
              `Hola ${first}, gracias por aplicar al programa de afiliados de Groundwork.`,
            ),
            tr(
              lang,
              "Our team reviews every application. Once approved you'll get an email and can sign in with a one-time code — no password needed.",
              "Nuestro equipo revisa cada solicitud. Al aprobarse recibirás un correo y podrás entrar con un código de un solo uso — sin contraseña.",
            ),
          ],
        }),
      );
      await notifyStaff("affiliate_signup", (l) => ({
        subject: tr(l, `New affiliate application: ${first} ${last}`, `Nueva solicitud de afiliado: ${first} ${last}`),
        headline: tr(l, "New affiliate application", "Nueva solicitud de afiliado"),
        paragraphs: [
          tr(l, "Review and approve in the admin portal.", "Revisa y aprueba en el portal de administración."),
        ],
        details: [
          [tr(l, "Name", "Nombre"), `${first} ${last}`],
          ["Email", email],
          [tr(l, "Phone", "Teléfono"), phone],
          [tr(l, "Company", "Empresa"), company || "—"],
        ],
        cta: { url: `${APP_URL}/admin/affiliates`, label: tr(l, "Open affiliates", "Abrir afiliados") },
      }));
      res.status(201).json({ ok: true, message: "Application received" });
    }),
  );

  /** Public homeowner portal application (pending until staff approves → prospect + invite). */
  app.post(
    "/api/public/client/signup",
    limiters.lead,
    route(async (req, res) => {
      const b = req.body || {};
      const first = String(b.first_name || "").trim().slice(0, 100);
      const last = String(b.last_name || "").trim().slice(0, 100);
      const email = normalizeEmail(b.email);
      const phone = String(b.phone || "").trim().slice(0, 40);
      const address = b.address_line1
        ? String(b.address_line1).trim().slice(0, 255)
        : null;
      const city = b.city ? String(b.city).trim().slice(0, 100) : null;
      const zip = b.zip ? String(b.zip).trim().slice(0, 20) : null;
      const lang = asLang(b.preferred_language);
      if (!first) throw new HttpError(400, "validation.firstNameRequired");
      if (!last) throw new HttpError(400, "validation.lastNameRequired");
      if (!isValidEmail(email)) throw new HttpError(400, "validation.emailInvalid");
      if (phone.replace(/\D/g, "").length < 10) {
        throw new HttpError(400, "validation.phoneMin");
      }

      const [existing] = await pool.execute<RowDataPacket[]>(
        `SELECT id, status, first_name, preferred_language FROM clients WHERE email = ? LIMIT 1`,
        [email],
      );
      if (existing[0]) {
        const st = String(existing[0].status);
        const cid = Number(existing[0].id);
        const existLang = asLang(existing[0].preferred_language);
        const existFirst = String(existing[0].first_name || first);
        if (st === "pending") {
          await safeSend(
            email,
            tplPortalNotice({
              lang: existLang,
              subject: tr(
                existLang,
                "We still have your homeowner application — Groundwork",
                "Aún tenemos tu solicitud de propietario — Groundwork",
              ),
              headline: tr(existLang, "You're still in the queue.", "Sigues en la fila."),
              paragraphs: [
                tr(
                  existLang,
                  `Hi ${existFirst}, we already have your application. Our team will email you when your portal is ready.`,
                  `Hola ${existFirst}, ya tenemos tu solicitud. Nuestro equipo te escribirá cuando tu portal esté listo.`,
                ),
              ],
            }),
          );
          await notifyStaff("client_signup_reminder", (l) => ({
            subject: tr(l, `Homeowner re-applied · ${existFirst}`, `Propietario reaplicó · ${existFirst}`),
            headline: tr(l, "Pending homeowner nudged signup again.", "Propietario pendiente volvió a solicitar."),
            paragraphs: [
              tr(l, "Open the client record to approve when ready.", "Abre el registro del cliente para aprobar cuando corresponda."),
            ],
            details: [["Email", email]],
            cta: {
              url: `${APP_URL}/admin/clients/${cid}`,
              label: tr(l, "Open client", "Abrir cliente"),
            },
          }));
          return res.json({ ok: true, outcome: "resent" });
        }
        if (st === "prospect") {
          const token = await issueClientPortalInvite(pool, {
            clientId: cid,
            email,
            byType: "system",
            byId: null,
          });
          await sendClientPortalInviteEmail({
            email,
            firstName: existFirst,
            lang: existLang,
            token,
          });
          return res.json({ ok: true, outcome: "invite_resent" });
        }
        // active / inactive / suspended — soft ack, no invite spam
        return res.json({ ok: true, outcome: "ready" });
      }
      // One role per person: same email/phone as any client, affiliate or contractor.
      if (
        await isPublicSignupDuplicate({
          source: "homeowner signup",
          attempted: "client",
          name: `${first} ${last}`,
          email,
          phone,
        })
      ) {
        return res.json({ ok: true, outcome: "exists" });
      }

      try {
        const [ins] = await pool.execute<ResultSetHeader>(
          `INSERT INTO clients
             (email, first_name, last_name, phone, preferred_language, status,
              address_line1, city, zip)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
          [email, first, last, phone, lang, address, city, zip],
        );
        const clientId = Number(ins.insertId);
        await safeSend(
          email,
          tplPortalNotice({
            lang,
            subject: tr(
              lang,
              "Homeowner application received — Groundwork Capital",
              "Solicitud de propietario recibida — Groundwork Capital",
            ),
            headline: tr(lang, "You're in the queue.", "Estás en la fila."),
            paragraphs: [
              tr(
                lang,
                `Hi ${first}, thanks for creating a Groundwork homeowner account.`,
                `Hola ${first}, gracias por crear una cuenta de propietario en Groundwork.`,
              ),
              tr(
                lang,
                "Our team reviews every application. Once approved you'll get a portal invite by email.",
                "Nuestro equipo revisa cada solicitud. Al aprobarse recibirás una invitación al portal por correo.",
              ),
            ],
          }),
        );
        await notifyStaff("client_signup", (l) => ({
          subject: tr(l, `New homeowner application: ${first} ${last}`, `Nueva solicitud de propietario: ${first} ${last}`),
          headline: tr(l, "New homeowner application", "Nueva solicitud de propietario"),
          paragraphs: [
            tr(l, "Approve in Admin → Clients to send their portal invite.", "Aprueba en Admin → Clientes para enviar su invitación al portal."),
          ],
          details: [
            [tr(l, "Name", "Nombre"), `${first} ${last}`],
            ["Email", email],
            [tr(l, "Phone", "Teléfono"), phone],
            [tr(l, "Address", "Dirección"), [address, city, zip].filter(Boolean).join(", ") || "—"],
          ],
          cta: {
            url: `${APP_URL}/admin/clients/${clientId}`,
            label: tr(l, "Open client", "Abrir cliente"),
          },
        }));
        return res.status(201).json({ ok: true, outcome: "created" });
      } catch (e: any) {
        if (e?.code !== "ER_DUP_ENTRY" && e?.errno !== 1062) throw e;
        // Race: another request inserted the same email — soft-outcome path.
        const [again] = await pool.execute<RowDataPacket[]>(
          `SELECT id, status, first_name, preferred_language FROM clients WHERE email = ? LIMIT 1`,
          [email],
        );
        if (!again[0]) throw e;
        const st = String(again[0].status);
        if (st === "pending") {
          return res.json({ ok: true, outcome: "resent" });
        }
        if (st === "prospect") {
          return res.json({ ok: true, outcome: "invite_resent" });
        }
        return res.json({ ok: true, outcome: "ready" });
      }
    }),
  );

  /** Public contractor portal application (pending until staff approves → active). */
  app.post(
    "/api/public/contractor/signup",
    limiters.lead,
    route(async (req, res) => {
      const b = req.body || {};
      const first = String(b.first_name || "").trim().slice(0, 100);
      const last = String(b.last_name || "").trim().slice(0, 100);
      const email = normalizeEmail(b.email);
      const phone = String(b.phone || "").trim().slice(0, 40);
      const company = b.company ? String(b.company).trim().slice(0, 200) : null;
      const lang = asLang(b.preferred_language);
      if (!first) throw new HttpError(400, "validation.firstNameRequired");
      if (!last) throw new HttpError(400, "validation.lastNameRequired");
      if (!isValidEmail(email)) throw new HttpError(400, "validation.emailInvalid");
      if (phone.replace(/\D/g, "").length < 10) {
        throw new HttpError(400, "validation.phoneMin");
      }

      const [existing] = await pool.execute<RowDataPacket[]>(
        `SELECT id, status, first_name, preferred_language, company, license_number, phone,
                invited_by_admin_id
         FROM contractors WHERE email = ? LIMIT 1`,
        [email],
      );
      if (existing[0]) {
        const row = existing[0];
        const st = String(row.status);
        const cid = Number(row.id);
        const existLang = asLang(row.preferred_language);
        const existFirst = String(row.first_name || first);
        if (st === "pending") {
          // Re-signup while pending = resend the prequalification link (or a "still reviewing" note).
          const [appRows] = await pool.execute<RowDataPacket[]>(
            `SELECT status FROM contractor_applications WHERE contractor_id = ? LIMIT 1`,
            [cid],
          );
          const appStatus = appRows[0] ? String(appRows[0].status) : null;
          if (!appStatus || appStatus === "draft" || appStatus === "needs_info") {
            await sendContractorApplicationLink({
              contractorId: cid,
              variant: appStatus ? "resend" : "new",
            });
          } else {
            await safeSend(
              email,
              tplPortalNotice({
                lang: existLang,
                subject: tr(
                  existLang,
                  "We still have your contractor application — Groundwork",
                  "Aún tenemos tu solicitud de contratista — Groundwork",
                ),
                headline: tr(existLang, "You're still in the queue.", "Sigues en la fila."),
                paragraphs: [
                  tr(
                    existLang,
                    `Hi ${existFirst}, we already have your application. We'll email you when you're approved to sign in.`,
                    `Hola ${existFirst}, ya tenemos tu solicitud. Te escribiremos cuando estés aprobado para entrar.`,
                  ),
                ],
              }),
            );
          }
          await notifyStaff("contractor_signup_reminder", (l) => ({
            subject: tr(l, `Contractor re-applied · ${existFirst}`, `Contratista reaplicó · ${existFirst}`),
            headline: tr(l, "Pending contractor nudged signup again.", "Contratista pendiente volvió a solicitar."),
            paragraphs: [
              tr(l, "The prequalification link was re-sent. Review the application once it's submitted.", "Se reenvió el enlace de precalificación. Revisa la solicitud cuando la envíe."),
            ],
            details: [["Email", email]],
            cta: {
              url: `${APP_URL}/admin/contractors/${cid}`,
              label: tr(l, "Open contractor", "Abrir contratista"),
            },
          }));
          return res.json({ ok: true, outcome: "resent" });
        }
        if (st === "invited") {
          // Opening the application link accepts the invite (invited → pending).
          await sendContractorApplicationLink({ contractorId: cid });
          return res.json({ ok: true, outcome: "invite_resent" });
        }
        if (st === "active") {
          return res.json({ ok: true, outcome: "ready" });
        }
        return res.json({ ok: true, outcome: "ready" });
      }

      // One role per person: same email/phone as any client, affiliate or contractor.
      if (
        await isPublicSignupDuplicate({
          source: "contractor signup",
          attempted: "contractor",
          name: `${first} ${last}`,
          email,
          phone,
        })
      ) {
        return res.json({ ok: true, outcome: "exists" });
      }

      try {
        const [ins] = await pool.execute<ResultSetHeader>(
          `INSERT INTO contractors
             (email, first_name, last_name, phone, company, status, preferred_language)
           VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
          [email, first, last, phone, company, lang],
        );
        const contractorId = Number(ins.insertId);
        await sendContractorApplicationLink({ contractorId, variant: "new" });
        await notifyStaff("contractor_signup", (l) => ({
          subject: tr(l, `New contractor application: ${first} ${last}`, `Nueva solicitud de contratista: ${first} ${last}`),
          headline: tr(l, "New contractor application", "Nueva solicitud de contratista"),
          paragraphs: [
            tr(l, "They were emailed the prequalification application. You'll be notified when it's submitted for review.", "Se le envió la solicitud de precalificación. Te avisaremos cuando la envíe para revisión."),
          ],
          details: [
            [tr(l, "Name", "Nombre"), `${first} ${last}`],
            ["Email", email],
            [tr(l, "Phone", "Teléfono"), phone],
            [tr(l, "Company", "Empresa"), company || "—"],
          ],
          cta: {
            url: `${APP_URL}/admin/contractors/${contractorId}`,
            label: tr(l, "Open contractor", "Abrir contratista"),
          },
        }));
        return res.status(201).json({ ok: true, outcome: "created" });
      } catch (e: any) {
        if (e?.code !== "ER_DUP_ENTRY" && e?.errno !== 1062) throw e;
        const [again] = await pool.execute<RowDataPacket[]>(
          `SELECT id, status FROM contractors WHERE email = ? LIMIT 1`,
          [email],
        );
        if (!again[0]) throw e;
        const st = String(again[0].status);
        if (st === "pending") return res.json({ ok: true, outcome: "resent" });
        if (st === "invited") return res.json({ ok: true, outcome: "invite_resent" });
        return res.json({ ok: true, outcome: "ready" });
      }
    }),
  );

  app.get(
    "/api/public/affiliates/by-code/:code",
    limiters.referral,
    route(async (req, res) => {
      const raw = String(req.params.code || "").trim().slice(0, 64);
      if (!raw || !/^[A-Za-z0-9_-]+$/.test(raw)) {
        throw new HttpError(404, "errors.referralInactive");
      }
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT id, first_name, last_name, company, avatar_url, bio,
                referral_code, slug, status
         FROM affiliates
         WHERE referral_code = ? OR slug = ?
         LIMIT 1`,
        [raw.toUpperCase(), raw.toLowerCase()],
      );
      const a = rows[0];
      if (!a || String(a.status) !== "active") {
        throw new HttpError(404, "errors.referralInactive");
      }
      const landingRaw = String(req.query.to || req.query.landing || "home");
      const landingKey = REFERRAL_LANDINGS[landingRaw] ? landingRaw : "home";
      await logAffiliateClick(req, Number(a.id), landingKey);
      const initials =
        `${String(a.first_name || "").charAt(0)}${String(a.last_name || "").charAt(0)}`.toUpperCase() ||
        "?";
      res.json({
        ok: true,
        affiliate: {
          first_name: String(a.first_name || ""),
          last_name: String(a.last_name || ""),
          company: a.company == null || a.company === "" ? null : String(a.company),
          avatar_url:
            a.avatar_url == null || a.avatar_url === ""
              ? null
              : String(a.avatar_url),
          bio: a.bio == null || a.bio === "" ? null : String(a.bio),
          referral_code: String(a.referral_code),
          slug: a.slug == null || a.slug === "" ? null : String(a.slug),
          initials,
        },
        landing: landingKey,
      });
    }),
  );

  // Compat redirect for advanced landings / old bookmarks. SPA owns `/r/:code`.
  app.get(
    "/api/public/r/:code",
    limiters.referral,
    route(async (req, res) => {
      const found = await findActiveAffiliateByCode(req.params.code);
      const landingKey = REFERRAL_LANDINGS[String(req.query.to || "home")]
        ? String(req.query.to || "home")
        : "home";
      if (!found) {
        if (landingKey === "home" || landingKey === "enroll") {
          return res.redirect(302, "/r/expired");
        }
        return res.redirect(302, REFERRAL_LANDINGS[landingKey]);
      }
      await logAffiliateClick(req, found.id, landingKey);
      if (landingKey === "home" || landingKey === "enroll") {
        return res.redirect(
          302,
          `/r/${encodeURIComponent(found.referral_code)}`,
        );
      }
      const dest = REFERRAL_LANDINGS[landingKey];
      const sep = dest.includes("?") ? "&" : "?";
      return res.redirect(
        302,
        `${dest}${sep}ref=${encodeURIComponent(found.referral_code)}`,
      );
    }),
  );

  app.post(
    "/api/public/enroll",
    limiters.lead,
    route(async (req, res) => {
      const b = req.body || {};
      const first = String(b.first_name || "").trim().slice(0, 100);
      const last = String(b.last_name || "").trim().slice(0, 100);
      const email = normalizeEmail(b.email);
      const phone = String(b.phone || "").trim().slice(0, 40);
      const address = String(b.property_address || "").trim().slice(0, 500);
      const city = b.property_city
        ? String(b.property_city).trim().slice(0, 100)
        : null;
      const zip = b.property_zip
        ? String(b.property_zip).trim().slice(0, 20)
        : null;
      const planId = b.adu_plan_id ? parseId(b.adu_plan_id) : null;
      const lang = asLang(b.preferred_language);
      const softPull = Boolean(
        b.soft_pull_consent === true ||
          b.soft_pull_consent === 1 ||
          b.soft_pull_consent === "1",
      );
      if (!first) throw new HttpError(400, "validation.firstNameRequired");
      if (!last) throw new HttpError(400, "validation.lastNameRequired");
      if (!isValidEmail(email)) throw new HttpError(400, "validation.emailInvalid");
      if (phone.replace(/\D/g, "").length < 10) {
        throw new HttpError(400, "validation.phoneMin");
      }
      if (address.length < 5) throw new HttpError(400, "validation.addressRequired");
      if (!(b.homeowner_consent === true || b.homeowner_consent === 1)) {
        throw new HttpError(400, "validation.homeownerConsent");
      }

      const affiliateRef = await findActiveAffiliateByCode(b.referral_code);
      // Returning homeowner (same email): friendly outcome, never an error wall.
      // Not-yet-active homeowners get a fresh portal magic link.
      const [dup] = await pool.execute<RowDataPacket[]>(
        `SELECT id, status, first_name, preferred_language FROM clients WHERE email = ? LIMIT 1`,
        [email],
      );
      if (dup[0]) {
        const st = String(dup[0].status);
        if (st === "pending" || st === "prospect") {
          const token = await withTx(async (conn) => {
            await conn.execute(
              `UPDATE clients SET status = 'prospect' WHERE id = ? AND status = 'pending'`,
              [dup[0].id],
            );
            return issueClientPortalInvite(conn, {
              clientId: Number(dup[0].id),
              email,
              byType: "system",
              byId: null,
            });
          });
          await sendClientPortalInviteEmail({
            email,
            firstName: String(dup[0].first_name || first),
            lang: asLang(dup[0].preferred_language),
            token,
          });
          return res.json({ ok: true, outcome: "invite_resent", project_public_id: null, invite_sent: true });
        }
        return res.json({ ok: true, outcome: "exists", project_public_id: null, invite_sent: false });
      }
      // One role per person (e.g. an affiliate can't also enroll as a homeowner): staff alerted.
      if (
        await isPublicSignupDuplicate({
          source: "homeowner enrollment",
          attempted: "client",
          name: `${first} ${last}`,
          email,
          phone,
        })
      ) {
        return res.json({ ok: true, outcome: "exists", project_public_id: null, invite_sent: false });
      }

      const created = await withTx(async (conn) => {
        // Reuse this person's earlier lead (repeat forms merge) instead of a new row.
        const { id: leadId } = await upsertStandardLead(
          {
            first_name: first,
            last_name: last,
            full_name: `${first} ${last}`,
            email,
            phone,
            property_address: address,
            soft_pull_consent: softPull,
            source: "enroll",
            preferred_language: lang,
            notes: null,
            affiliate_id: affiliateRef?.id ?? null,
            referral_code: affiliateRef?.referral_code ?? null,
            status: "qualified",
            ip: clientIp(req),
            ua: String(req.headers["user-agent"] || "").slice(0, 500) || null,
          },
          conn,
        );
        const out = await createClientWithProject(conn, {
          email,
          first_name: first,
          last_name: last,
          phone,
          lang,
          property_address: address,
          property_city: city,
          property_zip: zip,
          affiliate_id: affiliateRef?.id ?? null,
          lead_id: leadId,
          adu_plan_id: planId,
          assigned_admin_id: null,
          byType: "system",
          byId: null,
        });
        await conn.execute(`UPDATE leads SET client_id = ?, status = 'qualified' WHERE id = ?`, [
          out.clientId,
          leadId,
        ]);
        const token = await issueClientPortalInvite(conn, {
          clientId: out.clientId,
          email,
          byType: "system",
          byId: null,
        });
        return { ...out, token };
      });

      await sendClientPortalInviteEmail({
        email,
        firstName: first,
        lang,
        token: created.token,
        publicId: created.publicId,
      });
      await notifyStaff("client_created", (l) => ({
        subject: tr(
          l,
          `New enrollment · ${created.publicId}`,
          `Nueva inscripción · ${created.publicId}`,
        ),
        headline: tr(l, "A homeowner enrolled.", "Un propietario se inscribió."),
        paragraphs: [
          tr(
            l,
            `${first} ${last} (${email}) started project ${created.publicId}.`,
            `${first} ${last} (${email}) inició el proyecto ${created.publicId}.`,
          ),
        ],
        details: [
          [tr(l, "Property", "Propiedad"), address],
          [
            tr(l, "Affiliate", "Afiliado"),
            affiliateRef?.referral_code || "—",
          ],
          [
            tr(l, "Soft pull", "Soft pull"),
            softPull ? tr(l, "Yes", "Sí") : tr(l, "No", "No"),
          ],
        ],
        cta: {
          url: `${APP_URL}/admin/projects/${created.publicId}`,
          label: tr(l, "Open project", "Abrir proyecto"),
        },
      }));
      res.status(201).json({
        ok: true,
        outcome: "created",
        project_public_id: created.publicId,
        invite_sent: true,
      });
    }),
  );

  async function loadValidClientInvite(token: unknown) {
    const t = String(token || "").trim();
    if (!/^[a-f0-9]{64}$/.test(t)) return null;
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT i.id, i.email, i.client_id, c.first_name, c.last_name, c.status,
              c.preferred_language, c.phone, c.avatar_url
       FROM client_portal_invites i
       JOIN clients c ON c.id = i.client_id
       WHERE i.token = ? AND i.accepted_at IS NULL AND i.expires_at > NOW()
         AND c.status IN ('prospect', 'active')
       LIMIT 1`,
      [t],
    );
    return rows[0] || null;
  }

  app.get(
    "/api/public/client-invite/:token",
    limiters.lead,
    route(async (req, res) => {
      const inv = await loadValidClientInvite(req.params.token);
      if (!inv) throw new HttpError(404, "errors.inviteInvalid");
      res.json({
        ok: true,
        email: inv.email,
        first_name: inv.first_name,
      });
    }),
  );

  app.post(
    "/api/public/client-invite/accept",
    limiters.lead,
    route(async (req, res) => {
      const inv = await loadValidClientInvite(req.body?.token);
      if (!inv) throw new HttpError(404, "errors.inviteInvalid");
      await pool.execute(
        `UPDATE client_portal_invites SET accepted_at = NOW() WHERE id = ?`,
        [inv.id],
      );
      const nextStatus = await markClientLoggedIn(
        Number(inv.client_id),
        String(inv.status),
      );
      await mintPortalSession(req, res, "client", Number(inv.client_id));
      const user = toPortalUser("client", {
        ...inv,
        id: inv.client_id,
        status: nextStatus,
      } as RowDataPacket);
      const payload: PortalAuthResponse = {
        ok: true,
        actor: "client",
        user,
      };
      res.json(payload);
    }),
  );

  async function loadValidInvite(token: unknown) {
    const t = String(token || "").trim();
    if (!/^[a-f0-9]{64}$/.test(t)) return null;
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT i.id, i.email, i.contractor_id, i.created_by_admin_id, c.first_name, c.company
       FROM contractor_invites i
       JOIN contractors c ON c.id = i.contractor_id
       WHERE i.token = ? AND i.accepted_at IS NULL AND i.expires_at > NOW()
         AND c.status IN ('invited', 'pending') LIMIT 1`,
      [t],
    );
    return rows[0] || null;
  }

  app.get(
    "/api/public/contractor-invite/:token",
    limiters.lead,
    route(async (req, res) => {
      const inv = await loadValidInvite(req.params.token);
      if (!inv) throw new HttpError(404, "errors.inviteInvalid");
      res.json({
        ok: true,
        email: inv.email,
        first_name: inv.first_name,
        company: inv.company,
      });
    }),
  );

  app.post(
    "/api/public/contractor-invite/accept",
    limiters.lead,
    route(async (req, res) => {
      const inv = await loadValidInvite(req.body?.token);
      if (!inv) throw new HttpError(404, "errors.inviteInvalid");
      const contractorId = Number(inv.contractor_id);
      const [appRows] = await pool.execute<RowDataPacket[]>(
        `SELECT status FROM contractor_applications WHERE contractor_id = ? LIMIT 1`,
        [contractorId],
      );
      // Already prequalified (e.g. re-invite) → activate as before.
      if (appRows[0]?.status === "approved") {
        await withTx(async (conn) => {
          await conn.execute(
            `UPDATE contractors SET status = 'active', activated_at = COALESCE(activated_at, NOW()) WHERE id = ?`,
            [contractorId],
          );
          await conn.execute(
            `UPDATE contractor_invites SET accepted_at = NOW() WHERE id = ?`,
            [inv.id],
          );
        });
        return res.json({ ok: true, email: inv.email, next: "login" });
      }
      // Otherwise accepting the invite starts the prequalification application.
      const applicationPath = await withTx(async (conn) => {
        await conn.execute(
          `UPDATE contractors SET status = 'pending' WHERE id = ? AND status = 'invited'`,
          [contractorId],
        );
        await conn.execute(
          `UPDATE contractor_invites SET accepted_at = NOW() WHERE id = ?`,
          [inv.id],
        );
        const app = await cpqEnsureApplication(conn, contractorId, {
          adminId: Number(inv.created_by_admin_id) || null,
        });
        await conn.execute(
          `UPDATE contractor_applications SET sent_at = COALESCE(sent_at, NOW()) WHERE id = ?`,
          [app.id],
        );
        await cpqLogEvent(conn, app.id, "invite_accepted", { type: "contractor" });
        return `/contractor/apply/${await cpqMintToken(conn, app.id)}`;
      });
      res.json({ ok: true, email: inv.email, next: "application", application_path: applicationPath });
    }),
  );

  // ── Affiliate ─────────────────────────────────────────────────────────────

  app.get(
    "/api/affiliate/overview",
    aff,
    route(async (req, res) => {
      const user = portalUser(res);
      const [aRows] = await pool.execute<RowDataPacket[]>(
        `SELECT referral_code, slug, company, first_name, last_name, avatar_url, bio,
                phone, preferred_language, email, parent_affiliate_id
         FROM affiliates WHERE id = ? LIMIT 1`,
        [user.id],
      );
      const a = aRows[0];
      const parentAffiliateId = a.parent_affiliate_id
        ? Number(a.parent_affiliate_id)
        : null;
      const [[clicks]] = (await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM affiliate_link_clicks WHERE affiliate_id = ?`,
        [user.id],
      )) as unknown as [RowDataPacket[]];
      const [[leads]] = (await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM leads WHERE affiliate_id = ?`,
        [user.id],
      )) as unknown as [RowDataPacket[]];
      const [milestones] = await pool.execute<RowDataPacket[]>(
        `SELECT milestone, COUNT(*) AS n FROM projects
         WHERE closer_affiliate_id = ? OR parent_affiliate_id = ? OR affiliate_id = ?
         GROUP BY milestone`,
        [user.id, user.id, user.id],
      );
      const [comm] = await pool.execute<RowDataPacket[]>(
        `SELECT status, COALESCE(SUM(amount_cents), 0) AS cents
         FROM affiliate_commissions WHERE affiliate_id = ? GROUP BY status`,
        [user.id],
      );
      const byMilestone = Object.fromEntries(
        milestones.map((m) => [String(m.milestone), Number(m.n)]),
      );
      const byComm = Object.fromEntries(
        comm.map((c) => [String(c.status), Number(c.cents)]),
      );
      const total = Object.values(byMilestone).reduce((s, n) => s + n, 0);
      const trackingCode = String(a.slug || a.referral_code);
      res.json({
        ok: true,
        affiliate: {
          referral_code: a.referral_code,
          slug: a.slug,
          company: a.company,
          first_name: a.first_name,
          last_name: a.last_name,
          avatar_url:
            a.avatar_url == null || a.avatar_url === ""
              ? null
              : String(a.avatar_url),
          bio: a.bio == null || a.bio === "" ? null : String(a.bio),
          tracking_url: `${requestPublicOrigin(req)}/r/${trackingCode}`,
          parent_affiliate_id: parentAffiliateId,
          can_manage_team: parentAffiliateId == null,
        },
        stats: {
          clicks: Number(clicks.n),
          leads: Number(leads.n),
          clients: total,
          in_process:
            (byMilestone.lead || 0) +
            (byMilestone.financing || 0) +
            (byMilestone.contracted || 0) +
            (byMilestone.in_build || 0),
          closed: byMilestone.closed || 0,
          commission_pending_cents: byComm.pending || 0,
          commission_approved_cents: byComm.approved || 0,
          commission_paid_cents: byComm.paid || 0,
          payout_days: await getSettingInt("commission_payout_days_after_loan_close", 5),
        },
      });
    }),
  );

  app.get(
    "/api/affiliate/clients",
    aff,
    route(async (_req, res) => {
      const user = portalUser(res);
      // Simplified milestones only — no loan/financial columns (decision 8B).
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT p.public_id, p.milestone, p.milestone_changed_at, p.property_city,
                p.sq_ft, p.created_at, pl.name AS plan_name,
                c.first_name, c.last_name, c.email, c.phone,
                ac.amount_cents AS commission_cents, ac.status AS commission_status,
                ac.expected_pay_at
         FROM projects p
         JOIN clients c ON c.id = p.client_id
         LEFT JOIN adu_plans pl ON pl.id = p.adu_plan_id
         LEFT JOIN affiliate_commissions ac
           ON ac.project_id = p.id AND ac.affiliate_id = ?
         WHERE p.closer_affiliate_id = ? OR p.parent_affiliate_id = ? OR p.affiliate_id = ?
         ORDER BY p.created_at DESC LIMIT 500`,
        [user.id, user.id, user.id, user.id],
      );
      res.json({ ok: true, clients: rows });
    }),
  );

  app.post(
    "/api/affiliate/clients",
    aff,
    route(async (req, res) => {
      const user = portalUser(res);
      const b = req.body || {};
      const first = String(b.first_name || "").trim().slice(0, 100);
      const last = String(b.last_name || "").trim().slice(0, 100);
      const email = normalizeEmail(b.email);
      const phone = String(b.phone || "").trim().slice(0, 40);
      const address = String(b.property_address || "").trim().slice(0, 500);
      const city = b.property_city ? String(b.property_city).trim().slice(0, 100) : null;
      const zip = b.property_zip ? String(b.property_zip).trim().slice(0, 20) : null;
      const planId = b.adu_plan_id ? parseId(b.adu_plan_id) : null;
      const lang = asLang(b.preferred_language);
      if (!first) throw new HttpError(400, "validation.firstNameRequired");
      if (!last) throw new HttpError(400, "validation.lastNameRequired");
      if (!isValidEmail(email)) throw new HttpError(400, "validation.emailInvalid");
      if (phone.replace(/\D/g, "").length < 10) throw new HttpError(400, "validation.phoneMin");
      if (address.length < 5) throw new HttpError(400, "validation.addressRequired");
      if (!(b.homeowner_consent === true || b.homeowner_consent === 1)) {
        throw new HttpError(400, "validation.homeownerConsent");
      }
      const [dup] = await pool.execute<RowDataPacket[]>(
        `SELECT id FROM clients WHERE email = ? LIMIT 1`,
        [email],
      );
      if (dup.length) throw new HttpError(409, "errors.clientExists");
      // One role per person; affiliates only learn the role that matched.
      await assertPersonAvailable({ email, phone, actor: "affiliate" });

      const created = await withTx((conn) =>
        createClientWithProject(conn, {
          email,
          first_name: first,
          last_name: last,
          phone,
          lang,
          property_address: address,
          property_city: city,
          property_zip: zip,
          affiliate_id: user.id,
          lead_id: null,
          adu_plan_id: planId,
          assigned_admin_id: null,
          byType: "affiliate",
          byId: user.id,
        }),
      );
      const inviteToken = await issueClientPortalInvite(pool, {
        clientId: created.clientId,
        email,
        byType: "affiliate",
        byId: user.id,
      });
      await sendClientPortalInviteEmail({
        email,
        firstName: first,
        lang,
        token: inviteToken,
        publicId: created.publicId,
      });
      await notifyStaff("affiliate_client_registered", (l) => ({
        subject: tr(l, `Affiliate registered a client: ${first} ${last}`, `Un afiliado registró un cliente: ${first} ${last}`),
        headline: tr(l, "New client from an affiliate", "Nuevo cliente de un afiliado"),
        paragraphs: [
          tr(l, `${user.first_name} ${user.last_name} registered a homeowner.`, `${user.first_name} ${user.last_name} registró a un propietario.`),
        ],
        details: [
          [tr(l, "Client", "Cliente"), `${first} ${last}`],
          ["Email", email],
          [tr(l, "Phone", "Teléfono"), phone],
          [tr(l, "Property", "Propiedad"), address],
          [tr(l, "Project", "Proyecto"), created.publicId],
        ],
        cta: { url: `${APP_URL}/admin/projects/${created.publicId}`, label: tr(l, "Open project", "Abrir proyecto") },
      }));
      res.status(201).json({
        ok: true,
        client_id: created.clientId,
        project_public_id: created.publicId,
        invite_sent: true,
      });
    }),
  );

  app.get(
    "/api/affiliate/me",
    aff,
    route(async (_req, res) => {
      const user = portalUser(res);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT id, email, first_name, last_name, phone, company, status,
                preferred_language, referral_code, slug, avatar_url, bio
         FROM affiliates WHERE id = ? LIMIT 1`,
        [user.id],
      );
      if (!rows[0]) throw new HttpError(404, "errors.notFound");
      const a = rows[0];
      res.json({
        ok: true,
        profile: {
          ...toPortalUser("affiliate", a),
          company: a.company == null || a.company === "" ? null : String(a.company),
          referral_code: String(a.referral_code),
          slug: a.slug == null || a.slug === "" ? null : String(a.slug),
          bio: a.bio == null || a.bio === "" ? null : String(a.bio),
        },
      });
    }),
  );

  app.patch(
    "/api/affiliate/me",
    aff,
    route(async (req, res) => {
      const me = portalUser(res);
      const { updates } = parsePatch(req.body, {
        first_name: fStr(100, { min: 1 }),
        last_name: fStr(100, { min: 1 }),
        phone: fStr(40),
        company: fStr(200),
        preferred_language: fLang,
        bio: fStr(500),
      });
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "slug")) {
        updates.slug = normalizeAffiliateSlugInput(req.body.slug);
        await assertAffiliateSlugAvailable(updates.slug as string | null, me.id);
      }
      if (Object.keys(updates).length === 0) {
        throw new HttpError(400, "validation.invalidField");
      }
      if ("phone" in updates && updates.phone != null && updates.phone !== "") {
        if (String(updates.phone).replace(/\D/g, "").length < 10) {
          throw new HttpError(400, "validation.phoneMin");
        }
      }
      if ("phone" in updates && (updates.phone === "" || updates.phone == null)) {
        updates.phone = null;
      }
      if ("company" in updates && (updates.company === "" || updates.company == null)) {
        updates.company = null;
      }
      if ("bio" in updates && (updates.bio === "" || updates.bio == null)) {
        updates.bio = null;
      }
      await assertIdentityEditAllowed({ entity: "affiliate", id: me.id, updates, actor: "affiliate" });
      await applyUpdate(pool, "affiliates", me.id, updates);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT id, email, first_name, last_name, phone, company, status,
                preferred_language, referral_code, slug, avatar_url, bio
         FROM affiliates WHERE id = ? LIMIT 1`,
        [me.id],
      );
      if (!rows[0]) throw new HttpError(404, "errors.notFound");
      const a = rows[0];
      res.json({
        ok: true,
        user: toPortalUser("affiliate", a),
        profile: {
          ...toPortalUser("affiliate", a),
          company: a.company == null || a.company === "" ? null : String(a.company),
          referral_code: String(a.referral_code),
          slug: a.slug == null || a.slug === "" ? null : String(a.slug),
          bio: a.bio == null || a.bio === "" ? null : String(a.bio),
        },
      });
    }),
  );

  app.post(
    "/api/affiliate/me/avatar",
    aff,
    express.raw({ type: PHOTO_MIME_TYPES, limit: PHOTO_MAX_BYTES }),
    route(async (req, res) => {
      const me = portalUser(res);
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw new HttpError(400, "validation.photoFile");
      }
      const kind = detectImageType(body);
      if (
        !kind ||
        kind.mime !==
          String(req.headers["content-type"] || "")
            .split(";")[0]
            .trim()
            .toLowerCase()
      ) {
        throw new HttpError(400, "validation.photoFile");
      }
      const avatarUrl = await storeAffiliateAvatarFile(
        me.id,
        body,
        kind.mime,
        kind.ext,
      );
      await pool.execute(`UPDATE affiliates SET avatar_url = ? WHERE id = ?`, [
        avatarUrl,
        me.id,
      ]);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT * FROM affiliates WHERE id = ? LIMIT 1`,
        [me.id],
      );
      if (!rows[0]) throw new HttpError(404, "errors.notFound");
      res.json({ ok: true, user: toPortalUser("affiliate", rows[0]) });
    }),
  );

  app.get(
    "/api/affiliate/commissions",
    aff,
    route(async (_req, res) => {
      const user = portalUser(res);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT ac.id, ac.role, p.public_id AS project_public_id,
                CONCAT(c.first_name, ' ', c.last_name) AS client_name,
                ac.amount_cents, ac.sq_ft, ac.rate_cents_per_sqft, ac.status,
                ac.expected_pay_at, ac.paid_at, ac.created_at
         FROM affiliate_commissions ac
         JOIN projects p ON p.id = ac.project_id
         JOIN clients c ON c.id = p.client_id
         WHERE ac.affiliate_id = ? AND ac.status <> 'void'
         ORDER BY ac.created_at DESC LIMIT 500`,
        [user.id],
      );
      res.json({ ok: true, commissions: rows });
    }),
  );

  // ── Affiliate team (sub-affiliates) ───────────────────────────────────────
  async function assertTopLevelAffiliate(affiliateId: number) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, parent_affiliate_id, status FROM affiliates WHERE id = ? LIMIT 1`,
      [affiliateId],
    );
    const a = rows[0];
    if (!a || String(a.status) !== "active") {
      throw new HttpError(403, "errors.forbidden");
    }
    if (a.parent_affiliate_id) {
      throw new HttpError(403, "errors.subCannotInvite");
    }
    return a;
  }

  async function assertOwnedSub(parentId: number, subId: number) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM affiliates WHERE id = ? AND parent_affiliate_id = ? LIMIT 1`,
      [subId, parentId],
    );
    if (!rows[0]) throw new HttpError(404, "errors.notFound");
    return rows[0];
  }

  async function sendSubAffiliateWelcome(opts: {
    email: string;
    firstName: string;
    lang: Lang;
    parentName: string;
  }) {
    await safeSend(
      opts.email,
      tplPortalNotice({
        lang: opts.lang,
        subject: tr(
          opts.lang,
          "You're a Groundwork sub-affiliate",
          "Eres subafiliado de Groundwork",
        ),
        headline: tr(
          opts.lang,
          "Welcome to the team.",
          "Bienvenido al equipo.",
        ),
        paragraphs: [
          tr(
            opts.lang,
            `Hi ${opts.firstName}, ${opts.parentName} added you as a sub-affiliate.`,
            `Hola ${opts.firstName}, ${opts.parentName} te agregó como subafiliado.`,
          ),
          tr(
            opts.lang,
            "Sign in with your email and a one-time code to get your tracking link and register clients.",
            "Entra con tu correo y un código de un solo uso para obtener tu enlace y registrar clientes.",
          ),
        ],
        cta: {
          url: `${APP_URL}/affiliate/login`,
          label: tr(opts.lang, "Open affiliate portal", "Abrir portal de afiliados"),
        },
      }),
    );
  }

  app.get(
    "/api/affiliate/team",
    aff,
    route(async (_req, res) => {
      const user = portalUser(res);
      await assertTopLevelAffiliate(user.id);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT a.id, a.email, a.first_name, a.last_name, a.phone, a.company,
                a.status, a.referral_code, a.slug, a.created_at, a.last_login_at,
                (SELECT COUNT(*) FROM projects p
                  WHERE p.closer_affiliate_id = a.id OR p.affiliate_id = a.id) AS client_count,
                (SELECT COALESCE(SUM(ac.amount_cents), 0) FROM affiliate_commissions ac
                  WHERE ac.affiliate_id = a.id AND ac.status IN ('pending','approved','paid')) AS commission_cents
         FROM affiliates a
         WHERE a.parent_affiliate_id = ?
         ORDER BY a.created_at DESC
         LIMIT 200`,
        [user.id],
      );
      res.json({
        ok: true,
        team: rows.map((r) => ({
          id: Number(r.id),
          email: String(r.email),
          first_name: String(r.first_name),
          last_name: String(r.last_name),
          phone: r.phone ? String(r.phone) : null,
          company: r.company ? String(r.company) : null,
          status: String(r.status),
          referral_code: String(r.referral_code),
          slug: r.slug ? String(r.slug) : null,
          tracking_url: `${APP_URL}/r/${encodeURIComponent(String(r.slug || r.referral_code))}`,
          client_count: Number(r.client_count || 0),
          commission_cents: Number(r.commission_cents || 0),
          last_login_at: r.last_login_at ? String(r.last_login_at) : null,
          created_at: String(r.created_at),
        })),
      });
    }),
  );

  app.post(
    "/api/affiliate/team",
    aff,
    route(async (req, res) => {
      const user = portalUser(res);
      await assertTopLevelAffiliate(user.id);
      const b = req.body || {};
      const first = String(b.first_name || "").trim().slice(0, 100);
      const last = String(b.last_name || "").trim().slice(0, 100);
      const email = normalizeEmail(b.email);
      const phone = b.phone ? String(b.phone).trim().slice(0, 40) : null;
      const company = b.company ? String(b.company).trim().slice(0, 200) : null;
      const lang = asLang(b.preferred_language);
      if (!first) throw new HttpError(400, "validation.firstNameRequired");
      if (!last) throw new HttpError(400, "validation.lastNameRequired");
      if (!isValidEmail(email)) throw new HttpError(400, "validation.emailInvalid");
      if (phone && phone.replace(/\D/g, "").length < 10) {
        throw new HttpError(400, "validation.phoneMin");
      }
      const [existing] = await pool.execute<RowDataPacket[]>(
        `SELECT id FROM affiliates WHERE email = ? LIMIT 1`,
        [email],
      );
      if (existing.length) throw new HttpError(409, "errors.affiliateExists");
      // One role per person (no client / contractor / other affiliate with this email or phone).
      await assertPersonAvailable({ email, phone, actor: "affiliate" });

      // 4B: sub-affiliates activate immediately (admin can suspend later).
      const subId = await withNewAffiliateCodes(first, last, async ({ code, slug }) => {
        const [ins] = await pool.execute<ResultSetHeader>(
          `INSERT INTO affiliates
             (email, first_name, last_name, phone, company, status, preferred_language,
              referral_code, slug, parent_affiliate_id, approved_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, NOW())`,
          [email, first, last, phone, company, lang, code, slug, user.id],
        );
        return Number(ins.insertId);
      });
      await sendSubAffiliateWelcome({
        email,
        firstName: first,
        lang,
        parentName: `${user.first_name} ${user.last_name}`.trim(),
      });
      await notifyStaff("affiliate_signup", (l) => ({
        subject: tr(
          l,
          `New sub-affiliate: ${first} ${last}`,
          `Nuevo subafiliado: ${first} ${last}`,
        ),
        headline: tr(l, "Sub-affiliate added", "Subafiliado agregado"),
        paragraphs: [
          tr(
            l,
            `${user.first_name} ${user.last_name} added a sub-affiliate (active).`,
            `${user.first_name} ${user.last_name} agregó un subafiliado (activo).`,
          ),
        ],
        details: [
          [tr(l, "Name", "Nombre"), `${first} ${last}`],
          ["Email", email],
          [tr(l, "Parent", "Padre"), `${user.first_name} ${user.last_name}`],
        ],
        cta: {
          url: `${APP_URL}/admin/affiliates/${subId}`,
          label: tr(l, "Open affiliate", "Abrir afiliado"),
        },
      }));
      res.status(201).json({ ok: true, affiliate_id: subId });
    }),
  );

  app.post(
    "/api/affiliate/team/:id/resend",
    aff,
    route(async (req, res) => {
      const user = portalUser(res);
      await assertTopLevelAffiliate(user.id);
      const sub = await assertOwnedSub(user.id, parseId(req.params.id));
      await sendSubAffiliateWelcome({
        email: String(sub.email),
        firstName: String(sub.first_name || ""),
        lang: asLang(sub.preferred_language),
        parentName: `${user.first_name} ${user.last_name}`.trim(),
      });
      res.json({ ok: true });
    }),
  );

  app.patch(
    "/api/affiliate/team/:id",
    aff,
    route(async (req, res) => {
      const user = portalUser(res);
      await assertTopLevelAffiliate(user.id);
      const subId = parseId(req.params.id);
      await assertOwnedSub(user.id, subId);
      const { updates } = parsePatch(req.body, {
        status: fEnum(["active", "inactive"] as const),
      });
      if (!Object.keys(updates).length) {
        throw new HttpError(400, "validation.invalidField");
      }
      await applyUpdate(pool, "affiliates", subId, updates);
      res.json({ ok: true });
    }),
  );

  app.get(
    "/api/affiliate/team/:id/clients",
    aff,
    route(async (req, res) => {
      const user = portalUser(res);
      await assertTopLevelAffiliate(user.id);
      const subId = parseId(req.params.id);
      await assertOwnedSub(user.id, subId);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT p.public_id, p.milestone, p.property_city, p.sq_ft, p.created_at,
                c.first_name, c.last_name, c.email, c.phone,
                ac.amount_cents AS commission_cents, ac.status AS commission_status, ac.role
         FROM projects p
         JOIN clients c ON c.id = p.client_id
         LEFT JOIN affiliate_commissions ac
           ON ac.project_id = p.id AND ac.affiliate_id = ?
         WHERE p.closer_affiliate_id = ? OR p.affiliate_id = ?
         ORDER BY p.created_at DESC LIMIT 500`,
        [subId, subId, subId],
      );
      res.json({ ok: true, clients: rows });
    }),
  );

  app.get(
    "/api/affiliate/team/:id/commissions",
    aff,
    route(async (req, res) => {
      const user = portalUser(res);
      await assertTopLevelAffiliate(user.id);
      const subId = parseId(req.params.id);
      await assertOwnedSub(user.id, subId);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT ac.id, ac.role, p.public_id AS project_public_id,
                CONCAT(c.first_name, ' ', c.last_name) AS client_name,
                ac.amount_cents, ac.sq_ft, ac.status, ac.expected_pay_at, ac.paid_at, ac.created_at
         FROM affiliate_commissions ac
         JOIN projects p ON p.id = ac.project_id
         JOIN clients c ON c.id = p.client_id
         WHERE ac.affiliate_id = ? AND ac.status <> 'void'
         ORDER BY ac.created_at DESC LIMIT 500`,
        [subId],
      );
      res.json({ ok: true, commissions: rows });
    }),
  );

  // ── Contractor ────────────────────────────────────────────────────────────

  const CONTRACTOR_PROJECT_SELECT = `
    SELECT p.public_id, p.milestone, p.property_address, p.property_city, p.property_zip,
           p.sq_ft, p.created_at, pl.name AS plan_name,
           CONCAT(c.first_name, ' ', c.last_name) AS client_name, c.phone AS client_phone,
           p.contractor_cost_cents AS budget_cents,
           (SELECT COALESCE(SUM(d.amount_cents), 0) FROM draw_requests d
             WHERE d.project_id = p.id AND d.status IN ('submitted','approved','paid')) AS drawn_cents,
           (SELECT COUNT(*) FROM project_photos ph WHERE ph.project_id = p.id) AS photo_count
    FROM projects p
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN adu_plans pl ON pl.id = p.adu_plan_id`;

  async function loadContractorProject(contractorId: number, publicId: string) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `${CONTRACTOR_PROJECT_SELECT} WHERE p.contractor_id = ? AND p.public_id = ? LIMIT 1`,
      [contractorId, publicId],
    );
    return rows[0] || null;
  }

  async function contractorProjectInternalId(publicId: string, contractorId: number) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, milestone, contractor_cost_cents FROM projects
       WHERE public_id = ? AND contractor_id = ? LIMIT 1`,
      [publicId, contractorId],
    );
    if (!rows[0]) throw new HttpError(404, "errors.notFound");
    return rows[0];
  }

  app.get(
    "/api/contractor/projects",
    ctr,
    route(async (_req, res) => {
      const user = portalUser(res);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `${CONTRACTOR_PROJECT_SELECT} WHERE p.contractor_id = ?
         ORDER BY p.created_at DESC LIMIT 200`,
        [user.id],
      );
      res.json({ ok: true, projects: rows });
    }),
  );

  app.get(
    "/api/contractor/projects/:publicId",
    ctr,
    route(async (req, res) => {
      const user = portalUser(res);
      const publicId = parsePublicId(req.params.publicId);
      const project = await loadContractorProject(user.id, publicId);
      if (!project) throw new HttpError(404, "errors.notFound");
      const meta = await contractorProjectInternalId(publicId, user.id);
      const pid = Number(meta.id);
      const [photos] = await pool.execute<RowDataPacket[]>(
        `SELECT id, storage_url, caption, taken_at, created_at FROM project_photos
         WHERE project_id = ? ORDER BY id DESC LIMIT 200`,
        [pid],
      );
      const [draws] = await pool.execute<RowDataPacket[]>(
        `SELECT id, project_id, amount_cents, status, note, reviewed_at, paid_at, created_at
         FROM draw_requests WHERE project_id = ? AND contractor_id = ? ORDER BY id DESC`,
        [pid, user.id],
      );
      const [contracts] = await pool.execute<RowDataPacket[]>(
        `SELECT id, project_id, kind, status, storage_url, generated_at, signed_at, created_at
         FROM project_contracts
         WHERE project_id = ? AND kind = 'contractor_client' AND status <> 'void'
         ORDER BY id DESC`,
        [pid],
      );
      res.json({ ok: true, project, photos, draws, contracts });
    }),
  );

  app.get(
    "/api/contractor/photos",
    ctr,
    route(async (_req, res) => {
      const user = portalUser(res);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT ph.id, ph.storage_url, ph.caption, ph.taken_at, ph.created_at,
                p.public_id AS project_public_id, p.property_address
         FROM project_photos ph JOIN projects p ON p.id = ph.project_id
         WHERE p.contractor_id = ? ORDER BY ph.id DESC LIMIT 300`,
        [user.id],
      );
      res.json({ ok: true, photos: rows });
    }),
  );

  app.post(
    "/api/contractor/projects/:publicId/photos",
    ctr,
    route(async (req, res) => {
      const user = portalUser(res);
      const meta = await contractorProjectInternalId(
        parsePublicId(req.params.publicId),
        user.id,
      );
      if (meta.milestone === "cancelled") {
        throw new HttpError(400, "errors.projectNotActive");
      }
      const url = String(req.body?.storage_url || "").trim();
      if (!isAllowedPhotoUrl(url)) {
        throw new HttpError(400, "validation.photoUrl");
      }
      const caption = req.body?.caption
        ? String(req.body.caption).trim().slice(0, 300)
        : null;
      const [r] = await pool.execute<ResultSetHeader>(
        `INSERT INTO project_photos (project_id, uploaded_by_contractor_id, storage_url, caption, taken_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [meta.id, user.id, url, caption],
      );
      res.status(201).json({ ok: true, id: Number(r.insertId) });
    }),
  );

  app.post(
    "/api/contractor/projects/:publicId/photos/upload",
    ctr,
    express.raw({ type: PHOTO_MIME_TYPES, limit: PHOTO_MAX_BYTES }),
    route(async (req, res) => {
      const user = portalUser(res);
      const publicId = parsePublicId(req.params.publicId);
      const meta = await contractorProjectInternalId(publicId, user.id);
      if (meta.milestone === "cancelled") {
        throw new HttpError(400, "errors.projectNotActive");
      }
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw new HttpError(400, "validation.photoFile");
      }
      const kind = detectImageType(body);
      if (!kind || kind.mime !== String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase()) {
        throw new HttpError(400, "validation.photoFile");
      }
      const caption = req.query.caption
        ? String(req.query.caption).trim().slice(0, 300)
        : null;
      const storageUrl = await storeProjectPhotoFile(publicId, body, kind.mime, kind.ext);
      const [r] = await pool.execute<ResultSetHeader>(
        `INSERT INTO project_photos (project_id, uploaded_by_contractor_id, storage_url, caption, taken_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [meta.id, user.id, storageUrl, caption],
      );
      res.status(201).json({ ok: true, id: Number(r.insertId), storage_url: storageUrl });
    }),
  );

  app.get(
    "/api/contractor/contracts/:id/pdf",
    ctr,
    route(async (req, res) => {
      const user = portalUser(res);
      const id = parseId(req.params.id);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT pc.id, pc.kind, pc.status, pc.payload_json, p.public_id
         FROM project_contracts pc JOIN projects p ON p.id = pc.project_id
         WHERE pc.id = ? AND p.contractor_id = ? AND pc.kind = 'contractor_client'
           AND pc.status IN ('generated','sent','signed') LIMIT 1`,
        [id, user.id],
      );
      sendContractPdf(res, rows[0], req.query.lang ?? user.preferred_language);
    }),
  );

  app.get(
    "/api/contractor/draws",
    ctr,
    route(async (_req, res) => {
      const user = portalUser(res);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT d.id, d.project_id, d.amount_cents, d.status, d.note, d.reviewed_at,
                d.paid_at, d.created_at, p.public_id AS project_public_id, p.property_address
         FROM draw_requests d JOIN projects p ON p.id = d.project_id
         WHERE d.contractor_id = ? ORDER BY d.id DESC LIMIT 300`,
        [user.id],
      );
      res.json({ ok: true, draws: rows });
    }),
  );

  app.post(
    "/api/contractor/projects/:publicId/draws",
    ctr,
    route(async (req, res) => {
      const user = portalUser(res);
      const publicId = parsePublicId(req.params.publicId);
      const amount = Number(req.body?.amount_cents);
      if (!Number.isInteger(amount) || amount <= 0 || amount > 1_000_000_000) {
        throw new HttpError(400, "validation.drawAmount");
      }
      const note = req.body?.note ? String(req.body.note).trim().slice(0, 2000) : null;
      const submit = req.body?.submit !== false;
      const drawId = await withTx(async (conn) => {
        const [rows] = await conn.execute<RowDataPacket[]>(
          `SELECT id, milestone, contractor_cost_cents, draw_committed_cents
           FROM projects WHERE public_id = ? AND contractor_id = ? LIMIT 1 FOR UPDATE`,
          [publicId, user.id],
        );
        const meta = rows[0];
        if (!meta) throw new HttpError(404, "errors.notFound");
        if (!["contracted", "in_build"].includes(String(meta.milestone))) {
          throw new HttpError(400, "errors.projectNotActive");
        }
        if (meta.contractor_cost_cents == null) {
          throw new HttpError(400, "errors.drawBudgetRequired");
        }
        // Atomic budget reservation — works under TiDB optimistic concurrency.
        const [reserve] = await conn.execute<ResultSetHeader>(
          `UPDATE projects
           SET draw_committed_cents = draw_committed_cents + ?
           WHERE id = ?
             AND contractor_cost_cents IS NOT NULL
             AND draw_committed_cents + ? <= contractor_cost_cents`,
          [amount, meta.id, amount],
        );
        if (Number(reserve.affectedRows) !== 1) {
          throw new HttpError(400, "errors.drawExceedsBudget");
        }
        const [r] = await conn.execute<ResultSetHeader>(
          `INSERT INTO draw_requests (project_id, contractor_id, amount_cents, status, note)
           VALUES (?, ?, ?, ?, ?)`,
          [meta.id, user.id, amount, submit ? "submitted" : "draft", note],
        );
        return Number(r.insertId);
      });
      if (submit) {
        await notifyDrawSubmitted(user, publicId, amount);
      }
      res.status(201).json({ ok: true, id: drawId });
    }),
  );

  async function notifyDrawSubmitted(
    user: PortalAuthUser,
    publicId: string,
    amount: number,
  ) {
    await notifyStaff("draw_submitted", (l) => ({
      subject: tr(l, `Draw request ${money(amount)} · ${publicId}`, `Solicitud de desembolso ${money(amount)} · ${publicId}`),
      headline: tr(l, "New draw request", "Nueva solicitud de desembolso"),
      paragraphs: [
        tr(l, `${user.first_name} ${user.last_name} submitted a draw request for review.`, `${user.first_name} ${user.last_name} envió una solicitud de desembolso para revisión.`),
      ],
      details: [
        [tr(l, "Project", "Proyecto"), publicId],
        [tr(l, "Amount", "Monto"), money(amount)],
      ],
      cta: { url: `${APP_URL}/admin/draws`, label: tr(l, "Review draws", "Revisar desembolsos") },
    }));
  }

  app.post(
    "/api/contractor/draws/:id/submit",
    ctr,
    route(async (req, res) => {
      const user = portalUser(res);
      const id = parseId(req.params.id);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT d.id, d.amount_cents, d.status, p.public_id
         FROM draw_requests d JOIN projects p ON p.id = d.project_id
         WHERE d.id = ? AND d.contractor_id = ? LIMIT 1`,
        [id, user.id],
      );
      const d = rows[0];
      if (!d) throw new HttpError(404, "errors.notFound");
      if (d.status !== "draft") throw new HttpError(409, "errors.invalidTransition");
      await pool.execute(`UPDATE draw_requests SET status = 'submitted' WHERE id = ?`, [id]);
      await notifyDrawSubmitted(user, String(d.public_id), Number(d.amount_cents));
      res.json({ ok: true });
    }),
  );

  // ── Client (homeowner) ────────────────────────────────────────────────────

  app.get(
    "/api/client/overview",
    cli,
    route(async (_req, res) => {
      const user = portalUser(res);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT p.id, p.public_id, p.milestone, p.milestone_changed_at, p.loan_status,
                p.property_address, p.property_city, p.sq_ft,
                pl.name AS plan_name, pl.bedrooms AS plan_bedrooms,
                pl.bathrooms AS plan_bathrooms, pl.stories AS plan_stories,
                pl.sq_ft AS plan_sq_ft, pl.exterior_image_url, pl.layout_image_url,
                COALESCE(NULLIF(k.company, ''), CONCAT(k.first_name, ' ', k.last_name)) AS contractor_name
         FROM projects p
         LEFT JOIN adu_plans pl ON pl.id = p.adu_plan_id
         LEFT JOIN contractors k ON k.id = p.contractor_id
         WHERE p.client_id = ? ORDER BY p.created_at DESC LIMIT 20`,
        [user.id],
      );
      const projects = [];
      for (const r of rows) {
        const [events] = await pool.execute<RowDataPacket[]>(
          `SELECT id, from_milestone, to_milestone, changed_by_type, note, created_at
           FROM project_milestone_events WHERE project_id = ? ORDER BY id ASC`,
          [r.id],
        );
        const [photos] = await pool.execute<RowDataPacket[]>(
          `SELECT id, storage_url, caption, taken_at, created_at FROM project_photos
           WHERE project_id = ? ORDER BY id DESC LIMIT 24`,
          [r.id],
        );
        projects.push({
          public_id: r.public_id,
          milestone: r.milestone,
          milestone_changed_at: r.milestone_changed_at,
          loan_status: r.loan_status,
          property_address: r.property_address,
          property_city: r.property_city,
          sq_ft: r.sq_ft,
          plan: r.plan_name
            ? {
                name: r.plan_name,
                bedrooms: r.plan_bedrooms,
                bathrooms: r.plan_bathrooms,
                stories: r.plan_stories,
                sq_ft: r.plan_sq_ft,
                exterior_image_url: r.exterior_image_url,
                layout_image_url: r.layout_image_url,
              }
            : null,
          contractor_name: r.contractor_name,
          events,
          photos,
        });
      }
      res.json({ ok: true, projects });
    }),
  );

  app.get(
    "/api/client/documents",
    cli,
    route(async (_req, res) => {
      const user = portalUser(res);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT pc.id, p.public_id AS project_public_id, pc.kind, pc.status,
                pc.storage_url, pc.generated_at, pc.signed_at
         FROM project_contracts pc JOIN projects p ON p.id = pc.project_id
         WHERE p.client_id = ? AND pc.kind <> 'affiliate_terms'
           AND pc.status IN ('generated','sent','signed')
         ORDER BY pc.id DESC LIMIT 100`,
        [user.id],
      );
      res.json({ ok: true, documents: rows });
    }),
  );

  app.get(
    "/api/client/documents/:id/pdf",
    cli,
    route(async (req, res) => {
      const user = portalUser(res);
      const id = parseId(req.params.id);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT pc.id, pc.kind, pc.status, pc.payload_json, p.public_id
         FROM project_contracts pc JOIN projects p ON p.id = pc.project_id
         WHERE pc.id = ? AND p.client_id = ? AND pc.kind <> 'affiliate_terms'
           AND pc.status IN ('generated','sent','signed') LIMIT 1`,
        [id, user.id],
      );
      sendContractPdf(res, rows[0], req.query.lang ?? user.preferred_language);
    }),
  );

  registerAdminRoutes(app);
}

/** Stream a contract PDF rendered on demand from its stored payload snapshot. */
function sendContractPdf(res: Response, row: RowDataPacket | undefined, lang: unknown) {
  if (!row) throw new HttpError(404, "errors.notFound");
  let payload: ContractPayload | null = null;
  try {
    payload =
      typeof row.payload_json === "string"
        ? JSON.parse(row.payload_json)
        : (row.payload_json as ContractPayload | null);
  } catch {
    payload = null;
  }
  if (!payload || typeof payload !== "object") throw new HttpError(404, "errors.notFound");
  const pdf = buildContractPdf({
    payload,
    kind: String(row.kind),
    status: String(row.status),
    lang: asLang(lang),
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="contract-${String(row.public_id).replace(/[^A-Za-z0-9-]/g, "")}-${Number(row.id)}.pdf"`,
  );
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.status(200).send(pdf);
}


// ─── Portal feature layer: admin routes ──────────────────────────────────────

function likeParam(q: unknown): string | null {
  const s = String(q || "").trim().slice(0, 80);
  return s ? `%${s.replace(/[%_\\]/g, "\\$&")}%` : null;
}

function enumQuery(v: unknown, allowed: readonly string[]): string | null {
  const s = String(v || "");
  return (allowed as readonly string[]).includes(s) ? s : null;
}

function parseListPaging(req: { query: Record<string, unknown> }): {
  limit: number;
  offset: number;
} {
  const limitRaw = Number(req.query.limit);
  const offsetRaw = Number(req.query.offset);
  const limit = Math.min(
    100,
    Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 50),
  );
  const offset = Math.max(
    0,
    Number.isFinite(offsetRaw) ? Math.floor(offsetRaw) : 0,
  );
  return { limit, offset };
}

function parseIdQuery(v: unknown): number | null {
  if (v == null || String(v).trim() === "") return null;
  try {
    return parseId(v);
  } catch {
    return null;
  }
}

/**
 * Lead → client / affiliate / contractor with the one-role rule: a person who
 * already holds a *different* role (by email or phone) can't be converted.
 * Same-role phone matches keep the existing confirm_phone_link flow; other-role
 * phone-only matches need a staff `shared_phone_reason` (audited).
 */
async function runAdminLeadConvert(opts: {
  user: PortalAuthUser;
  leadId: number;
  body: Record<string, unknown>;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const rawTarget = String(opts.body?.target || "client").trim().toLowerCase();
  const target: PersonEntity =
    rawTarget === "affiliate" || rawTarget === "contractor" ? rawTarget : "client";
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT email, phone FROM leads WHERE id = ? LIMIT 1`,
    [opts.leadId],
  );
  let phoneOverride: { reason: string; matches: PersonMatch[] } | null = null;
  if (rows[0]) {
    const otherRole = (await findPersonMatches({ email: rows[0].email, phone: rows[0].phone })).filter(
      (m) => m.entity !== target,
    );
    const byEmail = otherRole.find((m) => m.by === "email");
    if (byEmail) {
      throw new HttpError(409, emailExistsErrorKey(byEmail.entity), { match: byEmail });
    }
    if (otherRole.length) {
      const reason = String(opts.body?.shared_phone_reason ?? "").trim().slice(0, 500);
      if (reason.length < SHARED_PHONE_REASON_MIN) {
        throw new HttpError(409, "errors.personPhoneMatch", { match: otherRole[0], can_override: true });
      }
      phoneOverride = { reason, matches: otherRole };
    }
  }
  const out = await runAdminLeadConvertInner(opts);
  if (phoneOverride && out.status < 300) {
    const id = Number(out.body.client_id ?? out.body.affiliate_id ?? out.body.contractor_id);
    if (id) {
      await recordSharedPhoneOverride({ entity: target, id, override: phoneOverride, adminId: opts.user.id });
    }
  }
  return out;
}

async function runAdminLeadConvertInner(
  opts: {
    user: PortalAuthUser;
    leadId: number;
    body: Record<string, unknown>;
  },
): Promise<{ status: number; body: Record<string, unknown> }> {
      const user = opts.user;
      const id = opts.leadId;
      const rawTarget = String(opts.body?.target || "client").trim().toLowerCase();
      const target = (
        rawTarget === "affiliate" || rawTarget === "contractor" ? rawTarget : "client"
      ) as LeadConvertTarget;
      const confirmPhoneLink = opts.body?.confirm_phone_link === true;
      const statusRaw = String(opts.body?.status || "").trim().toLowerCase();
      const chosenStatus: LeadConvertStatus =
        statusRaw === "pending" || statusRaw === "active"
          ? statusRaw
          : target === "contractor"
            ? "pending"
            : "active";

      if (target === "client" && !adminCan(user.role, "projects.write")) {
        throw new HttpError(403, "errors.forbidden");
      }
      if (
        (target === "affiliate" || target === "contractor") &&
        !adminCan(user.role, "approvals")
      ) {
        throw new HttpError(403, "errors.forbidden");
      }

      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT * FROM leads WHERE id = ? LIMIT 1`,
        [id],
      );
      const lead = rows[0];
      if (!lead) throw new HttpError(404, "errors.notFound");
      if (leadAlreadyConvertedRow(lead)) {
        throw new HttpError(409, "errors.leadAlreadyConverted");
      }

      const email = normalizeEmail(lead.email);
      const first = String(lead.first_name || lead.full_name || "").slice(0, 100);
      const last = String(lead.last_name || "").slice(0, 100);
      const phone = lead.phone ? String(lead.phone).trim().slice(0, 40) : null;
      const lang = asLang(lead.preferred_language);

      // ── Client / homeowner (3a — existing behavior) ───────────────────────
      if (target === "client") {
        const planId = opts.body?.adu_plan_id ? parseId(opts.body.adu_plan_id) : null;
        const identity = await findIdentityByEmail(email);
        const phoneMatch = await findPhoneMatchDifferentEmail("client", phone, email);
        if (phoneMatch && !confirmPhoneLink) {
          return { status: 409, body: {
            error: "errors.phoneLinkConfirmRequired",
            phone_match: phoneMatch,
          } };
        }
        // Cross-table email block (6a). Phone-link to an existing client is the only override.
        if (
          identity &&
          identity.entity !== "client" &&
          !(confirmPhoneLink && phoneMatch)
        ) {
          throw new HttpError(409, emailExistsErrorKey(identity.entity));
        }
        let existingClientId: number | null = null;
        let inviteEmail = email;
        let inviteFirst = first;
        if (confirmPhoneLink && phoneMatch) {
          existingClientId = phoneMatch.id;
          inviteEmail = phoneMatch.email;
          inviteFirst = phoneMatch.name.split(/\s+/)[0] || first;
        } else if (identity?.entity === "client") {
          existingClientId = identity.id;
        }
        const created = await withTx(async (conn) => {
          const out = await createClientWithProject(conn, {
            email,
            first_name: first,
            last_name: last,
            phone,
            lang,
            property_address: lead.property_address,
            property_city: null,
            property_zip: null,
            affiliate_id: lead.affiliate_id ?? null,
            lead_id: Number(lead.id),
            adu_plan_id: planId,
            assigned_admin_id: user.id,
            byType: "admin",
            byId: user.id,
            existingClientId,
          });
          await conn.execute(
            `UPDATE leads SET client_id = ?, status = 'qualified' WHERE id = ?`,
            [out.clientId, id],
          );
          const token = await issueClientPortalInvite(conn, {
            clientId: out.clientId,
            email: inviteEmail,
            byType: "admin",
            byId: user.id,
          });
          return { ...out, token };
        });
        await sendClientPortalInviteEmail({
          email: inviteEmail,
          firstName: inviteFirst,
          lang,
          token: created.token,
          publicId: created.publicId,
        });
        await notifyStaff("lead_converted", (l) => ({
          subject: tr(l, `Lead converted · ${created.publicId}`, `Lead convertido · ${created.publicId}`),
          headline: tr(l, "Lead became a project.", "El lead se convirtió en proyecto."),
          paragraphs: [
            tr(
              l,
              `${first} (${lead.email}) → ${created.publicId}.`,
              `${first} (${lead.email}) → ${created.publicId}.`,
            ),
          ],
          cta: {
            url: `${APP_URL}/admin/projects/${created.publicId}`,
            label: tr(l, "Open project", "Abrir proyecto"),
          },
        }));
        return { status: 201, body: {
          ok: true,
          target: "client",
          client_id: created.clientId,
          project_public_id: created.publicId,
          invite_sent: true,
        } };
      }

      // ── Affiliate (4b) ───────────────────────────────────────────────────
      if (target === "affiliate") {
        const identity = await findIdentityByEmail(email);
        const phoneMatch = await findPhoneMatchDifferentEmail("affiliate", phone, email);
        if (phoneMatch && !confirmPhoneLink) {
          return { status: 409, body: {
            error: "errors.phoneLinkConfirmRequired",
            phone_match: phoneMatch,
          } };
        }
        if (identity && !(confirmPhoneLink && phoneMatch)) {
          throw new HttpError(409, emailExistsErrorKey(identity.entity));
        }
        let affiliateId: number;
        if (phoneMatch && confirmPhoneLink) {
          affiliateId = phoneMatch.id;
          await pool.execute(
            `UPDATE affiliates SET status = ?, approved_at = CASE
               WHEN ? = 'active' THEN COALESCE(approved_at, NOW()) ELSE approved_at END
             WHERE id = ?`,
            [chosenStatus, chosenStatus, affiliateId],
          );
        } else {
          let parentId: number | null =
            lead.affiliate_id != null ? Number(lead.affiliate_id) : null;
          if (parentId == null && lead.referral_code) {
            const parent = await findActiveAffiliateByCode(lead.referral_code);
            parentId = parent?.id ?? null;
          }
          const companyVal = companyFromLeadNotes(lead.notes);
          affiliateId = await withNewAffiliateCodes(
            first,
            last || first,
            async ({ code, slug }) => {
              const [ins] = await pool.execute<ResultSetHeader>(
                `INSERT INTO affiliates
                   (email, first_name, last_name, phone, company, status, preferred_language,
                    referral_code, slug, parent_affiliate_id, approved_at, notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${chosenStatus === "active" ? "NOW()" : "NULL"}, ?)`,
                [
                  email,
                  first,
                  last || first,
                  phone,
                  companyVal,
                  chosenStatus,
                  lang,
                  code,
                  slug,
                  parentId,
                  lead.notes ? String(lead.notes).slice(0, 5000) : null,
                ],
              );
              return Number(ins.insertId);
            },
          );
        }
        await pool.execute(
          `UPDATE leads SET converted_affiliate_id = ?, status = 'qualified' WHERE id = ?`,
          [affiliateId, id],
        );
        await notifyStaff("lead_converted", (l) => ({
          subject: tr(l, `Lead → affiliate · ${first} ${last}`, `Lead → afiliado · ${first} ${last}`),
          headline: tr(l, "Lead converted to affiliate.", "Lead convertido en afiliado."),
          paragraphs: [
            tr(
              l,
              `${first} (${email}) → affiliate #${affiliateId} (${chosenStatus}).`,
              `${first} (${email}) → afiliado #${affiliateId} (${chosenStatus}).`,
            ),
          ],
          cta: {
            url: `${APP_URL}/admin/affiliates/${affiliateId}`,
            label: tr(l, "Open affiliate", "Abrir afiliado"),
          },
        }));
        return { status: 201, body: {
          ok: true,
          target: "affiliate",
          affiliate_id: affiliateId,
        } };
      }

      // ── Contractor (5b — invite-first + pending|active) ───────────────────
      {
        const identity = await findIdentityByEmail(email);
        const phoneMatch = await findPhoneMatchDifferentEmail("contractor", phone, email);
        if (phoneMatch && !confirmPhoneLink) {
          return { status: 409, body: {
            error: "errors.phoneLinkConfirmRequired",
            phone_match: phoneMatch,
          } };
        }
        if (identity && !(confirmPhoneLink && phoneMatch)) {
          throw new HttpError(409, emailExistsErrorKey(identity.entity));
        }
        // Converting straight to active skips prequalification → super_admin override only.
        let activationOverride: string | null = null;
        if (chosenStatus === "active") {
          ({ override: activationOverride } = await assertContractorActivationAllowed(
            phoneMatch && confirmPhoneLink ? phoneMatch.id : null,
            user,
            opts.body?.override_reason,
          ));
        }
        const token = crypto.randomBytes(32).toString("hex");
        let contractorId: number;
        if (phoneMatch && confirmPhoneLink) {
          contractorId = phoneMatch.id;
          await withTx(async (conn) => {
            await conn.execute(
              `UPDATE contractors SET first_name = ?, last_name = ?, phone = COALESCE(?, phone),
                 preferred_language = ?, invited_by_admin_id = ?,
                 status = ?, activated_at = CASE WHEN ? = 'active' THEN COALESCE(activated_at, NOW()) ELSE activated_at END
               WHERE id = ?`,
              [
                first,
                last || first,
                phone,
                lang,
                user.id,
                chosenStatus === "active" ? "active" : "pending",
                chosenStatus,
                contractorId,
              ],
            );
            await conn.execute(
              `UPDATE contractor_invites SET expires_at = NOW()
               WHERE contractor_id = ? AND accepted_at IS NULL`,
              [contractorId],
            );
            await conn.execute(
              `INSERT INTO contractor_invites (token, email, contractor_id, created_by_admin_id, expires_at)
               VALUES (?, ?, ?, ?, ?)`,
              [
                token,
                String(phoneMatch.email),
                contractorId,
                user.id,
                new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              ],
            );
            if (chosenStatus === "active") {
              await conn.execute(
                `UPDATE contractor_invites SET accepted_at = NOW()
                 WHERE contractor_id = ? AND token = ?`,
                [contractorId, token],
              );
            }
          });
        } else {
          const companyVal = companyFromLeadNotes(lead.notes);
          contractorId = await withTx(async (conn) => {
            const [ins] = await conn.execute<ResultSetHeader>(
              `INSERT INTO contractors
                 (email, first_name, last_name, phone, company, status,
                  preferred_language, invited_by_admin_id, activated_at)
               VALUES (?, ?, ?, ?, ?, 'invited', ?, ?, NULL)`,
              [email, first, last || first, phone, companyVal, lang, user.id],
            );
            const cid = Number(ins.insertId);
            await conn.execute(
              `INSERT INTO contractor_invites (token, email, contractor_id, created_by_admin_id, expires_at)
               VALUES (?, ?, ?, ?, ?)`,
              [
                token,
                email,
                cid,
                user.id,
                new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              ],
            );
            if (chosenStatus === "active") {
              await conn.execute(
                `UPDATE contractors SET status = 'active', activated_at = NOW() WHERE id = ?`,
                [cid],
              );
              await conn.execute(
                `UPDATE contractor_invites SET accepted_at = NOW() WHERE contractor_id = ? AND token = ?`,
                [cid, token],
              );
            } else {
              await conn.execute(
                `UPDATE contractors SET status = 'pending' WHERE id = ?`,
                [cid],
              );
            }
            return cid;
          });
        }
        await pool.execute(
          `UPDATE leads SET converted_contractor_id = ?, status = 'qualified' WHERE id = ?`,
          [contractorId, id],
        );
        if (activationOverride) {
          await recordContractorActivationOverride(contractorId, user.id, activationOverride);
        }
        if (chosenStatus === "active") {
          const inviteEmail =
            phoneMatch && confirmPhoneLink ? String(phoneMatch.email) : email;
          await safeSend(
            inviteEmail,
            tplPortalNotice({
              lang,
              subject: tr(
                lang,
                "You're invited to the Groundwork contractor portal",
                "Te invitamos al portal de contratistas de Groundwork",
              ),
              headline: tr(lang, "Build with Groundwork.", "Construye con Groundwork."),
              paragraphs: [
                tr(
                  lang,
                  `Hi ${first}, you've been invited to manage ADU projects, upload progress photos and request draws.`,
                  `Hola ${first}, te invitamos a gestionar proyectos ADU, subir fotos de avance y solicitar desembolsos.`,
                ),
                tr(
                  lang,
                  "Your account is active — sign in with a one-time code anytime.",
                  "Tu cuenta está activa — inicia sesión con un código de un solo uso cuando quieras.",
                ),
              ],
              cta: {
                url: `${APP_URL}/contractor/login`,
                label: tr(lang, "Sign in", "Iniciar sesión"),
              },
            }),
          );
        } else {
          // Pending converts get the prequalification application as their invite.
          await sendContractorApplicationLink({ contractorId, adminId: user.id, variant: "new" });
        }
        await notifyStaff("lead_converted", (l) => ({
          subject: tr(
            l,
            `Lead → contractor · ${first} ${last}`,
            `Lead → contratista · ${first} ${last}`,
          ),
          headline: tr(l, "Lead converted to contractor.", "Lead convertido en contratista."),
          paragraphs: [
            tr(
              l,
              `${first} (${email}) → contractor #${contractorId} (${chosenStatus}).`,
              `${first} (${email}) → contratista #${contractorId} (${chosenStatus}).`,
            ),
          ],
          cta: {
            url: `${APP_URL}/admin/contractors/${contractorId}`,
            label: tr(l, "Open contractor", "Abrir contratista"),
          },
        }));
        return { status: 201, body: {
          ok: true,
          target: "contractor",
          contractor_id: contractorId,
          invite_sent: true,
        } };
      }
}

function registerAdminRoutes(app: Express) {
  // ── Self profile (any signed-in admin) ────────────────────────────────────
  app.patch(
    "/api/admin/me",
    requireAdmin(),
    route(async (req, res) => {
      const me = portalUser(res);
      const { updates } = parsePatch(req.body, {
        first_name: fStr(100, { min: 1 }),
        last_name: fStr(100, { min: 1 }),
        phone: fStr(20),
        preferred_language: fLang,
      });
      if (Object.keys(updates).length === 0) {
        throw new HttpError(400, "validation.invalidField");
      }
      if ("phone" in updates && updates.phone != null && updates.phone !== "") {
        if (String(updates.phone).replace(/\D/g, "").length < 10) {
          throw new HttpError(400, "validation.phoneMin");
        }
      }
      if ("phone" in updates && (updates.phone === "" || updates.phone == null)) {
        updates.phone = null;
      }
      await applyUpdate(pool, "admins", me.id, updates);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT * FROM admins WHERE id = ? LIMIT 1`,
        [me.id],
      );
      if (!rows[0]) throw new HttpError(404, "errors.notFound");
      res.json({ ok: true, user: toPortalUser("admin", rows[0]) });
    }),
  );

  app.get(
    "/api/admin/me/notification-prefs",
    requireAdmin(),
    route(async (_req, res) => {
      const me = portalUser(res);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT notification_prefs_json FROM admins WHERE id = ? LIMIT 1`,
        [me.id],
      );
      if (!rows[0]) throw new HttpError(404, "errors.notFound");
      res.json({
        ok: true,
        prefs: parseAdminNotificationPrefs(rows[0].notification_prefs_json),
        channels: await adminNotifyChannelMetaForAdmin(me.id),
        events: ADMIN_NOTIFY_EVENT_KEYS,
      });
    }),
  );

  app.put(
    "/api/admin/me/notification-prefs",
    requireAdmin(),
    route(async (req, res) => {
      const me = portalUser(res);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT notification_prefs_json FROM admins WHERE id = ? LIMIT 1`,
        [me.id],
      );
      if (!rows[0]) throw new HttpError(404, "errors.notFound");
      const existing = parseAdminNotificationPrefs(
        rows[0].notification_prefs_json,
      );
      const merged = mergeAdminNotificationPrefsFromBody(
        existing,
        (req.body || {}) as Record<string, unknown>,
      );
      if (!(await adminSmsChannelAvailable(me.id))) {
        merged.sms = existing.sms;
      }
      await pool.query(
        `UPDATE admins SET notification_prefs_json = ? WHERE id = ?`,
        [JSON.stringify(merged), me.id],
      );
      res.json({
        ok: true,
        prefs: merged,
        channels: await adminNotifyChannelMetaForAdmin(me.id),
        events: ADMIN_NOTIFY_EVENT_KEYS,
      });
    }),
  );

  app.get(
    "/api/admin/me/notifications",
    requireAdmin(),
    route(async (req, res) => {
      const me = portalUser(res);
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, event_key, title, body, link_url, read_at, created_at
         FROM admin_notifications
         WHERE admin_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
        [me.id, limit],
      );
      const [[countRow]] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM admin_notifications
         WHERE admin_id = ? AND read_at IS NULL`,
        [me.id],
      );
      res.json({
        ok: true,
        notifications: rows.map((r) => ({
          id: Number(r.id),
          event_key: String(r.event_key),
          title: String(r.title),
          body: r.body != null ? String(r.body) : null,
          link_url: r.link_url != null ? String(r.link_url) : null,
          read_at: r.read_at
            ? new Date(r.read_at as string | Date).toISOString()
            : null,
          created_at: new Date(r.created_at as string | Date).toISOString(),
        })),
        unread_count: Number(countRow?.cnt || 0),
      });
    }),
  );

  app.post(
    "/api/admin/me/notifications/read",
    requireAdmin(),
    route(async (req, res) => {
      const me = portalUser(res);
      const ids = Array.isArray(req.body?.ids)
        ? (req.body.ids as unknown[])
            .map((x) => Number(x))
            .filter((n) => Number.isFinite(n) && n > 0)
        : [];
      const markAll = !!req.body?.all;
      if (markAll) {
        await pool.query(
          `UPDATE admin_notifications SET read_at = NOW()
           WHERE admin_id = ? AND read_at IS NULL`,
          [me.id],
        );
      } else if (ids.length > 0) {
        await pool.query(
          `UPDATE admin_notifications SET read_at = NOW()
           WHERE admin_id = ? AND id IN (${ids.map(() => "?").join(",")}) AND read_at IS NULL`,
          [me.id, ...ids],
        );
      }
      const [[countRow]] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM admin_notifications
         WHERE admin_id = ? AND read_at IS NULL`,
        [me.id],
      );
      res.json({ ok: true, unread_count: Number(countRow?.cnt || 0) });
    }),
  );

  /** Ably token for in-app bell (notifications channel); conversations caps when unlocked. */
  app.get(
    "/api/admin/me/ably-token",
    requireAdmin(),
    route(async (_req, res) => {
      const me = portalUser(res);
      if (ablyKeyRejected) {
        return res.status(503).json({ error: "ably_not_configured" });
      }
      try {
        const tokenRequest = await mintAdminAblyTokenRequest(me.id);
        if (!tokenRequest) {
          return res.status(503).json({ error: "ably_not_configured" });
        }
        res.json({ ok: true, tokenRequest });
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        console.error("[ably:me-token]", msg);
        if (/invalid key/i.test(msg)) {
          ablyKeyRejected = true;
          return res.status(503).json({ error: "ably_not_configured" });
        }
        res.status(500).json({ error: "ably_token_failed" });
      }
    }),
  );

  app.post(
    "/api/admin/me/avatar",
    requireAdmin(),
    express.raw({ type: PHOTO_MIME_TYPES, limit: PHOTO_MAX_BYTES }),
    route(async (req, res) => {
      const me = portalUser(res);
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw new HttpError(400, "validation.photoFile");
      }
      const kind = detectImageType(body);
      if (
        !kind ||
        kind.mime !==
          String(req.headers["content-type"] || "")
            .split(";")[0]
            .trim()
            .toLowerCase()
      ) {
        throw new HttpError(400, "validation.photoFile");
      }
      const avatarUrl = await storeAdminAvatarFile(me.id, body, kind.mime, kind.ext);
      await pool.execute(`UPDATE admins SET avatar_url = ? WHERE id = ?`, [
        avatarUrl,
        me.id,
      ]);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT * FROM admins WHERE id = ? LIMIT 1`,
        [me.id],
      );
      if (!rows[0]) throw new HttpError(404, "errors.notFound");
      res.json({ ok: true, user: toPortalUser("admin", rows[0]) });
    }),
  );

  // ── Assignees (active staff for project/client assignment) ────────────────
  app.get(
    "/api/admin/assignees",
    requireAdmin("people.read"),
    route(async (_req, res) => {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT id, email, first_name, last_name, role
         FROM admins
         WHERE status = 'active'
         ORDER BY first_name ASC, last_name ASC, id ASC`,
      );
      res.json({
        ok: true,
        assignees: rows.map((r) => ({
          id: Number(r.id),
          email: String(r.email),
          first_name: String(r.first_name || ""),
          last_name: String(r.last_name || ""),
          role: String(r.role),
        })),
      });
    }),
  );

  // ── Dashboard ─────────────────────────────────────────────────────────────
  app.get(
    "/api/admin/dashboard",
    requireAdmin(),
    route(async (_req, res) => {
      const role = portalUser(res).role;
      const count = async (sql: string) => {
        const [rows] = await pool.query<RowDataPacket[]>(sql);
        return Number(rows[0]?.n || 0);
      };
      const [milestones] = await pool.query<RowDataPacket[]>(
        `SELECT milestone, COUNT(*) AS n FROM projects GROUP BY milestone`,
      );
      const [draws] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents
         FROM draw_requests WHERE status = 'submitted'`,
      );
      const out: Record<string, any> = {
        ok: true,
        leads_new: await count(`SELECT COUNT(*) AS n FROM leads WHERE status = 'new'`),
        affiliates_pending: await count(
          `SELECT COUNT(*) AS n FROM affiliates WHERE status = 'pending'`,
        ),
        clients_pending: await count(
          `SELECT COUNT(*) AS n FROM clients WHERE status = 'pending'`,
        ),
        contractors_pending: await count(
          `SELECT COUNT(*) AS n FROM contractors WHERE status = 'pending'`,
        ),
        contractors_invited: await count(
          `SELECT COUNT(*) AS n FROM contractors WHERE status = 'invited'`,
        ),
        draws_submitted: Number(draws[0]?.n || 0),
        draws_submitted_cents: Number(draws[0]?.cents || 0),
        projects_by_milestone: Object.fromEntries(
          milestones.map((m) => [String(m.milestone), Number(m.n)]),
        ),
      };
      if (adminCan(role, "finance.read")) {
        const [comm] = await pool.query<RowDataPacket[]>(
          `SELECT status, COALESCE(SUM(amount_cents), 0) AS cents
           FROM affiliate_commissions GROUP BY status`,
        );
        const byComm = Object.fromEntries(
          comm.map((c) => [String(c.status), Number(c.cents)]),
        );
        const [profit] = await pool.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS n, COALESCE(SUM(net_profit_cents), 0) AS net,
                  AVG(net_profit_per_sqft_cents) AS per_sqft
           FROM projects WHERE milestone = 'closed' AND net_profit_cents IS NOT NULL`,
        );
        out.finance = {
          commissions_pending_cents: byComm.pending || 0,
          commissions_approved_cents: byComm.approved || 0,
          commissions_paid_cents: byComm.paid || 0,
          projects_closed: Number(profit[0]?.n || 0),
          net_profit_closed_cents: Number(profit[0]?.net || 0),
          avg_net_profit_per_sqft_cents:
            profit[0]?.per_sqft == null ? null : Math.round(Number(profit[0].per_sqft)),
        };
      }
      res.json(out);
    }),
  );

  // ── Plans ─────────────────────────────────────────────────────────────────
  app.get(
    "/api/admin/plans",
    requireAdmin(),
    route(async (_req, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM adu_plans ORDER BY sort_order, id`,
      );
      res.json({ ok: true, plans: rows });
    }),
  );

  app.patch(
    "/api/admin/plans/:id",
    requireAdmin("plans.write"),
    route(async (req, res) => {
      const id = parseId(req.params.id);
      const { updates } = parsePatch(req.body, {
        name: fStr(120, { min: 1 }),
        description: fStr(5000),
        layout_image_url: fStr(500),
        exterior_image_url: fStr(500),
        is_active: fBool,
        sort_order: fInt(-1000, 1000, false),
        bedrooms: fInt(0, 20, false),
        stories: fInt(1, 5, false),
        sq_ft: fInt(1, 100000, false),
        default_commission_cents: fInt(0, 1_000_000_000, false),
      });
      const [exists] = await pool.execute<RowDataPacket[]>(
        `SELECT id FROM adu_plans WHERE id = ? LIMIT 1`,
        [id],
      );
      if (!exists[0]) throw new HttpError(404, "errors.notFound");
      await applyUpdate(pool, "adu_plans", id, updates);
      res.json({ ok: true });
    }),
  );

  // ── Marketing events ──────────────────────────────────────────────────────
  const EVENT_STATUSES = ["draft", "published", "archived"] as const;
  const fDateTime = (nullable: boolean): FieldParser => (v) => {
    if (v === null || v === undefined || v === "") {
      return nullable ? { ok: true, value: null } : { ok: false };
    }
    const d = asDate(v);
    return d ? { ok: true, value: d } : { ok: false };
  };
  const eventFieldSpec = (): Record<string, FieldParser> => ({
    status: fEnum(EVENT_STATUSES),
    is_featured: fBool,
    starts_at: fDateTime(false),
    ends_at: fDateTime(true),
    registration_opens_at: fDateTime(true),
    registration_closes_at: fDateTime(true),
    capacity: fInt(1, 1_000_000, true),
    waitlist_enabled: fBool,
    city: fStr(100, { min: 1 }),
    venue_name: fStr(200),
    venue_address: fStr(500),
    zoom_url: fStr(500),
    image_url: fStr(500),
    title_en: fStr(200, { min: 1 }),
    title_es: fStr(200, { min: 1 }),
    summary_en: fStr(500),
    summary_es: fStr(500),
    body_en: fStr(20000),
    body_es: fStr(20000),
    location_label_en: fStr(200),
    location_label_es: fStr(200),
    cta_en: fStr(120),
    cta_es: fStr(120),
  });

  const eventWithCounts = async (r: RowDataPacket) => {
    const [confirmed, waitlisted] = await Promise.all([
      countEventRegistrations(Number(r.id), "confirmed"),
      countEventRegistrations(Number(r.id), "waitlisted"),
    ]);
    return mapMarketingEventRow(r, {
      confirmed_count: confirmed,
      waitlisted_count: waitlisted,
    });
  };

  app.get(
    "/api/admin/events",
    requireAdminAny("events", "leads"),
    route(async (req, res) => {
      const status = enumQuery(req.query.status, EVENT_STATUSES);
      const like = likeParam(req.query.q);
      const { limit, offset } = parseListPaging(req);
      const where: string[] = [];
      const params: any[] = [];
      if (status) {
        where.push("status = ?");
        params.push(status);
      }
      if (like) {
        where.push("(slug LIKE ? OR title_en LIKE ? OR title_es LIKE ? OR city LIKE ?)");
        params.push(like, like, like, like);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const [countRows] = await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM marketing_events ${whereSql}`,
        params,
      );
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT * FROM marketing_events ${whereSql}
         ORDER BY starts_at DESC, id DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      const events = await Promise.all(rows.map(eventWithCounts));
      res.json({
        ok: true,
        events,
        total: Number(countRows[0]?.n || 0),
        limit,
        offset,
      });
    }),
  );

  app.post(
    "/api/admin/events",
    requireAdmin("events"),
    route(async (req, res) => {
      const user = portalUser(res);
      const { updates } = parsePatch(req.body, eventFieldSpec());
      const slugParser = fStr(80, { min: 1 })(req.body?.slug ?? req.body?.title_en);
      if (!slugParser.ok) throw new HttpError(400, "validation.invalidField");
      const slug = slugifyEvent(slugParser.value);
      if (!slug) throw new HttpError(400, "validation.invalidField");
      if (!updates.starts_at || !updates.city || !updates.title_en) {
        throw new HttpError(400, "validation.invalidField");
      }
      if (!updates.title_es) updates.title_es = updates.title_en;
      if (updates.status == null) updates.status = "draft";
      const [dup] = await pool.execute<RowDataPacket[]>(
        `SELECT id FROM marketing_events WHERE slug = ? LIMIT 1`,
        [slug],
      );
      if (dup[0]) throw new HttpError(409, "errors.duplicate");
      const id = await withTx(async (conn) => {
        const cols = ["slug", "created_by_admin_id", ...Object.keys(updates)];
        const vals = [slug, user.id, ...Object.values(updates)];
        const [ins] = await conn.execute<ResultSetHeader>(
          `INSERT INTO marketing_events (${cols.map((c) => `\`${c}\``).join(", ")})
           VALUES (${cols.map(() => "?").join(", ")})`,
          vals,
        );
        const newId = Number(ins.insertId);
        if (updates.is_featured === 1) await clearOtherFeatured(newId, conn);
        return newId;
      });
      const row = await loadMarketingEventById(id);
      res.status(201).json({ ok: true, id, event: await eventWithCounts(row!) });
    }),
  );

  app.get(
    "/api/admin/events/:id",
    requireAdminAny("events", "leads"),
    route(async (req, res) => {
      const row = await loadMarketingEventById(parseId(req.params.id));
      if (!row) throw new HttpError(404, "errors.eventNotFound");
      res.json({ ok: true, event: await eventWithCounts(row) });
    }),
  );

  app.patch(
    "/api/admin/events/:id",
    requireAdmin("events"),
    route(async (req, res) => {
      const id = parseId(req.params.id);
      const existing = await loadMarketingEventById(id);
      if (!existing) throw new HttpError(404, "errors.eventNotFound");
      const { updates } = parsePatch(req.body, eventFieldSpec());
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "slug")) {
        const slug = slugifyEvent(String(req.body.slug || ""));
        if (!slug) throw new HttpError(400, "validation.invalidField");
        if (slug !== existing.slug) {
          const [dup] = await pool.execute<RowDataPacket[]>(
            `SELECT id FROM marketing_events WHERE slug = ? AND id <> ? LIMIT 1`,
            [slug, id],
          );
          if (dup[0]) throw new HttpError(409, "errors.duplicate");
          updates.slug = slug;
        }
      }
      await withTx(async (conn) => {
        await applyUpdate(conn, "marketing_events", id, updates);
        if (updates.is_featured === 1) await clearOtherFeatured(id, conn);
      });
      const row = await loadMarketingEventById(id);
      res.json({ ok: true, event: await eventWithCounts(row!) });
    }),
  );

  app.delete(
    "/api/admin/events/:id",
    requireAdmin("events"),
    route(async (req, res) => {
      const id = parseId(req.params.id);
      const existing = await loadMarketingEventById(id);
      if (!existing) throw new HttpError(404, "errors.eventNotFound");
      const [leadRows] = await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM leads WHERE event_id = ?`,
        [id],
      );
      // Published events and events with RSVPs must be archived, not deleted.
      if (Number(leadRows[0]?.n || 0) > 0 || existing.status === "published") {
        throw new HttpError(409, "errors.invalidTransition");
      }
      await pool.execute(`DELETE FROM marketing_events WHERE id = ?`, [id]);
      res.json({ ok: true });
    }),
  );

  app.get(
    "/api/admin/events/:id/attendees",
    requireAdminAny("events", "leads"),
    route(async (req, res) => {
      const id = parseId(req.params.id);
      const existing = await loadMarketingEventById(id);
      if (!existing) throw new HttpError(404, "errors.eventNotFound");
      const regStatus = enumQuery(req.query.registration_status, [
        "confirmed",
        "waitlisted",
      ]);
      const like = likeParam(req.query.q);
      const where = ["l.event_id = ?"];
      const params: any[] = [id];
      if (regStatus) {
        where.push("l.event_registration_status = ?");
        params.push(regStatus);
      }
      if (like) {
        where.push("(l.full_name LIKE ? OR l.email LIKE ? OR l.phone LIKE ?)");
        params.push(like, like, like);
      }
      const whereSql = `WHERE ${where.join(" AND ")}`;
      const cols = `l.id, l.full_name, l.email, l.phone, l.property_address,
                l.soft_pull_consent, l.event_id, l.event_registration_status,
                l.preferred_language, l.source, l.status, l.created_at`;
      if (String(req.query.format) === "csv") {
        const [all] = await pool.execute<RowDataPacket[]>(
          `SELECT ${cols} FROM leads l ${whereSql} ORDER BY l.id ASC LIMIT 5000`,
          params,
        );
        const head = [
          "id", "full_name", "email", "phone", "property_address",
          "registration_status", "soft_pull_consent", "language", "created_at",
        ];
        // Prefix formula triggers so spreadsheets never execute attendee input.
        const cell = (v: unknown) => {
          let t = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
          if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
          return `"${t.replace(/"/g, '""')}"`;
        };
        const lines = [head.join(",")].concat(
          all.map((r) =>
            [
              r.id, r.full_name, r.email, r.phone, r.property_address,
              r.event_registration_status, Number(r.soft_pull_consent) ? "yes" : "no",
              r.preferred_language, r.created_at,
            ].map(cell).join(","),
          ),
        );
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${String(existing.slug).replace(/[^a-z0-9-]/g, "")}-attendees.csv"`,
        );
        return res.send(lines.join("\n"));
      }
      const { limit, offset } = parseListPaging(req);
      const [countRows] = await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM leads l ${whereSql}`,
        params,
      );
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT ${cols} FROM leads l ${whereSql}
         ORDER BY l.id ASC LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      res.json({
        ok: true,
        event: await eventWithCounts(existing),
        attendees: rows,
        total: Number(countRows[0]?.n || 0),
        limit,
        offset,
      });
    }),
  );

  // ── Leads ─────────────────────────────────────────────────────────────────
  app.get(
    "/api/admin/leads",
    requireAdmin("leads"),
    route(async (req, res) => {
      const status = enumQuery(req.query.status, [
        "new",
        "contacted",
        "qualified",
        "closed",
        "spam",
      ]);
      const like = likeParam(req.query.q);
      const { limit, offset } = parseListPaging(req);
      const modeFilter = enumQuery(req.query.mode, ["event", "standard"]);
      const regFilter = enumQuery(req.query.event_registration_status, [
        "confirmed",
        "waitlisted",
      ]);
      const eventIdFilter = parseIdQuery(req.query.event_id);
      const where: string[] = [];
      const params: any[] = [];
      if (status) {
        where.push("l.status = ?");
        params.push(status);
      }
      if (modeFilter) {
        where.push("l.mode = ?");
        params.push(modeFilter);
      }
      if (regFilter) {
        where.push("l.event_registration_status = ?");
        params.push(regFilter);
      }
      if (eventIdFilter) {
        where.push("l.event_id = ?");
        params.push(eventIdFilter);
      }
      if (like) {
        where.push("(l.full_name LIKE ? OR l.email LIKE ? OR l.phone LIKE ?)");
        params.push(like, like, like);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const [countRows] = await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM leads l ${whereSql}`,
        params,
      );
      const total = Number(countRows[0]?.n || 0);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT l.id, l.full_name, l.email, l.phone, l.property_address, l.mode, l.event_city,
                l.event_id, l.event_registration_status, e.title_en AS event_title,
                l.source, l.audience_tag, l.affiliate_id, l.client_id,
                l.converted_affiliate_id, l.converted_contractor_id,
                l.referral_code, l.notes, l.status, l.submission_count, l.last_submitted_at,
                l.created_at, CONCAT(a.first_name, ' ', a.last_name) AS affiliate_name
         FROM leads l LEFT JOIN affiliates a ON a.id = l.affiliate_id
         LEFT JOIN marketing_events e ON e.id = l.event_id
         ${whereSql}
         ORDER BY COALESCE(l.last_submitted_at, l.created_at) DESC, l.id DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      res.json({ ok: true, leads: rows, total, limit, offset });
    }),
  );

  app.patch(
    "/api/admin/leads/:id",
    requireAdmin("leads"),
    route(async (req, res) => {
      const id = parseId(req.params.id);
      const { updates } = parsePatch(req.body, {
        status: fEnum(["new", "contacted", "qualified", "closed", "spam"] as const),
        notes: fStr(5000),
      });
      const [exists] = await pool.execute<RowDataPacket[]>(
        `SELECT id FROM leads WHERE id = ? LIMIT 1`,
        [id],
      );
      if (!exists[0]) throw new HttpError(404, "errors.notFound");
      await applyUpdate(pool, "leads", id, updates);
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/admin/leads/:id/convert",
    requireAdminAny("projects.write", "approvals"),
    route(async (req, res) => {
      const out = await runAdminLeadConvert({
        user: portalUser(res),
        leadId: parseId(req.params.id),
        body: (req.body || {}) as Record<string, unknown>,
      });
      return res.status(out.status).json(out.body);
    }),
  );

  // ── Affiliates ────────────────────────────────────────────────────────────
  app.get(
    "/api/admin/affiliates",
    requireAdmin("people.read"),
    route(async (req, res) => {
      const like = likeParam(req.query.q);
      const status = enumQuery(req.query.status, [
        "pending",
        "active",
        "inactive",
        "suspended",
      ]);
      const { limit, offset } = parseListPaging(req);
      const where: string[] = [];
      const params: any[] = [];
      if (status) {
        where.push("a.status = ?");
        params.push(status);
      }
      if (like) {
        where.push(
          "(a.first_name LIKE ? OR a.last_name LIKE ? OR a.email LIKE ? OR a.company LIKE ? OR a.slug LIKE ? OR a.referral_code LIKE ?)",
        );
        params.push(like, like, like, like, like, like);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const [countRows] = await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM affiliates a ${whereSql}`,
        params,
      );
      const total = Number(countRows[0]?.n || 0);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT a.id, a.email, a.first_name, a.last_name, a.phone, a.company, a.status,
                a.referral_code, a.slug, a.notes, a.approved_at, a.last_login_at, a.created_at,
                a.preferred_language, a.parent_affiliate_id,
                CONCAT(p.first_name, ' ', p.last_name) AS parent_name,
                (SELECT COUNT(*) FROM affiliate_link_clicks k WHERE k.affiliate_id = a.id) AS click_count,
                (SELECT COUNT(*) FROM projects pr
                  WHERE pr.closer_affiliate_id = a.id OR pr.affiliate_id = a.id) AS client_count,
                (SELECT COUNT(*) FROM affiliates s WHERE s.parent_affiliate_id = a.id) AS sub_count
         FROM affiliates a
         LEFT JOIN affiliates p ON p.id = a.parent_affiliate_id
         ${whereSql}
         ORDER BY FIELD(a.status, 'pending', 'active', 'inactive', 'suspended'), a.id DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      res.json({ ok: true, affiliates: rows, total, limit, offset });
    }),
  );

  app.get(
    "/api/admin/affiliates/:id",
    requireAdmin("people.read"),
    route(async (req, res) => {
      const id = parseId(req.params.id);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT a.id, a.email, a.first_name, a.last_name, a.phone, a.company, a.status,
                a.referral_code, a.slug, a.notes, a.approved_at, a.last_login_at, a.created_at,
                a.preferred_language, a.avatar_url, a.bio, a.parent_affiliate_id,
                CONCAT(p.first_name, ' ', p.last_name) AS parent_name,
                (SELECT COUNT(*) FROM affiliate_link_clicks k WHERE k.affiliate_id = a.id) AS click_count,
                (SELECT COUNT(*) FROM projects pr
                  WHERE pr.closer_affiliate_id = a.id OR pr.affiliate_id = a.id) AS client_count,
                (SELECT COUNT(*) FROM affiliates s WHERE s.parent_affiliate_id = a.id) AS sub_count
         FROM affiliates a
         LEFT JOIN affiliates p ON p.id = a.parent_affiliate_id
         WHERE a.id = ? LIMIT 1`,
        [id],
      );
      if (!rows[0]) throw new HttpError(404, "errors.notFound");
      res.json({ ok: true, affiliate: rows[0] });
    }),
  );

  app.patch(
    "/api/admin/affiliates/:id",
    requireAdmin("approvals"),
    route(async (req, res) => {
      const user = portalUser(res);
      const id = parseId(req.params.id);
      const { updates } = parsePatch(req.body, {
        status: fEnum(["pending", "active", "inactive", "suspended"] as const),
        notes: fStr(5000),
        company: fStr(200),
        phone: fStr(40),
      });
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT * FROM affiliates WHERE id = ? LIMIT 1`,
        [id],
      );
      const a = rows[0];
      if (!a) throw new HttpError(404, "errors.notFound");
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "slug")) {
        updates.slug = normalizeAffiliateSlugInput(req.body.slug);
        await assertAffiliateSlugAvailable(updates.slug as string | null, id);
      }
      if (Object.keys(updates).length === 0) {
        throw new HttpError(400, "validation.invalidField");
      }
      const approving = updates.status === "active" && a.status === "pending";
      if (approving) {
        updates.approved_at = new Date();
        updates.approved_by_admin_id = user.id;
      }
      const statusChanged =
        updates.status != null && String(updates.status) !== String(a.status);
      await assertIdentityEditAllowed({
        entity: "affiliate",
        id: id,
        updates,
        actor: "staff",
        sharedPhoneReason: req.body?.shared_phone_reason,
        adminId: portalUser(res).id,
      });
      await applyUpdate(pool, "affiliates", id, updates);
      if (approving) {
        const lang = asLang(a.preferred_language);
        await safeSend(
          String(a.email),
          tplPortalNotice({
            lang,
            subject: tr(lang, "You're approved — Groundwork affiliate program", "Estás aprobado — programa de afiliados Groundwork"),
            headline: tr(lang, "Welcome to the team.", "Bienvenido al equipo."),
            paragraphs: [
              tr(lang, `Hi ${a.first_name}, your affiliate account is active.`, `Hola ${a.first_name}, tu cuenta de afiliado está activa.`),
              tr(lang, "Sign in with a one-time code to grab your tracking link and register homeowners.", "Entra con un código de un solo uso para obtener tu enlace de seguimiento y registrar propietarios."),
            ],
            cta: { url: `${APP_URL}/affiliate/login`, label: tr(lang, "Open affiliate portal", "Abrir portal de afiliados") },
          }),
        );
      }
      // 11B: parent active↔inactive must immediately void/restore unpaid parent shares.
      if (statusChanged) {
        await withTx(async (conn) => {
          await resyncProjectsForParentAffiliate(conn, id, user.id);
        });
      }
      res.json({ ok: true });
    }),
  );

  // ── Contractors (invite-only) ─────────────────────────────────────────────
  app.get(
    "/api/admin/contractors",
    requireAdmin("people.read"),
    route(async (req, res) => {
      const like = likeParam(req.query.q);
      const status = enumQuery(req.query.status, [
        "pending",
        "invited",
        "active",
        "inactive",
        "suspended",
      ]);
      const appStatus = enumQuery(req.query.application_status, [
        "none",
        "draft",
        "submitted",
        "in_review",
        "needs_info",
        "approved",
        "denied",
      ]);
      const { limit, offset } = parseListPaging(req);
      const where: string[] = [];
      const params: any[] = [];
      if (status) {
        where.push("k.status = ?");
        params.push(status);
      }
      if (appStatus === "none") {
        where.push("cpq.id IS NULL");
      } else if (appStatus) {
        where.push("cpq.status = ?");
        params.push(appStatus);
      }
      if (like) {
        where.push(
          "(k.first_name LIKE ? OR k.last_name LIKE ? OR k.email LIKE ? OR k.company LIKE ?)",
        );
        params.push(like, like, like, like);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const [countRows] = await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM contractors k
         LEFT JOIN contractor_applications cpq ON cpq.contractor_id = k.id ${whereSql}`,
        params,
      );
      const total = Number(countRows[0]?.n || 0);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT k.id, k.email, k.first_name, k.last_name, k.phone, k.company, k.license_number,
                k.status, k.notes, k.activated_at, k.last_login_at, k.created_at, k.preferred_language,
                (SELECT COUNT(*) FROM projects p WHERE p.contractor_id = k.id) AS project_count,
                cpq.status AS application_status, cpq.application_number,
                cpq.submitted_at AS application_submitted_at, cpq.due_at AS application_due_at
         FROM contractors k
         LEFT JOIN contractor_applications cpq ON cpq.contractor_id = k.id
         ${whereSql}
         ORDER BY FIELD(k.status, 'pending', 'invited', 'active', 'inactive', 'suspended'), k.id DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      res.json({ ok: true, contractors: rows, total, limit, offset });
    }),
  );

  app.get(
    "/api/admin/contractors/:id",
    requireAdmin("people.read"),
    route(async (req, res) => {
      const id = parseId(req.params.id);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT k.id, k.email, k.first_name, k.last_name, k.phone, k.company, k.license_number,
                k.status, k.notes, k.activated_at, k.last_login_at, k.created_at, k.preferred_language,
                (SELECT COUNT(*) FROM projects p WHERE p.contractor_id = k.id) AS project_count,
                cpq.status AS application_status, cpq.application_number,
                cpq.submitted_at AS application_submitted_at, cpq.due_at AS application_due_at
         FROM contractors k
         LEFT JOIN contractor_applications cpq ON cpq.contractor_id = k.id
         WHERE k.id = ? LIMIT 1`,
        [id],
      );
      if (!rows[0]) throw new HttpError(404, "errors.notFound");
      res.json({ ok: true, contractor: rows[0] });
    }),
  );

  app.post(
    "/api/admin/contractors/invite",
    requireAdmin("approvals"),
    route(async (req, res) => {
      const user = portalUser(res);
      const b = req.body || {};
      const email = normalizeEmail(b.email);
      const first = String(b.first_name || "").trim().slice(0, 100);
      const last = String(b.last_name || "").trim().slice(0, 100);
      const company = b.company ? String(b.company).trim().slice(0, 200) : null;
      const license = b.license_number ? String(b.license_number).trim().slice(0, 100) : null;
      const phone = b.phone ? String(b.phone).trim().slice(0, 40) : null;
      const lang = asLang(b.preferred_language);
      if (!isValidEmail(email)) throw new HttpError(400, "validation.emailInvalid");
      if (!first) throw new HttpError(400, "validation.firstNameRequired");
      if (!last) throw new HttpError(400, "validation.lastNameRequired");

      const [ex] = await pool.execute<RowDataPacket[]>(
        `SELECT id, status FROM contractors WHERE email = ? LIMIT 1`,
        [email],
      );
      if (ex[0] && ex[0].status !== "invited") {
        throw new HttpError(409, "errors.contractorExists");
      }
      // One role per person; re-inviting the same invited contractor is fine.
      const { phoneOverride } = await assertPersonAvailable({
        email,
        phone,
        actor: "staff",
        sharedPhoneReason: b.shared_phone_reason,
        exclude: ex[0] ? [{ entity: "contractor", id: Number(ex[0].id) }] : [],
      });
      const token = crypto.randomBytes(32).toString("hex");
      const contractorId = await withTx(async (conn) => {
        let cid: number;
        if (ex[0]) {
          cid = Number(ex[0].id);
          await conn.execute(
            `UPDATE contractors SET first_name = ?, last_name = ?, company = ?,
               license_number = ?, phone = ?, preferred_language = ?,
               invited_by_admin_id = ? WHERE id = ?`,
            [first, last, company, license, phone, lang, user.id, cid],
          );
          await conn.execute(
            `UPDATE contractor_invites SET expires_at = NOW()
             WHERE contractor_id = ? AND accepted_at IS NULL`,
            [cid],
          );
        } else {
          const [r] = await conn.execute<ResultSetHeader>(
            `INSERT INTO contractors
               (email, first_name, last_name, phone, company, license_number, status,
                preferred_language, invited_by_admin_id)
             VALUES (?, ?, ?, ?, ?, ?, 'invited', ?, ?)`,
            [email, first, last, phone, company, license, lang, user.id],
          );
          cid = Number(r.insertId);
        }
        await conn.execute(
          `INSERT INTO contractor_invites (token, email, contractor_id, created_by_admin_id, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
          [token, email, cid, user.id, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)],
        );
        return cid;
      });
      if (phoneOverride) {
        await recordSharedPhoneOverride({ entity: "contractor", id: contractorId, override: phoneOverride, adminId: user.id });
      }
      // The invite email *is* the prequalification link (opening it accepts the invite).
      await sendContractorApplicationLink({ contractorId, adminId: user.id, variant: "new" });
      res.status(201).json({ ok: true, contractor_id: contractorId });
    }),
  );

  app.patch(
    "/api/admin/contractors/:id",
    requireAdmin("approvals"),
    route(async (req, res) => {
      const id = parseId(req.params.id);
      const { updates } = parsePatch(req.body, {
        status: fEnum(["pending", "active", "inactive", "suspended"] as const),
        notes: fStr(5000),
        company: fStr(200),
        license_number: fStr(100),
        phone: fStr(40),
      });
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT * FROM contractors WHERE id = ? LIMIT 1`,
        [id],
      );
      if (!rows[0]) throw new HttpError(404, "errors.notFound");
      if (rows[0].status === "invited" && "status" in updates) {
        throw new HttpError(409, "errors.contractorInvited");
      }
      const approving =
        updates.status === "active" && String(rows[0].status) === "pending";
      let override: string | null = null;
      if (approving) {
        // pending → active requires an approved prequalification (or a logged super_admin override).
        ({ override } = await assertContractorActivationAllowed(
          id,
          portalUser(res),
          req.body?.override_reason,
        ));
        updates.activated_at = new Date();
      }
      await assertIdentityEditAllowed({
        entity: "contractor",
        id: id,
        updates,
        actor: "staff",
        sharedPhoneReason: req.body?.shared_phone_reason,
        adminId: portalUser(res).id,
      });
      await applyUpdate(pool, "contractors", id, updates);
      if (override) {
        await recordContractorActivationOverride(id, portalUser(res).id, override);
      }
      if (approving) {
        const c = rows[0];
        await sendContractorApprovedEmail({
          email: String(c.email),
          first_name: String(c.first_name),
          preferred_language: c.preferred_language,
        });
      }
      res.json({ ok: true });
    }),
  );

  // ── Clients ───────────────────────────────────────────────────────────────
  app.get(
    "/api/admin/clients",
    requireAdmin("people.read"),
    route(async (req, res) => {
      const like = likeParam(req.query.q);
      const status = enumQuery(req.query.status, [
        "pending",
        "prospect",
        "active",
        "inactive",
        "suspended",
      ]);
      const { limit, offset } = parseListPaging(req);
      const where: string[] = [];
      const params: any[] = [];
      if (status) {
        where.push("c.status = ?");
        params.push(status);
      }
      if (like) {
        where.push(
          "(c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)",
        );
        params.push(like, like, like, like);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const [countRows] = await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM clients c ${whereSql}`,
        params,
      );
      const total = Number(countRows[0]?.n || 0);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT c.id, c.email, c.first_name, c.last_name, c.phone, c.status, c.address_line1,
                c.city, c.zip, c.affiliate_id, c.assigned_admin_id, c.admin_notes, c.last_login_at,
                c.created_at, c.preferred_language,
                CONCAT(a.first_name, ' ', a.last_name) AS affiliate_name,
                (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id) AS project_count
         FROM clients c LEFT JOIN affiliates a ON a.id = c.affiliate_id
         ${whereSql}
         ORDER BY FIELD(c.status, 'pending', 'prospect', 'active', 'inactive', 'suspended'), c.id DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      res.json({ ok: true, clients: rows, total, limit, offset });
    }),
  );

  app.get(
    "/api/admin/clients/:id",
    requireAdmin("people.read"),
    route(async (req, res) => {
      const id = parseId(req.params.id);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT c.id, c.email, c.first_name, c.last_name, c.phone, c.status, c.address_line1,
                c.city, c.zip, c.affiliate_id, c.assigned_admin_id, c.admin_notes, c.last_login_at,
                c.created_at, c.preferred_language,
                CONCAT(a.first_name, ' ', a.last_name) AS affiliate_name,
                (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id) AS project_count
         FROM clients c LEFT JOIN affiliates a ON a.id = c.affiliate_id
         WHERE c.id = ? LIMIT 1`,
        [id],
      );
      if (!rows[0]) throw new HttpError(404, "errors.notFound");
      res.json({ ok: true, client: rows[0] });
    }),
  );

  app.post(
    "/api/admin/clients",
    requireAdmin("people.write"),
    route(async (req, res) => {
      const user = portalUser(res);
      const b = req.body || {};
      const email = normalizeEmail(b.email);
      const first = String(b.first_name || "").trim().slice(0, 100);
      const last = String(b.last_name || "").trim().slice(0, 100);
      if (!isValidEmail(email)) throw new HttpError(400, "validation.emailInvalid");
      if (!first) throw new HttpError(400, "validation.firstNameRequired");
      if (!last) throw new HttpError(400, "validation.lastNameRequired");
      const affiliateId = b.affiliate_id ? parseId(b.affiliate_id) : null;
      if (affiliateId) {
        const [a] = await pool.execute<RowDataPacket[]>(
          `SELECT id, status FROM affiliates WHERE id = ? LIMIT 1`,
          [affiliateId],
        );
        if (!a[0]) throw new HttpError(400, "errors.invalidReference");
        if (a[0].status !== "active") throw new HttpError(400, "errors.affiliateInactive");
      }
      // One role per person; staff may confirm a shared (household) phone with a reason.
      const { phoneOverride } = await assertPersonAvailable({
        email,
        phone: b.phone,
        actor: "staff",
        sharedPhoneReason: b.shared_phone_reason,
      });
      const [r] = await pool.execute<ResultSetHeader>(
        `INSERT INTO clients
           (email, first_name, last_name, phone, preferred_language, status,
            address_line1, city, zip, affiliate_id, assigned_admin_id)
         VALUES (?, ?, ?, ?, ?, 'prospect', ?, ?, ?, ?, ?)`,
        [
          email,
          first,
          last,
          b.phone ? String(b.phone).trim().slice(0, 40) : null,
          asLang(b.preferred_language),
          b.address_line1 ? String(b.address_line1).trim().slice(0, 255) : null,
          b.city ? String(b.city).trim().slice(0, 100) : null,
          b.zip ? String(b.zip).trim().slice(0, 20) : null,
          affiliateId,
          user.id,
        ],
      );
      const clientId = Number(r.insertId);
      if (phoneOverride) {
        await recordSharedPhoneOverride({ entity: "client", id: clientId, override: phoneOverride, adminId: user.id });
      }
      await notifyStaff("client_created", (l) => ({
        subject: tr(l, `Client added · ${first} ${last}`, `Cliente agregado · ${first} ${last}`),
        headline: tr(l, "New client on file.", "Nuevo cliente registrado."),
        paragraphs: [
          tr(l, `${first} ${last} (${email}) was added as a prospect.`, `${first} ${last} (${email}) se agregó como prospecto.`),
        ],
        cta: {
          url: `${APP_URL}/admin/clients/${clientId}`,
          label: tr(l, "Open client", "Abrir cliente"),
        },
      }));
      res.status(201).json({ ok: true, client_id: clientId });
    }),
  );

  app.patch(
    "/api/admin/clients/:id",
    requireAdmin("people.write"),
    route(async (req, res) => {
      const user = portalUser(res);
      const id = parseId(req.params.id);
      const { updates } = parsePatch(req.body, {
        first_name: fStr(100, { min: 1 }),
        last_name: fStr(100, { min: 1 }),
        email: (v) => {
          if (v === null || v === undefined || v === "") {
            return { ok: true, value: null };
          }
          return fEmail(v);
        },
        phone: fStr(40),
        status: fEnum([
          "pending",
          "prospect",
          "active",
          "inactive",
          "suspended",
        ] as const),
        address_line1: fStr(255),
        city: fStr(100),
        zip: fStr(20),
        affiliate_id: fInt(1),
        assigned_admin_id: fInt(1),
        admin_notes: fStr(5000),
        preferred_language: fLang,
      });
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT * FROM clients WHERE id = ? LIMIT 1`,
        [id],
      );
      if (!rows[0]) throw new HttpError(404, "errors.notFound");
      const prev = rows[0];
      if ("email" in updates && updates.email) {
        const [dup] = await pool.execute<RowDataPacket[]>(
          `SELECT id FROM clients WHERE LOWER(email) = ? AND id <> ? LIMIT 1`,
          [updates.email, id],
        );
        if (dup[0]) throw new HttpError(409, "errors.duplicate");
      }
      if (updates.affiliate_id) {
        const [a] = await pool.execute<RowDataPacket[]>(
          `SELECT id, status FROM affiliates WHERE id = ? LIMIT 1`,
          [updates.affiliate_id],
        );
        if (!a[0]) throw new HttpError(400, "errors.invalidReference");
        if (a[0].status !== "active") throw new HttpError(400, "errors.affiliateInactive");
      }
      const approving =
        updates.status === "prospect" && String(prev.status) === "pending";
      if (approving && !adminCan(user.role, "approvals")) {
        throw new HttpError(403, "errors.forbidden");
      }
      const emailAfter =
        "email" in updates ? updates.email : prev.email ? String(prev.email) : null;
      if (approving && !emailAfter) {
        throw new HttpError(400, "validation.emailRequired");
      }
      await assertIdentityEditAllowed({
        entity: "client",
        id: id,
        updates,
        actor: "staff",
        sharedPhoneReason: req.body?.shared_phone_reason,
        adminId: portalUser(res).id,
      });
      await applyUpdate(pool, "clients", id, updates);
      if (approving) {
        const token = await issueClientPortalInvite(pool, {
          clientId: id,
          email: String(emailAfter),
          byType: "admin",
          byId: user.id,
        });
        await sendClientPortalInviteEmail({
          email: String(emailAfter),
          firstName: String(
            ("first_name" in updates ? updates.first_name : prev.first_name) || "",
          ),
          lang: asLang(
            "preferred_language" in updates
              ? updates.preferred_language
              : prev.preferred_language,
          ),
          token,
        });
      }
      res.json({ ok: true, invite_sent: approving || undefined });
    }),
  );

  app.post(
    "/api/admin/clients/:id/portal-invite",
    requireAdmin("people.write"),
    route(async (req, res) => {
      const user = portalUser(res);
      const id = parseId(req.params.id);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT email, first_name, preferred_language, status FROM clients WHERE id = ? LIMIT 1`,
        [id],
      );
      const c = rows[0];
      if (!c) throw new HttpError(404, "errors.notFound");
      if (!["prospect", "active"].includes(String(c.status))) {
        throw new HttpError(409, "errors.authInactive");
      }
      const email = c.email ? String(c.email).trim() : "";
      if (!email || !isValidEmail(normalizeEmail(email))) {
        throw new HttpError(400, "validation.emailRequired");
      }
      const token = await issueClientPortalInvite(pool, {
        clientId: id,
        email: normalizeEmail(email),
        byType: "admin",
        byId: user.id,
      });
      await sendClientPortalInviteEmail({
        email: normalizeEmail(email),
        firstName: String(c.first_name || ""),
        lang: asLang(c.preferred_language),
        token,
      });
      res.json({ ok: true, invite_sent: true });
    }),
  );

  // ── Projects ──────────────────────────────────────────────────────────────
  app.get(
    "/api/admin/projects",
    requireAdmin("projects.read"),
    route(async (req, res) => {
      const canFinance = adminCan(portalUser(res).role, "finance.read");
      const milestone = enumQuery(req.query.milestone, MILESTONE_VALUES);
      const like = likeParam(req.query.q);
      const affiliateId = parseIdQuery(req.query.affiliate_id);
      const contractorId = parseIdQuery(req.query.contractor_id);
      const assignedAdminId = parseIdQuery(req.query.assigned_admin_id);
      const loanStatus = enumQuery(req.query.loan_status, LOAN_STATUS_VALUES);
      const { limit, offset } = parseListPaging(req);
      const where: string[] = [];
      const params: any[] = [];
      if (milestone) {
        where.push("p.milestone = ?");
        params.push(milestone);
      }
      if (affiliateId) {
        where.push("p.affiliate_id = ?");
        params.push(affiliateId);
      }
      if (contractorId) {
        where.push("p.contractor_id = ?");
        params.push(contractorId);
      }
      if (assignedAdminId) {
        where.push("p.assigned_admin_id = ?");
        params.push(assignedAdminId);
      }
      if (loanStatus) {
        where.push("p.loan_status = ?");
        params.push(loanStatus);
      }
      if (like) {
        where.push(
          "(p.public_id LIKE ? OR p.property_address LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ?)",
        );
        params.push(like, like, like, like, like);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const [countRows] = await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM projects p
         LEFT JOIN clients c ON c.id = p.client_id
         ${whereSql}`,
        params,
      );
      const total = Number(countRows[0]?.n || 0);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `${PROJECT_ADMIN_SELECT} ${whereSql}
         ORDER BY p.id DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      res.json({
        ok: true,
        projects: rows.map((r) => shapeAdminProject(r, canFinance)),
        total,
        limit,
        offset,
      });
    }),
  );

  /** Kanban board: per-milestone columns with server filters + load-more pagination. */
  app.get(
    "/api/admin/projects/board",
    requireAdmin("projects.read"),
    route(async (req, res) => {
      const canFinance = adminCan(portalUser(res).role, "finance.read");
      const like = likeParam(req.query.q);
      const qStr = String(req.query.q || "").trim().slice(0, 80);
      const limitRaw = Number(req.query.limit);
      const limit = Math.min(
        50,
        Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 20),
      );
      const affiliateId =
        req.query.affiliate_id != null && String(req.query.affiliate_id).trim() !== ""
          ? parseId(req.query.affiliate_id)
          : null;
      const contractorId =
        req.query.contractor_id != null && String(req.query.contractor_id).trim() !== ""
          ? parseId(req.query.contractor_id)
          : null;
      const assignedAdminId =
        req.query.assigned_admin_id != null &&
        String(req.query.assigned_admin_id).trim() !== ""
          ? parseId(req.query.assigned_admin_id)
          : null;
      const loanStatus = (LOAN_STATUS_VALUES as readonly string[]).includes(
        String(req.query.loan_status || ""),
      )
        ? String(req.query.loan_status)
        : null;
      const singleMilestone = (MILESTONE_VALUES as readonly string[]).includes(
        String(req.query.milestone || ""),
      )
        ? (String(req.query.milestone) as Milestone)
        : null;

      const filterSql: string[] = [];
      const filterParams: any[] = [];
      if (like) {
        filterSql.push(
          "(p.public_id LIKE ? OR p.property_address LIKE ? OR p.property_city LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ? OR CONCAT(c.first_name, ' ', c.last_name) LIKE ?)",
        );
        filterParams.push(like, like, like, like, like, like, like);
      }
      if (affiliateId != null) {
        filterSql.push("p.affiliate_id = ?");
        filterParams.push(affiliateId);
      }
      if (contractorId != null) {
        filterSql.push("p.contractor_id = ?");
        filterParams.push(contractorId);
      }
      if (assignedAdminId != null) {
        filterSql.push("p.assigned_admin_id = ?");
        filterParams.push(assignedAdminId);
      }
      if (loanStatus) {
        filterSql.push("p.loan_status = ?");
        filterParams.push(loanStatus);
      }
      const andFilters = filterSql.length ? ` AND ${filterSql.join(" AND ")}` : "";

      async function fetchColumn(milestone: Milestone, offset: number) {
        const safeLimit = limit;
        const safeOffset = Math.max(0, Math.floor(offset));
        const [countRows] = await pool.execute<RowDataPacket[]>(
          `SELECT COUNT(*) AS total
           FROM projects p
           JOIN clients c ON c.id = p.client_id
           WHERE p.milestone = ?${andFilters}`,
          [milestone, ...filterParams],
        );
        const total = Number(countRows[0]?.total || 0);
        const [rows] = await pool.execute<RowDataPacket[]>(
          `${PROJECT_ADMIN_SELECT}
           WHERE p.milestone = ?${andFilters}
           ORDER BY COALESCE(p.milestone_changed_at, p.created_at) DESC, p.id DESC
           LIMIT ${safeLimit} OFFSET ${safeOffset}`,
          [milestone, ...filterParams],
        );
        return {
          items: rows.map((r) => shapeAdminProject(r, canFinance)),
          total,
          offset: safeOffset,
          limit: safeLimit,
          has_more: safeOffset + rows.length < total,
        };
      }

      if (singleMilestone) {
        const offsetRaw = Number(req.query.offset);
        const offset = Math.max(
          0,
          Number.isFinite(offsetRaw) ? Math.floor(offsetRaw) : 0,
        );
        const page = await fetchColumn(singleMilestone, offset);
        return res.json({
          ok: true,
          milestone: singleMilestone,
          q: qStr,
          ...page,
        });
      }

      const columns: Record<string, Awaited<ReturnType<typeof fetchColumn>>> = {};
      for (const m of MILESTONE_VALUES) {
        columns[m] = await fetchColumn(m, 0);
      }
      res.json({
        ok: true,
        q: qStr,
        limit,
        filters: {
          affiliate_id: affiliateId,
          contractor_id: contractorId,
          assigned_admin_id: assignedAdminId,
          loan_status: loanStatus,
        },
        columns,
      });
    }),
  );

  app.post(
    "/api/admin/projects",
    requireAdmin("projects.write"),
    route(async (req, res) => {
      const user = portalUser(res);
      const b = req.body || {};
      const clientId = parseId(b.client_id);
      const planId = b.adu_plan_id ? parseId(b.adu_plan_id) : null;
      const affiliateId = b.affiliate_id ? parseId(b.affiliate_id) : null;
      const [cRows] = await pool.execute<RowDataPacket[]>(
        `SELECT id, email, first_name, last_name, phone, preferred_language, affiliate_id,
                address_line1, city, zip FROM clients WHERE id = ? LIMIT 1`,
        [clientId],
      );
      const c = cRows[0];
      if (!c) throw new HttpError(400, "errors.invalidReference");
      const created = await withTx(async (conn) => {
        const out = await createClientWithProject(conn, {
          email: String(c.email),
          first_name: String(c.first_name),
          last_name: String(c.last_name),
          phone: c.phone,
          lang: asLang(c.preferred_language),
          property_address: b.property_address
            ? String(b.property_address).trim().slice(0, 500)
            : c.address_line1,
          property_city: b.property_city ? String(b.property_city).trim().slice(0, 100) : c.city,
          property_zip: b.property_zip ? String(b.property_zip).trim().slice(0, 20) : c.zip,
          affiliate_id: affiliateId ?? (c.affiliate_id ? Number(c.affiliate_id) : null),
          lead_id: null,
          adu_plan_id: planId,
          assigned_admin_id: user.id,
          byType: "admin",
          byId: user.id,
          existingClientId: clientId,
        });
        return out;
      });
      res.status(201).json({ ok: true, project_public_id: created.publicId });
    }),
  );

  app.get(
    "/api/admin/projects/:publicId",
    requireAdmin("projects.read"),
    route(async (req, res) => {
      const canFinance = adminCan(portalUser(res).role, "finance.read");
      const detail = await loadAdminProjectDetail(parsePublicId(req.params.publicId), canFinance);
      if (!detail) throw new HttpError(404, "errors.notFound");
      res.json({ ok: true, ...detail });
    }),
  );

  app.patch(
    "/api/admin/projects/:publicId",
    requireAdmin("projects.write"),
    route(async (req, res) => {
      const user = portalUser(res);
      const publicId = parsePublicId(req.params.publicId);
      const { updates } = parsePatch(req.body, {
        contractor_id: fInt(1),
        affiliate_id: fInt(1),
        assigned_admin_id: fInt(1),
        adu_plan_id: fInt(1),
        milestone: fEnum(MILESTONE_VALUES),
        property_address: fStr(500),
        property_city: fStr(100),
        property_state: fStr(50),
        property_zip: fStr(20),
        sq_ft: fInt(1, 100000),
        loan_lender_type: fEnum(["anchor", "external", "unknown"] as const),
        loan_lender_name: fStr(200),
        loan_status: fEnum(LOAN_STATUS_VALUES),
        anchor_external_id: fStr(120),
        notes: fStr(5000),
      });
      const fin = parsePatch(req.body, {
        sale_price_cents: fInt(0, 10_000_000_000),
        contractor_cost_cents: fInt(0, 10_000_000_000),
        agent_commission_cents: fInt(0, 10_000_000_000),
        commission_override_cents: fInt(0, 2_000_000_000),
      }).updates;
      if (Object.keys(fin).length && !adminCan(user.role, "finance.write")) {
        throw new HttpError(403, "errors.forbidden");
      }

      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT * FROM projects WHERE public_id = ? LIMIT 1`,
        [publicId],
      );
      const old = rows[0];
      if (!old) throw new HttpError(404, "errors.notFound");

      const paidLocked = await projectHasPaidCommission(pool, Number(old.id));
      if (paidLocked) {
        const lockedKeys = ["sq_ft", "adu_plan_id", "commission_override_cents"] as const;
        for (const k of lockedKeys) {
          if (k in updates || k in fin) {
            throw new HttpError(409, "errors.commissionPaidLocked");
          }
        }
      }

      if ("contractor_cost_cents" in fin && fin.contractor_cost_cents != null) {
        if (Number(fin.contractor_cost_cents) < Number(old.draw_committed_cents || 0)) {
          throw new HttpError(400, "errors.drawExceedsBudget");
        }
      }

      let newContractorId: number | null = null;
      if (updates.contractor_id && updates.contractor_id !== old.contractor_id) {
        const [k] = await pool.execute<RowDataPacket[]>(
          `SELECT id, status FROM contractors WHERE id = ? LIMIT 1`,
          [updates.contractor_id],
        );
        if (!k[0]) throw new HttpError(400, "errors.invalidReference");
        if (k[0].status !== "active") throw new HttpError(400, "errors.contractorInactive");
        newContractorId = Number(updates.contractor_id);
      }
      if (
        "affiliate_id" in updates &&
        updates.affiliate_id !== old.affiliate_id &&
        old.loan_status === "finalized"
      ) {
        throw new HttpError(409, "errors.projectLocked");
      }
      if ("affiliate_id" in updates) {
        if (updates.affiliate_id) {
          const attr = await resolveCloserParent(pool, Number(updates.affiliate_id));
          if (!attr.closer_id) throw new HttpError(400, "errors.affiliateInactive");
          updates.affiliate_id = attr.closer_id;
          updates.closer_affiliate_id = attr.closer_id;
          updates.parent_affiliate_id = attr.parent_id;
        } else {
          updates.affiliate_id = null;
          updates.closer_affiliate_id = null;
          updates.parent_affiliate_id = null;
        }
      }
      if (updates.adu_plan_id) {
        const [pl] = await pool.execute<RowDataPacket[]>(
          `SELECT sq_ft FROM adu_plans WHERE id = ? LIMIT 1`,
          [updates.adu_plan_id],
        );
        if (!pl[0]) throw new HttpError(400, "errors.invalidReference");
        if (!("sq_ft" in updates) && old.sq_ft == null) updates.sq_ft = Number(pl[0].sq_ft);
      }
      const nextMilestone = String(updates.milestone ?? old.milestone);
      const nextContractor =
        "contractor_id" in updates ? updates.contractor_id : old.contractor_id;
      if (nextMilestone === "in_build" && !nextContractor) {
        throw new HttpError(400, "errors.contractorRequired");
      }
      const milestoneChanged = "milestone" in updates && updates.milestone !== old.milestone;
      if (milestoneChanged) {
        assertMilestoneTransition(old.milestone, updates.milestone);
        updates.milestone_changed_at = new Date();
      }

      const loanNow = "loan_status" in updates ? updates.loan_status : old.loan_status;
      const becameFinalized = loanNow === "finalized" && old.loan_status !== "finalized";
      const leftFinalized = old.loan_status === "finalized" && loanNow !== "finalized";
      if (becameFinalized) updates.loan_finalized_at = new Date();
      if (leftFinalized) updates.loan_finalized_at = null;

      await withTx(async (conn) => {
        if (milestoneChanged) {
          // Serialize concurrent milestone moves: the row lock makes the
          // transition check above authoritative for this write.
          const [locked] = await conn.execute<RowDataPacket[]>(
            `SELECT milestone FROM projects WHERE id = ? FOR UPDATE`,
            [old.id],
          );
          if (String(locked[0]?.milestone) !== String(old.milestone)) {
            throw new HttpError(409, "errors.invalidTransition");
          }
        }
        await applyUpdate(conn, "projects", Number(old.id), { ...updates, ...fin });
        if (milestoneChanged) {
          await recordMilestone(conn, Number(old.id), String(old.milestone), nextMilestone, "admin", user.id);
        }
        await recalcProject(conn, Number(old.id));
        if (becameFinalized) await syncCommissionForLoan(conn, Number(old.id), true, user.id);
        if (leftFinalized) await syncCommissionForLoan(conn, Number(old.id), false, user.id);
      });

      if (newContractorId) {
        const [k] = await pool.execute<RowDataPacket[]>(
          `SELECT email, first_name, preferred_language FROM contractors WHERE id = ? LIMIT 1`,
          [newContractorId],
        );
        if (k[0]) {
          const lang = asLang(k[0].preferred_language);
          await safeSend(
            String(k[0].email),
            tplPortalNotice({
              lang,
              subject: tr(lang, `New project assigned · ${publicId}`, `Nuevo proyecto asignado · ${publicId}`),
              headline: tr(lang, "You have a new project.", "Tienes un nuevo proyecto."),
              paragraphs: [
                tr(lang, `Hi ${k[0].first_name}, project ${publicId} was assigned to you.`, `Hola ${k[0].first_name}, se te asignó el proyecto ${publicId}.`),
              ],
              cta: { url: `${APP_URL}/contractor/projects/${publicId}`, label: tr(lang, "Open project", "Abrir proyecto") },
            }),
          );
        }
      }

      if (milestoneChanged) {
        await notifyStaff("milestone_changed", (l) => ({
          subject: tr(l, `Milestone · ${publicId} → ${nextMilestone}`, `Hito · ${publicId} → ${nextMilestone}`),
          headline: tr(l, "Project milestone updated.", "Hito del proyecto actualizado."),
          paragraphs: [
            tr(
              l,
              `${publicId} moved from ${old.milestone} to ${nextMilestone}.`,
              `${publicId} pasó de ${old.milestone} a ${nextMilestone}.`,
            ),
          ],
          cta: {
            url: `${APP_URL}/admin/projects/${publicId}`,
            label: tr(l, "Open project", "Abrir proyecto"),
          },
        }));
        const [clientRows] = await pool.execute<RowDataPacket[]>(
          `SELECT c.email, c.first_name, c.preferred_language
           FROM clients c JOIN projects p ON p.client_id = c.id
           WHERE p.public_id = ? LIMIT 1`,
          [publicId],
        );
        if (clientRows[0]?.email) {
          const lang = asLang(clientRows[0].preferred_language);
          await safeSend(
            String(clientRows[0].email),
            tplPortalNotice({
              lang,
              subject: tr(lang, `Project update · ${publicId}`, `Actualización del proyecto · ${publicId}`),
              headline: tr(lang, "Your project moved forward.", "Tu proyecto avanzó."),
              paragraphs: [
                tr(
                  lang,
                  `Hi ${clientRows[0].first_name}, your ADU project is now at “${nextMilestone}”.`,
                  `Hola ${clientRows[0].first_name}, tu proyecto ADU ahora está en “${nextMilestone}”.`,
                ),
              ],
              cta: {
                url: `${APP_URL}/client/project`,
                label: tr(lang, "View project", "Ver proyecto"),
              },
            }),
          );
        }
      }

      if (becameFinalized) {
        const [pendingRows] = await pool.execute<RowDataPacket[]>(
          `SELECT a.email, a.first_name, a.preferred_language, ac.amount_cents, ac.role
           FROM affiliate_commissions ac
           JOIN affiliates a ON a.id = ac.affiliate_id
           WHERE ac.project_id = ? AND ac.status = 'pending' AND ac.amount_cents > 0`,
          [old.id],
        );
        let staffTotal = 0;
        for (const aff of pendingRows) {
          const amount = Number(aff.amount_cents || 0);
          if (!aff.email || amount <= 0) continue;
          staffTotal += amount;
          const lang = asLang(aff.preferred_language);
          await safeSend(
            String(aff.email),
            tplPortalNotice({
              lang,
              subject: tr(lang, `Commission pending · ${publicId}`, `Comisión pendiente · ${publicId}`),
              headline: tr(lang, "A commission was accrued.", "Se acumuló una comisión."),
              paragraphs: [
                tr(
                  lang,
                  `Hi ${aff.first_name}, loan finalize on ${publicId} created a pending commission of ${money(amount)}.`,
                  `Hola ${aff.first_name}, al finalizar el préstamo de ${publicId} se creó una comisión pendiente de ${money(amount)}.`,
                ),
              ],
              cta: {
                url: `${APP_URL}/affiliate/commissions`,
                label: tr(lang, "View commissions", "Ver comisiones"),
              },
            }),
          );
        }
        if (staffTotal > 0) {
          await notifyStaff("commission_accrued", (l) => ({
            subject: tr(l, `Commission accrued · ${publicId}`, `Comisión acumulada · ${publicId}`),
            headline: tr(l, "Affiliate commission pending.", "Comisión de afiliado pendiente."),
            paragraphs: [
              tr(
                l,
                `${money(staffTotal)} pending for ${publicId} across ${pendingRows.length} payee(s).`,
                `${money(staffTotal)} pendiente para ${publicId} entre ${pendingRows.length} beneficiario(s).`,
              ),
            ],
            cta: {
              url: `${APP_URL}/admin/commissions`,
              label: tr(l, "Open commissions", "Abrir comisiones"),
            },
          }));
        }
      }

      const detail = await loadAdminProjectDetail(publicId, adminCan(user.role, "finance.read"));
      res.json({ ok: true, ...detail });
    }),
  );

  app.post(
    "/api/admin/projects/:publicId/anchor/sync",
    requireAdmin("projects.write"),
    route(async (req, res) => {
      const user = portalUser(res);
      const publicId = parsePublicId(req.params.publicId);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT id FROM projects WHERE public_id = ? LIMIT 1`,
        [publicId],
      );
      if (!rows[0]) throw new HttpError(404, "errors.notFound");
      const result = await syncProjectAnchor(Number(rows[0].id), user.id);
      const detail = await loadAdminProjectDetail(
        publicId,
        adminCan(user.role, "finance.read"),
      );
      res.json({ ok: true, sync: result, ...detail });
    }),
  );

  // ── Contracts (generate stub — PDF rendering deferred, decision 13A) ─────
  app.post(
    "/api/admin/projects/:publicId/contracts",
    requireAdmin("projects.write"),
    route(async (req, res) => {
      const publicId = parsePublicId(req.params.publicId);
      const kind = ["contractor_client", "affiliate_terms", "other"].includes(String(req.body?.kind))
        ? String(req.body.kind)
        : "contractor_client";
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT p.id, p.public_id, p.property_address, p.property_city, p.property_state,
                p.property_zip, p.sq_ft, p.contractor_cost_cents, p.contractor_id,
                c.first_name AS c_first, c.last_name AS c_last, c.email AS c_email, c.phone AS c_phone,
                k.first_name AS k_first, k.last_name AS k_last, k.company AS k_company,
                k.license_number AS k_license, k.email AS k_email,
                pl.name AS plan_name, pl.bedrooms, pl.bathrooms
         FROM projects p
         JOIN clients c ON c.id = p.client_id
         LEFT JOIN contractors k ON k.id = p.contractor_id
         LEFT JOIN adu_plans pl ON pl.id = p.adu_plan_id
         WHERE p.public_id = ? LIMIT 1`,
        [publicId],
      );
      const p = rows[0];
      if (!p) throw new HttpError(404, "errors.notFound");
      if (kind === "contractor_client" && !p.contractor_id) {
        throw new HttpError(400, "errors.contractorRequired");
      }
      const payload = {
        project: p.public_id,
        generated_on: new Date().toISOString().slice(0, 10),
        property: {
          address: p.property_address,
          city: p.property_city,
          state: p.property_state,
          zip: p.property_zip,
        },
        plan: p.plan_name
          ? { name: p.plan_name, sq_ft: p.sq_ft, bedrooms: p.bedrooms, bathrooms: p.bathrooms }
          : null,
        client: { name: `${p.c_first} ${p.c_last}`, email: p.c_email, phone: p.c_phone },
        contractor: p.contractor_id
          ? {
              name: `${p.k_first} ${p.k_last}`,
              company: p.k_company,
              license: p.k_license,
              email: p.k_email,
            }
          : null,
        contract_price_cents: p.contractor_cost_cents ?? null,
      };
      const [r] = await pool.execute<ResultSetHeader>(
        `INSERT INTO project_contracts (project_id, kind, status, payload_json, generated_at)
         VALUES (?, ?, 'generated', ?, NOW())`,
        [p.id, kind, JSON.stringify(payload)],
      );
      res.status(201).json({ ok: true, id: Number(r.insertId) });
    }),
  );

  app.patch(
    "/api/admin/contracts/:id",
    requireAdmin("projects.write"),
    route(async (req, res) => {
      const id = parseId(req.params.id);
      const { updates } = parsePatch(req.body, {
        status: fEnum(["generated", "sent", "signed", "void"] as const),
        storage_url: fStr(1000),
      });
      if (updates.storage_url && !/^https:\/\//i.test(updates.storage_url)) {
        throw new HttpError(400, "validation.photoUrl");
      }
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT pc.status, pc.kind, p.public_id, c.email AS client_email, c.first_name AS client_first,
                c.preferred_language AS client_lang, k.email AS contractor_email,
                k.first_name AS contractor_first, k.preferred_language AS contractor_lang
         FROM project_contracts pc
         JOIN projects p ON p.id = pc.project_id
         JOIN clients c ON c.id = p.client_id
         LEFT JOIN contractors k ON k.id = p.contractor_id
         WHERE pc.id = ? LIMIT 1`,
        [id],
      );
      if (!rows[0]) throw new HttpError(404, "errors.notFound");
      if (rows[0].status === "signed" || rows[0].status === "void") {
        throw new HttpError(409, "errors.invalidTransition");
      }
      if (updates.status === "signed") updates.signed_at = new Date();
      await applyUpdate(pool, "project_contracts", id, updates);
      if (updates.status === "sent" && rows[0].status !== "sent") {
        const pub = String(rows[0].public_id);
        const recipients: Array<{ email: string; first: string; lang: ReturnType<typeof asLang> }> =
          [];
        if (rows[0].client_email) {
          recipients.push({
            email: String(rows[0].client_email),
            first: String(rows[0].client_first || ""),
            lang: asLang(rows[0].client_lang),
          });
        }
        if (rows[0].kind === "contractor_client" && rows[0].contractor_email) {
          recipients.push({
            email: String(rows[0].contractor_email),
            first: String(rows[0].contractor_first || ""),
            lang: asLang(rows[0].contractor_lang),
          });
        }
        for (const r of recipients) {
          await safeSend(
            r.email,
            tplPortalNotice({
              lang: r.lang,
              subject: tr(r.lang, `Contract ready · ${pub}`, `Contrato listo · ${pub}`),
              headline: tr(r.lang, "A contract was sent.", "Se envió un contrato."),
              paragraphs: [
                tr(
                  r.lang,
                  `Hi ${r.first}, a contract for project ${pub} is ready to review.`,
                  `Hola ${r.first}, un contrato del proyecto ${pub} está listo para revisar.`,
                ),
              ],
              cta: {
                url:
                  rows[0].kind === "contractor_client" && r.email === rows[0].contractor_email
                    ? `${APP_URL}/contractor/projects/${pub}`
                    : `${APP_URL}/client/documents`,
                label: tr(r.lang, "Open portal", "Abrir portal"),
              },
            }),
          );
        }
        await notifyStaff("contract_sent", (l) => ({
          subject: tr(l, `Contract sent · ${pub}`, `Contrato enviado · ${pub}`),
          headline: tr(l, "Contract marked sent.", "Contrato marcado como enviado."),
          paragraphs: [tr(l, `Project ${pub} contract was marked sent.`, `El contrato del proyecto ${pub} se marcó como enviado.`)],
          cta: {
            url: `${APP_URL}/admin/projects/${pub}`,
            label: tr(l, "Open project", "Abrir proyecto"),
          },
        }));
      }
      res.json({ ok: true });
    }),
  );

  app.get(
    "/api/admin/contracts/:id/pdf",
    requireAdmin("projects.read"),
    route(async (req, res) => {
      const user = portalUser(res);
      const id = parseId(req.params.id);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT pc.id, pc.kind, pc.status, pc.payload_json, p.public_id
         FROM project_contracts pc JOIN projects p ON p.id = pc.project_id
         WHERE pc.id = ? LIMIT 1`,
        [id],
      );
      sendContractPdf(res, rows[0], req.query.lang ?? user.preferred_language);
    }),
  );

  // ── Draws ─────────────────────────────────────────────────────────────────
  app.get(
    "/api/admin/draws",
    requireAdmin("projects.read"),
    route(async (req, res) => {
      const status = ["draft", "submitted", "approved", "rejected", "paid"].includes(
        String(req.query.status),
      )
        ? String(req.query.status)
        : null;
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT d.id, d.project_id, d.amount_cents, d.status, d.note, d.reviewed_at, d.paid_at,
                d.created_at, p.public_id AS project_public_id, p.property_address,
                COALESCE(NULLIF(k.company, ''), CONCAT(k.first_name, ' ', k.last_name)) AS contractor_name
         FROM draw_requests d
         JOIN projects p ON p.id = d.project_id
         JOIN contractors k ON k.id = d.contractor_id
         WHERE d.status <> 'draft' ${status ? "AND d.status = ?" : ""}
         ORDER BY FIELD(d.status, 'submitted', 'approved', 'rejected', 'paid'), d.id DESC
         LIMIT 500`,
        status ? [status] : [],
      );
      res.json({ ok: true, draws: rows });
    }),
  );

  app.patch(
    "/api/admin/draws/:id",
    // Temporary: any staff who can list draws may review them (choice 2).
    requireAdmin("projects.read"),
    route(async (req, res) => {
      const user = portalUser(res);
      const id = parseId(req.params.id);
      const { updates } = parsePatch(req.body, {
        status: fEnum(["approved", "rejected", "paid"] as const),
        note: fStr(2000),
      });
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT d.id, d.status, d.amount_cents, p.public_id, k.email, k.first_name, k.preferred_language
         FROM draw_requests d JOIN projects p ON p.id = d.project_id
         JOIN contractors k ON k.id = d.contractor_id WHERE d.id = ? LIMIT 1`,
        [id],
      );
      const d = rows[0];
      if (!d) throw new HttpError(404, "errors.notFound");
      const next = updates.status as string | undefined;
      if (next) {
        const allowed: Record<string, string[]> = {
          submitted: ["approved", "rejected"],
          approved: ["paid", "rejected"],
        };
        if (!allowed[String(d.status)]?.includes(next)) {
          throw new HttpError(409, "errors.invalidTransition");
        }
        updates.reviewed_by_admin_id = user.id;
        updates.reviewed_at = new Date();
        if (next === "paid") updates.paid_at = new Date();
      }
      await withTx(async (conn) => {
        await applyUpdate(conn, "draw_requests", id, updates);
        // Rejected draws free reserved budget.
        if (next === "rejected") {
          await conn.execute(
            `UPDATE projects p
             JOIN draw_requests d ON d.project_id = p.id
             SET p.draw_committed_cents = GREATEST(0, CAST(p.draw_committed_cents AS SIGNED) - d.amount_cents)
             WHERE d.id = ?`,
            [id],
          );
        }
      });
      if (next) {
        const lang = asLang(d.preferred_language);
        const label = tr(
          lang,
          next === "approved" ? "approved" : next === "paid" ? "paid" : "rejected",
          next === "approved" ? "aprobada" : next === "paid" ? "pagada" : "rechazada",
        );
        await safeSend(
          String(d.email),
          tplPortalNotice({
            lang,
            subject: tr(lang, `Draw request ${label} · ${d.public_id}`, `Solicitud de desembolso ${label} · ${d.public_id}`),
            headline: tr(lang, `Your draw request was ${label}.`, `Tu solicitud de desembolso fue ${label}.`),
            paragraphs: [
              tr(lang, `Hi ${d.first_name}, your request for ${money(d.amount_cents)} on ${d.public_id} is now ${label}.`, `Hola ${d.first_name}, tu solicitud de ${money(d.amount_cents)} en ${d.public_id} ahora está ${label}.`),
              ...(updates.note ? [String(updates.note)] : []),
            ],
            cta: { url: `${APP_URL}/contractor/draws`, label: tr(lang, "View draws", "Ver desembolsos") },
          }),
        );
      }
      res.json({ ok: true });
    }),
  );

  // ── Commissions ───────────────────────────────────────────────────────────
  app.get(
    "/api/admin/commissions",
    requireAdmin("finance.read"),
    route(async (req, res) => {
      const status = ["pending", "approved", "paid", "void"].includes(String(req.query.status))
        ? String(req.query.status)
        : null;
      const role = ["direct", "closer", "parent"].includes(String(req.query.role))
        ? String(req.query.role)
        : null;
      const affiliateId = req.query.affiliate_id
        ? parseId(req.query.affiliate_id)
        : null;
      const where: string[] = [];
      const params: any[] = [];
      if (status) {
        where.push("ac.status = ?");
        params.push(status);
      }
      if (role) {
        where.push("ac.role = ?");
        params.push(role);
      }
      if (affiliateId) {
        where.push("ac.affiliate_id = ?");
        params.push(affiliateId);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT ac.*, CONCAT(a.first_name, ' ', a.last_name) AS affiliate_name,
                a.email AS affiliate_email, p.public_id AS project_public_id,
                CONCAT(c.first_name, ' ', c.last_name) AS client_name
         FROM affiliate_commissions ac
         JOIN affiliates a ON a.id = ac.affiliate_id
         JOIN projects p ON p.id = ac.project_id
         LEFT JOIN clients c ON c.id = ac.client_id
         ${whereSql}
         ORDER BY FIELD(ac.status, 'pending', 'approved', 'paid', 'void'), ac.id DESC
         LIMIT 500`,
        params,
      );
      res.json({ ok: true, commissions: rows });
    }),
  );

  app.patch(
    "/api/admin/commissions/:id",
    requireAdmin("finance.write"),
    route(async (req, res) => {
      const id = parseId(req.params.id);
      const { updates } = parsePatch(req.body, {
        status: fEnum(["pending", "approved", "paid", "void"] as const),
        notes: fStr(500),
        expected_pay_at: fDate,
        amount_cents: fInt(0, 2_000_000_000, false),
      });
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT ac.*, a.email, a.first_name, a.preferred_language, p.public_id
         FROM affiliate_commissions ac JOIN affiliates a ON a.id = ac.affiliate_id
         JOIN projects p ON p.id = ac.project_id WHERE ac.id = ? LIMIT 1`,
        [id],
      );
      const c = rows[0];
      if (!c) throw new HttpError(404, "errors.notFound");
      if (c.status === "paid") throw new HttpError(409, "errors.invalidTransition");
      const projectId = Number(c.project_id);
      const next = updates.status as string | undefined;
      if (next) {
        const allowed: Record<string, string[]> = {
          pending: ["approved", "void"],
          approved: ["paid", "void", "pending"],
          void: ["pending"],
        };
        if (!allowed[String(c.status)]?.includes(next)) {
          throw new HttpError(409, "errors.invalidTransition");
        }
        if (next === "paid") updates.paid_at = new Date();
      }
      // After any share is paid, amounts are frozen (sibling can still be approved/paid).
      if ("amount_cents" in updates && (await projectHasPaidCommission(pool, projectId))) {
        throw new HttpError(409, "errors.commissionPaidLocked");
      }
      await withTx(async (conn) => {
        await applyUpdate(conn, "affiliate_commissions", id, updates);
        if (next === "paid") {
          // Freeze project affiliate total on first payout (sum of live non-void rows).
          const [[sumRow]] = (await conn.execute<RowDataPacket[]>(
            `SELECT COALESCE(SUM(amount_cents), 0) AS n FROM affiliate_commissions
             WHERE project_id = ? AND status IN ('pending','approved','paid')`,
            [projectId],
          )) as unknown as [RowDataPacket[]];
          const affComm = Number(sumRow?.n || 0);
          const [projRows] = await conn.execute<RowDataPacket[]>(
            `SELECT * FROM projects WHERE id = ? LIMIT 1`,
            [projectId],
          );
          const proj = projRows[0];
          if (proj) {
            const econ = computeProjectEconomics({
              sale_price_cents: proj.sale_price_cents ?? null,
              contractor_cost_cents: proj.contractor_cost_cents ?? null,
              affiliate_commission_cents: affComm,
              agent_commission_cents: proj.agent_commission_cents ?? null,
              sq_ft: proj.sq_ft ?? null,
            });
            await conn.execute(
              `UPDATE projects SET affiliate_commission_cents = ?, net_profit_cents = ?,
                 net_profit_per_sqft_cents = ? WHERE id = ?`,
              [affComm, econ.net_profit_cents, econ.net_profit_per_sqft_cents, projectId],
            );
          }
          // Project commission_paid_at only when every non-void share is paid.
          const [[open]] = (await conn.execute<RowDataPacket[]>(
            `SELECT COUNT(*) AS n FROM affiliate_commissions
             WHERE project_id = ? AND status IN ('pending','approved')`,
            [projectId],
          )) as unknown as [RowDataPacket[]];
          if (Number(open?.n || 0) === 0) {
            await conn.execute(
              `UPDATE projects SET commission_paid_at = NOW() WHERE id = ?`,
              [projectId],
            );
          }
        }
        if ("amount_cents" in updates) {
          const [projRows] = await conn.execute<RowDataPacket[]>(
            `SELECT parent_affiliate_id FROM projects WHERE id = ? LIMIT 1`,
            [projectId],
          );
          const [[sib]] = (await conn.execute<RowDataPacket[]>(
            `SELECT COUNT(*) AS n FROM affiliate_commissions
             WHERE project_id = ? AND status <> 'void'`,
            [projectId],
          )) as unknown as [RowDataPacket[]];
          const isSplit =
            Boolean(projRows[0]?.parent_affiliate_id) || Number(sib?.n || 0) > 1;
          if (isSplit) {
            // Per-share edit must not become the project-total override (would re-split 70/30).
            await refreshProjectEconomicsFromCommissionRows(conn, projectId);
          } else {
            // Decision 7C: single-payee admin amount becomes the project override.
            await conn.execute(
              `UPDATE projects SET commission_override_cents = ? WHERE id = ?`,
              [updates.amount_cents, projectId],
            );
            await recalcProject(conn, projectId);
          }
        }
      });
      if (next === "paid") {
        // Always notify the payee on this row (closer or parent).
        const lang = asLang(c.preferred_language);
        await safeSend(
          String(c.email),
          tplPortalNotice({
            lang,
            subject: tr(lang, "Your commission was paid — Groundwork Capital", "Tu comisión fue pagada — Groundwork Capital"),
            headline: tr(lang, "Commission paid.", "Comisión pagada."),
            paragraphs: [
              tr(lang, `Hi ${c.first_name}, your commission for project ${c.public_id} has been paid.`, `Hola ${c.first_name}, tu comisión del proyecto ${c.public_id} fue pagada.`),
            ],
            details: [[tr(lang, "Amount", "Monto"), money(updates.amount_cents ?? c.amount_cents)]],
            cta: { url: `${APP_URL}/affiliate/commissions`, label: tr(lang, "View commissions", "Ver comisiones") },
          }),
        );
      }
      res.json({ ok: true });
    }),
  );

  // ── Staff (super_admin only) ──────────────────────────────────────────────
  app.get(
    "/api/admin/staff",
    requireAdmin("staff"),
    route(async (_req, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, email, first_name, last_name, phone, role, status, last_login_at, created_at
         FROM admins ORDER BY id`,
      );
      res.json({ ok: true, staff: rows });
    }),
  );

  app.post(
    "/api/admin/staff",
    requireAdmin("staff"),
    route(async (req, res) => {
      const b = req.body || {};
      const email = normalizeEmail(b.email);
      const first = String(b.first_name || "").trim().slice(0, 100);
      const last = String(b.last_name || "").trim().slice(0, 100);
      const role = String(b.role || "");
      if (!isValidEmail(email)) throw new HttpError(400, "validation.emailInvalid");
      if (!first) throw new HttpError(400, "validation.firstNameRequired");
      if (!last) throw new HttpError(400, "validation.lastNameRequired");
      if (!["super_admin", "admin", "agent", "finance", "content"].includes(role)) {
        throw new HttpError(400, "validation.invalidField");
      }
      const lang = asLang(b.preferred_language);
      const [r] = await pool.execute<ResultSetHeader>(
        `INSERT INTO admins (email, first_name, last_name, phone, role, status, preferred_language)
         VALUES (?, ?, ?, ?, ?, 'active', ?)`,
        [email, first, last, b.phone ? String(b.phone).trim().slice(0, 20) : null, role, lang],
      );
      await safeSend(
        email,
        tplPortalNotice({
          lang,
          subject: tr(lang, "You've been added to Groundwork Admin", "Te agregaron a Groundwork Admin"),
          headline: tr(lang, "Welcome to the team.", "Bienvenido al equipo."),
          paragraphs: [
            tr(lang, `Hi ${first}, you now have ${role.replace("_", " ")} access to the Groundwork admin portal.`, `Hola ${first}, ahora tienes acceso de ${role.replace("_", " ")} al portal de administración de Groundwork.`),
          ],
          cta: { url: `${APP_URL}/admin/login`, label: tr(lang, "Open admin portal", "Abrir portal de administración") },
        }),
      );
      res.status(201).json({ ok: true, id: Number(r.insertId) });
    }),
  );

  app.patch(
    "/api/admin/staff/:id",
    requireAdmin("staff"),
    route(async (req, res) => {
      const me = portalUser(res);
      const id = parseId(req.params.id);
      const { updates } = parsePatch(req.body, {
        role: fEnum(["super_admin", "admin", "agent", "finance", "content"] as const),
        status: fEnum(["active", "inactive", "suspended"] as const),
        first_name: fStr(100, { min: 1 }),
        last_name: fStr(100, { min: 1 }),
        phone: fStr(20),
      });
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT id, role, status FROM admins WHERE id = ? LIMIT 1`,
        [id],
      );
      const target = rows[0];
      if (!target) throw new HttpError(404, "errors.notFound");
      const losesSuper =
        target.role === "super_admin" &&
        target.status === "active" &&
        (("role" in updates && updates.role !== "super_admin") ||
          ("status" in updates && updates.status !== "active"));
      if (losesSuper) {
        if (id === me.id) throw new HttpError(409, "errors.cannotDemoteSelf");
        const [[n]] = (await pool.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS n FROM admins WHERE role = 'super_admin' AND status = 'active'`,
        )) as unknown as [RowDataPacket[]];
        if (Number(n.n) <= 1) throw new HttpError(409, "errors.lastSuperAdmin");
      }
      if (id === me.id && "status" in updates && updates.status !== "active") {
        throw new HttpError(409, "errors.cannotDemoteSelf");
      }
      await applyUpdate(pool, "admins", id, updates);
      res.json({ ok: true });
    }),
  );

  // ── Settings ──────────────────────────────────────────────────────────────
  app.get(
    "/api/admin/settings",
    requireAdmin("settings"),
    route(async (_req, res) => {
      const [extras] = await pool.execute<RowDataPacket[]>(
        `SELECT id, email, label, is_active, events_json, created_at
         FROM admin_notify_extra_emails
         ORDER BY id ASC`,
      );
      const rates = await loadCommissionRates();
      res.json({
        ok: true,
        settings: {
          commission_payout_days_after_loan_close: await getSettingInt(
            "commission_payout_days_after_loan_close",
            5,
          ),
          // Legacy alias kept for older clients; equals direct rate.
          commission_cents_per_sqft: rates.direct_cents_per_sqft,
          commission_direct_cents_per_sqft: rates.direct_cents_per_sqft,
          commission_closer_cents_per_sqft: rates.closer_cents_per_sqft,
          commission_parent_cents_per_sqft: rates.parent_cents_per_sqft,
        },
        notify_extra_emails: extras.map(mapNotifyExtraEmailRow),
        notify_event_keys: ADMIN_NOTIFY_EVENT_KEYS,
      });
    }),
  );

  app.put(
    "/api/admin/settings",
    requireAdmin("settings"),
    route(async (req, res) => {
      const { updates } = parsePatch(req.body, {
        commission_payout_days_after_loan_close: fInt(0, 365, false),
        commission_cents_per_sqft: fInt(0, 100000, false),
        commission_direct_cents_per_sqft: fInt(0, 100000, false),
        commission_closer_cents_per_sqft: fInt(0, 100000, false),
        commission_parent_cents_per_sqft: fInt(0, 100000, false),
      });
      // Keep legacy key in sync when direct is written (or vice versa).
      if (
        "commission_direct_cents_per_sqft" in updates &&
        !("commission_cents_per_sqft" in updates)
      ) {
        updates.commission_cents_per_sqft = updates.commission_direct_cents_per_sqft;
      } else if (
        "commission_cents_per_sqft" in updates &&
        !("commission_direct_cents_per_sqft" in updates)
      ) {
        updates.commission_direct_cents_per_sqft = updates.commission_cents_per_sqft;
      }
      for (const [key, value] of Object.entries(updates)) {
        await pool.execute(
          `INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
          [key, String(value)],
        );
      }
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/admin/settings/notify-extras",
    requireAdmin("settings"),
    route(async (req, res) => {
      const user = portalUser(res);
      const email = normalizeEmail(req.body?.email);
      const label = req.body?.label ? String(req.body.label).trim().slice(0, 100) : null;
      if (!isValidEmail(email)) throw new HttpError(400, "validation.emailInvalid");
      // Default: all team alert types except inbound_sms (line-owner traffic is noisy for ops copies).
      let eventsJson: string | null = JSON.stringify(
        ADMIN_NOTIFY_EVENT_KEYS.filter((k) => k !== "inbound_sms"),
      );
      if ("events" in (req.body || {})) {
        const normalized = normalizeNotifyExtraEventsInput(req.body.events);
        if (normalized === undefined) throw new HttpError(400, "validation.invalidField");
        eventsJson = normalized == null ? null : JSON.stringify(normalized);
      }
      try {
        const [r] = await pool.execute<ResultSetHeader>(
          `INSERT INTO admin_notify_extra_emails
             (email, label, is_active, events_json, created_by_admin_id)
           VALUES (?, ?, 1, ?, ?)`,
          [email, label, eventsJson, user.id],
        );
        res.status(201).json({ ok: true, id: Number(r.insertId) });
      } catch (e: any) {
        if (e?.code === "ER_DUP_ENTRY") throw new HttpError(409, "errors.duplicate");
        throw e;
      }
    }),
  );

  app.patch(
    "/api/admin/settings/notify-extras/:id",
    requireAdmin("settings"),
    route(async (req, res) => {
      const id = parseId(req.params.id);
      const { updates } = parsePatch(req.body, {
        label: fStr(100),
        is_active: fBool,
        email: fStr(255),
      });
      if ("email" in updates && updates.email) {
        const email = normalizeEmail(updates.email);
        if (!isValidEmail(email)) throw new HttpError(400, "validation.emailInvalid");
        updates.email = email;
      }
      if (req.body && "events" in req.body) {
        const normalized = normalizeNotifyExtraEventsInput(req.body.events);
        if (normalized === undefined) throw new HttpError(400, "validation.invalidField");
        updates.events_json =
          normalized == null ? null : JSON.stringify(normalized);
      }
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT id FROM admin_notify_extra_emails WHERE id = ? LIMIT 1`,
        [id],
      );
      if (!rows[0]) throw new HttpError(404, "errors.notFound");
      await applyUpdate(pool, "admin_notify_extra_emails", id, updates);
      res.json({ ok: true });
    }),
  );

  app.delete(
    "/api/admin/settings/notify-extras/:id",
    requireAdmin("settings"),
    route(async (req, res) => {
      const id = parseId(req.params.id);
      const [r] = await pool.execute<ResultSetHeader>(
        `DELETE FROM admin_notify_extra_emails WHERE id = ?`,
        [id],
      );
      if (!r.affectedRows) throw new HttpError(404, "errors.notFound");
      res.json({ ok: true });
    }),
  );

  // ── Team notifications (staff prefs + extras catalog) ───────────────────
  app.get(
    "/api/admin/notify-recipients",
    requireAdmin("settings"),
    route(async (_req, res) => {
      const [staffRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, email, first_name, last_name, role, phone, notification_prefs_json
         FROM admins
         WHERE status = 'active'
           AND role IN ('super_admin', 'admin', 'agent', 'finance', 'content')
           AND email IS NOT NULL AND TRIM(email) <> ''
         ORDER BY first_name ASC, last_name ASC, id ASC`,
      );
      const staff: AdminNotifyStaffRecipient[] = await Promise.all(
        staffRows.map(async (r) => {
          const id = Number(r.id);
          return {
            id,
            email: String(r.email),
            first_name: String(r.first_name || ""),
            last_name: String(r.last_name || ""),
            role: String(r.role),
            phone: r.phone ? String(r.phone) : null,
            prefs: parseAdminNotificationPrefs(r.notification_prefs_json),
            channels: await adminNotifyChannelMetaForAdmin(id),
          };
        }),
      );
      const [extraRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, email, label, is_active, events_json, created_at
         FROM admin_notify_extra_emails
         ORDER BY id ASC`,
      );
      res.json({
        ok: true,
        staff,
        extras: extraRows.map(mapNotifyExtraEmailRow),
        events: ADMIN_NOTIFY_EVENT_KEYS,
      });
    }),
  );

  app.put(
    "/api/admin/admins/:id/notification-prefs",
    requireAdmin("settings"),
    route(async (req, res) => {
      const targetId = parseId(req.params.id);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, email, first_name, last_name, role, phone, status, notification_prefs_json
         FROM admins WHERE id = ? LIMIT 1`,
        [targetId],
      );
      if (!rows[0] || String(rows[0].status) !== "active") {
        throw new HttpError(404, "errors.notFound");
      }
      const role = String(rows[0].role);
      if (
        !["super_admin", "admin", "agent", "finance", "content"].includes(role)
      ) {
        throw new HttpError(400, "validation.invalidField");
      }
      const existing = parseAdminNotificationPrefs(
        rows[0].notification_prefs_json,
      );
      const merged = mergeAdminNotificationPrefsFromBody(
        existing,
        (req.body || {}) as Record<string, unknown>,
      );
      if (!(await adminSmsChannelAvailable(targetId))) {
        merged.sms = existing.sms;
      }
      await pool.query(
        `UPDATE admins SET notification_prefs_json = ? WHERE id = ?`,
        [JSON.stringify(merged), targetId],
      );
      const staff: AdminNotifyStaffRecipient = {
        id: targetId,
        email: String(rows[0].email),
        first_name: String(rows[0].first_name || ""),
        last_name: String(rows[0].last_name || ""),
        role,
        phone: rows[0].phone ? String(rows[0].phone) : null,
        prefs: merged,
        channels: await adminNotifyChannelMetaForAdmin(targetId),
      };
      res.json({ ok: true, staff });
    }),
  );

  registerCampaignRoutes(app);
  registerConversationsRoutes(app);
}


// ─── Campaigns (Resend transactional email + consent-gated Twilio SMS) ────────

type CampaignRecipientRow = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  lang: "en" | "es";
  sms_marketing_consent: boolean;
};

const CAMPAIGN_TEMPLATE_ROLES: CampaignTemplateRole[] = [
  "opener",
  "reply_1",
  "reply_2",
  "reply_3",
  "reply_4",
];

const REPLY_DIGIT_TO_TAG: Record<string, LeadAudienceTag> = {
  "1": "homeowner",
  "2": "information",
  "3": "affiliate_lead",
  "4": "contractor_lead",
};

function parseCampaignAudienceFilter(raw: unknown): CampaignAudienceFilter {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: CampaignAudienceFilter = {};
  if (typeof o.status === "string" && o.status.trim()) out.status = o.status.trim();
  if (typeof o.created_from === "string" && o.created_from.trim()) {
    out.created_from = o.created_from.trim().slice(0, 10);
  }
  if (typeof o.created_to === "string" && o.created_to.trim()) {
    out.created_to = o.created_to.trim().slice(0, 10);
  }
  if (o.event_id != null && Number.isFinite(Number(o.event_id))) {
    out.event_id = Number(o.event_id);
  }
  return out;
}

function parseCampaignChannels(raw: unknown): CampaignChannels {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    email: o.email !== false,
    sms: o.sms !== false,
  };
}

function firstNameFromFull(name: string): string {
  const t = String(name || "").trim();
  return t.split(/\s+/)[0] || "there";
}

function renderCampaignPlaceholders(
  template: string,
  vars: Record<string, string>,
): string {
  let out = String(template || "");
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(v);
  }
  return out;
}

function wrapCampaignEmailHtml(opts: {
  lang: "en" | "es";
  bodyHtml: string;
  /** Defaults to Resend Broadcast placeholder; pass a real URL for transactional sends. */
  unsubscribeUrl?: string;
}): string {
  const unsubHref = opts.unsubscribeUrl || "{{{RESEND_UNSUBSCRIBE_URL}}}";
  const unsubLabel =
    opts.lang === "es" ? "darse de baja" : "unsubscribe";
  const unsubNote =
    opts.lang === "es"
      ? `Puede darse de baja aquí: <a href="${unsubHref}" style="color:#6b7280;">${unsubLabel}</a>`
      : `You can unsubscribe here: <a href="${unsubHref}" style="color:#6b7280;">${unsubLabel}</a>`;
  return emailLayout({
    title: APP_NAME,
    preheader: "",
    bodyHtml: `${opts.bodyHtml}<p style="margin:28px 0 0;font-size:12px;line-height:1.5;color:#6b7280;">${unsubNote}</p>`,
    lang: opts.lang,
  });
}

async function loadCampaignTemplates(
  campaignId: number,
): Promise<CampaignTemplate[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, role, subject_en, subject_es, email_html_en, email_html_es,
            sms_body_en, sms_body_es
     FROM campaign_templates WHERE campaign_id = ? ORDER BY id ASC`,
    [campaignId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    role: String(r.role) as CampaignTemplateRole,
    subject_en: r.subject_en != null ? String(r.subject_en) : null,
    subject_es: r.subject_es != null ? String(r.subject_es) : null,
    email_html_en: r.email_html_en != null ? String(r.email_html_en) : null,
    email_html_es: r.email_html_es != null ? String(r.email_html_es) : null,
    sms_body_en: r.sms_body_en != null ? String(r.sms_body_en) : null,
    sms_body_es: r.sms_body_es != null ? String(r.sms_body_es) : null,
  }));
}

function mapCampaignRow(
  r: RowDataPacket,
  templates: CampaignTemplate[],
): Campaign {
  let filter: CampaignAudienceFilter = {};
  let channels: CampaignChannels = { email: true, sms: true };
  let stats: Record<string, unknown> | null = null;
  try {
    filter = parseCampaignAudienceFilter(
      typeof r.audience_filter_json === "string"
        ? JSON.parse(r.audience_filter_json)
        : r.audience_filter_json,
    );
  } catch {
    /* defaults */
  }
  try {
    channels = parseCampaignChannels(
      typeof r.channels_json === "string"
        ? JSON.parse(r.channels_json)
        : r.channels_json,
    );
  } catch {
    /* defaults */
  }
  try {
    if (r.stats_json) {
      stats =
        typeof r.stats_json === "string"
          ? JSON.parse(r.stats_json)
          : (r.stats_json as Record<string, unknown>);
    }
  } catch {
    stats = null;
  }
  return {
    id: Number(r.id),
    name: String(r.name),
    audience_kind: String(r.audience_kind) as CampaignAudienceKind,
    audience_filter: filter,
    channels,
    status: String(r.status) as Campaign["status"],
    created_by_admin_id:
      r.created_by_admin_id != null ? Number(r.created_by_admin_id) : null,
    scheduled_at: r.scheduled_at
      ? new Date(r.scheduled_at as string | Date).toISOString()
      : null,
    sent_at: r.sent_at
      ? new Date(r.sent_at as string | Date).toISOString()
      : null,
    resend_segment_id_en: r.resend_segment_id_en
      ? String(r.resend_segment_id_en)
      : null,
    resend_segment_id_es: r.resend_segment_id_es
      ? String(r.resend_segment_id_es)
      : null,
    resend_broadcast_id_en: r.resend_broadcast_id_en
      ? String(r.resend_broadcast_id_en)
      : null,
    resend_broadcast_id_es: r.resend_broadcast_id_es
      ? String(r.resend_broadcast_id_es)
      : null,
    stats,
    templates,
    created_at: r.created_at
      ? new Date(r.created_at as string | Date).toISOString()
      : null,
    updated_at: r.updated_at
      ? new Date(r.updated_at as string | Date).toISOString()
      : null,
  };
}

async function loadCampaign(id: number): Promise<Campaign | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM campaigns WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!rows[0]) return null;
  return mapCampaignRow(rows[0], await loadCampaignTemplates(id));
}

async function listCampaignAudience(
  kind: CampaignAudienceKind,
  filter: CampaignAudienceFilter,
): Promise<CampaignRecipientRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (kind === "leads") {
    if (filter.status) {
      where.push(`status = ?`);
      params.push(filter.status);
    }
    if (filter.created_from) {
      where.push(`DATE(created_at) >= ?`);
      params.push(filter.created_from);
    }
    if (filter.created_to) {
      where.push(`DATE(created_at) <= ?`);
      params.push(filter.created_to);
    }
    if (filter.event_id != null) {
      where.push(`event_id = ?`);
      params.push(filter.event_id);
    }
    const sql = `
      SELECT id, full_name AS name, email, phone, preferred_language AS lang,
             sms_marketing_consent
      FROM leads
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY id DESC
      LIMIT 5000`;
    const [rows] = await pool.query<RowDataPacket[]>(sql, params);
    return rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name || ""),
      email: r.email ? String(r.email).trim().toLowerCase() : null,
      phone: r.phone ? String(r.phone) : null,
      lang: r.lang === "es" ? "es" : "en",
      sms_marketing_consent: Number(r.sms_marketing_consent) === 1,
    }));
  }

  if (kind === "affiliates") {
    if (filter.status) {
      where.push(`status = ?`);
      params.push(filter.status);
    }
    if (filter.created_from) {
      where.push(`DATE(created_at) >= ?`);
      params.push(filter.created_from);
    }
    if (filter.created_to) {
      where.push(`DATE(created_at) <= ?`);
      params.push(filter.created_to);
    }
    const sql = `
      SELECT id, CONCAT(first_name,' ',last_name) AS name, email, phone,
             preferred_language AS lang, sms_marketing_consent
      FROM affiliates
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY id DESC
      LIMIT 5000`;
    const [rows] = await pool.query<RowDataPacket[]>(sql, params);
    return rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name || "").trim(),
      email: r.email ? String(r.email).trim().toLowerCase() : null,
      phone: r.phone ? String(r.phone) : null,
      lang: r.lang === "es" ? "es" : "en",
      sms_marketing_consent: Number(r.sms_marketing_consent) === 1,
    }));
  }

  if (filter.status) {
    where.push(`status = ?`);
    params.push(filter.status);
  }
  if (filter.created_from) {
    where.push(`DATE(created_at) >= ?`);
    params.push(filter.created_from);
  }
  if (filter.created_to) {
    where.push(`DATE(created_at) <= ?`);
    params.push(filter.created_to);
  }
  const sql = `
    SELECT id, CONCAT(first_name,' ',last_name) AS name, email, phone,
           preferred_language AS lang, sms_marketing_consent
    FROM contractors
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY id DESC
    LIMIT 5000`;
  const [rows] = await pool.query<RowDataPacket[]>(sql, params);
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name || "").trim(),
    email: r.email ? String(r.email).trim().toLowerCase() : null,
    phone: r.phone ? String(r.phone) : null,
    lang: r.lang === "es" ? "es" : "en",
    sms_marketing_consent: Number(r.sms_marketing_consent) === 1,
  }));
}

const CAMPAIGN_PREVIEW_SAMPLE_CAP = 1000;
const FONTANA_CAMPAIGN_EVENT_SLUG = "fontana-oct-6";

function campaignPathButton(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px;width:100%;">
  <tr><td align="center" style="border-radius:999px;background:${BRAND_GOLD};">
    <a href="${escapeHtml(url)}" style="display:block;padding:14px 22px;color:${BRAND_INK};text-decoration:none;font-weight:700;font-size:15px;border-radius:999px;text-align:center;">${escapeHtml(label)}</a>
  </td></tr></table>`;
}

function previewCampaignAudience(
  rows: CampaignRecipientRow[],
): CampaignAudiencePreview {
  const by_lang = { en: 0, es: 0 };
  let email_eligible = 0;
  let sms_eligible = 0;
  let sms_skipped_no_consent = 0;
  for (const r of rows) {
    by_lang[r.lang] += 1;
    if (r.email) email_eligible += 1;
    if (r.phone) {
      if (r.sms_marketing_consent) sms_eligible += 1;
      else sms_skipped_no_consent += 1;
    }
  }
  return {
    total: rows.length,
    email_eligible,
    sms_eligible,
    sms_skipped_no_consent,
    by_lang,
    sample: rows.slice(0, CAMPAIGN_PREVIEW_SAMPLE_CAP).map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      lang: r.lang,
      sms_marketing_consent: r.sms_marketing_consent,
    })),
    sample_truncated: rows.length > CAMPAIGN_PREVIEW_SAMPLE_CAP,
  };
}

function defaultFontanaLeadTemplates(): Omit<CampaignTemplate, "id">[] {
  const gcr = `${APP_URL}/get-credit-report`;
  const aff = `${APP_URL}/affiliate/signup`;
  const ctr = `${APP_URL}/contractor/signup`;
  const info = `${APP_URL}/`;
  const openerCtasEn = [
    campaignPathButton(gcr, "I'm a homeowner — free credit report"),
    campaignPathButton(info, "I want more ADU information first"),
    campaignPathButton(aff, "I'm a realtor or loan officer"),
    campaignPathButton(ctr, "I'm a contractor"),
  ].join("");
  const openerCtasEs = [
    campaignPathButton(gcr, "Soy propietario — reporte de crédito gratis"),
    campaignPathButton(info, "Primero quiero más información sobre ADU"),
    campaignPathButton(aff, "Soy realtor o loan officer"),
    campaignPathButton(ctr, "Soy contratista"),
  ].join("");
  return [
    {
      role: "opener",
      subject_en:
        "Thanks for joining ADU Discovery Night — pick your next step",
      subject_es:
        "Gracias por la Noche de ADU — elija su siguiente paso",
      email_html_en: `<p>Hi {{{FIRST_NAME|there}}},</p><p>This is Cesar with Groundwork Capital. Thank you for your interest in our ADU Discovery Night in Fontana! It was the first of many events.</p><p>Tap the path that fits you — we'll take you straight to the right next step:</p>${openerCtasEn}<p>Thank you!<br/>Cesar Gomez and Daniel Carrillo</p>`,
      email_html_es: `<p>Hola {{{FIRST_NAME|there}}},</p><p>Soy César de Groundwork Capital. ¡Gracias por su interés en nuestra Noche de ADU en Fontana! Fue el primero de muchos eventos.</p><p>Toque el camino que le corresponde — lo llevamos al siguiente paso:</p>${openerCtasEs}<p>¡Gracias!<br/>César Gomez y Daniel Carrillo</p>`,
      sms_body_en: `Hi {first_name}, Cesar with Groundwork Capital. Thanks for ADU Discovery Night in Fontana!\n\nPick your next step:\nHomeowner credit report: ${gcr}\nMore ADU info: ${info}\nRealtor/LO affiliate: ${aff}\nContractor: ${ctr}\n\nThank you!`,
      sms_body_es: `Hola {first_name}, soy César de Groundwork Capital. ¡Gracias por la Noche de ADU en Fontana!\n\nElija su siguiente paso:\nReporte de crédito (propietario): ${gcr}\nMás info de ADU: ${info}\nAfiliado (realtor/LO): ${aff}\nContratista: ${ctr}\n\n¡Gracias!`,
    },
    {
      role: "reply_1",
      subject_en: "Your next step — free credit report",
      subject_es: "Su siguiente paso — reporte de crédito gratis",
      email_html_en: `<p>Hi {{{FIRST_NAME|there}}},</p><p>Thanks — as a homeowner, your next step is our free credit report so Daniel can review financing options.</p><p><a href="${gcr}">Get your free credit report</a></p>`,
      email_html_es: `<p>Hola {{{FIRST_NAME|there}}},</p><p>Gracias — como propietario, su siguiente paso es el reporte de crédito gratis para que Daniel revise las opciones de financiamiento.</p><p><a href="${gcr}">Obtener reporte de crédito gratis</a></p>`,
      sms_body_en: `Thanks {first_name}! As a homeowner, next step is our free credit report so Daniel can review financing: ${gcr}`,
      sms_body_es: `¡Gracias {first_name}! Como propietario, el siguiente paso es el reporte de crédito gratis para que Daniel revise el financiamiento: ${gcr}`,
    },
    {
      role: "reply_2",
      subject_en: "ADU information — we'll invite you to the next homeowner event",
      subject_es: "Información de ADU — le invitaremos al próximo evento",
      email_html_en: `<p>Hi {{{FIRST_NAME|there}}},</p><p>We'll send ADU information and invite you to the next homeowner event (English or Spanish) as soon as dates are set.</p>`,
      email_html_es: `<p>Hola {{{FIRST_NAME|there}}},</p><p>Le enviaremos información sobre ADU y la invitación al próximo evento para propietarios (inglés o español) cuando tengamos fechas.</p>`,
      sms_body_en: `Thanks {first_name}! We'll send ADU info and invite you to the next homeowner event once dates are set.`,
      sms_body_es: `¡Gracias {first_name}! Le enviaremos información de ADU y la invitación al próximo evento para propietarios cuando haya fechas.`,
    },
    {
      role: "reply_3",
      subject_en: "Apply as a Groundwork affiliate",
      subject_es: "Aplique como afiliado de Groundwork",
      email_html_en: `<p>Hi {{{FIRST_NAME|there}}},</p><p>Great — apply as an affiliate here: <a href="${aff}">${aff}</a></p>`,
      email_html_es: `<p>Hola {{{FIRST_NAME|there}}},</p><p>Perfecto — aplique como afiliado aquí: <a href="${aff}">${aff}</a></p>`,
      sms_body_en: `Thanks {first_name}! Apply as a Groundwork affiliate: ${aff}`,
      sms_body_es: `¡Gracias {first_name}! Aplique como afiliado de Groundwork: ${aff}`,
    },
    {
      role: "reply_4",
      subject_en: "Contractor application",
      subject_es: "Solicitud de contratista",
      email_html_en: `<p>Hi {{{FIRST_NAME|there}}},</p><p>Apply as a contractor here: <a href="${ctr}">${ctr}</a></p>`,
      email_html_es: `<p>Hola {{{FIRST_NAME|there}}},</p><p>Aplique como contratista aquí: <a href="${ctr}">${ctr}</a></p>`,
      sms_body_en: `Thanks {first_name}! Apply as a Groundwork contractor: ${ctr}`,
      sms_body_es: `¡Gracias {first_name}! Aplique como contratista de Groundwork: ${ctr}`,
    },
  ];
}

async function upsertCampaignTemplates(
  campaignId: number,
  templates: Omit<CampaignTemplate, "id">[],
): Promise<void> {
  for (const t of templates) {
    await pool.query(
      `INSERT INTO campaign_templates
         (campaign_id, role, subject_en, subject_es, email_html_en, email_html_es,
          sms_body_en, sms_body_es)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         subject_en = VALUES(subject_en),
         subject_es = VALUES(subject_es),
         email_html_en = VALUES(email_html_en),
         email_html_es = VALUES(email_html_es),
         sms_body_en = VALUES(sms_body_en),
         sms_body_es = VALUES(sms_body_es)`,
      [
        campaignId,
        t.role,
        t.subject_en,
        t.subject_es,
        t.email_html_en,
        t.email_html_es,
        t.sms_body_en,
        t.sms_body_es,
      ],
    );
  }
}

async function resolveCampaignSmsFrom(): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT e164 FROM admin_phone_numbers
     WHERE is_active = 1
     ORDER BY id ASC LIMIT 1`,
  );
  return rows[0]?.e164 ? String(rows[0].e164) : null;
}

async function logCampaignSend(opts: {
  campaignId: number;
  kind: CampaignAudienceKind;
  recipientId: number;
  email?: string | null;
  phone?: string | null;
  channel: "email" | "sms";
  lang: "en" | "es";
  status:
    | "queued"
    | "sent"
    | "skipped_no_consent"
    | "skipped_no_contact"
    | "failed"
    | "dry_run";
  providerId?: string | null;
  error?: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO campaign_send_logs
       (campaign_id, recipient_kind, recipient_id, email, phone, channel, lang,
        status, provider_id, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.campaignId,
      opts.kind,
      opts.recipientId,
      opts.email || null,
      opts.phone || null,
      opts.channel,
      opts.lang,
      opts.status,
      opts.providerId || null,
      opts.error ? String(opts.error).slice(0, 500) : null,
    ],
  );
}

async function executeCampaignSend(opts: {
  campaign: Campaign;
  dryRun: boolean;
}): Promise<Record<string, number>> {
  const { campaign, dryRun } = opts;
  const opener = campaign.templates.find((t) => t.role === "opener");
  if (!opener) throw new HttpError(400, "validation.invalidField");

  const audience = await listCampaignAudience(
    campaign.audience_kind,
    campaign.audience_filter,
  );
  const stats = {
    total: audience.length,
    email_sent: 0,
    email_dry_run: 0,
    email_failed: 0,
    sms_sent: 0,
    sms_dry_run: 0,
    sms_skipped_no_consent: 0,
    sms_skipped_no_contact: 0,
    sms_failed: 0,
  };

  const smsFrom =
    campaign.channels.sms && !dryRun ? await resolveCampaignSmsFrom() : null;

  // Email via Resend transactional sends (works with send-only API keys).
  // Broadcasts/Segments require a full Resend key; we personalize per recipient instead.
  if (campaign.channels.email && resend && !dryRun && shouldDeliverEmail()) {
    for (const r of audience.filter((x) => x.email)) {
      const lang = r.lang;
      const subject =
        (lang === "es" ? opener.subject_es : opener.subject_en) ||
        opener.subject_en ||
        campaign.name;
      const bodyHtml =
        lang === "es"
          ? opener.email_html_es || opener.email_html_en || ""
          : opener.email_html_en || "";
      if (!bodyHtml) continue;
      const first = escapeHtml(firstNameFromFull(r.name));
      const personalized = bodyHtml
        .replace(/\{\{\{FIRST_NAME\|there\}\}\}/g, first)
        .replace(/\{first_name\}/gi, first);
      const html = wrapCampaignEmailHtml({
        lang,
        bodyHtml: personalized,
        unsubscribeUrl: `${APP_URL}/contact`,
      });
      const sent = await sendEmail({
        to: r.email!,
        subject: String(subject),
        html,
      });
      if (!sent.ok || sent.dryRun) {
        stats.email_failed += 1;
        await logCampaignSend({
          campaignId: campaign.id,
          kind: campaign.audience_kind,
          recipientId: r.id,
          email: r.email,
          channel: "email",
          lang,
          status: "failed",
          error: sent.dryRun ? "email_dry_run_blocked" : "resend_send_failed",
        });
        continue;
      }
      stats.email_sent += 1;
      await logCampaignSend({
        campaignId: campaign.id,
        kind: campaign.audience_kind,
        recipientId: r.id,
        email: r.email,
        channel: "email",
        lang,
        status: "sent",
        providerId: sent.id || null,
      });
      await pool.query(
        `INSERT INTO campaign_recipient_state
           (campaign_id, recipient_kind, recipient_id, last_role)
         VALUES (?, ?, ?, 'opener')
         ON DUPLICATE KEY UPDATE last_role = 'opener', updated_at = NOW()`,
        [campaign.id, campaign.audience_kind, r.id],
      );
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  } else if (campaign.channels.email) {
    for (const r of audience.filter((x) => x.email)) {
      stats.email_dry_run += 1;
      await logCampaignSend({
        campaignId: campaign.id,
        kind: campaign.audience_kind,
        recipientId: r.id,
        email: r.email,
        channel: "email",
        lang: r.lang,
        status: "dry_run",
      });
    }
  }

  // SMS one-by-one (consent required)
  if (campaign.channels.sms) {
    for (const r of audience) {
      if (!r.phone) {
        stats.sms_skipped_no_contact += 1;
        await logCampaignSend({
          campaignId: campaign.id,
          kind: campaign.audience_kind,
          recipientId: r.id,
          phone: r.phone,
          channel: "sms",
          lang: r.lang,
          status: "skipped_no_contact",
        });
        continue;
      }
      if (!r.sms_marketing_consent) {
        stats.sms_skipped_no_consent += 1;
        await logCampaignSend({
          campaignId: campaign.id,
          kind: campaign.audience_kind,
          recipientId: r.id,
          phone: r.phone,
          channel: "sms",
          lang: r.lang,
          status: "skipped_no_consent",
        });
        continue;
      }
      const smsTpl =
        (r.lang === "es" ? opener.sms_body_es : opener.sms_body_en) ||
        opener.sms_body_en ||
        "";
      const body = renderCampaignPlaceholders(smsTpl, {
        first_name: firstNameFromFull(r.name),
      }).slice(0, 1600);
      if (!body) continue;
      if (dryRun) {
        stats.sms_dry_run += 1;
        await logCampaignSend({
          campaignId: campaign.id,
          kind: campaign.audience_kind,
          recipientId: r.id,
          phone: r.phone,
          channel: "sms",
          lang: r.lang,
          status: "dry_run",
        });
        continue;
      }
      try {
        if (!smsFrom) throw new Error("No brand SMS From number");
        const sent = await sendSms({ to: r.phone, body, from: smsFrom });
        stats.sms_sent += 1;
        await logCampaignSend({
          campaignId: campaign.id,
          kind: campaign.audience_kind,
          recipientId: r.id,
          phone: r.phone,
          channel: "sms",
          lang: r.lang,
          status: "sent",
          providerId: sent.sid,
        });
        await pool.query(
          `INSERT INTO campaign_recipient_state
             (campaign_id, recipient_kind, recipient_id, last_role)
           VALUES (?, ?, ?, 'opener')
           ON DUPLICATE KEY UPDATE last_role = 'opener', updated_at = NOW()`,
          [campaign.id, campaign.audience_kind, r.id],
        );
      } catch (e: any) {
        stats.sms_failed += 1;
        await logCampaignSend({
          campaignId: campaign.id,
          kind: campaign.audience_kind,
          recipientId: r.id,
          phone: r.phone,
          channel: "sms",
          lang: r.lang,
          status: "failed",
          error: e?.message || String(e),
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return stats;
}

/**
 * Inbound SMS "1"–"4" → tag lead + send campaign reply template (homeowner → GCR).
 * Returns true when handled.
 */
async function tryHandleCampaignKeywordReply(opts: {
  fromPhone: string;
  body: string;
}): Promise<boolean> {
  const m = String(opts.body || "")
    .trim()
    .match(/^([1-4])$/);
  if (!m) return false;
  const digit = m[1];
  const tag = REPLY_DIGIT_TO_TAG[digit];
  if (!tag) return false;

  const variants = phoneMatchVariants(opts.fromPhone);
  if (!variants.length) return false;
  const [leads] = await pool.query<RowDataPacket[]>(
    `SELECT id, full_name, email, phone, preferred_language, sms_marketing_consent
     FROM leads
     WHERE phone IN (${variants.map(() => "?").join(",")})
        OR REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone,''),'+',''),'-',''),'(',''),')','')
           IN (${variants.map(() => "?").join(",")})
     ORDER BY id DESC LIMIT 1`,
    [...variants, ...variants.map((v) => normalizePhoneDigits(v))],
  );
  if (!leads[0]) return false;
  const leadId = Number(leads[0].id);
  const lang = leads[0].preferred_language === "es" ? "es" : "en";
  const name = String(leads[0].full_name || "");
  await pool.query(`UPDATE leads SET audience_tag = ?, status = 'contacted' WHERE id = ?`, [
    tag,
    leadId,
  ]);

  const [stateRows] = await pool.query<RowDataPacket[]>(
    `SELECT campaign_id FROM campaign_recipient_state
     WHERE recipient_kind = 'leads' AND recipient_id = ?
     ORDER BY updated_at DESC LIMIT 1`,
    [leadId],
  );
  let campaignId = stateRows[0] ? Number(stateRows[0].campaign_id) : 0;
  if (!campaignId) {
    const [latest] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM campaigns
       WHERE audience_kind = 'leads' AND status = 'sent'
       ORDER BY sent_at DESC LIMIT 1`,
    );
    campaignId = latest[0] ? Number(latest[0].id) : 0;
  }
  if (!campaignId) return true; // tagged even without follow-up template

  const role = `reply_${digit}` as CampaignTemplateRole;
  const [tplRows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM campaign_templates WHERE campaign_id = ? AND role = ? LIMIT 1`,
    [campaignId, role],
  );
  if (!tplRows[0]) return true;

  const smsBodyRaw =
    (lang === "es" ? tplRows[0].sms_body_es : tplRows[0].sms_body_en) ||
    tplRows[0].sms_body_en ||
    "";
  const smsBody = renderCampaignPlaceholders(String(smsBodyRaw), {
    first_name: firstNameFromFull(name),
  }).slice(0, 1600);

  // Replies: send SMS if they texted us (engaged); still require stored consent for marketing.
  const consent = Number(leads[0].sms_marketing_consent) === 1;
  if (smsBody && consent) {
    const from = await resolveCampaignSmsFrom();
    if (from && leads[0].phone) {
      try {
        await sendSms({ to: String(leads[0].phone), body: smsBody, from });
      } catch (e: any) {
        console.error("[campaign:reply-sms]", e?.message ?? e);
      }
    }
  }

  const emailHtmlRaw =
    (lang === "es" ? tplRows[0].email_html_es : tplRows[0].email_html_en) ||
    tplRows[0].email_html_en ||
    "";
  const subject =
    (lang === "es" ? tplRows[0].subject_es : tplRows[0].subject_en) ||
    tplRows[0].subject_en ||
    "Groundwork Capital";
  if (emailHtmlRaw && leads[0].email) {
    const html = wrapCampaignEmailHtml({
      lang,
      bodyHtml: renderCampaignPlaceholders(String(emailHtmlRaw), {
        first_name: firstNameFromFull(name),
      })
        .replace(/\{\{\{FIRST_NAME\|there\}\}\}/g, firstNameFromFull(name))
        .replace(/\{first_name\}/gi, firstNameFromFull(name)),
    }).replace(/\{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}/g, `${APP_URL}/contact`);
    try {
      await sendEmail({
        to: String(leads[0].email),
        subject: String(subject),
        html,
      });
    } catch (e: any) {
      console.error("[campaign:reply-email]", e?.message ?? e);
    }
  }

  await pool.query(
    `INSERT INTO campaign_recipient_state
       (campaign_id, recipient_kind, recipient_id, last_role, audience_tag)
     VALUES (?, 'leads', ?, ?, ?)
     ON DUPLICATE KEY UPDATE last_role = VALUES(last_role),
       audience_tag = VALUES(audience_tag), updated_at = NOW()`,
    [campaignId, leadId, role, tag],
  );
  return true;
}

function registerCampaignRoutes(app: Express) {
  app.get(
    "/api/admin/campaigns",
    requireAdmin("campaigns"),
    route(async (_req, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM campaigns ORDER BY id DESC LIMIT 100`,
      );
      const items: Campaign[] = [];
      for (const r of rows) {
        items.push(mapCampaignRow(r, await loadCampaignTemplates(Number(r.id))));
      }
      res.json({ ok: true, campaigns: items });
    }),
  );

  app.post(
    "/api/admin/campaigns",
    requireAdmin("campaigns"),
    route(async (req, res) => {
      const me = portalUser(res);
      const name = String(req.body?.name || "").trim().slice(0, 200);
      if (!name) throw new HttpError(400, "validation.invalidField");
      const kind = String(req.body?.audience_kind || "leads") as CampaignAudienceKind;
      if (!["leads", "affiliates", "contractors"].includes(kind)) {
        throw new HttpError(400, "validation.invalidField");
      }
      let filter = parseCampaignAudienceFilter(req.body?.audience_filter);
      const channels = parseCampaignChannels(req.body?.channels);
      const preset = String(req.body?.preset || "");

      if (preset === "fontana_followup" && kind === "leads") {
        if (filter.event_id == null) {
          const ev = await loadMarketingEventBySlug(FONTANA_CAMPAIGN_EVENT_SLUG);
          if (!ev) throw new HttpError(400, "validation.invalidField");
          filter = { ...filter, event_id: Number(ev.id) };
        }
      }

      const [ins] = await pool.query<ResultSetHeader>(
        `INSERT INTO campaigns
           (name, audience_kind, audience_filter_json, channels_json, status, created_by_admin_id)
         VALUES (?, ?, ?, ?, 'draft', ?)`,
        [
          name,
          kind,
          JSON.stringify(filter),
          JSON.stringify(channels),
          me.id,
        ],
      );
      const id = Number(ins.insertId);
      if (preset === "fontana_followup" && kind === "leads") {
        await upsertCampaignTemplates(id, defaultFontanaLeadTemplates());
      } else if (Array.isArray(req.body?.templates)) {
        const templates = (req.body.templates as unknown[])
          .map((t) => t as CampaignTemplate)
          .filter((t) => CAMPAIGN_TEMPLATE_ROLES.includes(t.role));
        if (templates.length) await upsertCampaignTemplates(id, templates);
      } else if (kind === "leads") {
        await upsertCampaignTemplates(id, defaultFontanaLeadTemplates());
      }
      const campaign = await loadCampaign(id);
      res.status(201).json({ ok: true, campaign });
    }),
  );

  app.get(
    "/api/admin/campaigns/:id",
    requireAdmin("campaigns"),
    route(async (req, res) => {
      const campaign = await loadCampaign(parseId(req.params.id));
      if (!campaign) throw new HttpError(404, "errors.notFound");
      res.json({ ok: true, campaign });
    }),
  );

  app.patch(
    "/api/admin/campaigns/:id",
    requireAdmin("campaigns"),
    route(async (req, res) => {
      const id = parseId(req.params.id);
      const existing = await loadCampaign(id);
      if (!existing) throw new HttpError(404, "errors.notFound");
      if (existing.status !== "draft" && existing.status !== "failed") {
        throw new HttpError(409, "errors.conflict");
      }
      const updates: string[] = [];
      const params: unknown[] = [];
      if (typeof req.body?.name === "string" && req.body.name.trim()) {
        updates.push(`name = ?`);
        params.push(String(req.body.name).trim().slice(0, 200));
      }
      if (req.body?.audience_filter !== undefined) {
        updates.push(`audience_filter_json = ?`);
        params.push(
          JSON.stringify(parseCampaignAudienceFilter(req.body.audience_filter)),
        );
      }
      if (req.body?.channels !== undefined) {
        updates.push(`channels_json = ?`);
        params.push(JSON.stringify(parseCampaignChannels(req.body.channels)));
      }
      if (updates.length) {
        params.push(id);
        await pool.query(
          `UPDATE campaigns SET ${updates.join(", ")} WHERE id = ?`,
          params,
        );
      }
      if (Array.isArray(req.body?.templates)) {
        const templates = (req.body.templates as unknown[])
          .map((t) => t as CampaignTemplate)
          .filter((t) => CAMPAIGN_TEMPLATE_ROLES.includes(t.role));
        if (templates.length) await upsertCampaignTemplates(id, templates);
      }
      res.json({ ok: true, campaign: await loadCampaign(id) });
    }),
  );

  app.delete(
    "/api/admin/campaigns/:id",
    requireAdmin("campaigns"),
    route(async (req, res) => {
      const id = parseId(req.params.id);
      const existing = await loadCampaign(id);
      if (!existing) throw new HttpError(404, "errors.notFound");
      if (existing.status === "sending") throw new HttpError(409, "errors.conflict");
      await pool.query(`DELETE FROM campaigns WHERE id = ?`, [id]);
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/admin/campaigns/:id/preview",
    requireAdmin("campaigns"),
    route(async (req, res) => {
      const campaign = await loadCampaign(parseId(req.params.id));
      if (!campaign) throw new HttpError(404, "errors.notFound");
      const filter =
        req.body?.audience_filter !== undefined
          ? parseCampaignAudienceFilter(req.body.audience_filter)
          : campaign.audience_filter;
      const rows = await listCampaignAudience(campaign.audience_kind, filter);
      res.json({ ok: true, preview: previewCampaignAudience(rows) });
    }),
  );

  app.post(
    "/api/admin/campaigns/:id/send",
    requireAdmin("campaigns"),
    route(async (req, res) => {
      const id = parseId(req.params.id);
      const campaign = await loadCampaign(id);
      if (!campaign) throw new HttpError(404, "errors.notFound");
      if (campaign.status !== "draft" && campaign.status !== "failed") {
        throw new HttpError(409, "errors.conflict");
      }
      const dryRun = !!req.body?.dry_run;
      const confirm = !!req.body?.confirm;
      if (!dryRun && !confirm) {
        throw new HttpError(400, "validation.invalidField");
      }
      if (!campaign.templates.some((t) => t.role === "opener")) {
        throw new HttpError(400, "validation.invalidField");
      }

      await pool.query(
        `UPDATE campaigns SET status = ? WHERE id = ?`,
        [dryRun ? "draft" : "sending", id],
      );
      try {
        const stats = await executeCampaignSend({ campaign, dryRun });
        if (!dryRun) {
          await pool.query(
            `UPDATE campaigns SET status = 'sent', sent_at = NOW(), stats_json = ? WHERE id = ?`,
            [JSON.stringify(stats), id],
          );
        } else {
          await pool.query(
            `UPDATE campaigns SET stats_json = ? WHERE id = ?`,
            [JSON.stringify({ ...stats, dry_run: true }), id],
          );
        }
        res.json({
          ok: true,
          dry_run: dryRun,
          stats,
          campaign: await loadCampaign(id),
        });
      } catch (e: any) {
        if (!dryRun) {
          await pool.query(`UPDATE campaigns SET status = 'failed' WHERE id = ?`, [
            id,
          ]);
        }
        throw e;
      }
    }),
  );
}


// ─── Conversations Contact Hub (Twilio SMS + CRM contacts + Ably) ─────────────
// Ported from Optimum (Groundwork brand strings). Runtime stays inline in index.ts.

const IS_PROD =
  process.env.NODE_ENV === "production" ||
  process.env.VERCEL_ENV === "production";

let twilioClient: ReturnType<typeof twilio> | null = null;
function getTwilioClient(): ReturnType<typeof twilio> | null {
  if (twilioClient) return twilioClient;
  const sid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const token = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  if (!sid || !token) return null;
  try {
    twilioClient = twilio(sid, token);
    return twilioClient;
  } catch (err) {
    console.warn("[twilio] init failed:", err);
    return null;
  }
}

function isTwilioConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    getTwilioClient()
  );
}

/**
 * Public API origin for Twilio webhooks (must be Twilio-fetchable).
 * Always prefer www — apex `groundworkcapitalgroup.com` 308-redirects and
 * Twilio Voice (error 11200) does not reliably follow that for TwiML.
 */
function groundworkApiBaseUrl(): string {
  const candidates = [
    process.env.PUBLIC_APP_URL,
    APP_URL,
    "https://www.groundworkcapitalgroup.com",
  ];
  for (const raw of candidates) {
    const base = String(raw || "")
      .trim()
      .replace(/\/+$/, "");
    if (!base) continue;
    try {
      const u = new URL(base);
      const host = u.hostname;
      if (
        !host ||
        host === "localhost" ||
        host === "127.0.0.1" ||
        host.endsWith(".local")
      ) {
        continue;
      }
      if (
        host === "groundworkcapitalgroup.com" ||
        host === "www.groundworkcapitalgroup.com"
      ) {
        return "https://www.groundworkcapitalgroup.com";
      }
      return `${u.protocol}//${host}${u.port ? `:${u.port}` : ""}`;
    } catch {
      /* try next */
    }
  }
  return "https://www.groundworkcapitalgroup.com";
}

function normalizePhoneDigits(raw: string): string {
  return String(raw || "").replace(/\D/g, "");
}

/** US-centric E.164 for Twilio outbound (10-digit → +1…). Alias: normalizeE164. */
function toSmsE164(raw: string): string {
  const trimmed = String(raw || "").trim();
  const d = normalizePhoneDigits(trimmed);
  if (!d) return trimmed;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (trimmed.startsWith("+")) return `+${d}`;
  return `+${d}`;
}

const normalizeE164 = toSmsE164;

function normalizePhoneLast10(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

function phoneMatchVariants(raw: string): string[] {
  const d = normalizePhoneDigits(raw);
  const out = new Set<string>();
  if (!d) return [];
  out.add(d);
  out.add(`+${d}`);
  if (d.length === 11 && d.startsWith("1")) {
    out.add(d.slice(1));
    out.add(`+${d}`);
    out.add(`+1${d.slice(1)}`);
  } else if (d.length === 10) {
    out.add(`1${d}`);
    out.add(`+1${d}`);
  }
  return [...out];
}

const SMS_MAX_BODY_CHARS = 1600;

async function sendSms(opts: {
  to: string;
  body: string;
  from: string;
  mediaUrls?: string[];
}): Promise<{ sid: string; status: string }> {
  const fromNumber = String(opts.from || "").trim();
  if (!fromNumber) throw new Error("SMS From (Groundwork number) is required");
  const mediaUrls = (opts.mediaUrls || [])
    .map((u) => String(u || "").trim())
    .filter(Boolean);
  const body = String(opts.body || "");
  if (!body && mediaUrls.length === 0) {
    throw new Error("SMS body or media is required");
  }
  const client = getTwilioClient();
  if (!client || notifySandbox()) {
    const drySid = `dry-run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const to = toSmsE164(opts.to);
    smsDryRuns.push({
      to,
      from: fromNumber,
      body,
      sid: drySid,
      at: new Date().toISOString(),
    });
    console.log(
      "[sms:dry-run]",
      fromNumber,
      to,
      body.slice(0, 80),
      mediaUrls.length ? `media=${mediaUrls.length}` : "",
      drySid,
    );
    return { sid: drySid, status: "queued" };
  }
  const to = toSmsE164(opts.to);
  const statusCallbackBase = groundworkApiBaseUrl();
  const createOpts: {
    from: string;
    to: string;
    body?: string;
    mediaUrl?: string[];
    statusCallback?: string;
  } = { from: fromNumber, to };
  if (body) createOpts.body = body;
  if (mediaUrls.length) createOpts.mediaUrl = mediaUrls;
  if (statusCallbackBase) {
    createOpts.statusCallback = `${statusCallbackBase}/api/webhooks/twilio/sms-status`;
  }
  const msg = await client.messages.create(createOpts);
  return { sid: msg.sid, status: msg.status };
}

function mapPhoneNumberRow(r: RowDataPacket) {
  let capabilities: { sms?: boolean; mms?: boolean; voice?: boolean } | null =
    null;
  try {
    capabilities =
      typeof r.capabilities_json === "string"
        ? JSON.parse(r.capabilities_json)
        : (r.capabilities_json as any) || null;
  } catch {
    capabilities = null;
  }
  return {
    id: Number(r.id),
    e164: String(r.e164),
    friendly_name: (r.friendly_name as string) || null,
    twilio_sid: (r.twilio_sid as string) || null,
    assigned_admin_id:
      r.assigned_admin_id != null ? Number(r.assigned_admin_id) : null,
    assigned_admin_name: r.assigned_admin_name
      ? String(r.assigned_admin_name)
      : null,
    is_active: Number(r.is_active) === 1,
    capabilities,
  };
}

async function listAssignedPhoneNumbers(
  adminId: number,
): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, e164, friendly_name, twilio_sid, assigned_admin_id, is_active, capabilities_json
     FROM admin_phone_numbers
     WHERE assigned_admin_id = ? AND is_active = 1
     ORDER BY id ASC`,
    [adminId],
  );
  return rows;
}

async function adminHasConversationsAccess(adminId: number): Promise<boolean> {
  return (await listAssignedPhoneNumbers(adminId)).length > 0;
}

async function adminAssignedPhoneNumberIds(adminId: number): Promise<number[]> {
  return (await listAssignedPhoneNumbers(adminId))
    .map((r) => Number(r.id))
    .filter(Boolean);
}

async function resolveAssignedSmsFrom(adminId: number): Promise<string | null> {
  const phones = await listAssignedPhoneNumbers(adminId);
  return phones[0] ? String(phones[0].e164) : null;
}

/** Middleware-style gate: 403 conversations_number_required when no brand line. */
async function requireConversationsAccess(
  res: Response,
  adminId: number,
): Promise<boolean> {
  const ok = await adminHasConversationsAccess(adminId);
  if (!ok) {
    res.status(403).json({
      error: "conversations_number_required",
      message:
        "Conversations is available only to staff with an assigned Groundwork phone number.",
    });
    return false;
  }
  return true;
}

function adminClientConversationScopeSql(
  alias: string,
  adminId: number,
  ofgIds: number[],
): { sql: string; params: any[] } {
  if (ofgIds.length > 0) {
    return {
      sql: `(${alias}.assigned_admin_id = ? OR ${alias}.ofg_number_id IN (${ofgIds.map(() => "?").join(",")}))`,
      params: [adminId, ...ofgIds],
    };
  }
  return { sql: `${alias}.assigned_admin_id = ?`, params: [adminId] };
}

async function adminCanAccessUnknownContact(
  adminId: number,
  unknownContactId: number,
): Promise<boolean> {
  const ids = await adminAssignedPhoneNumberIds(adminId);
  if (ids.length) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM conversation_unknown_contacts
       WHERE id = ? AND ofg_number_id IN (${ids.map(() => "?").join(",")})
       LIMIT 1`,
      [unknownContactId, ...ids],
    );
    if (rows.length > 0) return true;
  }
  const [assigned] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM conversations
     WHERE unknown_contact_id = ? AND assigned_admin_id = ?
     LIMIT 1`,
    [unknownContactId, adminId],
  );
  return assigned.length > 0;
}

async function adminCanAccessClientConversations(
  adminId: number,
  clientId: number,
): Promise<boolean> {
  const ofgIds = await adminAssignedPhoneNumberIds(adminId);
  const scope = adminClientConversationScopeSql("cv", adminId, ofgIds);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT cv.id FROM conversations cv
     WHERE cv.client_id = ? AND ${scope.sql}
     LIMIT 1`,
    [clientId, ...scope.params],
  );
  return rows.length > 0;
}

async function adminCanMutateClientConversations(
  adminId: number,
  clientId: number,
): Promise<boolean> {
  if (await adminCanAccessClientConversations(adminId, clientId)) return true;
  if (!(await adminHasConversationsAccess(adminId))) return false;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM conversations WHERE client_id = ? LIMIT 1`,
    [clientId],
  );
  return rows.length === 0;
}

function twilioWebhookCandidateUrls(req: Request): string[] {
  const pathAndQuery = String(req.originalUrl || req.url || "/");
  const path = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
  const urls = new Set<string>();
  const add = (base: string) => {
    const b = String(base || "")
      .trim()
      .replace(/\/+$/, "");
    if (b) urls.add(`${b}${path}`);
  };
  add(APP_URL);
  add(groundworkApiBaseUrl());
  const xfProto = String(req.headers["x-forwarded-proto"] || "https")
    .split(",")[0]
    .trim();
  const xfHost = String(
    req.headers["x-forwarded-host"] || req.headers.host || "",
  )
    .split(",")[0]
    .trim();
  if (xfHost) add(`${xfProto}://${xfHost}`);
  add("https://www.groundworkcapitalgroup.com");
  add("https://groundworkcapitalgroup.com");
  return [...urls];
}

function isValidTwilioWebhookRequest(req: Request): boolean {
  if (process.env.VITEST === "true") return true;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return !IS_PROD;
  const signature = req.headers["x-twilio-signature"] as string | undefined;
  if (!signature) return false;
  const params = (req.body as Record<string, string>) || {};
  for (const url of twilioWebhookCandidateUrls(req)) {
    try {
      if (twilio.validateRequest(authToken, signature, url, params)) return true;
    } catch {
      /* try next */
    }
  }
  console.warn(
    "[twilio] Invalid signature — tried URLs:",
    twilioWebhookCandidateUrls(req).join(" | "),
  );
  return false;
}

const TWILIO_SMS_STATUS_RANK: Record<string, number> = {
  accepted: 1,
  queued: 1,
  sending: 2,
  sent: 3,
  delivered: 4,
  undelivered: 5,
  failed: 5,
};

function twilioSmsStatusRank(status: string): number {
  return TWILIO_SMS_STATUS_RANK[String(status || "").toLowerCase()] || 0;
}

let ablyKeyRejected = false;

async function mintAdminAblyTokenRequest(adminId: number) {
  if (ablyKeyRejected) return null;
  const key = String(process.env.ABLY_API_KEY || "")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!key || !/^[-\w]+\.[-\w]+:.+$/.test(key)) return null;
  const capability: Record<string, string[]> = {
    [`admin:${adminId}:notifications`]: ["subscribe"],
  };
  if (await adminHasConversationsAccess(adminId)) {
    // Softphone ringing uses Twilio Device SDK; inbox/call rows fan out here.
    capability[`admin:${adminId}:conversations`] = ["subscribe", "presence"];
  }
  const Ably = (await import("ably")).default;
  const rest = new Ably.Rest({ key });
  return rest.auth.createTokenRequest({
    clientId: `admin-${adminId}`,
    capability: capability as any,
  });
}

async function publishConversationRealtime(event: {
  type: string;
  adminIds?: number[];
  payload: Record<string, unknown>;
}): Promise<void> {
  if (ablyKeyRejected) return;
  const key = String(process.env.ABLY_API_KEY || "")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!key || !/^[-\w]+\.[-\w]+:.+$/.test(key) || notifySandbox())
    return;
  try {
    const Ably = (await import("ably")).default;
    const rest = new Ably.Rest({ key });
    let targets = event.adminIds && event.adminIds.length > 0 ? event.adminIds : [];
    if (!targets.length) {
      const assigned = Number(event.payload.assigned_admin_id || 0);
      if (assigned > 0) targets = [assigned];
    }
    if (!targets.length) return;
    await Promise.all(
      targets.filter(Boolean).map(async (adminId) => {
        const channel = rest.channels.get(`admin:${adminId}:conversations`);
        await channel.publish(event.type, event.payload);
      }),
    );
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (/invalid key/i.test(msg)) ablyKeyRejected = true;
    console.warn("[ably] publish failed", msg);
  }
}

async function publishAdminBellRealtime(
  adminId: number,
  payload: Record<string, unknown> = {},
): Promise<void> {
  if (ablyKeyRejected || !adminId) return;
  const key = String(process.env.ABLY_API_KEY || "")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!key || !/^[-\w]+\.[-\w]+:.+$/.test(key) || notifySandbox())
    return;
  try {
    const Ably = (await import("ably")).default;
    const rest = new Ably.Rest({ key });
    const channel = rest.channels.get(`admin:${adminId}:notifications`);
    await channel.publish("new", payload);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (/invalid key/i.test(msg)) ablyKeyRejected = true;
    console.warn("[ably] bell publish failed", msg);
  }
}

function mergeAdminNotificationPrefsFromBody(
  existing: AdminNotificationPrefs,
  body: Record<string, unknown>,
): AdminNotificationPrefs {
  const next: AdminNotificationPrefs = {
    email: { ...existing.email },
    in_app: { ...existing.in_app },
    sms: { ...existing.sms },
  };
  const masters = body.channel_masters;
  if (masters && typeof masters === "object") {
    const m = masters as Record<string, unknown>;
    for (const channel of ["email", "in_app", "sms"] as AdminNotifyChannel[]) {
      if (typeof m[channel] !== "boolean") continue;
      const toggles = allAdminNotifyEventsOn();
      for (const key of ADMIN_NOTIFY_EVENT_KEYS) toggles[key] = m[channel] as boolean;
      next[channel] = toggles;
    }
  }
  return parseAdminNotificationPrefs({
    email: { ...next.email, ...((body.email as object) || {}) },
    in_app: { ...next.in_app, ...((body.in_app as object) || {}) },
    sms: { ...next.sms, ...((body.sms as object) || {}) },
  });
}

async function resolveOfgNumberByToAddress(
  toRaw: string,
): Promise<RowDataPacket | null> {
  const variants = phoneMatchVariants(toRaw);
  if (!variants.length) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, e164, assigned_admin_id, is_active FROM admin_phone_numbers
     WHERE is_active = 1 AND (
       e164 IN (${variants.map(() => "?").join(",")})
       OR REPLACE(REPLACE(REPLACE(REPLACE(e164,'+',''),'-',''),'(',''),')','') IN (${variants.map(() => "?").join(",")})
     )
     LIMIT 1`,
    [...variants, ...variants.map((v) => v.replace(/\D/g, ""))],
  );
  return rows[0] || null;
}

async function findClientIdByPhone(fromRaw: string): Promise<number | null> {
  const variants = phoneMatchVariants(fromRaw);
  if (!variants.length) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM clients
     WHERE phone IN (${variants.map(() => "?").join(",")})
        OR REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone,''),'+',''),'-',''),'(',''),')','') IN (${variants.map(() => "?").join(",")})
     ORDER BY id DESC LIMIT 1`,
    [...variants, ...variants.map((v) => normalizePhoneDigits(v))],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

async function findContactIdByPhone(fromRaw: string): Promise<number | null> {
  const variants = phoneMatchVariants(fromRaw);
  if (!variants.length) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM contacts
     WHERE deleted_at IS NULL
       AND converted_client_id IS NULL
       AND (
         phone IN (${variants.map(() => "?").join(",")})
         OR REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone,''),'+',''),'-',''),'(',''),')','') IN (${variants.map(() => "?").join(",")})
       )
     ORDER BY id DESC LIMIT 1`,
    [...variants, ...variants.map((v) => normalizePhoneDigits(v))],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

function mapCrmContactRow(r: RowDataPacket) {
  return {
    id: Number(r.id),
    first_name: String(r.first_name || ""),
    last_name: String(r.last_name || ""),
    email: r.email != null ? String(r.email) : null,
    phone: r.phone != null ? String(r.phone) : null,
    address_line1: r.address_line1 != null ? String(r.address_line1) : null,
    address_line2: r.address_line2 != null ? String(r.address_line2) : null,
    city: r.city != null ? String(r.city) : null,
    state: r.state != null ? String(r.state) : null,
    zip: r.zip != null ? String(r.zip) : null,
    preferred_language: r.preferred_language === "es" ? "es" : "en",
    admin_notes: r.admin_notes != null ? String(r.admin_notes) : null,
    assigned_admin_id:
      r.assigned_admin_id != null ? Number(r.assigned_admin_id) : null,
    created_by_admin_id:
      r.created_by_admin_id != null ? Number(r.created_by_admin_id) : null,
    converted_client_id:
      r.converted_client_id != null ? Number(r.converted_client_id) : null,
    converted_at: r.converted_at ? isoDate(r.converted_at) : null,
    deleted_at: r.deleted_at ? isoDate(r.deleted_at) : null,
    created_at: isoDate(r.created_at),
    updated_at: isoDate(r.updated_at),
  };
}

type ConvertCrmContactResult =
  | {
      ok: true;
      existing: boolean;
      linked_existing: boolean;
      contact_id: number;
      client_id: number;
      preferred_language: "en" | "es";
      phone: string | null;
      email: string | null;
    }
  | { ok: false; error: string; match?: PersonMatch; can_override?: boolean };

/**
 * Convert CRM contact → client prospect (or link existing by phone/email).
 * Phone and/or email required (Optimum parity). clients.email may be NULL.
 */
async function convertCrmContactToClient(opts: {
  contactId: number;
  /** Acting admin fallback when contact has no assignee. */
  ownerAdminId: number;
  /** Explicit staff owner (MCP assigned_admin_*) — wins over contact assignee. */
  overrideOwnerAdminId?: number | null;
  /** Staff confirmed a phone-only match with an affiliate/contractor is a different person. */
  sharedPhoneReason?: unknown;
}): Promise<ConvertCrmContactResult> {
  const contactId = opts.contactId;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM contacts
     WHERE id = ? AND deleted_at IS NULL AND converted_client_id IS NULL
     LIMIT 1`,
    [contactId],
  );
  if (!rows[0]) {
    return {
      ok: false,
      error: "Contact not found (or already converted/deleted)",
    };
  }
  const c = rows[0];
  const phone = c.phone ? String(c.phone) : null;
  const email = c.email ? normalizeEmail(c.email) : null;
  if (!phone && !email) {
    return {
      ok: false,
      error: "Contact needs phone or email before convert. Use update_contact first.",
    };
  }
  if (email && !isValidEmail(email)) {
    return { ok: false, error: "Contact email is invalid. Fix with update_contact." };
  }

  let existingClientId: number | null = null;
  if (phone) existingClientId = await findClientIdByPhone(phone);
  if (existingClientId == null && email) {
    const [emailDup] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM clients WHERE LOWER(email) = ? LIMIT 1`,
      [email],
    );
    if (emailDup[0]) existingClientId = Number(emailDup[0].id);
  }
  const lang: "en" | "es" = c.preferred_language === "es" ? "es" : "en";
  const ownerId =
    opts.overrideOwnerAdminId != null
      ? Number(opts.overrideOwnerAdminId)
      : c.assigned_admin_id != null
        ? Number(c.assigned_admin_id)
        : opts.ownerAdminId;

  if (existingClientId != null) {
    await pool.query(
      `UPDATE conversations SET client_id = ?, contact_id = NULL WHERE contact_id = ?`,
      [existingClientId, contactId],
    );
    await pool.query(
      `UPDATE contacts SET converted_client_id = ?, converted_at = NOW() WHERE id = ?`,
      [existingClientId, contactId],
    );
    return {
      ok: true,
      existing: true,
      linked_existing: true,
      contact_id: contactId,
      client_id: existingClientId,
      preferred_language: lang,
      phone,
      email,
    };
  }

  // One role per person: no existing client matched, but an affiliate/contractor may.
  let phoneOverride: { reason: string; matches: PersonMatch[] } | null = null;
  try {
    ({ phoneOverride } = await assertPersonAvailable({
      email,
      phone,
      actor: "staff",
      sharedPhoneReason: opts.sharedPhoneReason,
    }));
  } catch (e) {
    if (e instanceof HttpError) {
      return {
        ok: false,
        error: e.key,
        match: e.data?.match as PersonMatch | undefined,
        can_override: e.data?.can_override === true || undefined,
      };
    }
    throw e;
  }

  try {
    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients
         (first_name, last_name, phone, email, status, preferred_language,
          assigned_admin_id, admin_notes, address_line1, address_line2,
          city, state, zip)
       VALUES (?, ?, ?, ?, 'prospect', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        c.first_name,
        c.last_name,
        phone,
        email,
        lang,
        ownerId,
        c.admin_notes,
        c.address_line1,
        c.address_line2,
        c.city,
        c.state,
        c.zip,
      ],
    );
    const clientId = Number(ins.insertId);
    if (phoneOverride) {
      await recordSharedPhoneOverride({
        entity: "client",
        id: clientId,
        override: phoneOverride,
        adminId: opts.ownerAdminId,
      });
    }
    await pool.query(
      `UPDATE conversations SET client_id = ?, contact_id = NULL WHERE contact_id = ?`,
      [clientId, contactId],
    );
    await pool.query(
      `UPDATE contacts SET converted_client_id = ?, converted_at = NOW() WHERE id = ?`,
      [clientId, contactId],
    );
    return {
      ok: true,
      existing: false,
      linked_existing: false,
      contact_id: contactId,
      client_id: clientId,
      preferred_language: lang,
      phone,
      email,
    };
  } catch (e: any) {
    if (e?.code === "ER_DUP_ENTRY" || /Duplicate/i.test(String(e?.message))) {
      if (email) {
        const [dup] = await pool.query<RowDataPacket[]>(
          `SELECT id FROM clients WHERE LOWER(email) = ? LIMIT 1`,
          [email],
        );
        if (dup[0]) {
          const dupId = Number(dup[0].id);
          await pool.query(
            `UPDATE conversations SET client_id = ?, contact_id = NULL WHERE contact_id = ?`,
            [dupId, contactId],
          );
          await pool.query(
            `UPDATE contacts SET converted_client_id = ?, converted_at = NOW() WHERE id = ?`,
            [dupId, contactId],
          );
          return {
            ok: true,
            existing: true,
            linked_existing: true,
            contact_id: contactId,
            client_id: dupId,
            preferred_language: lang,
            phone,
            email,
          };
        }
      }
      return { ok: false, error: "A client with this email already exists." };
    }
    throw e;
  }
}

function tplAdminInboundSmsAlert(opts: {
  adminFirstName: string;
  fromLabel: string;
  preview: string;
  linkUrl: string;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const headline = isEs ? "SMS entrante" : "Inbound SMS";
  const body = isEs
    ? `<h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:${BRAND_INK};">${escapeHtml(headline)}</h1>
       <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:${BRAND_CHARCOAL};">Hola ${escapeHtml(opts.adminFirstName)},</p>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${BRAND_CHARCOAL};">
         Mensaje de <strong>${escapeHtml(opts.fromLabel)}</strong>:
       </p>
       <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:${BRAND_CHARCOAL};padding:12px;background:${BRAND_PAPER};border-radius:8px;">
         ${escapeHtml(opts.preview)}
       </p>
       ${emailButton(opts.linkUrl, "Abrir conversaciones")}`
    : `<h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:${BRAND_INK};">${escapeHtml(headline)}</h1>
       <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:${BRAND_CHARCOAL};">Hi ${escapeHtml(opts.adminFirstName)},</p>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${BRAND_CHARCOAL};">
         Message from <strong>${escapeHtml(opts.fromLabel)}</strong>:
       </p>
       <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:${BRAND_CHARCOAL};padding:12px;background:${BRAND_PAPER};border-radius:8px;">
         ${escapeHtml(opts.preview)}
       </p>
       ${emailButton(opts.linkUrl, "Open conversations")}`;
  return {
    subject: isEs ? `SMS de ${opts.fromLabel}` : `SMS from ${opts.fromLabel}`,
    html: emailLayout({
      title: headline,
      preheader: opts.preview.slice(0, 80),
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

/** Alert SMS to personal cell + Resend email (not full relay). Badge = unread_count. */
async function notifyAdminInboundSms(opts: {
  adminId: number;
  fromLabel: string;
  preview: string;
  linkUrl: string;
  providerMessageId?: string | null;
}): Promise<void> {
  const adminId = opts.adminId;
  if (!adminId) return;
  const [aRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, email, first_name, phone, preferred_language, notification_prefs_json
     FROM admins WHERE id = ? AND status = 'active' LIMIT 1`,
    [adminId],
  );
  if (!aRows[0]) return;
  const prefs = parseAdminNotificationPrefs(aRows[0].notification_prefs_json);
  const body = String(opts.preview || "New message").slice(0, 500);
  const absoluteLink = opts.linkUrl.startsWith("http")
    ? opts.linkUrl
    : `${APP_URL}${opts.linkUrl.startsWith("/") ? "" : "/"}${opts.linkUrl}`;
  const adminEmail = String(aRows[0].email || "")
    .trim()
    .toLowerCase();
  const adminLang = aRows[0].preferred_language === "es" ? "es" : "en";
  const emailTpl = tplAdminInboundSmsAlert({
    adminFirstName: String(aRows[0].first_name || "Team"),
    fromLabel: opts.fromLabel,
    preview: body,
    linkUrl: absoluteLink,
    lang: adminLang,
  });
  if (
    adminEmail &&
    isValidEmail(adminEmail) &&
    adminNotifyPrefOn(prefs, "email", "inbound_sms")
  ) {
    try {
      await sendEmail({
        to: adminEmail,
        subject: emailTpl.subject,
        html: emailTpl.html,
      });
    } catch (e: any) {
      console.error(`[notify:inbound_sms:email] ${adminEmail}:`, e?.message ?? e);
    }
  }
  if (adminNotifyPrefOn(prefs, "in_app", "inbound_sms")) {
    const notifId = await insertAdminInAppNotification({
      adminId,
      eventKey: "inbound_sms",
      title: emailTpl.subject,
      body,
      linkUrl: absoluteLink,
      payload: opts.providerMessageId
        ? { provider_message_id: opts.providerMessageId }
        : undefined,
    });
    if (notifId) {
      await publishAdminBellRealtime(adminId, {
        notification_id: notifId,
        event_key: "inbound_sms",
      });
    }
  }
  // Extra notify inboxes that opted into inbound_sms (null events = all types).
  try {
    const extras = await listExtraNotifyEmails("inbound_sms");
    const skip = new Set(adminEmail ? [adminEmail] : []);
    await Promise.all(
      extras
        .filter((e) => e && !skip.has(e))
        .map(async (to) => {
          try {
            await sendEmail({
              to,
              subject: emailTpl.subject,
              html: emailTpl.html,
            });
          } catch (e: any) {
            console.error(`[notify:inbound_sms:extra] ${to}:`, e?.message ?? e);
          }
        }),
    );
  } catch (e: any) {
    console.error(`[notify:inbound_sms:extras]`, e?.message ?? e);
  }
  if (adminNotifyPrefOn(prefs, "sms", "inbound_sms")) {
    const adminPhone = String(aRows[0].phone || "").trim();
    if (adminPhone) {
      try {
        const from = await resolveAssignedSmsFrom(adminId);
        if (from) {
          const toDigits = normalizePhoneDigits(adminPhone);
          const fromDigits = normalizePhoneDigits(from);
          if (!(toDigits && fromDigits && toDigits === fromDigits)) {
            const prefix =
              adminLang === "es"
                ? `Groundwork SMS de ${opts.fromLabel}: ${body}`
                : `Groundwork SMS from ${opts.fromLabel}: ${body}`;
            const smsBody = `${prefix.slice(0, 260)}\n${absoluteLink}`.slice(
              0,
              320,
            );
            await sendSms({ to: adminPhone, body: smsBody, from });
          }
        }
      } catch (e: any) {
        console.error(
          `[notify:inbound_sms:sms] admin ${adminId}:`,
          e?.message ?? e,
        );
      }
    }
  }
}

async function getOrCreateClientChannelConversation(opts: {
  clientId: number;
  channel: string;
  ofgNumberId?: number | null;
  assignedAdminId?: number | null;
  reopenIfClosed?: boolean;
}): Promise<number> {
  const reopenIfClosed = opts.reopenIfClosed !== false;
  const ofgId = opts.ofgNumberId ?? null;
  const reopenIfNeeded = async (id: number, statusRaw: unknown) => {
    const st = String(statusRaw || "");
    const isTerminal = st === "closed" || st === "archived";
    if (st === "snoozed" || (isTerminal && reopenIfClosed)) {
      await pool.query(
        `UPDATE conversations SET status = 'open', updated_at = NOW() WHERE id = ?`,
        [id],
      );
    }
  };
  if (ofgId != null) {
    const [exact] = await pool.query<RowDataPacket[]>(
      `SELECT id, status FROM conversations
       WHERE client_id = ? AND channel = ? AND ofg_number_id = ?
       ORDER BY id DESC LIMIT 1`,
      [opts.clientId, opts.channel, ofgId],
    );
    if (exact[0]) {
      const id = Number(exact[0].id);
      await reopenIfNeeded(id, exact[0].status);
      return id;
    }
    const [unowned] = await pool.query<RowDataPacket[]>(
      `SELECT id, status FROM conversations
       WHERE client_id = ? AND channel = ? AND ofg_number_id IS NULL
       ORDER BY id DESC LIMIT 1`,
      [opts.clientId, opts.channel],
    );
    if (unowned[0]) {
      const id = Number(unowned[0].id);
      await reopenIfNeeded(id, unowned[0].status);
      const [claimed] = await pool.query<ResultSetHeader>(
        `UPDATE conversations
         SET ofg_number_id = ?,
             assigned_admin_id = COALESCE(assigned_admin_id, ?)
         WHERE id = ? AND ofg_number_id IS NULL`,
        [ofgId, opts.assignedAdminId ?? null, id],
      );
      if (Number(claimed.affectedRows || 0) > 0) return id;
    }
    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO conversations
         (client_id, channel, status, assigned_admin_id, ofg_number_id)
       VALUES (?, ?, 'open', ?, ?)`,
      [opts.clientId, opts.channel, opts.assignedAdminId ?? null, ofgId],
    );
    return Number(ins.insertId);
  }
  const [existing] = await pool.query<RowDataPacket[]>(
    `SELECT id, status FROM conversations
     WHERE client_id = ? AND channel = ? AND ofg_number_id IS NULL
     ORDER BY id DESC LIMIT 1`,
    [opts.clientId, opts.channel],
  );
  if (existing[0]) {
    const id = Number(existing[0].id);
    await reopenIfNeeded(id, existing[0].status);
    return id;
  }
  const [ins] = await pool.query<ResultSetHeader>(
    `INSERT INTO conversations
       (client_id, channel, status, assigned_admin_id, ofg_number_id)
     VALUES (?, ?, 'open', ?, NULL)`,
    [opts.clientId, opts.channel, opts.assignedAdminId ?? null],
  );
  return Number(ins.insertId);
}

async function getOrCreateUnknownSmsConversation(opts: {
  unknownContactId: number;
  ofgNumberId?: number | null;
  assignedAdminId?: number | null;
  reopenIfClosed?: boolean;
}): Promise<number> {
  const reopenIfClosed = opts.reopenIfClosed !== false;
  const [conv] = await pool.query<RowDataPacket[]>(
    `SELECT id, status FROM conversations
     WHERE unknown_contact_id = ? AND channel = 'sms' LIMIT 1`,
    [opts.unknownContactId],
  );
  if (conv[0]) {
    const id = Number(conv[0].id);
    const st = String(conv[0].status || "");
    const isTerminal = st === "closed" || st === "archived";
    if (st === "snoozed" || (isTerminal && reopenIfClosed)) {
      await pool.query(
        `UPDATE conversations SET status = 'open', updated_at = NOW() WHERE id = ?`,
        [id],
      );
    }
    if (opts.ofgNumberId != null) {
      await pool.query(
        `UPDATE conversations SET ofg_number_id = COALESCE(ofg_number_id, ?) WHERE id = ?`,
        [opts.ofgNumberId, id],
      );
    }
    if (opts.assignedAdminId != null) {
      await pool.query(
        `UPDATE conversations
         SET assigned_admin_id = COALESCE(assigned_admin_id, ?) WHERE id = ?`,
        [opts.assignedAdminId, id],
      );
    }
    return id;
  }
  const [insC] = await pool.query<ResultSetHeader>(
    `INSERT INTO conversations
       (client_id, channel, status, assigned_admin_id, ofg_number_id, unknown_contact_id)
     VALUES (NULL, 'sms', 'open', ?, ?, ?)`,
    [
      opts.assignedAdminId ?? null,
      opts.ofgNumberId ?? null,
      opts.unknownContactId,
    ],
  );
  return Number(insC.insertId);
}

async function getOrCreateCrmContactChannelConversation(opts: {
  crmContactId: number;
  channel: string;
  ofgNumberId?: number | null;
  assignedAdminId?: number | null;
  reopenIfClosed?: boolean;
}): Promise<number> {
  const reopenIfClosed = opts.reopenIfClosed !== false;
  const channel = opts.channel === "call" ? "call" : "sms";
  const [conv] = await pool.query<RowDataPacket[]>(
    `SELECT id, status FROM conversations
     WHERE contact_id = ? AND channel = ?
     ORDER BY id DESC LIMIT 1`,
    [opts.crmContactId, channel],
  );
  if (conv[0]) {
    const id = Number(conv[0].id);
    const st = String(conv[0].status || "");
    const isTerminal = st === "closed" || st === "archived";
    if (st === "snoozed" || (isTerminal && reopenIfClosed)) {
      await pool.query(
        `UPDATE conversations SET status = 'open', updated_at = NOW() WHERE id = ?`,
        [id],
      );
    }
    if (opts.ofgNumberId != null) {
      await pool.query(
        `UPDATE conversations SET ofg_number_id = COALESCE(ofg_number_id, ?) WHERE id = ?`,
        [opts.ofgNumberId, id],
      );
    }
    if (opts.assignedAdminId != null) {
      await pool.query(
        `UPDATE conversations
         SET assigned_admin_id = COALESCE(assigned_admin_id, ?) WHERE id = ?`,
        [opts.assignedAdminId, id],
      );
    }
    return id;
  }
  const [insC] = await pool.query<ResultSetHeader>(
    `INSERT INTO conversations
       (client_id, channel, status, assigned_admin_id, ofg_number_id, contact_id)
     VALUES (NULL, ?, 'open', ?, ?, ?)`,
    [
      channel,
      opts.assignedAdminId ?? null,
      opts.ofgNumberId ?? null,
      opts.crmContactId,
    ],
  );
  return Number(insC.insertId);
}

async function findOrCreateOpenUnknownContact(opts: {
  phoneRaw: string;
  ofgNumberId?: number | null;
}): Promise<{ unknownId: number; created: boolean; phoneE164: string }> {
  const phoneE164 = toSmsE164(opts.phoneRaw);
  const phoneVariants = phoneMatchVariants(phoneE164);
  if (phoneVariants.length) {
    const ofgClause = opts.ofgNumberId != null ? `AND ofg_number_id = ?` : ``;
    const args: any[] =
      opts.ofgNumberId != null
        ? [
            opts.ofgNumberId,
            ...phoneVariants,
            ...phoneVariants.map((v) => normalizePhoneDigits(v)),
          ]
        : [
            ...phoneVariants,
            ...phoneVariants.map((v) => normalizePhoneDigits(v)),
          ];
    const [found] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM conversation_unknown_contacts
       WHERE status = 'open' ${ofgClause}
         AND (
           phone_e164 IN (${phoneVariants.map(() => "?").join(",")})
           OR REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone_e164,''),'+',''),'-',''),'(',''),')','') IN (${phoneVariants.map(() => "?").join(",")})
         )
       LIMIT 1`,
      args,
    );
    if (found[0]) {
      return {
        unknownId: Number(found[0].id),
        created: false,
        phoneE164,
      };
    }
  }
  const [insU] = await pool.query<ResultSetHeader>(
    `INSERT INTO conversation_unknown_contacts
       (phone_e164, ofg_number_id, status, unread_count)
     VALUES (?, ?, 'open', 0)`,
    [phoneE164, opts.ofgNumberId ?? null],
  );
  return {
    unknownId: Number(insU.insertId),
    created: true,
    phoneE164,
  };
}

async function bumpUnknownContactAfterOutbound(
  unknownId: number,
  preview: string,
  adminId: number,
): Promise<void> {
  await pool.query(
    `UPDATE conversation_unknown_contacts
     SET last_message_at = NOW(), last_message_preview = ?
     WHERE id = ?`,
    [preview.slice(0, 200), unknownId],
  );
  await pool.query(
    `UPDATE conversations
     SET last_message_at = NOW(), last_message_preview = ?,
         assigned_admin_id = COALESCE(assigned_admin_id, ?)
     WHERE unknown_contact_id = ? AND channel = 'sms'
       AND status NOT IN ('closed','archived')`,
    [preview.slice(0, 200), adminId, unknownId],
  );
}

async function insertConversationSystemEvent(opts: {
  conversationId: number;
  body: "closed" | "reopened";
  adminId: number;
}): Promise<void> {
  const meta = JSON.stringify({ system_event: true });
  await pool.query(
    `INSERT INTO conversation_messages
       (conversation_id, direction, channel, body, sent_by_admin_id, metadata_json)
     VALUES (?, 'system', 'internal', ?, ?, ?)`,
    [opts.conversationId, opts.body, opts.adminId, meta],
  );
}

async function setContactConversationStatus(opts: {
  clientId?: number;
  unknownContactId?: number;
  crmContactId?: number;
  status: "open" | "closed";
  adminId: number;
}): Promise<{ status: string }> {
  const hasClient = opts.clientId != null && opts.clientId > 0;
  const hasUnknown = opts.unknownContactId != null && opts.unknownContactId > 0;
  const hasCrm = opts.crmContactId != null && opts.crmContactId > 0;
  if ([hasClient, hasUnknown, hasCrm].filter(Boolean).length !== 1) {
    throw new Error("client_id, unknown_contact_id, or contact_id required");
  }
  const status = opts.status;
  const whereCol = hasClient
    ? "client_id"
    : hasUnknown
      ? "unknown_contact_id"
      : "contact_id";
  const whereId = hasClient
    ? opts.clientId
    : hasUnknown
      ? opts.unknownContactId
      : opts.crmContactId;
  await pool.query(
    `UPDATE conversations SET status = ? WHERE ${whereCol} = ?`,
    [status, whereId],
  );
  const [primary] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM conversations WHERE ${whereCol} = ?
     ORDER BY last_message_at DESC, id DESC LIMIT 1`,
    [whereId],
  );
  if (primary[0]) {
    await insertConversationSystemEvent({
      conversationId: Number(primary[0].id),
      body: status === "closed" ? "closed" : "reopened",
      adminId: opts.adminId,
    });
  }
  await publishConversationRealtime({
    type: "status",
    adminIds: [opts.adminId],
    payload: {
      kind: hasClient ? "client" : hasUnknown ? "unknown" : "contact",
      contact_id: whereId,
      status,
      assigned_admin_id: opts.adminId,
    },
  });
  return { status };
}

async function deliverHubConversationMessage(opts: {
  adminId: number;
  clientId?: number;
  unknownContactId?: number;
  crmContactId?: number;
  channel: string;
  textBody: string;
  isInternalNote?: boolean;
  ofgNumberId?: number | null;
  /** MCP / trusted callers: force From E.164 (must be an active brand line). */
  fromE164Override?: string | null;
  mediaUrl?: string | null;
  mediaContentType?: string | null;
}): Promise<{
  ok: boolean;
  conversation_id: number;
  message_id: number;
  provider_status: string | null;
  error: string | null;
  client_id?: number;
  unknown_contact_id?: number;
  contact_id?: number;
}> {
  const hasClient = opts.clientId != null && opts.clientId > 0;
  const hasUnknown = opts.unknownContactId != null && opts.unknownContactId > 0;
  const hasCrm = opts.crmContactId != null && opts.crmContactId > 0;
  if ([hasClient, hasUnknown, hasCrm].filter(Boolean).length !== 1) {
    throw new Error(
      "Exactly one of client_id, unknown_contact_id, or contact_id required",
    );
  }
  const ch = opts.isInternalNote ? "internal" : String(opts.channel || "sms");
  if (!["sms", "internal"].includes(ch)) throw new Error("Unsupported channel");
  if ((hasUnknown || hasCrm) && ch === "internal") {
    throw new Error("Internal notes require a linked client");
  }
  const mediaUrl = opts.mediaUrl ? String(opts.mediaUrl).trim() : "";
  const mediaContentType = opts.mediaContentType
    ? String(opts.mediaContentType).trim()
    : null;
  if (ch === "sms" && !opts.textBody.trim() && !mediaUrl) {
    throw new Error("SMS body or media is required");
  }
  if (ch === "sms" && [...opts.textBody].length > SMS_MAX_BODY_CHARS) {
    throw new Error(`SMS body exceeds ${SMS_MAX_BODY_CHARS} characters`);
  }
  const mediaUrls = mediaUrl ? [mediaUrl] : undefined;

  // Auto-reopen closed threads for staff outbound
  if (
    await (async () => {
      const col = hasClient
        ? "client_id"
        : hasUnknown
          ? "unknown_contact_id"
          : "contact_id";
      const id = hasClient
        ? opts.clientId
        : hasUnknown
          ? opts.unknownContactId
          : opts.crmContactId;
      const [r] = await pool.query<RowDataPacket[]>(
        `SELECT 1 AS x FROM conversations
         WHERE ${col} = ? AND status IN ('closed','archived') LIMIT 1`,
        [id],
      );
      return r.length > 0;
    })()
  ) {
    await setContactConversationStatus({
      clientId: hasClient ? opts.clientId : undefined,
      unknownContactId: hasUnknown ? opts.unknownContactId : undefined,
      crmContactId: hasCrm ? opts.crmContactId : undefined,
      status: "open",
      adminId: opts.adminId,
    });
  }

  const assigned = await listAssignedPhoneNumbers(opts.adminId);
  let ofgNumberId: number | null = null;
  let fromE164: string | undefined;
  const overrideFrom = String(opts.fromE164Override || "").trim();
  if (overrideFrom) {
    // Trusted MCP path: From is an active brand line (may not be on adminId's list).
    if (opts.ofgNumberId != null) {
      const [nrow] = await pool.query<RowDataPacket[]>(
        `SELECT id, e164, is_active FROM admin_phone_numbers WHERE id = ? LIMIT 1`,
        [Number(opts.ofgNumberId)],
      );
      if (!nrow[0] || Number(nrow[0].is_active) !== 1) {
        throw new Error("Groundwork phone number not found or inactive");
      }
      ofgNumberId = Number(nrow[0].id);
      fromE164 = String(nrow[0].e164 || "").trim() || overrideFrom;
    } else {
      const [nrow] = await pool.query<RowDataPacket[]>(
        `SELECT id, e164 FROM admin_phone_numbers
         WHERE e164 = ? AND is_active = 1 LIMIT 1`,
        [overrideFrom],
      );
      if (!nrow[0]) {
        throw new Error("Groundwork phone number not found or inactive");
      }
      ofgNumberId = Number(nrow[0].id);
      fromE164 = String(nrow[0].e164);
    }
  } else if (opts.ofgNumberId != null) {
    // HTTP path: never silently fall back to a different From line.
    ofgNumberId = Number(opts.ofgNumberId);
    const hit = assigned.find((n) => Number(n.id) === ofgNumberId);
    if (!hit?.e164) {
      throw new Error("Groundwork phone number not assigned to this admin");
    }
    fromE164 = String(hit.e164);
  } else if (assigned[0]) {
    ofgNumberId = Number(assigned[0].id);
    fromE164 = String(assigned[0].e164);
  }

  let conversationId = 0;
  let toAddress = "";
  let providerId: string | undefined;
  let providerStatus: string | null = null;
  let errorMessage: string | null = null;
  let realtimePayload: Record<string, unknown> = {
    assigned_admin_id: opts.adminId,
  };

  if (hasClient) {
    const [crows] = await pool.query<RowDataPacket[]>(
      `SELECT phone FROM clients WHERE id = ? LIMIT 1`,
      [opts.clientId],
    );
    if (!crows[0]) throw new Error("Client not found");
    conversationId = await getOrCreateClientChannelConversation({
      clientId: opts.clientId!,
      channel: ch === "internal" ? "internal" : "sms",
      ofgNumberId: ch === "sms" ? ofgNumberId : null,
      assignedAdminId: opts.adminId,
      reopenIfClosed: false,
    });
    if (ch !== "internal") {
      if (!crows[0].phone) throw new Error("Client has no phone");
      toAddress = toSmsE164(String(crows[0].phone));
      if (!fromE164) throw new Error("No Groundwork phone number assigned");
      const result = await sendSms({
        to: toAddress,
        body: opts.textBody,
        from: fromE164,
        mediaUrls,
      }).catch((e) => {
        errorMessage = String(e?.message || e);
        return null;
      });
      providerId = result?.sid;
      providerStatus = result?.status || (errorMessage ? "failed" : null);
    }
    realtimePayload = {
      ...realtimePayload,
      client_id: opts.clientId,
      conversation_id: conversationId,
    };
  } else if (hasCrm) {
    const crmId = opts.crmContactId!;
    const [crows] = await pool.query<RowDataPacket[]>(
      `SELECT phone FROM contacts
       WHERE id = ? AND deleted_at IS NULL AND converted_client_id IS NULL
       LIMIT 1`,
      [crmId],
    );
    if (!crows[0]) throw new Error("Contact not found");
    if (!crows[0].phone) throw new Error("Contact has no phone");
    toAddress = toSmsE164(String(crows[0].phone));
    conversationId = await getOrCreateCrmContactChannelConversation({
      crmContactId: crmId,
      channel: "sms",
      ofgNumberId,
      assignedAdminId: opts.adminId,
      reopenIfClosed: false,
    });
    if (!fromE164) throw new Error("No Groundwork phone number assigned");
    const result = await sendSms({
      to: toAddress,
      body: opts.textBody,
      from: fromE164,
      mediaUrls,
    }).catch((e) => {
      errorMessage = String(e?.message || e);
      return null;
    });
    providerId = result?.sid;
    providerStatus = result?.status || (errorMessage ? "failed" : null);
    realtimePayload = {
      ...realtimePayload,
      contact_id: crmId,
      conversation_id: conversationId,
    };
  } else {
    const unknownId = opts.unknownContactId!;
    if (!(await adminCanAccessUnknownContact(opts.adminId, unknownId))) {
      throw new Error("Unknown contact not found");
    }
    const [urows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM conversation_unknown_contacts
       WHERE id = ? AND status = 'open' LIMIT 1`,
      [unknownId],
    );
    if (!urows[0]) throw new Error("Unknown contact not found");
    ofgNumberId =
      urows[0].ofg_number_id != null
        ? Number(urows[0].ofg_number_id)
        : ofgNumberId;
    if (!urows[0].phone_e164) throw new Error("Unknown contact has no phone");
    toAddress = toSmsE164(String(urows[0].phone_e164));
    conversationId = await getOrCreateUnknownSmsConversation({
      unknownContactId: unknownId,
      ofgNumberId,
      assignedAdminId: opts.adminId,
      reopenIfClosed: false,
    });
    const fromForUnknown = assigned.find((n) => Number(n.id) === ofgNumberId)
      ?.e164
      ? String(assigned.find((n) => Number(n.id) === ofgNumberId)!.e164)
      : fromE164;
    if (!fromForUnknown) throw new Error("No Groundwork phone number assigned");
    const result = await sendSms({
      to: toAddress,
      body: opts.textBody,
      from: fromForUnknown,
      mediaUrls,
    }).catch((e) => {
      errorMessage = String(e?.message || e);
      return null;
    });
    providerId = result?.sid;
    providerStatus = result?.status || (errorMessage ? "failed" : null);
    realtimePayload = {
      ...realtimePayload,
      unknown_contact_id: unknownId,
      conversation_id: conversationId,
    };
  }

  const preview = (opts.textBody.trim() || (mediaUrl ? "[Media]" : "")).slice(0, 200);
  const [ins] = await pool.query<ResultSetHeader>(
    `INSERT INTO conversation_messages
       (conversation_id, direction, channel, body, media_url, media_content_type,
        to_address, sent_by_admin_id, provider_message_id, provider_status, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      conversationId,
      ch === "internal" ? "internal" : "outbound",
      ch,
      opts.textBody || null,
      mediaUrl || null,
      mediaContentType,
      toAddress || null,
      opts.adminId,
      providerId || null,
      providerStatus,
      errorMessage,
    ],
  );

  if (hasUnknown) {
    await bumpUnknownContactAfterOutbound(
      opts.unknownContactId!,
      preview,
      opts.adminId,
    );
  } else {
    await pool.query(
      `UPDATE conversations
       SET last_message_at = NOW(), last_message_preview = ?,
           assigned_admin_id = COALESCE(assigned_admin_id, ?)
       WHERE id = ? AND status NOT IN ('closed','archived')`,
      [preview, opts.adminId, conversationId],
    );
  }
  realtimePayload.message_id = ins.insertId;
  await publishConversationRealtime({ type: "message", payload: realtimePayload });

  return {
    ok: !errorMessage,
    conversation_id: conversationId,
    message_id: Number(ins.insertId),
    provider_status: providerStatus,
    error: errorMessage,
    client_id: hasClient ? opts.clientId : undefined,
    unknown_contact_id: hasUnknown ? opts.unknownContactId : undefined,
    contact_id: hasCrm ? opts.crmContactId : undefined,
  };
}

/** Decode literal \\n / \\uXXXX that models sometimes emit in tool args. */
function decodeLiteralUnicodeEscapes(input: string): string {
  if (!input || !input.includes("\\")) return input;
  if (!/\\[nrtu]/.test(input)) return input;
  return input
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t");
}

async function appendContactAdminNote(
  contactId: number,
  stamped: string,
): Promise<boolean> {
  try {
    await pool.query(
      `UPDATE contacts
       SET admin_notes = CONCAT(
             COALESCE(admin_notes, ''),
             CASE WHEN admin_notes IS NULL OR admin_notes = '' THEN '' ELSE '\n' END,
             ?
           )
       WHERE id = ? AND deleted_at IS NULL`,
      [stamped.slice(0, 8000), contactId],
    );
    return true;
  } catch (noteErr: any) {
    console.error("[contact] admin note", noteErr?.message ?? noteErr);
    return false;
  }
}

async function appendClientAdminNote(
  clientId: number,
  stamped: string,
): Promise<boolean> {
  try {
    await pool.query(
      `UPDATE clients
       SET admin_notes = CONCAT(
             COALESCE(admin_notes, ''),
             CASE WHEN admin_notes IS NULL OR admin_notes = '' THEN '' ELSE '\n' END,
             ?
           )
       WHERE id = ?`,
      [stamped.slice(0, 8000), clientId],
    );
    return true;
  } catch (noteErr: any) {
    console.error("[client] admin note", noteErr?.message ?? noteErr);
    return false;
  }
}

async function findCrmContactDuplicates(opts: {
  phone?: string | null;
  email?: string | null;
  excludeContactId?: number;
}): Promise<{
  clients: Array<Record<string, unknown>>;
  contacts: Array<Record<string, unknown>>;
}> {
  const clients: Array<Record<string, unknown>> = [];
  const contacts: Array<Record<string, unknown>> = [];
  const phone = opts.phone ? String(opts.phone).trim() : "";
  const email = opts.email ? String(opts.email).trim().toLowerCase() : "";
  if (phone) {
    const last10 = normalizePhoneLast10(phone);
    if (last10) {
      const clientId = await findClientIdByPhone(phone);
      if (clientId != null) {
        const [crows] = await pool.query<RowDataPacket[]>(
          `SELECT id, first_name, last_name, email, phone, status
           FROM clients WHERE id = ? LIMIT 1`,
          [clientId],
        );
        if (crows[0]) {
          clients.push({
            id: Number(crows[0].id),
            name: `${crows[0].first_name || ""} ${crows[0].last_name || ""}`.trim(),
            email: crows[0].email,
            phone: crows[0].phone,
            status: crows[0].status,
            href: `/admin/clients/${crows[0].id}`,
          });
        }
      }
      const [contactPhone] = await pool.query<RowDataPacket[]>(
        `SELECT id, first_name, last_name, email, phone
         FROM contacts
         WHERE deleted_at IS NULL AND converted_client_id IS NULL
           AND phone IS NOT NULL
           ${opts.excludeContactId ? "AND id <> ?" : ""}
         ORDER BY id DESC LIMIT 50`,
        opts.excludeContactId ? [opts.excludeContactId] : [],
      );
      for (const r of contactPhone) {
        if (normalizePhoneLast10(String(r.phone || "")) !== last10) continue;
        contacts.push({
          id: Number(r.id),
          name: `${r.first_name || ""} ${r.last_name || ""}`.trim(),
          email: r.email,
          phone: r.phone,
          href: `/admin/contacts`,
        });
      }
    }
  }
  if (email) {
    const [clientEmail] = await pool.query<RowDataPacket[]>(
      `SELECT id, first_name, last_name, email, phone, status
       FROM clients WHERE LOWER(email) = ?
       ORDER BY id DESC LIMIT 5`,
      [email],
    );
    for (const r of clientEmail) {
      clients.push({
        id: Number(r.id),
        name: `${r.first_name || ""} ${r.last_name || ""}`.trim(),
        email: r.email,
        phone: r.phone,
        status: r.status,
        href: `/admin/clients/${r.id}`,
      });
    }
    const [contactEmail] = await pool.query<RowDataPacket[]>(
      `SELECT id, first_name, last_name, email, phone
       FROM contacts
       WHERE deleted_at IS NULL AND converted_client_id IS NULL
         AND LOWER(email) = ?
         ${opts.excludeContactId ? "AND id <> ?" : ""}
       ORDER BY id DESC LIMIT 5`,
      opts.excludeContactId ? [email, opts.excludeContactId] : [email],
    );
    for (const r of contactEmail) {
      contacts.push({
        id: Number(r.id),
        name: `${r.first_name || ""} ${r.last_name || ""}`.trim(),
        email: r.email,
        phone: r.phone,
        href: `/admin/contacts`,
      });
    }
  }
  return { clients: clients.slice(0, 10), contacts: contacts.slice(0, 10) };
}

type McpStaffResolve =
  | { ok: true; requested: false; id: null }
  | { ok: true; requested: true; id: number; name: string; email: string }
  | { ok: false; error: string; message: string; matches?: unknown };

async function resolveMcpStaffAssignee(opts: {
  adminId?: unknown;
  name?: unknown;
  email?: unknown;
}): Promise<McpStaffResolve> {
  const rawId =
    opts.adminId != null && Number(opts.adminId) > 0
      ? Number(opts.adminId)
      : null;
  const name = String(opts.name || "").trim().toLowerCase();
  const email = String(opts.email || "").trim().toLowerCase();
  if (!rawId && !name && !email) {
    return { ok: true, requested: false, id: null };
  }
  const [staff] = await pool.query<RowDataPacket[]>(
    `SELECT id, first_name, last_name, email, phone, preferred_language
     FROM admins WHERE status = 'active'
     ORDER BY id ASC`,
  );
  let matches = staff;
  if (email) {
    matches = staff.filter((s) => String(s.email || "").toLowerCase() === email);
  } else if (name) {
    matches = staff.filter((s) => {
      const full = `${s.first_name || ""} ${s.last_name || ""}`
        .trim()
        .toLowerCase();
      return (
        full === name ||
        full.includes(name) ||
        String(s.first_name || "").toLowerCase() === name ||
        String(s.last_name || "").toLowerCase() === name
      );
    });
  } else if (rawId) {
    matches = staff.filter((s) => Number(s.id) === rawId);
  }
  if (rawId && matches.length > 1) {
    const byId = matches.find((s) => Number(s.id) === rawId);
    if (byId) matches = [byId];
  }
  if (matches.length === 0) {
    return {
      ok: false,
      error: "assignee_not_found",
      message: "Staff not found or inactive. Use search_staff.",
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      error: "assignee_ambiguous",
      message: "Multiple staff match. Pass assigned_admin_id from search_staff.",
      matches: matches.slice(0, 8).map((r) => ({
        id: Number(r.id),
        name: `${r.first_name || ""} ${r.last_name || ""}`.trim(),
        email: r.email,
      })),
    };
  }
  const hit = matches[0];
  return {
    ok: true,
    requested: true,
    id: Number(hit.id),
    name: `${hit.first_name || ""} ${hit.last_name || ""}`.trim(),
    email: String(hit.email || ""),
  };
}

async function resolveMcpSmsFromE164(
  ctxAdminId: number,
  args: Record<string, unknown>,
): Promise<
  | { ok: true; e164: string; from_admin_id: number; ofg_number_id: number | null }
  | { ok: false; error: string; message: string }
> {
  const phoneNumberId =
    args.from_phone_number_id != null && Number(args.from_phone_number_id) > 0
      ? Number(args.from_phone_number_id)
      : null;
  if (phoneNumberId) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, e164, assigned_admin_id, is_active
       FROM admin_phone_numbers WHERE id = ? LIMIT 1`,
      [phoneNumberId],
    );
    if (!rows[0] || Number(rows[0].is_active) !== 1) {
      return {
        ok: false,
        error: "invalid_args",
        message:
          "from_phone_number_id is not an active brand number. Use list_brand_phone_numbers all=true.",
      };
    }
    const e164 = String(rows[0].e164 || "").trim();
    if (!e164) {
      return { ok: false, error: "invalid_args", message: "Brand number has no E.164" };
    }
    return {
      ok: true,
      e164,
      ofg_number_id: Number(rows[0].id),
      from_admin_id:
        rows[0].assigned_admin_id != null
          ? Number(rows[0].assigned_admin_id)
          : ctxAdminId,
    };
  }
  const named = await resolveMcpStaffAssignee({
    adminId: args.from_admin_id,
    name: args.from_admin_name,
    email: args.from_admin_email,
  });
  if (named.ok === false) return named;
  const ownerId = named.requested ? named.id : ctxAdminId;
  const phones = await listAssignedPhoneNumbers(ownerId);
  if (!phones[0]) {
    return {
      ok: false,
      error: "conversations_number_required",
      message:
        "That staff member has no assigned Groundwork phone number. Assign one in Staff → Brand phone numbers, or pass from_phone_number_id.",
    };
  }
  return {
    ok: true,
    e164: String(phones[0].e164),
    ofg_number_id: Number(phones[0].id),
    from_admin_id: ownerId,
  };
}

/** Log-only TCPA keywords in v1 (no HELP/STOP auto-replies). */
function classifySmsKeyword(body: string): "stop" | "help" | "start" | null {
  const t = String(body || "")
    .trim()
    .toUpperCase();
  if (/^(STOP|STOPALL|UNSUBSCRIBE|END|QUIT|CANCELAR|BAJA)$/.test(t)) return "stop";
  if (/^(HELP|INFO|AYUDA)$/.test(t)) return "help";
  if (/^(START|YES|UNSTOP)$/.test(t)) return "start";
  return null;
}

async function enrichAdminAuthUser(user: PortalAuthUser): Promise<PortalAuthUser & {
  conversations_enabled: boolean;
  assigned_phone_numbers: ReturnType<typeof mapPhoneNumberRow>[];
  voice_available: boolean;
  call_forwarding_enabled: boolean;
  call_forwarding_phone: string | null;
  voicemail_enabled: boolean | null;
  voicemail_greeting_text: string | null;
}> {
  const phones = await listAssignedPhoneNumbers(user.id);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT voice_available, call_forwarding_enabled, call_forwarding_phone,
            voicemail_enabled, voicemail_greeting_text
     FROM admins WHERE id = ? LIMIT 1`,
    [user.id],
  );
  return {
    ...user,
    assigned_phone_numbers: phones.map(mapPhoneNumberRow),
    conversations_enabled: phones.length > 0,
    voice_available: Number(rows[0]?.voice_available || 0) === 1,
    call_forwarding_enabled: Number(rows[0]?.call_forwarding_enabled || 0) === 1,
    call_forwarding_phone: rows[0]?.call_forwarding_phone
      ? String(rows[0].call_forwarding_phone)
      : null,
    voicemail_enabled:
      rows[0]?.voicemail_enabled == null
        ? null
        : Number(rows[0].voicemail_enabled) === 1,
    voicemail_greeting_text: rows[0]?.voicemail_greeting_text
      ? String(rows[0].voicemail_greeting_text)
      : null,
  };
}


// ── Conversations hub parity helpers (voice + MMS + call log) ───────────────

const MMS_ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/3gpp",
  "video/quicktime",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/amr",
  "application/pdf",
]);
const MMS_MAX_BYTES = PHOTO_MAX_BYTES;
const MMS_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MMS_RETENTION_DAYS = 365;

function parseMessageMetadataJson(raw: unknown): Record<string, unknown> {
  if (raw == null || raw === "") return {};
  try {
    if (typeof raw === "string") {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    }
    if (typeof raw === "object" && !Array.isArray(raw)) {
      return { ...(raw as Record<string, unknown>) };
    }
  } catch {
    /* ignore */
  }
  return {};
}

async function mergeConversationMessageMetadata(
  messageId: number,
  patch: Record<string, unknown>,
  extras?: { body?: string | null },
): Promise<Record<string, unknown> | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT metadata_json FROM conversation_messages WHERE id = ? LIMIT 1`,
    [messageId],
  );
  if (!rows[0]) return null;
  const next = { ...parseMessageMetadataJson(rows[0].metadata_json), ...patch };
  if (extras && "body" in extras) {
    await pool.query(
      `UPDATE conversation_messages SET metadata_json = ?, body = ? WHERE id = ?`,
      [JSON.stringify(next), extras.body, messageId],
    );
  } else {
    await pool.query(
      `UPDATE conversation_messages SET metadata_json = ? WHERE id = ?`,
      [JSON.stringify(next), messageId],
    );
  }
  return next;
}

/**
 * Store a finished (or failed) call transcript on its conversation message,
 * update the voicemail preview, email the assignee for voicemail, and push the
 * realtime update. Shared by the legacy <Record transcribe> callback and
 * Twilio Voice v3 transcriptions.
 */
async function applyCallTranscriptResult(opts: {
  messageId: number;
  conversationId: number;
  metaRaw: unknown;
  bodyRaw: string | null;
  completed: boolean;
  transcript: string;
  recordingSid: string | null;
  extraMeta?: Record<string, unknown>;
}) {
  const existing = parseMessageMetadataJson(opts.metaRaw);
  const transcript = opts.completed ? opts.transcript : "";
  const metaPatch: Record<string, unknown> = {
    transcript_status: opts.completed && transcript ? "ready" : "failed",
    ...(opts.extraMeta || {}),
  };
  if (opts.recordingSid) metaPatch.recording_sid = opts.recordingSid;
  if (opts.completed) metaPatch.transcript = transcript;

  let nextBody: string | null | undefined = undefined;
  const isVoicemail = !!(existing.is_voicemail || existing.voicemail);
  if (opts.completed && transcript && isVoicemail) {
    const preview = transcript.slice(0, 240);
    nextBody = preview ? `Voicemail: ${preview}` : opts.bodyRaw;
  }
  const merged = await mergeConversationMessageMetadata(
    opts.messageId,
    metaPatch,
    nextBody !== undefined ? { body: nextBody } : undefined,
  );
  const assignedAdminId = await conversationAssignedAdminId(opts.conversationId);
  if (isVoicemail) {
    await emailAssigneeVoicemailTranscript({
      messageId: opts.messageId,
      transcript,
      transcriptionFailed: metaPatch.transcript_status !== "ready",
    });
  }
  await publishConversationRealtime({
    type: "call_transcript",
    adminIds: assignedAdminId ? [assignedAdminId] : undefined,
    payload: {
      conversation_id: opts.conversationId,
      message_id: opts.messageId,
      transcript_status: metaPatch.transcript_status,
      transcript: transcript || null,
      recording_sid: opts.recordingSid,
      assigned_admin_id: assignedAdminId,
      metadata: merged,
    },
  });
}

// ── Call transcripts: Twilio Voice v3 Transcriptions (Deepgram nova-3, EN/ES auto) ──
// Same engine as Optimum Credit. No console setup: the transcription
// configuration (engine, language, Caller/Agent channels, webhook) is created
// through the API on first use and reused by unique name.

const TWILIO_TRANSCRIPTION_CONFIG_NAME = "groundwork_call_transcript";
let cachedTwilioTranscriptionConfigId: string | null = null;

function twilioVoiceAuthHeader(): string | null {
  const key = String(process.env.TWILIO_API_KEY || "").trim();
  const secret = String(process.env.TWILIO_API_SECRET || "").trim();
  if (key && secret) return `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
  const sid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const token = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  if (sid.startsWith("AC") && token) return `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
  return null;
}

async function twilioVoiceJson<T>(
  method: "GET" | "POST",
  url: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const auth = twilioVoiceAuthHeader();
  if (!auth) throw Object.assign(new Error("twilio_auth_missing"), { code: "twilio_auth_missing" });
  const res = await fetch(url, {
    method,
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text.slice(0, 200) };
  }
  return { status: res.status, data: data as T };
}

/** 403 + 46009 / "addendum" = the account hasn't accepted Twilio's AI addendum. */
export function twilioTranscriptionErrorCode(
  httpStatus: number,
  body: unknown,
): "twilio_ai_addendum" | "twilio_stt_failed" | null {
  if (!(httpStatus >= 400)) return null;
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (httpStatus === 403 && (Number(o.code) === 46009 || /addendum/i.test(String(o.message || "")))) {
    return "twilio_ai_addendum";
  }
  return "twilio_stt_failed";
}

/** Sentences → "Caller: … / Agent: …" (channel 1 = customer, 2 = agent), in time order. */
export function transcriptTextFromTwilioSentences(sentences: unknown): string {
  if (!Array.isArray(sentences)) return "";
  const rows: { start: number; index: number; line: string }[] = [];
  sentences.forEach((st, i) => {
    if (!st || typeof st !== "object") return;
    const o = st as Record<string, unknown>;
    const text = String(o.text || o.transcript || "").trim();
    if (!text) return;
    const ch = Number(o.audioChannelIndex ?? o.audio_channel_index);
    const who = ch === 2 ? "Agent" : ch === 1 ? "Caller" : "";
    const start = Number(o.startTimeSeconds ?? o.start_time);
    const index = Number(o.sentenceIndex ?? o.sentence_index);
    rows.push({
      start: Number.isFinite(start) ? start : i,
      index: Number.isFinite(index) ? index : i,
      line: who ? `${who}: ${text}` : text,
    });
  });
  rows.sort((x, y) => x.start - y.start || x.index - y.index);
  return rows.map((r) => r.line).join("\n").slice(0, 60000);
}

async function ensureTwilioTranscriptionConfigId(): Promise<string> {
  if (cachedTwilioTranscriptionConfigId) return cachedTwilioTranscriptionConfigId;
  const list = await twilioVoiceJson<{ content?: Array<{ id?: string; unique_name?: string }> }>(
    "GET",
    "https://voice.twilio.com/v2/Configurations/Transcription?pageSize=50",
  );
  if (list.status >= 400) {
    const code = twilioTranscriptionErrorCode(list.status, list.data) || "twilio_stt_failed";
    throw Object.assign(new Error(code), { code });
  }
  const found = (list.data?.content || []).find((c) => c.unique_name === TWILIO_TRANSCRIPTION_CONFIG_NAME && c.id);
  if (found?.id) return (cachedTwilioTranscriptionConfigId = found.id);
  const created = await twilioVoiceJson<{ id?: string }>(
    "POST",
    "https://voice.twilio.com/v2/Configurations/Transcription",
    {
      unique_name: TWILIO_TRANSCRIPTION_CONFIG_NAME,
      description: "Groundwork call recordings — transcript only, EN/ES auto",
      configuration: {
        configurationType: "Transcription",
        transcriptionEngine: "deepgram",
        speechModel: "nova-3",
        language: "multi",
        transcriptionStatusCallback: {
          url: `${groundworkApiBaseUrl()}/api/voice/call-transcript`,
          method: "POST",
        },
        participantDefaults: [
          { audioChannelIndex: 1, type: "CUSTOMER" },
          { audioChannelIndex: 2, type: "HUMAN_AGENT" },
        ],
      },
    },
  );
  if (created.status >= 400 || !created.data?.id) {
    const code = twilioTranscriptionErrorCode(created.status, created.data) || "twilio_stt_failed";
    throw Object.assign(new Error(code), { code });
  }
  return (cachedTwilioTranscriptionConfigId = created.data.id);
}

type TranscriptJob =
  | { state: "ready"; text: string }
  | { state: "pending" }
  | { state: "failed"; error: string };

/** Read one v3 transcription job (used by the webhook and by Retry to recover missed callbacks). */
async function fetchTwilioTranscriptionJob(jobId: string): Promise<TranscriptJob & { sourceId: string }> {
  const got = await twilioVoiceJson<Record<string, any>>(
    "GET",
    `https://voice.twilio.com/v3/Transcriptions/${encodeURIComponent(jobId)}`,
  );
  if (got.status >= 400) return { state: "failed", error: "twilio_stt_failed", sourceId: "" };
  const payload = (got.data?.transcription && typeof got.data.transcription === "object"
    ? got.data.transcription
    : got.data) as Record<string, any>;
  const sourceId = String(payload?.sourceId || got.data?.sourceId || "");
  const text = transcriptTextFromTwilioSentences(payload?.sentences || got.data?.sentences);
  if (text) return { state: "ready", text, sourceId };
  const status = String(payload?.status || got.data?.status || "").toLowerCase();
  if (status === "failed" || status === "canceled") {
    return { state: "failed", error: "twilio_stt_failed", sourceId };
  }
  return { state: "pending", sourceId };
}

/**
 * Transcribe a finished call recording (answered calls + voicemail, any length,
 * English/Spanish auto) — result arrives on POST /api/voice/call-transcript.
 * Outcome is always stored on the message (never "pending" forever).
 */
async function requestTwilioRecordingTranscription(
  recordingSid: string,
  messageId: number,
): Promise<"pending" | "unavailable" | "failed"> {
  const sid = String(recordingSid || "").trim();
  if (!sid || !messageId) return "unavailable";
  // Sandbox (tests / NOTIFY_SANDBOX): never call Twilio; the webhook path is tested directly.
  if (notifySandbox()) {
    await mergeConversationMessageMetadata(messageId, { transcript_status: "pending" });
    return "pending";
  }
  if (!twilioVoiceAuthHeader()) {
    await mergeConversationMessageMetadata(messageId, { transcript_status: "unavailable" });
    return "unavailable";
  }
  try {
    const configId = await ensureTwilioTranscriptionConfigId();
    const created = await twilioVoiceJson<Record<string, any>>("POST", "https://voice.twilio.com/v3/Transcriptions", {
      transcriptionConfigurationId: configId,
      sourceId: sid,
    });
    const code = twilioTranscriptionErrorCode(created.status, created.data);
    if (code) throw Object.assign(new Error(code), { code });
    const jobId = String(created.data?.id || created.data?.transcription?.id || created.data?.operationId || "").trim();
    if (!jobId) throw Object.assign(new Error("twilio_stt_failed"), { code: "twilio_stt_failed" });
    await mergeConversationMessageMetadata(messageId, {
      transcript_status: "pending",
      transcript_job_id: jobId,
      transcript_provider: "twilio_v3",
      transcript_error: null,
    });
    return "pending";
  } catch (err: any) {
    const code = String(err?.code || "twilio_stt_failed");
    console.warn("[voice:transcript] create failed", sid, code, err?.message ?? "");
    // AI addendum not accepted → "unavailable" (account setting), anything else → "failed".
    const status = code === "twilio_ai_addendum" || code === "twilio_auth_missing" ? "unavailable" : "failed";
    await mergeConversationMessageMetadata(messageId, { transcript_status: status, transcript_error: code });
    return status;
  }
}

async function conversationAssignedAdminId(
  conversationId: number,
): Promise<number | null> {
  if (!conversationId) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT assigned_admin_id FROM conversations WHERE id = ? LIMIT 1`,
    [conversationId],
  );
  const id = Number(rows[0]?.assigned_admin_id || 0);
  return id > 0 ? id : null;
}

/** Inbox deep link for the assignee (`?client` / `?contact` / `?unknown`). */
function conversationInboxUrl(row: {
  client_id?: unknown;
  contact_id?: unknown;
  unknown_contact_id?: unknown;
}): string {
  const base = `${APP_URL}/admin/conversations`;
  const clientId = Number(row.client_id || 0);
  const contactId = Number(row.contact_id || 0);
  const unknownId = Number(row.unknown_contact_id || 0);
  if (clientId > 0) return `${base}?client=${clientId}`;
  if (contactId > 0) return `${base}?contact=${contactId}`;
  if (unknownId > 0) return `${base}?unknown=${unknownId}`;
  return base;
}

/**
 * Email the conversation assignee when a voicemail transcript is ready
 * (or when transcription failed). Skips answered-call transcripts and retries.
 */
async function emailAssigneeVoicemailTranscript(opts: {
  messageId: number;
  transcript: string;
  transcriptionFailed: boolean;
}): Promise<void> {
  if (!opts.messageId) return;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT m.from_address, m.metadata_json,
            c.client_id, c.contact_id, c.unknown_contact_id,
            a.email, a.first_name, a.preferred_language, a.status
     FROM conversation_messages m
     JOIN conversations c ON c.id = m.conversation_id
     LEFT JOIN admins a ON a.id = c.assigned_admin_id
     WHERE m.id = ? LIMIT 1`,
    [opts.messageId],
  );
  const row = rows[0];
  if (!row) return;
  const meta = parseMessageMetadataJson(row.metadata_json);
  if (meta.voicemail_transcript_emailed_at) return;
  const email = String(row.email || "").trim();
  if (!email || String(row.status || "") !== "active") return;
  const lang = asLang(row.preferred_language);
  const caller =
    String(row.from_address || "").trim() ||
    tr(lang, "Unknown caller", "Llamada desconocida");
  const transcript = String(opts.transcript || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
  const missing = opts.transcriptionFailed || !transcript;
  const name = String(row.first_name || "").trim();
  const greeting = name
    ? tr(lang, `Hi ${name},`, `Hola ${name},`)
    : tr(lang, "Hi,", "Hola,");
  const subject = missing
    ? tr(lang, `Voicemail from ${caller}`, `Mensaje de voz de ${caller}`)
    : tr(
        lang,
        `Voicemail transcript from ${caller}`,
        `Transcripción de mensaje de voz de ${caller}`,
      );
  const headline = missing
    ? tr(lang, "New voicemail", "Nuevo mensaje de voz")
    : tr(lang, "Voicemail transcript", "Transcripción del mensaje de voz");
  const paragraphs = missing
    ? [
        greeting,
        tr(
          lang,
          `${caller} left a voicemail on the Groundwork line. A transcript isn't available yet. Open the conversation to listen.`,
          `${caller} dejó un mensaje de voz en la línea de Groundwork. Aún no hay transcripción. Abre la conversación para escucharlo.`,
        ),
      ]
    : [
        greeting,
        tr(
          lang,
          `${caller} left a voicemail on the Groundwork line.`,
          `${caller} dejó un mensaje de voz en la línea de Groundwork.`,
        ),
        transcript,
      ];
  const tpl = tplPortalNotice({
    lang,
    subject,
    headline,
    paragraphs,
    cta: {
      url: conversationInboxUrl({
        client_id: row.client_id,
        contact_id: row.contact_id,
        unknown_contact_id: row.unknown_contact_id,
      }),
      label: tr(lang, "Open conversation", "Abrir conversación"),
    },
  });
  try {
    const sent = await sendEmail({
      to: email,
      subject: tpl.subject,
      html: tpl.html,
    });
    if (!sent.ok) return;
    await mergeConversationMessageMetadata(opts.messageId, {
      voicemail_transcript_emailed_at: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error("[voice:voicemail-email]", e?.message ?? e);
  }
}

type PendingRecording = { mp3Url: string; durationSec: number | null; at: number };
const pendingRecordings = new Map<string, PendingRecording>();

function rememberPendingRecording(
  callSid: string,
  mp3Url: string,
  durationSec: number | null,
) {
  const sid = String(callSid || "").trim();
  if (!sid) return;
  pendingRecordings.set(sid, { mp3Url, durationSec, at: Date.now() });
  if (pendingRecordings.size > 200) {
    const cutoff = Date.now() - 30 * 60_000;
    for (const [k, v] of pendingRecordings) {
      if (v.at < cutoff) pendingRecordings.delete(k);
    }
  }
}

function takePendingRecording(callSid: string): PendingRecording | null {
  const sid = String(callSid || "").trim();
  if (!sid) return null;
  const hit = pendingRecordings.get(sid) || null;
  if (hit) pendingRecordings.delete(sid);
  return hit;
}

async function getSystemSettingValue(key: string): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1`,
    [key],
  );
  return rows[0]?.setting_value != null ? String(rows[0].setting_value) : null;
}

async function upsertSystemSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO system_settings (setting_key, setting_value)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [key, value],
  );
}

let cachedTwimlAppSid: string | null =
  String(process.env.TWILIO_TWIML_APP_SID || "").trim() || null;
let twimlAppVerified = false;

async function getOrCreateTwimlAppSid(): Promise<string | null> {
  const client = getTwilioClient();
  if (!client || process.env.VITEST === "true") {
    return (
      cachedTwimlAppSid ||
      String(process.env.TWILIO_TWIML_APP_SID || "").trim() ||
      null
    );
  }
  const voiceUrl = `${groundworkApiBaseUrl()}/api/voice/twiml`;
  if (!voiceUrl.startsWith("http")) return cachedTwimlAppSid;

  if (!cachedTwimlAppSid) {
    const fromDb = await getSystemSettingValue("twilio_twiml_app_sid");
    if (fromDb && fromDb.startsWith("AP")) cachedTwimlAppSid = fromDb;
  }

  if (cachedTwimlAppSid && !twimlAppVerified) {
    try {
      const app = await client.applications(cachedTwimlAppSid).fetch();
      if (app.voiceUrl !== voiceUrl) {
        await client.applications(cachedTwimlAppSid).update({
          voiceUrl,
          voiceMethod: "POST",
        });
      }
      twimlAppVerified = true;
      return cachedTwimlAppSid;
    } catch {
      cachedTwimlAppSid = null;
    }
  }
  if (cachedTwimlAppSid) return cachedTwimlAppSid;

  const appName = "Groundwork Capital Voice App";
  try {
    const apps = await client.applications.list({ friendlyName: appName, limit: 1 });
    if (apps.length > 0) {
      const existing = apps[0];
      if (existing.voiceUrl !== voiceUrl) {
        await client.applications(existing.sid).update({
          voiceUrl,
          voiceMethod: "POST",
        });
      }
      cachedTwimlAppSid = existing.sid;
      twimlAppVerified = true;
      await upsertSystemSetting("twilio_twiml_app_sid", existing.sid);
      return cachedTwimlAppSid;
    }
    const app = await client.applications.create({
      friendlyName: appName,
      voiceUrl,
      voiceMethod: "POST",
    });
    cachedTwimlAppSid = app.sid;
    twimlAppVerified = true;
    await upsertSystemSetting("twilio_twiml_app_sid", app.sid);
    console.log(`[voice] Created TwiML App ${cachedTwimlAppSid} → ${voiceUrl}`);
    return cachedTwimlAppSid;
  } catch (err) {
    console.error("[voice] Failed to get/create TwiML App:", err);
    return null;
  }
}

async function persistMmsMedia(opts: {
  buffer: Buffer;
  contentType: string;
  filename?: string | null;
  adminId?: number | null;
}): Promise<{ id: string; publicUrl: string; cdnUrl: string }> {
  const id = crypto.randomUUID();
  const ext =
    opts.contentType === "image/png"
      ? "png"
      : opts.contentType === "image/gif"
        ? "gif"
        : opts.contentType === "image/webp"
          ? "webp"
          : opts.contentType.startsWith("video/")
            ? "mp4"
            : opts.contentType.startsWith("audio/")
              ? "mp3"
              : opts.contentType === "application/pdf"
                ? "pdf"
                : "bin";
  const filename = `conversations/mms/${id}.${ext}`;
  const cdnUrl = await storePublicBlobFile(
    filename,
    opts.buffer,
    opts.contentType,
  );
  // Prefer Blob URL in cdn_url; keep a minimal stub in data for NOT NULL legacy rows.
  const stub = Buffer.from(`blob:${cdnUrl}`).subarray(0, 64);
  await pool.query(
    `INSERT INTO mms_media
       (id, content_type, filename, data, cdn_url, created_by_admin_id, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))`,
    [
      id,
      opts.contentType,
      opts.filename || null,
      stub,
      cdnUrl,
      opts.adminId ?? null,
      MMS_RETENTION_DAYS,
    ],
  );
  return { id, publicUrl: cdnUrl, cdnUrl };
}


async function fetchTwilioMediaAsBuffer(
  mediaUrl: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token || !mediaUrl || process.env.VITEST === "true") return null;
  const res = await fetch(mediaUrl, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
    },
    redirect: "follow",
  });
  if (!res.ok) return null;
  const contentType = (
    res.headers.get("content-type") || "application/octet-stream"
  )
    .split(";")[0]
    .trim();
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType };
}

async function ingestInboundTwilioMedia(
  reqBody: Record<string, unknown>,
): Promise<{ mediaUrl: string | null; mediaContentType: string | null }> {
  const numMedia = parseInt(String(reqBody?.NumMedia ?? "0"), 10) || 0;
  if (numMedia <= 0) return { mediaUrl: null, mediaContentType: null };
  const twilioUrl = String(reqBody?.MediaUrl0 || "").trim();
  const twilioType = String(
    reqBody?.MediaContentType0 || "application/octet-stream",
  ).trim();
  if (!twilioUrl) return { mediaUrl: null, mediaContentType: null };
  const fetched = await fetchTwilioMediaAsBuffer(twilioUrl).catch(() => null);
  if (fetched && fetched.buffer.length > 0 && fetched.buffer.length <= MMS_MAX_BYTES) {
    try {
      const stored = await persistMmsMedia({
        buffer: fetched.buffer,
        contentType: fetched.contentType || twilioType,
        filename: `inbound-${Date.now()}`,
      });
      return {
        mediaUrl: stored.cdnUrl,
        mediaContentType: fetched.contentType || twilioType,
      };
    } catch (e: any) {
      console.warn("[mms:inbound]", e?.message || e);
    }
  }
  // Fall back to proxyable Twilio URL
  return { mediaUrl: twilioUrl, mediaContentType: twilioType || null };
}

function isAllowedOutboundMmsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return (
      host === "public.blob.vercel-storage.com" ||
      host.endsWith(".public.blob.vercel-storage.com") ||
      host.endsWith(".blob.vercel-storage.com")
    );
  } catch {
    return false;
  }
}

async function resolveConversationOutboundMedia(
  mediaUrlRaw: string,
): Promise<string | null> {
  const u = String(mediaUrlRaw || "").trim();
  if (!u) return null;
  if (MMS_UUID_RE.test(u)) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT cdn_url FROM mms_media WHERE id = ? AND expires_at > NOW() LIMIT 1`,
      [u],
    );
    if (rows[0]?.cdn_url) return String(rows[0].cdn_url);
    return null;
  }
  if (isAllowedOutboundMmsUrl(u)) return u;
  throw new Error("Unsupported media URL");
}

async function getOrCreateCallConversation(opts: {
  callerPhone: string;
  ofgNumberId: number | null;
  assignedAdminId: number | null;
  reopenIfClosed?: boolean;
}): Promise<{
  conversationId: number;
  clientId: number | null;
  contactId: number | null;
  unknownContactId: number | null;
}> {
  const reopenIfClosed = opts.reopenIfClosed !== false;
  const clientId = await findClientIdByPhone(opts.callerPhone);
  if (clientId) {
    const conversationId = await getOrCreateClientChannelConversation({
      clientId,
      channel: "call",
      ofgNumberId: opts.ofgNumberId,
      assignedAdminId: opts.assignedAdminId,
      reopenIfClosed,
    });
    return {
      conversationId,
      clientId,
      contactId: null,
      unknownContactId: null,
    };
  }
  const crmContactId = await findContactIdByPhone(opts.callerPhone);
  if (crmContactId) {
    const conversationId = await getOrCreateCrmContactChannelConversation({
      crmContactId,
      channel: "call",
      ofgNumberId: opts.ofgNumberId,
      assignedAdminId: opts.assignedAdminId,
      reopenIfClosed,
    });
    return {
      conversationId,
      clientId: null,
      contactId: crmContactId,
      unknownContactId: null,
    };
  }
  if (opts.ofgNumberId == null) {
    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO conversations
         (client_id, channel, status, assigned_admin_id, ofg_number_id)
       VALUES (NULL, 'call', 'open', ?, NULL)`,
      [opts.assignedAdminId],
    );
    return {
      conversationId: Number(ins.insertId),
      clientId: null,
      contactId: null,
      unknownContactId: null,
    };
  }
  const { unknownId } = await findOrCreateOpenUnknownContact({
    phoneRaw: opts.callerPhone,
    ofgNumberId: opts.ofgNumberId,
  });
  const [existing] = await pool.query<RowDataPacket[]>(
    `SELECT id, status FROM conversations
     WHERE unknown_contact_id = ? AND channel = 'call'
     LIMIT 1`,
    [unknownId],
  );
  if (existing[0]) {
    const id = Number(existing[0].id);
    const st = String(existing[0].status || "");
    if (
      st === "snoozed" ||
      ((st === "closed" || st === "archived") && reopenIfClosed)
    ) {
      await pool.query(
        `UPDATE conversations SET status = 'open', updated_at = NOW() WHERE id = ?`,
        [id],
      );
    }
    return {
      conversationId: id,
      clientId: null,
      contactId: null,
      unknownContactId: unknownId,
    };
  }
  await pool.query(
    `INSERT INTO conversations
       (client_id, channel, status, assigned_admin_id, ofg_number_id, unknown_contact_id)
     VALUES (NULL, 'call', 'open', ?, ?, ?)`,
    [opts.assignedAdminId, opts.ofgNumberId, unknownId],
  );
  const [again] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM conversations
     WHERE unknown_contact_id = ? AND channel = 'call'
     ORDER BY id DESC LIMIT 1`,
    [unknownId],
  );
  return {
    conversationId: Number(again[0]?.id || 0),
    clientId: null,
    contactId: null,
    unknownContactId: unknownId,
  };
}

async function insertCallMessage(opts: {
  conversationId: number;
  direction: "inbound" | "outbound";
  body: string;
  fromAddress: string | null;
  toAddress: string | null;
  providerMessageId: string | null;
  providerStatus?: string | null;
  callDurationSec?: number | null;
  recordingUrl?: string | null;
  sentByAdminId?: number | null;
  bumpUnread?: boolean;
  unknownContactId?: number | null;
}): Promise<{ id: number; created: boolean } | null> {
  if (!opts.conversationId) return null;
  if (opts.providerMessageId) {
    const [dup] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM conversation_messages
       WHERE provider_message_id = ? AND channel = 'call' LIMIT 1`,
      [opts.providerMessageId],
    );
    if (dup[0]) {
      if (opts.providerStatus && opts.providerStatus !== "ringing") {
        await pool.query(
          `UPDATE conversation_messages SET provider_status = ? WHERE id = ?`,
          [opts.providerStatus, Number(dup[0].id)],
        );
      }
      if (opts.callDurationSec != null || opts.recordingUrl) {
        await pool.query(
          `UPDATE conversation_messages
           SET call_duration_sec = COALESCE(?, call_duration_sec),
               recording_url = COALESCE(?, recording_url)
           WHERE id = ?`,
          [
            opts.callDurationSec ?? null,
            opts.recordingUrl ?? null,
            Number(dup[0].id),
          ],
        );
      }
      return { id: Number(dup[0].id), created: false };
    }
  }
  const [ins] = await pool.query<ResultSetHeader>(
    `INSERT INTO conversation_messages
       (conversation_id, direction, channel, body, from_address, to_address,
        provider_message_id, provider_status, call_duration_sec, recording_url,
        sent_by_admin_id)
     VALUES (?, ?, 'call', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.conversationId,
      opts.direction,
      opts.body,
      opts.fromAddress,
      opts.toAddress,
      opts.providerMessageId,
      opts.providerStatus ?? null,
      opts.callDurationSec ?? null,
      opts.recordingUrl ?? null,
      opts.sentByAdminId ?? null,
    ],
  );
  const messageId = Number(ins.insertId);
  const preview = opts.body.slice(0, 200);
  if (opts.bumpUnread) {
    await pool.query(
      `UPDATE conversations
       SET last_message_at = NOW(), last_message_preview = ?,
           unread_count = unread_count + 1, status = 'open', updated_at = NOW()
       WHERE id = ?`,
      [preview, opts.conversationId],
    );
  } else {
    await pool.query(
      `UPDATE conversations
       SET last_message_at = NOW(), last_message_preview = ?,
           status = IF(status IN ('closed','archived'), status, 'open'),
           updated_at = NOW()
       WHERE id = ?`,
      [preview, opts.conversationId],
    );
  }
  let unknownId =
    opts.unknownContactId != null ? Number(opts.unknownContactId) : null;
  if (unknownId == null) {
    const [convMeta] = await pool.query<RowDataPacket[]>(
      `SELECT unknown_contact_id FROM conversations WHERE id = ? LIMIT 1`,
      [opts.conversationId],
    );
    unknownId =
      convMeta[0]?.unknown_contact_id != null
        ? Number(convMeta[0].unknown_contact_id)
        : null;
  }
  if (unknownId) {
    if (opts.bumpUnread) {
      await pool.query(
        `UPDATE conversation_unknown_contacts
         SET last_message_at = NOW(), last_message_preview = ?,
             unread_count = unread_count + 1, updated_at = NOW()
         WHERE id = ?`,
        [preview, unknownId],
      );
    } else {
      await pool.query(
        `UPDATE conversation_unknown_contacts
         SET last_message_at = NOW(), last_message_preview = ?, updated_at = NOW()
         WHERE id = ?`,
        [preview, unknownId],
      );
    }
  }
  return { id: messageId, created: true };
}


function registerConversationsRoutes(app: Express) {
  const withAccess = (
    fn: (req: Request, res: Response, adminId: number) => Promise<unknown>,
  ) =>
    route(async (req, res) => {
      const adminId = portalUser(res).id;
      if (!(await requireConversationsAccess(res, adminId))) return;
      await fn(req, res, adminId);
    });

  app.get(
    "/api/admin/conversations/access",
    requireAdmin(),
    route(async (_req, res) => {
      const phones = await listAssignedPhoneNumbers(portalUser(res).id);
      res.json({
        enabled: phones.length > 0,
        numbers: phones.map(mapPhoneNumberRow),
      });
    }),
  );

  app.get(
    "/api/admin/conversations/badge",
    requireAdmin(),
    withAccess(async (_req, res, adminId) => {
      const [clientRows] = await pool.query<RowDataPacket[]>(
        `SELECT COALESCE(SUM(cv.unread_count), 0) AS unread
         FROM conversations cv
         WHERE cv.client_id IS NOT NULL
           AND cv.status = 'open'
           AND (
             cv.assigned_admin_id = ?
             OR (
               cv.assigned_admin_id IS NULL
               AND cv.ofg_number_id IN (
                 SELECT id FROM admin_phone_numbers
                 WHERE assigned_admin_id = ? AND is_active = 1
               )
             )
           )`,
        [adminId, adminId],
      );
      const [unknownRows] = await pool.query<RowDataPacket[]>(
        `SELECT COALESCE(SUM(u.unread_count), 0) AS unread
         FROM conversation_unknown_contacts u
         WHERE u.status = 'open'
           AND u.ofg_number_id IN (
             SELECT id FROM admin_phone_numbers
             WHERE assigned_admin_id = ? AND is_active = 1
           )
           AND EXISTS (
             SELECT 1 FROM conversations cvu
             WHERE cvu.unknown_contact_id = u.id AND cvu.status = 'open'
           )`,
        [adminId],
      );
      const [crmRows] = await pool.query<RowDataPacket[]>(
        `SELECT COALESCE(SUM(cv.unread_count), 0) AS unread
         FROM conversations cv
         WHERE cv.contact_id IS NOT NULL AND cv.status = 'open'
           AND (
             cv.assigned_admin_id = ?
             OR cv.ofg_number_id IN (
               SELECT id FROM admin_phone_numbers
               WHERE assigned_admin_id = ? AND is_active = 1
             )
           )`,
        [adminId, adminId],
      );
      res.json({
        unread_total:
          Number(clientRows[0]?.unread || 0) +
          Number(unknownRows[0]?.unread || 0) +
          Number(crmRows[0]?.unread || 0),
      });
    }),
  );

  app.get(
    "/api/admin/conversations/ably-token",
    requireAdmin(),
    withAccess(async (_req, res, adminId) => {
      if (ablyKeyRejected) {
        return res.status(503).json({ error: "ably_not_configured" });
      }
      try {
        const tokenRequest = await mintAdminAblyTokenRequest(adminId);
        if (!tokenRequest) {
          return res.status(503).json({ error: "ably_not_configured" });
        }
        res.json({ tokenRequest });
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        console.error("[ably:token]", msg);
        if (/invalid key/i.test(msg)) {
          ablyKeyRejected = true;
          return res.status(503).json({ error: "ably_not_configured" });
        }
        res.status(500).json({ error: "ably_token_failed" });
      }
    }),
  );

  app.get(
    "/api/admin/conversations",
    requireAdmin(),
    withAccess(async (req, res, adminId) => {
      const view = String(req.query.view || "all");
      const q = String(req.query.q || "")
        .trim()
        .slice(0, 120);
      const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
      const limit = Math.min(
        100,
        Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50),
      );
      const offset = (page - 1) * limit;
      const ofgIds = await adminAssignedPhoneNumberIds(adminId);
      const clientScope = adminClientConversationScopeSql("cv", adminId, ofgIds);
      const like = q ? likeParam(q) : null;

      /** Shared hub row shape for UNION ALL (client | contact | unknown). */
      const unionParts: string[] = [];
      const unionArgs: any[] = [];

      if (view !== "unknown") {
        const where = ["cv.client_id IS NOT NULL", clientScope.sql];
        const args: any[] = [...clientScope.params];
        if (view === "mine") {
          where.push("cv.assigned_admin_id = ?");
          where.push("cv.status NOT IN ('closed','archived')");
          args.push(adminId);
        } else if (view === "unassigned") {
          where.push("cv.assigned_admin_id IS NULL");
          where.push("cv.status = 'open'");
        } else if (view === "open") {
          where.push("cv.status = 'open'");
        } else if (view === "closed") {
          where.push("cv.status IN ('closed','archived')");
        } else if (view === "unread") {
          where.push("cv.unread_count > 0");
          where.push("cv.status NOT IN ('closed','archived')");
        } else {
          where.push("cv.status NOT IN ('closed','archived')");
        }
        if (like) {
          where.push(
            `(c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR cv.last_message_preview LIKE ?)`,
          );
          args.push(like, like, like, like, like);
        }
        unionParts.push(`
          SELECT
            'client' AS kind,
            c.id AS contact_id,
            c.id AS client_id,
            NULL AS crm_contact_id,
            NULL AS unknown_contact_id,
            CONCAT(c.first_name,' ',c.last_name) AS display_name,
            c.phone AS phone,
            c.email AS email,
            MAX(cv.last_message_at) AS last_message_at,
            SUBSTRING_INDEX(GROUP_CONCAT(cv.last_message_preview ORDER BY cv.last_message_at DESC SEPARATOR '\n'), '\n', 1) AS last_message_preview,
            SUM(cv.unread_count) AS unread_count,
            SUBSTRING_INDEX(GROUP_CONCAT(cv.status ORDER BY cv.last_message_at DESC), ',', 1) AS status,
            NULLIF(SUBSTRING_INDEX(GROUP_CONCAT(IFNULL(cv.assigned_admin_id,'') ORDER BY cv.last_message_at DESC), ',', 1), '') AS assigned_admin_id,
            CAST(SUBSTRING_INDEX(GROUP_CONCAT(cv.id ORDER BY cv.last_message_at DESC), ',', 1) AS UNSIGNED) AS primary_conversation_id,
            c.status AS client_status
          FROM conversations cv
          JOIN clients c ON c.id = cv.client_id
          WHERE ${where.join(" AND ")}
          GROUP BY c.id, c.first_name, c.last_name, c.phone, c.email, c.status
        `);
        unionArgs.push(...args);

        if (
          ofgIds.length &&
          view !== "closed" &&
          ["all", "open", "unread", "mine", "unassigned"].includes(view)
        ) {
          const crmWhere = [
            "cv.contact_id IS NOT NULL",
            "ct.deleted_at IS NULL",
            `(cv.assigned_admin_id = ? OR cv.ofg_number_id IN (${ofgIds.map(() => "?").join(",")}))`,
            "cv.status NOT IN ('closed','archived')",
          ];
          const crmArgs: any[] = [adminId, ...ofgIds];
          if (view === "mine") {
            crmWhere.push("cv.assigned_admin_id = ?");
            crmArgs.push(adminId);
          } else if (view === "unassigned") {
            crmWhere.push("cv.assigned_admin_id IS NULL");
          } else if (view === "unread") {
            crmWhere.push("cv.unread_count > 0");
          }
          if (like) {
            crmWhere.push(
              `(ct.first_name LIKE ? OR ct.last_name LIKE ? OR ct.email LIKE ? OR ct.phone LIKE ? OR cv.last_message_preview LIKE ?)`,
            );
            crmArgs.push(like, like, like, like, like);
          }
          unionParts.push(`
            SELECT
              'contact' AS kind,
              ct.id AS contact_id,
              NULL AS client_id,
              ct.id AS crm_contact_id,
              NULL AS unknown_contact_id,
              CONCAT(ct.first_name,' ',ct.last_name) AS display_name,
              ct.phone AS phone,
              ct.email AS email,
              MAX(cv.last_message_at) AS last_message_at,
              SUBSTRING_INDEX(GROUP_CONCAT(cv.last_message_preview ORDER BY cv.last_message_at DESC SEPARATOR '\n'), '\n', 1) AS last_message_preview,
              SUM(cv.unread_count) AS unread_count,
              SUBSTRING_INDEX(GROUP_CONCAT(cv.status ORDER BY cv.last_message_at DESC), ',', 1) AS status,
              NULLIF(SUBSTRING_INDEX(GROUP_CONCAT(IFNULL(cv.assigned_admin_id,'') ORDER BY cv.last_message_at DESC), ',', 1), '') AS assigned_admin_id,
              CAST(SUBSTRING_INDEX(GROUP_CONCAT(cv.id ORDER BY cv.last_message_at DESC), ',', 1) AS UNSIGNED) AS primary_conversation_id,
              NULL AS client_status
            FROM conversations cv
            JOIN contacts ct ON ct.id = cv.contact_id
            WHERE ${crmWhere.join(" AND ")}
            GROUP BY ct.id, ct.first_name, ct.last_name, ct.phone, ct.email
          `);
          unionArgs.push(...crmArgs);
        }
      }

      if (
        ofgIds.length &&
        ["all", "unknown", "unread", "unassigned", "open", "mine", "closed"].includes(
          view,
        )
      ) {
        const unkWhere: string[] = [
          `u.status = 'open'`,
          `u.ofg_number_id IN (${ofgIds.map(() => "?").join(",")})`,
        ];
        const unkArgs: any[] = [...ofgIds];
        if (view === "closed") {
          unkWhere.push(
            `EXISTS (
               SELECT 1 FROM conversations cvu
               WHERE cvu.unknown_contact_id = u.id
                 AND cvu.status IN ('closed','archived')
             )`,
          );
        } else if (view === "unread") {
          unkWhere.push(`u.unread_count > 0`);
          unkWhere.push(
            `EXISTS (
               SELECT 1 FROM conversations cvu
               WHERE cvu.unknown_contact_id = u.id AND cvu.status = 'open'
             )`,
          );
        } else if (view === "mine") {
          unkWhere.push(
            `EXISTS (
               SELECT 1 FROM conversations cvu
               WHERE cvu.unknown_contact_id = u.id
                 AND cvu.assigned_admin_id = ?
                 AND cvu.status NOT IN ('closed','archived')
             )`,
          );
          unkArgs.push(adminId);
        } else {
          unkWhere.push(
            `EXISTS (
               SELECT 1 FROM conversations cvu
               WHERE cvu.unknown_contact_id = u.id
                 AND cvu.status NOT IN ('closed','archived')
             )`,
          );
        }
        if (like) {
          unkWhere.push(
            `(u.display_name LIKE ? OR u.phone_e164 LIKE ? OR u.email LIKE ? OR u.last_message_preview LIKE ?)`,
          );
          unkArgs.push(like, like, like, like);
        }
        unionParts.push(`
          SELECT
            'unknown' AS kind,
            u.id AS contact_id,
            NULL AS client_id,
            NULL AS crm_contact_id,
            u.id AS unknown_contact_id,
            COALESCE(NULLIF(u.display_name,''), u.phone_e164, 'Unknown') AS display_name,
            u.phone_e164 AS phone,
            u.email AS email,
            u.last_message_at AS last_message_at,
            u.last_message_preview AS last_message_preview,
            u.unread_count AS unread_count,
            'open' AS status,
            (SELECT cv.assigned_admin_id FROM conversations cv
             WHERE cv.unknown_contact_id = u.id
             ORDER BY cv.last_message_at DESC, cv.id DESC LIMIT 1) AS assigned_admin_id,
            (SELECT cv.id FROM conversations cv
             WHERE cv.unknown_contact_id = u.id
             ORDER BY cv.last_message_at DESC, cv.id DESC LIMIT 1) AS primary_conversation_id,
            NULL AS client_status
          FROM conversation_unknown_contacts u
          WHERE ${unkWhere.join(" AND ")}
        `);
        unionArgs.push(...unkArgs);
      }

      if (!unionParts.length) {
        return res.json({
          contacts: [],
          pagination: { page, limit, total: 0, totalPages: 1 },
        });
      }

      const hubSql = unionParts.join("\nUNION ALL\n");
      const [countRows] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM (${hubSql}) AS hub`,
        unionArgs,
      );
      const total = Number(countRows[0]?.total || 0);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM (${hubSql}) AS hub
         ORDER BY last_message_at DESC
         LIMIT ? OFFSET ?`,
        [...unionArgs, limit, offset],
      );

      const contacts = rows.map((r) => {
        const kind = String(r.kind || "client") as
          | "client"
          | "contact"
          | "unknown";
        const contactId = Number(r.contact_id);
        const base = {
          kind,
          contact_id: contactId,
          display_name: String(r.display_name || "").trim() ||
            (kind === "unknown" ? "Unknown" : kind === "contact" ? "Contact" : "Client"),
          phone: r.phone ?? null,
          email: r.email ?? null,
          last_message_at: isoDate(r.last_message_at),
          last_message_preview: r.last_message_preview ?? null,
          unread_count: Number(r.unread_count || 0),
          status: String(r.status || "open"),
          assigned_admin_id: r.assigned_admin_id
            ? Number(r.assigned_admin_id)
            : null,
          primary_conversation_id: r.primary_conversation_id
            ? Number(r.primary_conversation_id)
            : null,
        };
        if (kind === "client") {
          return {
            ...base,
            client_id: Number(r.client_id || contactId),
            client_status: r.client_status ?? null,
          };
        }
        if (kind === "contact") {
          return {
            ...base,
            crm_contact_id: Number(r.crm_contact_id || contactId),
          };
        }
        return {
          ...base,
          unknown_contact_id: Number(r.unknown_contact_id || contactId),
        };
      });

      res.json({
        contacts,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit) || 1),
        },
      });
    }),
  );

  app.post(
    "/api/admin/conversations/send",
    requireAdmin(),
    withAccess(async (req, res, adminId) => {
      const {
        client_id,
        unknown_contact_id,
        contact_id,
        channel,
        body,
        is_internal_note,
        ofg_number_id,
        media_url,
        media_content_type,
      } = req.body || {};
      const mediaUrlRaw =
        media_url != null && String(media_url).trim()
          ? String(media_url).trim()
          : null;
      const textBody = body != null ? String(body) : "";
      const hasClient = client_id != null && Number(client_id) > 0;
      const hasUnknown =
        unknown_contact_id != null && Number(unknown_contact_id) > 0;
      const hasCrm = contact_id != null && Number(contact_id) > 0;
      if (
        [hasClient, hasUnknown, hasCrm].filter(Boolean).length !== 1 ||
        (!textBody.trim() && !mediaUrlRaw)
      ) {
        throw new HttpError(400, "validation.invalidField");
      }
      try {
        const mediaUrl = mediaUrlRaw
          ? await resolveConversationOutboundMedia(mediaUrlRaw)
          : null;
        const result = await deliverHubConversationMessage({
          adminId,
          clientId: hasClient ? Number(client_id) : undefined,
          unknownContactId: hasUnknown ? Number(unknown_contact_id) : undefined,
          crmContactId: hasCrm ? Number(contact_id) : undefined,
          channel: String(channel || "sms"),
          textBody,
          isInternalNote: !!is_internal_note,
          ofgNumberId:
            ofg_number_id != null ? Number(ofg_number_id) : undefined,
          mediaUrl,
          mediaContentType: media_content_type
            ? String(media_content_type)
            : null,
        });
        res.json(result);
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (/not found/i.test(msg)) throw new HttpError(404, "errors.notFound");
        if (
          /required|Unsupported|exceeds|Internal notes|not assigned|inactive/i.test(
            msg,
          )
        ) {
          throw new HttpError(400, "validation.invalidField");
        }
        console.error("[conversations:send]", msg);
        throw new HttpError(500, "errors.server");
      }
    }),
  );

  app.post(
    "/api/admin/conversations/start",
    requireAdmin(),
    withAccess(async (req, res, adminId) => {
      const phoneRaw = String(req.body?.phone || "").trim();
      const textBody = req.body?.body != null ? String(req.body.body) : "";
      const ofg_number_id = req.body?.ofg_number_id;
      const mediaUrlRaw =
        req.body?.media_url != null && String(req.body.media_url).trim()
          ? String(req.body.media_url).trim()
          : null;
      if (!phoneRaw) throw new HttpError(400, "validation.phoneMin");
      if (!textBody.trim() && !mediaUrlRaw) {
        throw new HttpError(400, "validation.invalidField");
      }
      if (!normalizePhoneLast10(phoneRaw)) {
        throw new HttpError(400, "validation.phoneMin");
      }
      const assigned = await listAssignedPhoneNumbers(adminId);
      const ofgNumberId =
        ofg_number_id != null
          ? Number(ofg_number_id)
          : assigned[0]
            ? Number(assigned[0].id)
            : null;
      if (
        !ofgNumberId ||
        !assigned.some((n) => Number(n.id) === ofgNumberId)
      ) {
        throw new HttpError(400, "validation.invalidField");
      }
      const mediaUrl = mediaUrlRaw
        ? await resolveConversationOutboundMedia(mediaUrlRaw)
        : null;
      const mediaContentType = req.body?.media_content_type
        ? String(req.body.media_content_type)
        : null;
      try {
        const existingClientId = await findClientIdByPhone(phoneRaw);
        if (existingClientId) {
          const result = await deliverHubConversationMessage({
            adminId,
            clientId: existingClientId,
            channel: "sms",
            textBody,
            ofgNumberId,
            mediaUrl,
            mediaContentType,
          });
          return res.json({ kind: "client", ...result });
        }
        const existingContactId = await findContactIdByPhone(phoneRaw);
        if (existingContactId) {
          const result = await deliverHubConversationMessage({
            adminId,
            crmContactId: existingContactId,
            channel: "sms",
            textBody,
            ofgNumberId,
            mediaUrl,
            mediaContentType,
          });
          return res.json({ kind: "contact", ...result });
        }
        const { unknownId, created, phoneE164 } =
          await findOrCreateOpenUnknownContact({
            phoneRaw,
            ofgNumberId,
          });
        const result = await deliverHubConversationMessage({
          adminId,
          unknownContactId: unknownId,
          channel: "sms",
          textBody,
          ofgNumberId,
          mediaUrl,
          mediaContentType,
        });
        return res.json({
          kind: "unknown",
          unknown_created: created,
          phone: phoneE164,
          ...result,
        });
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (/not found/i.test(msg)) throw new HttpError(404, "errors.notFound");
        console.error("[conversations:start]", msg);
        throw new HttpError(500, "errors.server");
      }
    }),
  );

  app.post(
    "/api/admin/conversations/contact/:kind/:id/read",
    requireAdmin(),
    withAccess(async (req, res, adminId) => {
      const kind = String(req.params.kind);
      const id = parseId(req.params.id);
      if (kind === "unknown") {
        if (!(await adminCanAccessUnknownContact(adminId, id))) {
          throw new HttpError(404, "errors.notFound");
        }
        await pool.query(
          `UPDATE conversation_unknown_contacts SET unread_count = 0 WHERE id = ?`,
          [id],
        );
        await pool.query(
          `UPDATE conversations SET unread_count = 0 WHERE unknown_contact_id = ?`,
          [id],
        );
      } else if (kind === "contact") {
        await pool.query(
          `UPDATE conversations SET unread_count = 0 WHERE contact_id = ?`,
          [id],
        );
      } else if (kind === "client") {
        if (!(await adminCanAccessClientConversations(adminId, id))) {
          throw new HttpError(404, "errors.notFound");
        }
        await pool.query(
          `UPDATE conversations SET unread_count = 0 WHERE client_id = ?`,
          [id],
        );
      } else {
        throw new HttpError(400, "validation.invalidField");
      }
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/admin/conversations/contact/:kind/:id/status",
    requireAdmin(),
    withAccess(async (req, res, adminId) => {
      const kind = String(req.params.kind);
      const id = parseId(req.params.id);
      const status = String(req.body?.status || "").trim();
      if (!["open", "closed"].includes(status)) {
        throw new HttpError(400, "validation.invalidField");
      }
      if (kind === "client") {
        if (!(await adminCanMutateClientConversations(adminId, id))) {
          throw new HttpError(404, "errors.notFound");
        }
        const result = await setContactConversationStatus({
          clientId: id,
          status: status as "open" | "closed",
          adminId,
        });
        return res.json({ ok: true, ...result });
      }
      if (kind === "unknown") {
        if (!(await adminCanAccessUnknownContact(adminId, id))) {
          throw new HttpError(404, "errors.notFound");
        }
        const result = await setContactConversationStatus({
          unknownContactId: id,
          status: status as "open" | "closed",
          adminId,
        });
        return res.json({ ok: true, ...result });
      }
      if (kind === "contact") {
        const result = await setContactConversationStatus({
          crmContactId: id,
          status: status as "open" | "closed",
          adminId,
        });
        return res.json({ ok: true, ...result });
      }
      throw new HttpError(400, "validation.invalidField");
    }),
  );

  app.get(
    "/api/admin/conversations/contact/:kind/:id/timeline",
    requireAdmin(),
    withAccess(async (req, res, adminId) => {
      const kind = String(req.params.kind);
      const id = parseId(req.params.id);
      if (kind === "unknown") {
        if (!(await adminCanAccessUnknownContact(adminId, id))) {
          throw new HttpError(404, "errors.notFound");
        }
        const [urows] = await pool.query<RowDataPacket[]>(
          `SELECT * FROM conversation_unknown_contacts WHERE id = ? LIMIT 1`,
          [id],
        );
        if (!urows[0]) throw new HttpError(404, "errors.notFound");
        const [convRows] = await pool.query<RowDataPacket[]>(
          `SELECT id, channel, status, assigned_admin_id, ofg_number_id, unread_count, last_message_at
           FROM conversations WHERE unknown_contact_id = ? ORDER BY last_message_at DESC`,
          [id],
        );
        const convIds = convRows.map((c) => Number(c.id));
        let messages: RowDataPacket[] = [];
        if (convIds.length) {
          const [m] = await pool.query<RowDataPacket[]>(
            `SELECT m.*, CONCAT(a.first_name,' ',a.last_name) AS sent_by_admin_name
             FROM conversation_messages m
             LEFT JOIN admins a ON a.id = m.sent_by_admin_id
             WHERE m.conversation_id IN (${convIds.map(() => "?").join(",")})
             ORDER BY m.id ASC LIMIT 500`,
            convIds,
          );
          messages = m;
        }
        await pool.query(
          `UPDATE conversation_unknown_contacts SET unread_count = 0 WHERE id = ?`,
          [id],
        );
        await pool.query(
          `UPDATE conversations SET unread_count = 0 WHERE unknown_contact_id = ?`,
          [id],
        );
        return res.json({
          kind: "unknown",
          contact: urows[0],
          threads: convRows,
          messages,
        });
      }
      if (kind === "contact") {
        const [crows] = await pool.query<RowDataPacket[]>(
          `SELECT * FROM contacts WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
          [id],
        );
        if (!crows[0]) throw new HttpError(404, "errors.notFound");
        const [convRows] = await pool.query<RowDataPacket[]>(
          `SELECT id, channel, status, assigned_admin_id, ofg_number_id, unread_count, last_message_at
           FROM conversations WHERE contact_id = ? ORDER BY last_message_at DESC`,
          [id],
        );
        const convIds = convRows.map((c) => Number(c.id));
        let messages: RowDataPacket[] = [];
        if (convIds.length) {
          const [m] = await pool.query<RowDataPacket[]>(
            `SELECT m.*, CONCAT(a.first_name,' ',a.last_name) AS sent_by_admin_name
             FROM conversation_messages m
             LEFT JOIN admins a ON a.id = m.sent_by_admin_id
             WHERE m.conversation_id IN (${convIds.map(() => "?").join(",")})
             ORDER BY m.id ASC LIMIT 500`,
            convIds,
          );
          messages = m;
          await pool.query(
            `UPDATE conversations SET unread_count = 0 WHERE contact_id = ?`,
            [id],
          );
        }
        return res.json({
          kind: "contact",
          contact: mapCrmContactRow(crows[0]),
          threads: convRows,
          messages,
        });
      }
      if (kind !== "client") throw new HttpError(400, "validation.invalidField");
      if (!(await adminCanAccessClientConversations(adminId, id))) {
        throw new HttpError(404, "errors.notFound");
      }
      const [crows] = await pool.query<RowDataPacket[]>(
        `SELECT id, first_name, last_name, email, phone, status, preferred_language
         FROM clients WHERE id = ? LIMIT 1`,
        [id],
      );
      if (!crows[0]) throw new HttpError(404, "errors.notFound");
      const ofgIds = await adminAssignedPhoneNumberIds(adminId);
      const scope = adminClientConversationScopeSql("cv", adminId, ofgIds);
      const [threads] = await pool.query<RowDataPacket[]>(
        `SELECT cv.id, cv.channel, cv.status, cv.assigned_admin_id, cv.ofg_number_id,
                cv.unread_count, cv.last_message_at
         FROM conversations cv
         WHERE cv.client_id = ? AND ${scope.sql}
         ORDER BY cv.last_message_at DESC`,
        [id, ...scope.params],
      );
      const convIds = threads.map((t) => Number(t.id));
      let messages: RowDataPacket[] = [];
      if (convIds.length) {
        const [m] = await pool.query<RowDataPacket[]>(
          `SELECT m.*, CONCAT(a.first_name,' ',a.last_name) AS sent_by_admin_name
           FROM conversation_messages m
           LEFT JOIN admins a ON a.id = m.sent_by_admin_id
           WHERE m.conversation_id IN (${convIds.map(() => "?").join(",")})
           ORDER BY m.id ASC LIMIT 500`,
          convIds,
        );
        messages = m;
        await pool.query(
          `UPDATE conversations SET unread_count = 0 WHERE client_id = ? AND id IN (${convIds.map(() => "?").join(",")})`,
          [id, ...convIds],
        );
      }
      res.json({ kind: "client", contact: crows[0], threads, messages });
    }),
  );

  // ── Conversation templates (SMS library) ──────────────────────────────────
  function mapConversationTemplateRow(r: RowDataPacket) {
    return {
      id: Number(r.id),
      title: String(r.title || ""),
      body_en: String(r.body_en || ""),
      body_es: r.body_es != null ? String(r.body_es) : null,
      is_active: Number(r.is_active) === 1,
      sort_order: Number(r.sort_order || 0),
      created_by_admin_id:
        r.created_by_admin_id != null ? Number(r.created_by_admin_id) : null,
      created_at: isoDate(r.created_at),
      updated_at: isoDate(r.updated_at),
    };
  }

  app.get(
    "/api/admin/conversation-templates",
    requireAdmin(),
    route(async (req, res) => {
      const includeInactive = String(req.query.all || "") === "1";
      const [rows] = await pool.query<RowDataPacket[]>(
        includeInactive
          ? `SELECT * FROM conversation_templates ORDER BY sort_order ASC, id ASC`
          : `SELECT * FROM conversation_templates
             WHERE is_active = 1 ORDER BY sort_order ASC, id ASC`,
      );
      res.json({ templates: rows.map(mapConversationTemplateRow) });
    }),
  );

  app.post(
    "/api/admin/conversation-templates",
    requireAdmin("people.write"),
    route(async (req, res) => {
      const me = portalUser(res);
      const role = String(me.role || "");
      if (role !== "super_admin" && role !== "admin") {
        throw new HttpError(403, "errors.forbidden");
      }
      const title = String(req.body?.title || "").trim().slice(0, 120);
      const bodyEn = decodeLiteralUnicodeEscapes(
        String(req.body?.body_en || ""),
      ).trim();
      const bodyEsRaw = decodeLiteralUnicodeEscapes(
        String(req.body?.body_es || ""),
      ).trim();
      if (!title || !bodyEn) throw new HttpError(400, "validation.invalidField");
      const [ins] = await pool.query<ResultSetHeader>(
        `INSERT INTO conversation_templates
           (title, body_en, body_es, is_active, sort_order, created_by_admin_id)
         VALUES (?, ?, ?, 1, ?, ?)`,
        [
          title,
          bodyEn,
          bodyEsRaw || null,
          Number(req.body?.sort_order) || 0,
          me.id,
        ],
      );
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM conversation_templates WHERE id = ? LIMIT 1`,
        [ins.insertId],
      );
      res.status(201).json({ template: mapConversationTemplateRow(rows[0]) });
    }),
  );

  app.patch(
    "/api/admin/conversation-templates/:id",
    requireAdmin("people.write"),
    route(async (req, res) => {
      const me = portalUser(res);
      const role = String(me.role || "");
      if (role !== "super_admin" && role !== "admin") {
        throw new HttpError(403, "errors.forbidden");
      }
      const id = parseId(req.params.id);
      const [existing] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM conversation_templates WHERE id = ? LIMIT 1`,
        [id],
      );
      if (!existing[0]) throw new HttpError(404, "errors.notFound");
      const sets: string[] = [];
      const args: any[] = [];
      if (req.body?.title !== undefined) {
        const title = String(req.body.title || "").trim().slice(0, 120);
        if (!title) throw new HttpError(400, "validation.invalidField");
        sets.push("title = ?");
        args.push(title);
      }
      if (req.body?.body_en !== undefined) {
        const bodyEn = decodeLiteralUnicodeEscapes(
          String(req.body.body_en || ""),
        ).trim();
        if (!bodyEn) throw new HttpError(400, "validation.invalidField");
        sets.push("body_en = ?");
        args.push(bodyEn);
      }
      if (req.body?.body_es !== undefined) {
        const bodyEs = decodeLiteralUnicodeEscapes(
          String(req.body.body_es || ""),
        ).trim();
        sets.push("body_es = ?");
        args.push(bodyEs || null);
      }
      if (req.body?.is_active !== undefined) {
        sets.push("is_active = ?");
        args.push(
          req.body.is_active === true ||
            req.body.is_active === 1 ||
            req.body.is_active === "1"
            ? 1
            : 0,
        );
      }
      if (req.body?.sort_order !== undefined) {
        sets.push("sort_order = ?");
        args.push(Number(req.body.sort_order) || 0);
      }
      if (!sets.length) throw new HttpError(400, "validation.invalidField");
      args.push(id);
      await pool.query(
        `UPDATE conversation_templates SET ${sets.join(", ")} WHERE id = ?`,
        args,
      );
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM conversation_templates WHERE id = ? LIMIT 1`,
        [id],
      );
      res.json({ template: mapConversationTemplateRow(rows[0]) });
    }),
  );

  app.delete(
    "/api/admin/conversation-templates/:id",
    requireAdmin("people.write"),
    route(async (req, res) => {
      const me = portalUser(res);
      const role = String(me.role || "");
      if (role !== "super_admin" && role !== "admin") {
        throw new HttpError(403, "errors.forbidden");
      }
      const id = parseId(req.params.id);
      const [r] = await pool.query<ResultSetHeader>(
        `DELETE FROM conversation_templates WHERE id = ?`,
        [id],
      );
      if (!r.affectedRows) throw new HttpError(404, "errors.notFound");
      res.json({ ok: true });
    }),
  );

  // ── CRM Contacts ──────────────────────────────────────────────────────────
  app.get(
    "/api/admin/contacts",
    requireAdmin("people.read"),
    route(async (req, res) => {
      const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
      const limit = Math.min(
        100,
        Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50),
      );
      const offset = (page - 1) * limit;
      const search = String(req.query.search || "").trim().slice(0, 120);
      const where = ["c.deleted_at IS NULL", "c.converted_client_id IS NULL"];
      const args: any[] = [];
      if (search) {
        const like = `%${search.replace(/[%_]/g, "\\$&")}%`;
        where.push(
          `(c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)`,
        );
        args.push(like, like, like, like);
      }
      const whereClause = `WHERE ${where.join(" AND ")}`;
      const [countRow] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM contacts c ${whereClause}`,
        args,
      );
      const total = Number(countRow[0]?.total ?? 0);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT c.* FROM contacts c ${whereClause}
         ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`,
        [...args, limit, offset],
      );
      res.json({
        contacts: rows.map(mapCrmContactRow),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      });
    }),
  );

  app.get(
    "/api/admin/contacts/:id",
    requireAdmin("people.read"),
    route(async (req, res) => {
      const id = parseId(req.params.id);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM contacts WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
        [id],
      );
      if (!rows[0]) throw new HttpError(404, "errors.notFound");
      res.json({ contact: mapCrmContactRow(rows[0]) });
    }),
  );

  app.post(
    "/api/admin/contacts",
    requireAdmin("people.write"),
    route(async (req, res) => {
      const me = portalUser(res);
      const first = String(req.body?.first_name || "").trim();
      const last = String(req.body?.last_name || "").trim();
      if (!first || !last) throw new HttpError(400, "validation.invalidField");
      const emailRaw = normalizeEmail(req.body?.email);
      const email = emailRaw || null;
      let phone: string | null = String(req.body?.phone || "").trim() || null;
      if (!email && !phone) throw new HttpError(400, "validation.invalidField");
      if (email && !isValidEmail(email)) {
        throw new HttpError(400, "validation.emailInvalid");
      }
      if (phone) {
        if (!normalizePhoneLast10(phone)) {
          throw new HttpError(400, "validation.phoneMin");
        }
        phone = toSmsE164(phone).slice(0, 20);
      }
      const lang = req.body?.preferred_language === "es" ? "es" : "en";
      const [ins] = await pool.query<ResultSetHeader>(
        `INSERT INTO contacts
           (first_name, last_name, email, phone, address_line1, address_line2,
            city, state, zip, preferred_language, admin_notes,
            assigned_admin_id, created_by_admin_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          first,
          last,
          email,
          phone,
          String(req.body?.address_line1 || "").trim() || null,
          String(req.body?.address_line2 || "").trim() || null,
          String(req.body?.city || "").trim() || null,
          String(req.body?.state || "").trim() || null,
          String(req.body?.zip || "").trim() || null,
          lang,
          String(req.body?.admin_notes || "").trim() || null,
          me.id,
          me.id,
        ],
      );
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM contacts WHERE id = ? LIMIT 1`,
        [ins.insertId],
      );
      res.status(201).json({ contact: mapCrmContactRow(rows[0]) });
    }),
  );

  app.put(
    "/api/admin/contacts/:id",
    requireAdmin("people.write"),
    route(async (req, res) => {
      const id = parseId(req.params.id);
      const [existing] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM contacts
         WHERE id = ? AND deleted_at IS NULL AND converted_client_id IS NULL
         LIMIT 1`,
        [id],
      );
      if (!existing[0]) throw new HttpError(404, "errors.notFound");
      const first =
        req.body?.first_name != null
          ? String(req.body.first_name).trim()
          : String(existing[0].first_name);
      const last =
        req.body?.last_name != null
          ? String(req.body.last_name).trim()
          : String(existing[0].last_name);
      if (!first || !last) throw new HttpError(400, "validation.invalidField");
      const email =
        req.body?.email !== undefined
          ? normalizeEmail(req.body.email) || null
          : existing[0].email
            ? String(existing[0].email)
            : null;
      let phone: string | null =
        req.body?.phone !== undefined
          ? String(req.body.phone || "").trim() || null
          : existing[0].phone
            ? String(existing[0].phone)
            : null;
      if (!email && !phone) throw new HttpError(400, "validation.invalidField");
      if (email && !isValidEmail(email)) {
        throw new HttpError(400, "validation.emailInvalid");
      }
      if (phone && req.body?.phone !== undefined) {
        if (!normalizePhoneLast10(phone)) {
          throw new HttpError(400, "validation.phoneMin");
        }
        phone = toSmsE164(phone).slice(0, 20);
      }
      const lang =
        req.body?.preferred_language === "es"
          ? "es"
          : req.body?.preferred_language === "en"
            ? "en"
            : existing[0].preferred_language === "es"
              ? "es"
              : "en";
      await pool.query(
        `UPDATE contacts SET
           first_name = ?, last_name = ?, email = ?, phone = ?,
           address_line1 = ?, address_line2 = ?, city = ?, state = ?, zip = ?,
           preferred_language = ?, admin_notes = ?
         WHERE id = ?`,
        [
          first,
          last,
          email,
          phone,
          req.body?.address_line1 !== undefined
            ? String(req.body.address_line1 || "").trim() || null
            : existing[0].address_line1,
          req.body?.address_line2 !== undefined
            ? String(req.body.address_line2 || "").trim() || null
            : existing[0].address_line2,
          req.body?.city !== undefined
            ? String(req.body.city || "").trim() || null
            : existing[0].city,
          req.body?.state !== undefined
            ? String(req.body.state || "").trim() || null
            : existing[0].state,
          req.body?.zip !== undefined
            ? String(req.body.zip || "").trim() || null
            : existing[0].zip,
          lang,
          req.body?.admin_notes !== undefined
            ? String(req.body.admin_notes || "").trim() || null
            : existing[0].admin_notes,
          id,
        ],
      );
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM contacts WHERE id = ? LIMIT 1`,
        [id],
      );
      res.json({ contact: mapCrmContactRow(rows[0]) });
    }),
  );

  app.delete(
    "/api/admin/contacts/:id",
    requireAdmin("people.write"),
    route(async (req, res) => {
      const id = parseId(req.params.id);
      const [r] = await pool.query<ResultSetHeader>(
        `UPDATE contacts SET deleted_at = NOW()
         WHERE id = ? AND deleted_at IS NULL`,
        [id],
      );
      if (!r.affectedRows) throw new HttpError(404, "errors.notFound");
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/admin/contacts/:id/convert",
    requireAdmin("people.write"),
    route(async (req, res) => {
      const me = portalUser(res);
      const id = parseId(req.params.id);
      const result = await convertCrmContactToClient({
        contactId: id,
        ownerAdminId: me.id,
        sharedPhoneReason: req.body?.shared_phone_reason,
      });
      if (result.ok === false) {
        if (result.error.startsWith("errors.person")) {
          throw new HttpError(409, result.error, {
            match: result.match,
            can_override: result.can_override,
          });
        }
        if (/not found/i.test(result.error)) {
          throw new HttpError(404, "errors.notFound");
        }
        if (/phone or email|invalid/i.test(result.error)) {
          throw new HttpError(400, "validation.invalidField");
        }
        throw new HttpError(400, "validation.invalidField");
      }
      res.json({
        ok: true,
        existing: result.existing || undefined,
        linked_existing: result.linked_existing || undefined,
        contact_id: result.contact_id,
        client_id: result.client_id,
        preferred_language: result.preferred_language,
      });
    }),
  );

  // ── Phone numbers (People assign + Twilio sync) ───────────────────────────
  app.get(
    "/api/admin/phone-numbers",
    requireAdmin(),
    route(async (_req, res) => {
      const me = portalUser(res);
      const role = String(me.role || "");
      if (role === "super_admin" || role === "admin") {
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT n.*, CONCAT(a.first_name,' ',a.last_name) AS assigned_admin_name
           FROM admin_phone_numbers n
           LEFT JOIN admins a ON a.id = n.assigned_admin_id
           ORDER BY n.id ASC`,
        );
        return res.json({ numbers: rows.map(mapPhoneNumberRow) });
      }
      const mine = await listAssignedPhoneNumbers(me.id);
      res.json({ numbers: mine.map(mapPhoneNumberRow) });
    }),
  );

  app.post(
    "/api/admin/phone-numbers/sync-twilio",
    requireAdmin("staff"),
    route(async (_req, res) => {
      const client = getTwilioClient();
      if (!client || process.env.VITEST === "true") {
        if (process.env.VITEST === "true") {
          return res.json({ ok: true, upserted: 0, numbers: [], dry_run: true });
        }
        throw new HttpError(503, "errors.server");
      }
      const list = await client.incomingPhoneNumbers.list({ limit: 200 });
      let upserted = 0;
      for (const n of list) {
        const e164 = String(n.phoneNumber || "").trim();
        if (!e164.startsWith("+")) continue;
        const caps = {
          sms: !!(n.capabilities as any)?.sms,
          mms: !!(n.capabilities as any)?.mms,
          voice: !!(n.capabilities as any)?.voice,
        };
        await pool.query(
          `INSERT INTO admin_phone_numbers
             (e164, friendly_name, twilio_sid, capabilities_json, is_active)
           VALUES (?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE
             friendly_name = VALUES(friendly_name),
             twilio_sid = VALUES(twilio_sid),
             capabilities_json = VALUES(capabilities_json),
             is_active = 1,
             updated_at = NOW()`,
          [e164, n.friendlyName || null, n.sid || null, JSON.stringify(caps)],
        );
        upserted++;
      }
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT n.*, CONCAT(a.first_name,' ',a.last_name) AS assigned_admin_name
         FROM admin_phone_numbers n
         LEFT JOIN admins a ON a.id = n.assigned_admin_id
         ORDER BY n.id ASC`,
      );
      res.json({ ok: true, upserted, numbers: rows.map(mapPhoneNumberRow) });
    }),
  );

  app.patch(
    "/api/admin/phone-numbers/:id",
    requireAdmin(),
    route(async (req, res) => {
      const me = portalUser(res);
      const role = String(me.role || "");
      if (role !== "super_admin" && role !== "admin") {
        throw new HttpError(403, "errors.forbidden");
      }
      const id = parseId(req.params.id);
      const assignedRaw = req.body?.assigned_admin_id;
      const assignedAdminId =
        assignedRaw === null || assignedRaw === ""
          ? null
          : Number(assignedRaw);
      if (
        assignedAdminId != null &&
        (!Number.isFinite(assignedAdminId) || assignedAdminId <= 0)
      ) {
        throw new HttpError(400, "validation.invalidField");
      }
      if (assignedAdminId != null) {
        const [aRows] = await pool.query<RowDataPacket[]>(
          `SELECT id FROM admins
           WHERE id = ? AND status = 'active'
             AND role IN ('super_admin','admin','agent')
           LIMIT 1`,
          [assignedAdminId],
        );
        if (!aRows[0]) throw new HttpError(400, "validation.invalidField");
      }
      const friendly =
        req.body?.friendly_name !== undefined
          ? String(req.body.friendly_name || "").trim() || null
          : undefined;
      if (friendly !== undefined) {
        await pool.query(
          `UPDATE admin_phone_numbers
           SET assigned_admin_id = ?, friendly_name = COALESCE(?, friendly_name)
           WHERE id = ?`,
          [assignedAdminId, friendly, id],
        );
      } else {
        await pool.query(
          `UPDATE admin_phone_numbers SET assigned_admin_id = ? WHERE id = ?`,
          [assignedAdminId, id],
        );
      }
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT n.*, CONCAT(a.first_name,' ',a.last_name) AS assigned_admin_name
         FROM admin_phone_numbers n
         LEFT JOIN admins a ON a.id = n.assigned_admin_id
         WHERE n.id = ? LIMIT 1`,
        [id],
      );
      if (!rows[0]) throw new HttpError(404, "errors.notFound");
      res.json({ number: mapPhoneNumberRow(rows[0]) });
    }),
  );


  /** (Re)transcribe a recorded call — retries stuck / failed transcripts and recovers missed webhooks. */
  app.post(
    "/api/admin/conversations/messages/:id/transcribe",
    requireAdmin(),
    withAccess(async (req, res) => {
      const id = parseId(req.params.id);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, metadata_json FROM conversation_messages WHERE id = ? AND channel = 'call' LIMIT 1`,
        [id],
      );
      if (!rows[0]) throw new HttpError(404, "errors.notFound");
      const meta = parseMessageMetadataJson(rows[0].metadata_json);
      const recordingSid = String(meta.recording_sid || "");
      if (!/^RE[0-9a-f]{32}$/i.test(recordingSid)) throw new HttpError(409, "errors.noRecording");
      if (meta.transcript_status === "ready") throw new HttpError(409, "errors.transcriptReady");
      // A job already exists (webhook missed?) → read it before submitting a new one.
      const jobId = String(meta.transcript_job_id || "");
      if (jobId && meta.transcript_status === "pending" && !notifySandbox()) {
        const job = await fetchTwilioTranscriptionJob(jobId);
        if (job.state !== "pending") {
          const [mr] = await pool.query<RowDataPacket[]>(
            `SELECT conversation_id, metadata_json, body FROM conversation_messages WHERE id = ? LIMIT 1`,
            [id],
          );
          await applyCallTranscriptResult({
            messageId: id,
            conversationId: Number(mr[0]?.conversation_id || 0),
            metaRaw: mr[0]?.metadata_json,
            bodyRaw: mr[0]?.body != null ? String(mr[0].body) : null,
            completed: job.state === "ready",
            transcript: job.state === "ready" ? job.text : "",
            recordingSid: null,
          });
          return res.json({ ok: true, transcript_status: job.state === "ready" ? "ready" : "failed" });
        }
        return res.json({ ok: true, transcript_status: "pending" });
      }
      const status = await requestTwilioRecordingTranscription(recordingSid, id);
      if (status === "unavailable") throw new HttpError(503, "errors.transcriptionNotConfigured");
      res.json({ ok: true, transcript_status: status });
    }),
  );

  // ── MMS upload (Vercel Blob) ──────────────────────────────────────────────
  app.post(
    "/api/admin/conversations/media/upload",
    requireAdmin(),
    express.raw({ type: () => true, limit: MMS_MAX_BYTES }),
    withAccess(async (req, res, adminId) => {
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw new HttpError(400, "validation.invalidField");
      }
      if (body.length > MMS_MAX_BYTES) {
        throw new HttpError(400, "validation.invalidField");
      }
      const contentType = String(req.headers["content-type"] || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      if (!MMS_ALLOWED_CONTENT_TYPES.has(contentType)) {
        throw new HttpError(400, "validation.invalidField");
      }
      const filename = String(req.headers["x-filename"] || "mms").slice(0, 255);
      try {
        const stored = await persistMmsMedia({
          buffer: body,
          contentType,
          filename,
          adminId,
        });
        res.json({
          success: true,
          url: stored.publicUrl,
          content_type: contentType,
          filename,
          cdn_url: stored.cdnUrl,
          id: stored.id,
        });
      } catch (e: any) {
        console.error("[mms:upload]", e?.message || e);
        if (e instanceof HttpError) throw e;
        throw new HttpError(500, "errors.server");
      }
    }),
  );

  app.get("/api/conversations/media/public/:id", async (req, res) => {
    const id = String(req.params.id || "");
    if (!MMS_UUID_RE.test(id)) {
      return res.status(400).json({ error: "Invalid media ID" });
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT content_type, data, cdn_url FROM mms_media
       WHERE id = ? AND expires_at > NOW() LIMIT 1`,
      [id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Media not found or expired" });
    if (rows[0].cdn_url && String(rows[0].cdn_url).startsWith("https://")) {
      return res.redirect(302, String(rows[0].cdn_url));
    }
    const contentType = String(rows[0].content_type || "application/octet-stream");
    const raw = rows[0].data;
    if (!raw) return res.status(404).json({ error: "Media not found or expired" });
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as any);
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=3600");
    return res.end(buf);
  });

  /** Proxy Twilio MMS / recording URLs for media tags (browser cannot send Basic auth). */
  app.get(
    "/api/conversations/media",
    requireAdmin(),
    route(async (req, res) => {
      const rawUrl = String(req.query.url || "").trim();
      if (!rawUrl) throw new HttpError(400, "validation.invalidField");
      const isTwilioUrl =
        rawUrl.startsWith("https://api.twilio.com/") ||
        /^https:\/\/api\.twilio\.com\//i.test(rawUrl);
      const isBlob =
        /^https:\/\/[a-z0-9.-]*blob\.vercel-storage\.com\//i.test(rawUrl) ||
        /^https:\/\/public\.blob\.vercel-storage\.com\//i.test(rawUrl);
      if (!isTwilioUrl && !isBlob) {
        throw new HttpError(400, "validation.invalidField");
      }
      const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
      const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
      if (isTwilioUrl && (!twilioAccountSid || !twilioAuthToken)) {
        throw new HttpError(503, "errors.server");
      }
      const upstream = await fetch(rawUrl, {
        headers: isTwilioUrl
          ? {
              Authorization: `Basic ${Buffer.from(
                `${twilioAccountSid}:${twilioAuthToken}`,
              ).toString("base64")}`,
            }
          : {},
        redirect: "follow",
      });
      if (!upstream.ok) {
        return res.status(upstream.status).json({ error: "Media fetch failed" });
      }
      const contentType =
        upstream.headers.get("content-type") || "application/octet-stream";
      res.set("Content-Type", contentType);
      res.set("Cache-Control", "private, max-age=86400");
      return res.send(Buffer.from(await upstream.arrayBuffer()));
    }),
  );

  // ── Assign client thread to me / staff ────────────────────────────────────
  app.post(
    "/api/admin/conversations/contact/client/:id/assign",
    requireAdmin(),
    withAccess(async (req, res, adminId) => {
      const clientId = parseId(req.params.id);
      if (!(await adminCanMutateClientConversations(adminId, clientId))) {
        throw new HttpError(404, "errors.notFound");
      }
      const assignee =
        req.body?.assigned_admin_id === null
          ? null
          : Number(req.body?.assigned_admin_id ?? adminId);
      if (assignee != null && (!Number.isFinite(assignee) || assignee <= 0)) {
        throw new HttpError(400, "validation.invalidField");
      }
      const ofgIds = await adminAssignedPhoneNumberIds(adminId);
      const scope = adminClientConversationScopeSql(
        "conversations",
        adminId,
        ofgIds,
      );
      await pool.query(
        `UPDATE conversations SET assigned_admin_id = ?
         WHERE client_id = ? AND status = 'open' AND ${scope.sql}`,
        [assignee, clientId, ...scope.params],
      );
      await publishConversationRealtime({
        type: "assign",
        payload: { client_id: clientId, assigned_admin_id: assignee },
      });
      res.json({ ok: true, assigned_admin_id: assignee });
    }),
  );

  // ── Unknown tools: link / create-prospect / dismiss ───────────────────────
  app.post(
    "/api/admin/conversations/unknown/:id/link",
    requireAdmin(),
    withAccess(async (req, res, adminId) => {
      const unknownId = parseId(req.params.id);
      if (!(await adminCanAccessUnknownContact(adminId, unknownId))) {
        throw new HttpError(404, "errors.notFound");
      }
      const clientId = Number(req.body?.client_id);
      if (!clientId) throw new HttpError(400, "validation.invalidField");
      const [urows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM conversation_unknown_contacts WHERE id = ? LIMIT 1`,
        [unknownId],
      );
      if (!urows[0] || urows[0].status !== "open") {
        throw new HttpError(404, "errors.notFound");
      }
      const [crows] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM clients WHERE id = ? LIMIT 1`,
        [clientId],
      );
      if (!crows[0]) throw new HttpError(404, "errors.notFound");
      await pool.query(
        `UPDATE conversations SET client_id = ?, unknown_contact_id = NULL
         WHERE unknown_contact_id = ?`,
        [clientId, unknownId],
      );
      await pool.query(
        `UPDATE conversation_unknown_contacts
         SET status = 'linked', linked_client_id = ? WHERE id = ?`,
        [clientId, unknownId],
      );
      await publishConversationRealtime({
        type: "unknown_linked",
        payload: { unknown_contact_id: unknownId, client_id: clientId },
      });
      res.json({ ok: true, client_id: clientId });
    }),
  );

  app.post(
    "/api/admin/conversations/unknown/:id/create-prospect",
    requireAdmin(),
    withAccess(async (req, res, adminId) => {
      const unknownId = parseId(req.params.id);
      if (!(await adminCanAccessUnknownContact(adminId, unknownId))) {
        throw new HttpError(404, "errors.notFound");
      }
      const [urows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM conversation_unknown_contacts
         WHERE id = ? AND status = 'open' LIMIT 1`,
        [unknownId],
      );
      if (!urows[0]) throw new HttpError(404, "errors.notFound");
      const first = String(req.body?.first_name || "").trim() || "Unknown";
      const last = String(req.body?.last_name || "").trim() || "Lead";
      const phone = urows[0].phone_e164
        ? String(urows[0].phone_e164)
        : null;
      const emailRaw = String(req.body?.email || urows[0].email || "")
        .trim()
        .toLowerCase();
      const email = emailRaw || null;
      const lang =
        req.body?.preferred_language === "es" ||
        req.body?.preferred_language === "en"
          ? req.body.preferred_language
          : "en";
      if (email && !isValidEmail(email)) {
        throw new HttpError(400, "validation.emailInvalid");
      }
      if (phone) {
        const existing = await findClientIdByPhone(phone);
        if (existing) {
          return res.status(409).json({
            error: "duplicate_phone",
            existing_client_id: existing,
            message:
              "A client with this phone already exists. Link to that client instead.",
          });
        }
      }
      if (email) {
        const [emailDup] = await pool.query<RowDataPacket[]>(
          `SELECT id FROM clients WHERE LOWER(email) = ? LIMIT 1`,
          [email],
        );
        if (emailDup[0]) {
          return res.status(409).json({
            error: "duplicate_email",
            existing_client_id: Number(emailDup[0].id),
            message:
              "A client with this email already exists. Link to that client instead.",
          });
        }
      }
      // One role per person: the caller may already be an affiliate or contractor.
      const { phoneOverride } = await assertPersonAvailable({
        email,
        phone,
        actor: "staff",
        sharedPhoneReason: req.body?.shared_phone_reason,
      });
      const [ins] = await pool.query<ResultSetHeader>(
        `INSERT INTO clients
           (first_name, last_name, phone, email, status, preferred_language, assigned_admin_id)
         VALUES (?, ?, ?, ?, 'prospect', ?, ?)`,
        [first, last, phone, email, lang, adminId],
      );
      const clientId = Number(ins.insertId);
      if (phoneOverride) {
        await recordSharedPhoneOverride({ entity: "client", id: clientId, override: phoneOverride, adminId });
      }
      await pool.query(
        `UPDATE conversations SET client_id = ?, unknown_contact_id = NULL
         WHERE unknown_contact_id = ?`,
        [clientId, unknownId],
      );
      await pool.query(
        `UPDATE conversation_unknown_contacts
         SET status = 'linked', linked_client_id = ? WHERE id = ?`,
        [clientId, unknownId],
      );
      await publishConversationRealtime({
        type: "unknown_linked",
        payload: { unknown_contact_id: unknownId, client_id: clientId },
      });
      res.json({
        ok: true,
        client_id: clientId,
        preferred_language: lang,
      });
    }),
  );

  app.post(
    "/api/admin/conversations/unknown/:id/dismiss",
    requireAdmin(),
    withAccess(async (req, res, adminId) => {
      const unknownId = parseId(req.params.id);
      if (!(await adminCanAccessUnknownContact(adminId, unknownId))) {
        throw new HttpError(404, "errors.notFound");
      }
      await pool.query(
        `UPDATE conversation_unknown_contacts SET status = 'dismissed' WHERE id = ?`,
        [unknownId],
      );
      await pool.query(
        `UPDATE conversations SET status = 'closed'
         WHERE unknown_contact_id = ? AND status = 'open'`,
        [unknownId],
      );
      await publishConversationRealtime({
        type: "unknown_dismissed",
        payload: { unknown_contact_id: unknownId },
      });
      res.json({ ok: true });
    }),
  );

  app.get(
    "/api/admin/conversations/lookup-contact",
    requireAdmin(),
    withAccess(async (req, res, _adminId) => {
      const phone = String(req.query.phone || "").trim();
      if (!phone) throw new HttpError(400, "validation.phoneMin");
      const clientId = await findClientIdByPhone(phone);
      if (clientId) {
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT id, first_name, last_name FROM clients WHERE id = ? LIMIT 1`,
          [clientId],
        );
        return res.json({
          found: true,
          kind: "client",
          client_id: clientId,
          client_name:
            `${rows[0]?.first_name || ""} ${rows[0]?.last_name || ""}`.trim() ||
            null,
        });
      }
      const contactId = await findContactIdByPhone(phone);
      if (contactId) {
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT id, first_name, last_name FROM contacts WHERE id = ? LIMIT 1`,
          [contactId],
        );
        return res.json({
          found: true,
          kind: "contact",
          contact_id: contactId,
          client_name:
            `${rows[0]?.first_name || ""} ${rows[0]?.last_name || ""}`.trim() ||
            null,
          client_id: null,
        });
      }
      res.json({ found: false, client_id: null, client_name: null });
    }),
  );

  // ── Voice call-forwarding ─────────────────────────────────────────────────
  app.get(
    "/api/voice/call-forwarding",
    requireAdmin(),
    withAccess(async (_req, res, adminId) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT call_forwarding_enabled, call_forwarding_phone, phone
         FROM admins WHERE id = ? LIMIT 1`,
        [adminId],
      );
      if (!rows[0]) throw new HttpError(404, "errors.notFound");
      const phone =
        (rows[0].call_forwarding_phone as string | null) ??
        (rows[0].phone as string | null) ??
        null;
      res.json({
        success: true,
        call_forwarding_enabled: !!rows[0].call_forwarding_enabled,
        call_forwarding_phone: phone,
        call_forwarding_number: phone,
      });
    }),
  );

  app.put(
    "/api/voice/call-forwarding",
    requireAdmin(),
    withAccess(async (req, res, adminId) => {
      const { enabled, phone } = req.body as {
        enabled: boolean;
        phone?: string;
      };
      if (typeof enabled !== "boolean") {
        throw new HttpError(400, "validation.invalidField");
      }
      let normalizedPhone: string | null = null;
      if (phone && String(phone).trim()) {
        if (!normalizePhoneLast10(phone)) {
          throw new HttpError(400, "validation.phoneMin");
        }
        normalizedPhone = toSmsE164(phone);
      }
      await pool.query(
        `UPDATE admins
         SET call_forwarding_enabled = ?, call_forwarding_phone = ?, updated_at = NOW()
         WHERE id = ?`,
        [enabled ? 1 : 0, normalizedPhone, adminId],
      );
      res.json({
        success: true,
        call_forwarding_enabled: enabled,
        call_forwarding_phone: normalizedPhone,
        call_forwarding_number: normalizedPhone,
      });
    }),
  );

  /**
   * Inbound voice on a brand Twilio line.
   * Simultaneous-ring style: Dial assignee call_forwarding_phone (or admins.phone)
   * with CallerID = the Groundwork brand number. Softphone Device not required for v1.
   */

  // ── Softphone token / TwiML / availability / call log ────────────────────
  app.post(
    "/api/voice/token",
    requireAdmin(),
    withAccess(async (_req, res, adminId) => {
      if (process.env.VITEST === "true") {
        return res.json({ success: true, token: `vitest-voice-token-${adminId}` });
      }
      const twilioClient = getTwilioClient();
      if (!twilioClient) {
        return res.status(503).json({ success: false, error: "Twilio not configured" });
      }
      const twimlAppSid = await getOrCreateTwimlAppSid();
      if (!twimlAppSid) {
        return res.status(503).json({ success: false, error: "TwiML App unavailable" });
      }
      const accountSid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
      const apiKey = (process.env.TWILIO_API_KEY || "").trim();
      const apiSecret = (process.env.TWILIO_API_SECRET || "").trim();
      if (!accountSid.startsWith("AC")) {
        return res.status(503).json({
          success: false,
          error: "TWILIO_ACCOUNT_SID is not configured",
        });
      }
      if (!apiKey.startsWith("SK") || apiSecret.length < 20) {
        return res.status(503).json({
          success: false,
          error:
            "Voice tokens require TWILIO_API_KEY and TWILIO_API_SECRET",
        });
      }
      const AccessToken = twilio.jwt.AccessToken;
      const VoiceGrant = AccessToken.VoiceGrant;
      const token = new AccessToken(accountSid, apiKey, apiSecret, {
        identity: `admin_${adminId}`,
        ttl: 3600,
      });
      token.addGrant(
        new VoiceGrant({
          outgoingApplicationSid: twimlAppSid,
          incomingAllow: true,
        }),
      );
      res.json({ success: true, token: token.toJwt() });
    }),
  );

  app.post("/api/voice/twiml", async (req, res) => {
    res.set("Content-Type", "text/xml");
    try {
      if (!isValidTwilioWebhookRequest(req) && process.env.VITEST !== "true") {
        return res.status(403).send("<Response/>");
      }
      const To = (req.body?.To || req.query?.To) as string | undefined;
      const fromParam = String(
        req.body?.From || req.body?.Caller || req.body?.Identity || "",
      );
      const identity = fromParam.replace(/^client:/, "");
      if (!To) {
        return res.send(
          "<Response><Say>Missing destination number.</Say></Response>",
        );
      }
      let callerId = "";
      const match = identity.match(/admin_(\d+)/);
      if (match) {
        const adminId = parseInt(match[1], 10);
        const phones = await listAssignedPhoneNumbers(adminId);
        if (phones[0]?.e164) callerId = String(phones[0].e164);
      }
      const VoiceResponse = twilio.twiml.VoiceResponse;
      const twiml = new VoiceResponse();
      const dial = twiml.dial({
        callerId,
        timeout: 30,
        record: "record-from-answer-dual",
        recordingStatusCallback: `${groundworkApiBaseUrl()}/api/voice/recording-status`,
        recordingStatusCallbackMethod: "POST",
        answerOnBridge: true,
        trim: "trim-silence",
      } as any);
      dial.number({}, To);
      return res.send(twiml.toString());
    } catch (e: any) {
      console.error("[voice:twiml]", e?.message ?? e);
      return res
        .status(500)
        .send("<Response><Say>Unable to complete call.</Say></Response>");
    }
  });

  app.post(
    "/api/voice/availability",
    requireAdmin(),
    withAccess(async (req, res, adminId) => {
      const { available } = req.body as { available: boolean };
      if (typeof available !== "boolean") {
        throw new HttpError(400, "validation.invalidField");
      }
      await pool.query(`UPDATE admins SET voice_available = ? WHERE id = ?`, [
        available ? 1 : 0,
        adminId,
      ]);
      res.json({ success: true, available });
    }),
  );

  app.get(
    "/api/voice/voicemail-settings",
    requireAdmin(),
    withAccess(async (_req, res, adminId) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT voicemail_enabled, voicemail_greeting_text, voicemail_greeting_url
         FROM admins WHERE id = ? LIMIT 1`,
        [adminId],
      );
      const enabledDefault =
        (await getSystemSettingValue("voice_voicemail_enabled")) !== "0";
      const greetingTextDefault =
        (await getSystemSettingValue("voice_voicemail_greeting_text")) ||
        "Hello, you have reached Groundwork Capital. We are unable to take your call right now. Please leave a message after the tone.";
      const greetingUrlDefault =
        (await getSystemSettingValue("voice_voicemail_greeting_url")) || null;
      const maxSeconds = Math.min(
        Math.max(
          parseInt(
            (await getSystemSettingValue("voice_voicemail_max_seconds")) || "120",
            10,
          ) || 120,
          10,
        ),
        600,
      );
      const a = (rows[0] || {}) as RowDataPacket;
      res.json({
        success: true,
        admin: {
          voicemail_enabled:
            a.voicemail_enabled == null ? null : !!a.voicemail_enabled,
          voicemail_greeting_text: a.voicemail_greeting_text
            ? String(a.voicemail_greeting_text)
            : null,
          voicemail_greeting_url: a.voicemail_greeting_url
            ? String(a.voicemail_greeting_url)
            : null,
          has_personal_line: true,
        },
        tenant: {
          voicemail_enabled: enabledDefault,
          voicemail_greeting_text: greetingTextDefault,
          voicemail_greeting_url: greetingUrlDefault,
          voicemail_max_seconds: maxSeconds,
          voicemail_transcribe: false,
        },
      });
    }),
  );

  app.put(
    "/api/voice/voicemail-settings",
    requireAdmin(),
    withAccess(async (req, res, adminId) => {
      const { enabled, greeting_text } = req.body as {
        enabled?: boolean | null;
        greeting_text?: string | null;
      };
      const sets: string[] = [];
      const args: any[] = [];
      if (enabled === null) {
        sets.push("voicemail_enabled = NULL");
      } else if (typeof enabled === "boolean") {
        sets.push("voicemail_enabled = ?");
        args.push(enabled ? 1 : 0);
      }
      if (greeting_text !== undefined) {
        sets.push("voicemail_greeting_text = ?");
        args.push(
          greeting_text == null || !String(greeting_text).trim()
            ? null
            : String(greeting_text).trim().slice(0, 2000),
        );
      }
      if (!sets.length) throw new HttpError(400, "validation.invalidField");
      args.push(adminId);
      await pool.query(
        `UPDATE admins SET ${sets.join(", ")}, updated_at = NOW() WHERE id = ?`,
        args,
      );
      res.json({ success: true });
    }),
  );

  app.post(
    "/api/voice/log",
    requireAdmin(),
    withAccess(async (req, res, adminId) => {
      const { client_id, phone, duration, call_status, call_sid, direction } =
        req.body as {
          client_id?: number;
          phone?: string;
          duration?: number;
          call_status?: string;
          call_sid?: string;
          direction?: "inbound" | "outbound";
        };
      if (!phone) throw new HttpError(400, "validation.phoneMin");
      const normalizedPhone = toSmsE164(phone);
      if (call_sid) {
        const [existing] = await pool.query<RowDataPacket[]>(
          `SELECT id, conversation_id, recording_url FROM conversation_messages
           WHERE provider_message_id = ? AND channel = 'call' LIMIT 1`,
          [call_sid],
        );
        if (existing[0]) {
          const durationSec = duration ?? 0;
          const statusLabel = call_status ?? "completed";
          const body = `Voice call — ${durationSec}s (${statusLabel})`;
          const pendingRec = takePendingRecording(call_sid);
          await pool.query(
            `UPDATE conversation_messages
             SET provider_status = ?,
                 call_duration_sec = COALESCE(?, call_duration_sec),
                 recording_url = COALESCE(recording_url, ?),
                 body = ?
             WHERE id = ?`,
            [
              statusLabel,
              durationSec || null,
              pendingRec?.mp3Url ?? null,
              body,
              Number(existing[0].id),
            ],
          );
          return res.json({ success: true, idempotent: true, updated: true });
        }
      }

      let resolvedClientId: number | null =
        client_id != null ? Number(client_id) : null;
      if (!resolvedClientId) {
        resolvedClientId = await findClientIdByPhone(normalizedPhone);
      }
      const phones = await listAssignedPhoneNumbers(adminId);
      const ofgNumberId = phones[0] ? Number(phones[0].id) : null;
      const dir = direction === "inbound" ? "inbound" : "outbound";
      let unknownContactId: number | null = null;
      let conversationId: number;
      if (resolvedClientId) {
        conversationId = await getOrCreateClientChannelConversation({
          clientId: resolvedClientId,
          channel: "call",
          ofgNumberId,
          assignedAdminId: adminId,
          reopenIfClosed: true,
        });
      } else if (ofgNumberId) {
        const created = await getOrCreateCallConversation({
          callerPhone: normalizedPhone,
          ofgNumberId,
          assignedAdminId: adminId,
          reopenIfClosed: true,
        });
        conversationId = created.conversationId;
        unknownContactId = created.unknownContactId;
      } else {
        throw new HttpError(400, "validation.invalidField");
      }
      const durationSec = duration ?? 0;
      const statusLabel = call_status ?? "completed";
      const body = `Voice call — ${durationSec}s (${statusLabel})`;
      const ofgE164 = phones[0] ? String(phones[0].e164) : null;
      const pendingRec = call_sid ? takePendingRecording(call_sid) : null;
      await insertCallMessage({
        conversationId,
        direction: dir,
        body,
        fromAddress: dir === "outbound" ? ofgE164 : normalizedPhone,
        toAddress: dir === "outbound" ? normalizedPhone : ofgE164,
        providerMessageId: call_sid ?? null,
        providerStatus: statusLabel,
        callDurationSec:
          pendingRec?.durationSec != null
            ? pendingRec.durationSec
            : durationSec,
        recordingUrl: pendingRec?.mp3Url ?? null,
        sentByAdminId: adminId,
        bumpUnread: false,
        unknownContactId,
      });
      await publishConversationRealtime({
        type: "message",
        adminIds: [adminId],
        payload: {
          conversation_id: conversationId,
          client_id: resolvedClientId,
          channel: "call",
        },
      });
      res.json({ success: true });
    }),
  );

  app.post(
    "/api/voice/call-answered",
    requireAdmin(),
    withAccess(async (req, res, _adminId) => {
      const callSid = String(req.body?.call_sid || req.body?.CallSid || "").trim();
      if (callSid) {
        await pool.query(
          `UPDATE conversation_messages
           SET provider_status = 'answered'
           WHERE provider_message_id = ? AND channel = 'call'`,
          [callSid],
        );
      }
      res.json({ success: true });
    }),
  );

  app.post("/api/voice/recording-status", async (req, res) => {
    try {
      if (!isValidTwilioWebhookRequest(req) && process.env.VITEST !== "true") {
        return res.sendStatus(403);
      }
      const {
        CallSid,
        ParentCallSid,
        RecordingSid,
        RecordingUrl,
        RecordingDuration,
        RecordingStatus,
      } = req.body as {
        CallSid?: string;
        ParentCallSid?: string;
        RecordingSid?: string;
        RecordingUrl?: string;
        RecordingDuration?: string;
        RecordingStatus?: string;
      };
      if (RecordingStatus !== "completed" || !CallSid || !RecordingUrl) {
        return res.sendStatus(204);
      }
      const mp3Url = RecordingUrl.endsWith(".mp3")
        ? RecordingUrl
        : `${RecordingUrl}.mp3`;
      const durationSec = RecordingDuration
        ? parseInt(RecordingDuration, 10)
        : null;
      const recordingSid = String(RecordingSid || "").trim() || null;
      const sidCandidates = Array.from(
        new Set(
          [CallSid, ParentCallSid]
            .map((s) => String(s || "").trim())
            .filter(Boolean),
        ),
      );
      let matchedId = 0;
      let conversationId = 0;
      for (const sid of sidCandidates) {
        const [upd] = await pool.query<ResultSetHeader>(
          `UPDATE conversation_messages
           SET recording_url = ?,
               call_duration_sec = COALESCE(?, call_duration_sec)
           WHERE provider_message_id = ? AND channel = 'call'`,
          [mp3Url, Number.isFinite(durationSec) ? durationSec : null, sid],
        );
        if (Number(upd.affectedRows || 0) > 0) {
          const [rows] = await pool.query<RowDataPacket[]>(
            `SELECT id, conversation_id, metadata_json FROM conversation_messages
             WHERE provider_message_id = ? AND channel = 'call' LIMIT 1`,
            [sid],
          );
          matchedId = Number(rows[0]?.id || 0);
          conversationId = Number(rows[0]?.conversation_id || 0);
          if (matchedId) {
            const metaPatch: Record<string, unknown> = {
              transcript_status: "pending",
            };
            if (recordingSid) metaPatch.recording_sid = recordingSid;
            await mergeConversationMessageMetadata(matchedId, metaPatch);
          }
          break;
        }
      }
      if (!matchedId) {
        for (const sid of sidCandidates) {
          rememberPendingRecording(
            sid,
            mp3Url,
            Number.isFinite(durationSec) ? durationSec : null,
          );
        }
        return res.sendStatus(204);
      }
      const transcriptStatus = recordingSid
        ? await requestTwilioRecordingTranscription(recordingSid, matchedId)
        : "unavailable";
      const assignedAdminId = await conversationAssignedAdminId(conversationId);
      await publishConversationRealtime({
        type: "call_recording",
        adminIds: assignedAdminId ? [assignedAdminId] : undefined,
        payload: {
          conversation_id: conversationId,
          message_id: matchedId,
          recording_url: mp3Url,
          call_duration_sec: Number.isFinite(durationSec) ? durationSec : null,
          recording_sid: recordingSid,
          transcript_status: transcriptStatus,
          assigned_admin_id: assignedAdminId,
        },
      });
      return res.sendStatus(204);
    } catch (err) {
      console.error("[voice:recording-status]", err);
      return res.sendStatus(500);
    }
  });

  app.post("/api/voice/transcription", async (req, res) => {
    try {
      if (!isValidTwilioWebhookRequest(req) && process.env.VITEST !== "true") {
        return res.sendStatus(403);
      }
      const {
        CallSid,
        RecordingSid,
        TranscriptionText,
        TranscriptionStatus,
      } = req.body as {
        CallSid?: string;
        RecordingSid?: string;
        TranscriptionText?: string;
        TranscriptionStatus?: string;
      };
      const status = String(TranscriptionStatus || "")
        .trim()
        .toLowerCase();
      if (status !== "completed" && status !== "failed") {
        return res.sendStatus(204);
      }
      const recordingSid = String(RecordingSid || "").trim();
      const callSid = String(CallSid || "").trim();
      let matchedId = 0;
      let conversationId = 0;
      let metaRaw: unknown = null;
      let bodyRaw: string | null = null;

      if (recordingSid) {
        const [byRec] = await pool.query<RowDataPacket[]>(
          `SELECT id, conversation_id, metadata_json, body
           FROM conversation_messages
           WHERE channel = 'call'
             AND (
               JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.recording_sid')) = ?
               OR metadata_json LIKE ?
             )
           ORDER BY id DESC
           LIMIT 1`,
          [recordingSid, `%"recording_sid":"${recordingSid}"%`],
        );
        if (byRec[0]) {
          matchedId = Number(byRec[0].id || 0);
          conversationId = Number(byRec[0].conversation_id || 0);
          metaRaw = byRec[0].metadata_json;
          bodyRaw = byRec[0].body != null ? String(byRec[0].body) : null;
        }
      }
      if (!matchedId && callSid) {
        const [byCall] = await pool.query<RowDataPacket[]>(
          `SELECT id, conversation_id, metadata_json, body
           FROM conversation_messages
           WHERE provider_message_id = ? AND channel = 'call'
           LIMIT 1`,
          [callSid],
        );
        if (byCall[0]) {
          matchedId = Number(byCall[0].id || 0);
          conversationId = Number(byCall[0].conversation_id || 0);
          metaRaw = byCall[0].metadata_json;
          bodyRaw = byCall[0].body != null ? String(byCall[0].body) : null;
        }
      }
      if (!matchedId) {
        return res.sendStatus(204);
      }

      await applyCallTranscriptResult({
        messageId: matchedId,
        conversationId,
        metaRaw,
        bodyRaw,
        completed: status === "completed",
        transcript: String(TranscriptionText || "").trim(),
        recordingSid: recordingSid || null,
      });
      return res.sendStatus(204);
    } catch (err) {
      console.error("[voice:transcription]", err);
      return res.sendStatus(500);
    }
  });

  /**
   * Twilio Voice v3 transcription callback (URL set on the transcription
   * configuration we create). The payload is only a pointer: we re-fetch the job
   * from Twilio with our credentials and require it to belong to this message's
   * recording, so a forged call can't write anything.
   */
  app.post("/api/voice/call-transcript", async (req, res) => {
    try {
      const b = (req.body || {}) as Record<string, unknown>;
      const ours = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
      const accountId = String(b.accountId || b.account_sid || "").trim();
      if (ours && accountId && accountId !== ours) return res.status(200).json({ ok: true });
      const jobId = String(b.id || "").trim();
      if (!/^[A-Za-z0-9_-]{6,120}$/.test(jobId)) return res.status(200).json({ ok: true });
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, conversation_id, metadata_json, body FROM conversation_messages
         WHERE channel = 'call' AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.transcript_job_id')) = ?
         ORDER BY id DESC LIMIT 1`,
        [jobId],
      );
      const m = rows[0];
      if (!m) return res.status(200).json({ ok: true });
      const meta = parseMessageMetadataJson(m.metadata_json);
      const job = await fetchTwilioTranscriptionJob(jobId);
      if (job.sourceId && meta.recording_sid && job.sourceId !== meta.recording_sid) {
        return res.status(200).json({ ok: true });
      }
      if (job.state !== "pending") {
        await applyCallTranscriptResult({
          messageId: Number(m.id),
          conversationId: Number(m.conversation_id || 0),
          metaRaw: m.metadata_json,
          bodyRaw: m.body != null ? String(m.body) : null,
          completed: job.state === "ready",
          transcript: job.state === "ready" ? job.text : "",
          recordingSid: null,
          extraMeta: job.state === "failed" ? { transcript_error: job.error } : { transcript_error: null },
        });
      }
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("[voice:call-transcript]", err);
      return res.status(200).json({ ok: true });
    }
  });

  app.post("/api/voice/dial-status", async (req, res) => {
    res.set("Content-Type", "text/xml");
    try {
      if (!isValidTwilioWebhookRequest(req) && process.env.VITEST !== "true") {
        return res.status(403).send("<Response/>");
      }
      const callSid = (req.body?.CallSid as string) || "";
      const dialCallStatus = (req.body?.DialCallStatus as string) || "";
      const calledNumber =
        (req.body?.To as string) || (req.body?.Called as string) || "";
      if (
        callSid &&
        (dialCallStatus === "answered" || dialCallStatus === "completed")
      ) {
        await pool.query(
          `UPDATE conversation_messages
           SET provider_status = ?
           WHERE provider_message_id = ? AND channel = 'call'`,
          [dialCallStatus, callSid],
        );
        return res.status(200).send("<Response></Response>");
      }
      const unanswered = ["no-answer", "busy", "failed", "canceled"].includes(
        dialCallStatus,
      );
      if (!unanswered) {
        return res.status(200).send("<Response></Response>");
      }
      // Voicemail fallback when no answer
      const ofg = calledNumber
        ? await resolveOfgNumberByToAddress(calledNumber)
        : null;
      const assignedAdminId =
        ofg?.assigned_admin_id != null ? Number(ofg.assigned_admin_id) : null;
      const VoiceResponse = twilio.twiml.VoiceResponse;
      const twiml = new VoiceResponse();
      let vmEnabled = (await getSystemSettingValue("voice_voicemail_enabled")) !== "0";
      let greeting =
        (await getSystemSettingValue("voice_voicemail_greeting_text")) ||
        "Hello, you have reached Groundwork Capital. We are unable to take your call right now. Please leave a message after the tone.";
      if (assignedAdminId) {
        const [ar] = await pool.query<RowDataPacket[]>(
          `SELECT voicemail_enabled, voicemail_greeting_text FROM admins WHERE id = ? LIMIT 1`,
          [assignedAdminId],
        );
        if (ar[0]?.voicemail_enabled != null) {
          vmEnabled = Number(ar[0].voicemail_enabled) === 1;
        }
        if (ar[0]?.voicemail_greeting_text) {
          greeting = String(ar[0].voicemail_greeting_text);
        }
      }
      if (!vmEnabled) {
        twiml.say({ voice: "alice" }, "Thank you for calling Groundwork Capital. Goodbye.");
        twiml.hangup();
        return res.send(twiml.toString());
      }
      if (callSid) {
        const [vmRows] = await pool.query<RowDataPacket[]>(
          `SELECT id FROM conversation_messages
           WHERE provider_message_id = ? AND channel = 'call' LIMIT 1`,
          [callSid],
        );
        const vmMsgId = Number(vmRows[0]?.id || 0);
        if (vmMsgId) {
          await mergeConversationMessageMetadata(vmMsgId, {
            is_voicemail: true,
          });
          await pool.query(
            `UPDATE conversation_messages
             SET body = ?, provider_status = 'voicemail'
             WHERE id = ?`,
            [`Voicemail from caller`, vmMsgId],
          );
        }
      }
      twiml.say({ voice: "alice" }, greeting);
      twiml.record({
        maxLength: 120,
        playBeep: true,
        recordingStatusCallback: `${groundworkApiBaseUrl()}/api/voice/recording-status`,
        recordingStatusCallbackMethod: "POST",
        transcriptionCallbackMethod: "POST",
      } as any);
      return res.send(twiml.toString());
    } catch (e: any) {
      console.error("[voice:dial-status]", e?.message ?? e);
      return res.status(200).send("<Response></Response>");
    }
  });

  /**
   * Inbound voice on a brand Twilio line.
   * Rings softphone (Client:admin_{id}) when voice_available, plus call-forward phone.
   */
  app.post("/api/voice/incoming", async (req, res) => {
    res.set("Content-Type", "text/xml");
    try {
      if (!process.env.TWILIO_AUTH_TOKEN && IS_PROD) {
        return res.status(503).send("<Response><Say>Service unavailable.</Say></Response>");
      }
      if (!isValidTwilioWebhookRequest(req) && process.env.VITEST !== "true") {
        console.warn("[twilio:voice] Invalid or missing signature");
        return res.status(403).send("<Response/>");
      }
      const to = String(req.body?.To || req.body?.Called || "");
      const from = String(req.body?.From || req.body?.Caller || "Unknown");
      const callSid = String(req.body?.CallSid || "") || null;
      const brand = await resolveOfgNumberByToAddress(to);
      const VoiceResponse = twilio.twiml.VoiceResponse;
      const twiml = new VoiceResponse();
      if (!brand?.assigned_admin_id) {
        twiml.say(
          { voice: "alice" },
          "Thank you for calling Groundwork Capital. We are unable to take your call right now. Please try again later or visit groundwork capital group dot com.",
        );
        return res.send(twiml.toString());
      }
      const assignedAdminId = Number(brand.assigned_admin_id);
      const ofgNumberId = Number(brand.id);

      // Log inbound call row up-front
      try {
        const created = await getOrCreateCallConversation({
          callerPhone: from,
          ofgNumberId,
          assignedAdminId,
        });
        await insertCallMessage({
          conversationId: created.conversationId,
          direction: "inbound",
          body: `Incoming call from ${from}`,
          fromAddress: from,
          toAddress: to || null,
          providerMessageId: callSid,
          providerStatus: "ringing",
          bumpUnread: true,
          unknownContactId: created.unknownContactId,
        });
        await publishConversationRealtime({
          type: "message",
          adminIds: [assignedAdminId],
          payload: {
            conversation_id: created.conversationId,
            client_id: created.clientId,
            contact_id: created.contactId,
            unknown_contact_id: created.unknownContactId,
            channel: "call",
          },
        });
      } catch (logErr: any) {
        console.error("[voice:incoming] log error:", logErr?.message ?? logErr);
      }

      const [admins] = await pool.query<RowDataPacket[]>(
        `SELECT voice_available, call_forwarding_enabled, call_forwarding_phone, phone, first_name
         FROM admins WHERE id = ? AND status = 'active' LIMIT 1`,
        [assignedAdminId],
      );
      const admin = admins[0];
      const softphoneOnline = !!(admin && Number(admin.voice_available) === 1);
      const forwardRaw =
        admin && Number(admin.call_forwarding_enabled)
          ? admin.call_forwarding_phone || admin.phone
          : null;
      const forward = forwardRaw ? toSmsE164(String(forwardRaw)) : null;
      const callerDigits = normalizePhoneDigits(from);
      const fwdDigits = forward ? normalizePhoneDigits(forward) : "";
      const ringCell = !!forward && !!fwdDigits && fwdDigits !== callerDigits;
      const ringSoftphone = softphoneOnline || !ringCell;

      if (!ringSoftphone && !ringCell) {
        twiml.say(
          { voice: "alice" },
          "Thank you for calling Groundwork Capital. We are unable to take your call right now.",
        );
        return res.send(twiml.toString());
      }

      console.log(
        `[twilio:voice] inbound from=${from} to=${brand.e164} softphone=${ringSoftphone} forward=${forward || "-"} admin=${assignedAdminId}`,
      );
      const dial = twiml.dial({
        callerId: brand.e164,
        timeout: ringCell ? 28 : 22,
        answerOnBridge: true,
        action: `${groundworkApiBaseUrl()}/api/voice/dial-status`,
        method: "POST",
        record: "record-from-answer-dual",
        recordingStatusCallback: `${groundworkApiBaseUrl()}/api/voice/recording-status`,
        recordingStatusCallbackMethod: "POST",
        trim: "trim-silence",
      } as any);
      if (ringSoftphone) {
        dial.client(`admin_${assignedAdminId}`);
      }
      if (ringCell && forward) {
        dial.number(forward);
      }
      return res.send(twiml.toString());
    } catch (e: any) {
      console.error("[twilio:voice]", e?.message ?? e);
      return res
        .status(500)
        .send(
          "<Response><Say>We are unable to complete your call. Please try again later.</Say></Response>",
        );
    }
  });

}

function registerTwilioWebhookRoutes(app: Express) {
  app.post("/api/webhooks/twilio/sms", async (req, res) => {
    try {
      if (!process.env.TWILIO_AUTH_TOKEN && IS_PROD) {
        res.set("Content-Type", "text/xml");
        return res.status(503).send("<Response/>");
      }
      if (!isValidTwilioWebhookRequest(req)) {
        console.warn("[twilio:sms] Invalid or missing signature");
        res.set("Content-Type", "text/xml");
        return res.status(403).send("<Response/>");
      }
      const from = String(req.body?.From || "");
      const to = String(req.body?.To || "");
      const body = String(req.body?.Body || "");
      const sid = String(req.body?.MessageSid || "");
      const inboundMedia = await ingestInboundTwilioMedia(
        (req.body || {}) as Record<string, unknown>,
      );
      const mediaUrl = inboundMedia.mediaUrl;
      const mediaContentType = inboundMedia.mediaContentType;

      if (!from || (!body && !mediaUrl)) {
        res.set("Content-Type", "text/xml");
        return res.send("<Response/>");
      }

      const keyword = classifySmsKeyword(body);
      if (keyword) {
        console.log(
          `[twilio:sms] keyword=${keyword} from=${from} to=${to} sid=${sid} (v1 log-only, no auto-reply)`,
        );
      }

      try {
        await tryHandleCampaignKeywordReply({ fromPhone: from, body });
      } catch (replyErr: any) {
        console.error(
          "[twilio:sms] campaign reply handler:",
          replyErr?.message ?? replyErr,
        );
      }

      if (sid) {
        const [dup] = await pool.query<RowDataPacket[]>(
          `SELECT id FROM conversation_messages WHERE provider_message_id = ? LIMIT 1`,
          [sid],
        );
        if (dup[0]) {
          res.set("Content-Type", "text/xml");
          return res.send("<Response/>");
        }
      }

      const ofgNumber = await resolveOfgNumberByToAddress(to);
      const ofgNumberId = ofgNumber ? Number(ofgNumber.id) : null;
      const assigneeId =
        ofgNumber?.assigned_admin_id != null
          ? Number(ofgNumber.assigned_admin_id)
          : null;
      const clientId = await findClientIdByPhone(from);
      const preview = (body || (mediaUrl ? "[Media]" : "")).slice(0, 200);

      if (!clientId) {
        const crmContactId = await findContactIdByPhone(from);
        if (crmContactId) {
          const conversationId = await getOrCreateCrmContactChannelConversation({
            crmContactId,
            channel: "sms",
            ofgNumberId,
            assignedAdminId: assigneeId,
            reopenIfClosed: true,
          });
          await pool.query(
            `INSERT INTO conversation_messages
               (conversation_id, direction, channel, body, media_url, media_content_type,
                from_address, to_address, provider_message_id, provider_status)
             VALUES (?, 'inbound', 'sms', ?, ?, ?, ?, ?, ?, 'received')`,
            [
              conversationId,
              body || null,
              mediaUrl,
              mediaContentType,
              from,
              to,
              sid || null,
            ],
          );
          await pool.query(
            `UPDATE conversations
             SET last_message_at = NOW(), last_message_preview = ?,
                 unread_count = unread_count + 1, status = 'open'
             WHERE id = ?`,
            [preview, conversationId],
          );
          await publishConversationRealtime({
            type: "message",
            adminIds: assigneeId ? [assigneeId] : undefined,
            payload: {
              contact_id: crmContactId,
              conversation_id: conversationId,
              assigned_admin_id: assigneeId,
            },
          });
          if (assigneeId) {
            const [cSnap] = await pool.query<RowDataPacket[]>(
              `SELECT first_name, last_name FROM contacts WHERE id = ? LIMIT 1`,
              [crmContactId],
            );
            const fromLabel =
              `${cSnap[0]?.first_name || ""} ${cSnap[0]?.last_name || ""}`.trim() ||
              from;
            await notifyAdminInboundSms({
              adminId: assigneeId,
              fromLabel,
              preview,
              linkUrl: `/admin/conversations?contact=${crmContactId}`,
              providerMessageId: sid || null,
            });
          }
          return res.type("text/xml").send("<Response></Response>");
        }

        let unknownId: number;
        const phoneVariants = phoneMatchVariants(from);
        let existingU: RowDataPacket[] = [];
        if (phoneVariants.length) {
          const [found] = await pool.query<RowDataPacket[]>(
            `SELECT id FROM conversation_unknown_contacts
             WHERE status = 'open' AND (
               phone_e164 IN (${phoneVariants.map(() => "?").join(",")})
               OR REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone_e164,''),'+',''),'-',''),'(',''),')','') IN (${phoneVariants.map(() => "?").join(",")})
             )
             LIMIT 1`,
            [
              ...phoneVariants,
              ...phoneVariants.map((v) => normalizePhoneDigits(v)),
            ],
          );
          existingU = found;
        }
        if (existingU[0]) {
          unknownId = Number(existingU[0].id);
        } else {
          const [insU] = await pool.query<ResultSetHeader>(
            `INSERT INTO conversation_unknown_contacts
               (phone_e164, ofg_number_id, status, last_message_at, last_message_preview, unread_count)
             VALUES (?, ?, 'open', NOW(), ?, 1)`,
            [from, ofgNumberId, preview],
          );
          unknownId = Number(insU.insertId);
        }

        const conversationId = await getOrCreateUnknownSmsConversation({
          unknownContactId: unknownId,
          ofgNumberId,
          assignedAdminId: assigneeId,
          reopenIfClosed: true,
        });
        await pool.query(
          `INSERT INTO conversation_messages
             (conversation_id, direction, channel, body, media_url, media_content_type,
              from_address, to_address, provider_message_id, provider_status)
           VALUES (?, 'inbound', 'sms', ?, ?, ?, ?, ?, ?, 'received')`,
          [
            conversationId,
            body || null,
            mediaUrl,
            mediaContentType,
            from,
            to,
            sid || null,
          ],
        );
        await pool.query(
          `UPDATE conversations
           SET last_message_at = NOW(), last_message_preview = ?, unread_count = unread_count + 1
           WHERE id = ?`,
          [preview, conversationId],
        );
        await pool.query(
          `UPDATE conversation_unknown_contacts
           SET last_message_at = NOW(), last_message_preview = ?,
               unread_count = unread_count + 1,
               ofg_number_id = COALESCE(ofg_number_id, ?)
           WHERE id = ?`,
          [preview, ofgNumberId, unknownId],
        );
        await publishConversationRealtime({
          type: "inbound_unknown",
          adminIds: assigneeId ? [assigneeId] : undefined,
          payload: {
            unknown_contact_id: unknownId,
            conversation_id: conversationId,
            assigned_admin_id: assigneeId,
          },
        });
        if (assigneeId) {
          await notifyAdminInboundSms({
            adminId: assigneeId,
            fromLabel: from,
            preview,
            linkUrl: `/admin/conversations?unknown=${unknownId}`,
            providerMessageId: sid || null,
          });
        }
        res.set("Content-Type", "text/xml");
        return res.send("<Response/>");
      }

      const conversationId = await getOrCreateClientChannelConversation({
        clientId,
        channel: "sms",
        ofgNumberId,
        assignedAdminId: assigneeId,
      });
      await pool.query(
        `UPDATE conversations
         SET status = 'open',
             assigned_admin_id = COALESCE(assigned_admin_id, ?),
             ofg_number_id = COALESCE(ofg_number_id, ?)
         WHERE id = ?`,
        [assigneeId, ofgNumberId, conversationId],
      );
      await pool.query(
        `INSERT INTO conversation_messages
           (conversation_id, direction, channel, body, media_url, media_content_type,
            from_address, to_address, provider_message_id, provider_status)
         VALUES (?, 'inbound', 'sms', ?, ?, ?, ?, ?, ?, 'received')`,
        [
          conversationId,
          body || null,
          mediaUrl,
          mediaContentType,
          from,
          to,
          sid || null,
        ],
      );
      await pool.query(
        `UPDATE conversations
         SET last_message_at = NOW(), last_message_preview = ?, unread_count = unread_count + 1
         WHERE id = ?`,
        [preview, conversationId],
      );
      const [assigneeRows] = await pool.query<RowDataPacket[]>(
        `SELECT assigned_admin_id FROM conversations WHERE id = ? LIMIT 1`,
        [conversationId],
      );
      const notifyAdmin =
        assigneeRows[0]?.assigned_admin_id != null
          ? Number(assigneeRows[0].assigned_admin_id)
          : assigneeId;
      await publishConversationRealtime({
        type: "inbound",
        adminIds: notifyAdmin ? [notifyAdmin] : undefined,
        payload: {
          client_id: clientId,
          conversation_id: conversationId,
          assigned_admin_id: notifyAdmin,
        },
      });
      const [clRows] = await pool.query<RowDataPacket[]>(
        `SELECT first_name, last_name FROM clients WHERE id = ? LIMIT 1`,
        [clientId],
      );
      const fromLabel =
        `${clRows[0]?.first_name || ""} ${clRows[0]?.last_name || ""}`.trim() ||
        from;
      if (notifyAdmin) {
        await notifyAdminInboundSms({
          adminId: notifyAdmin,
          fromLabel,
          preview,
          linkUrl: `/admin/conversations?client=${clientId}`,
          providerMessageId: sid || null,
        });
      }
      res.set("Content-Type", "text/xml");
      return res.send("<Response/>");
    } catch (e: any) {
      console.error("[twilio:sms]", e?.message ?? e);
      res.set("Content-Type", "text/xml");
      return res.status(500).send("<Response/>");
    }
  });

  app.post("/api/webhooks/twilio/sms-status", async (req, res) => {
    try {
      if (!process.env.TWILIO_AUTH_TOKEN && IS_PROD) {
        return res.status(503).send("unavailable");
      }
      if (!isValidTwilioWebhookRequest(req)) {
        console.warn("[twilio:sms-status] Invalid or missing signature");
        return res.status(403).send("forbidden");
      }
      const sid = String(req.body?.MessageSid || "").trim();
      const status = String(req.body?.MessageStatus || "")
        .trim()
        .toLowerCase();
      const errorCode = String(req.body?.ErrorCode || "").trim();
      const errorMessage = String(
        req.body?.ErrorMessage || req.body?.ErrorCode || "",
      ).trim();
      if (!sid || !status) return res.status(200).send("ok");
      const newRank = twilioSmsStatusRank(status);
      const [existing] = await pool.query<RowDataPacket[]>(
        `SELECT id, provider_status FROM conversation_messages
         WHERE provider_message_id = ? LIMIT 1`,
        [sid],
      );
      if (!existing[0]) return res.status(200).send("ok");
      const prev = String(existing[0].provider_status || "").toLowerCase();
      const prevRank = twilioSmsStatusRank(prev);
      if (prevRank > 0 && newRank > 0 && newRank < prevRank) {
        return res.status(200).send("ok");
      }
      const err =
        status === "failed" || status === "undelivered"
          ? [errorCode, errorMessage].filter(Boolean).join(" ").slice(0, 500) ||
            status
          : null;
      await pool.query(
        `UPDATE conversation_messages
         SET provider_status = ?,
             error_message = IF(? IS NOT NULL, ?, IF(? IN ('delivered','sent'), NULL, error_message))
         WHERE provider_message_id = ?`,
        [status.slice(0, 40), err, err, status, sid],
      );
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT m.id AS message_id, m.conversation_id, c.client_id, c.assigned_admin_id
         FROM conversation_messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE m.provider_message_id = ?
         LIMIT 1`,
        [sid],
      );
      if (rows[0]) {
        const adminId =
          rows[0].assigned_admin_id != null
            ? Number(rows[0].assigned_admin_id)
            : undefined;
        await publishConversationRealtime({
          type: "message_status",
          adminIds: adminId ? [adminId] : undefined,
          payload: {
            client_id:
              rows[0].client_id != null ? Number(rows[0].client_id) : null,
            conversation_id: Number(rows[0].conversation_id),
            message_id: Number(rows[0].message_id),
            provider_status: status,
          },
        });
      }
      return res.status(200).send("ok");
    } catch (e: any) {
      console.error("[twilio:sms-status]", e?.message ?? e);
      return res.status(500).send("error");
    }
  });
}


// ─── App ─────────────────────────────────────────────────────────────────────

function buildApp(): Express {
  const app = express();
  app.set("trust proxy", 1);
  app.use(
    cors({
      origin: true,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(csrfOriginGuard);

  const leadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.VITEST === "true" ? 1000 : 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "errors.tooMany" },
  });

  // Public tracking links: over-limit visitors still reach the site (redirect),
  // but no click row is written — stops click-count inflation without dead links.
  // JSON affiliate-card lookups answer 429 instead of redirecting.
  const referralLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max:
      Number(process.env.REFERRAL_RATE_LIMIT_MAX) ||
      (process.env.VITEST === "true" ? 1000 : 60),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      if (String(req.originalUrl || "").includes("/affiliates/by-code")) {
        return res.status(429).json({ error: "errors.tooMany" });
      }
      return res.redirect(302, "/");
    },
  });

  const otpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.VITEST === "true" ? 1000 : 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "errors.tooMany" },
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "groundwork",
      time: new Date().toISOString(),
    });
  });

  app.get("/api/ping", (_req, res) => {
    res.json({ pong: true });
  });

  app.get(["/go/free-score", "/api/public/go/free-score"], (_req, res) => {
    res.redirect(302, MFSN_FREE_SNAPSHOT_URL);
  });

  // ── Portal auth (passwordless email OTP) ─────────────────────────────────
  for (const actor of [
    "admin",
    "affiliate",
    "contractor",
    "client",
  ] as PortalActor[]) {
    const base = `/api/${actor}/auth`;

    app.post(`${base}/otp/request`, otpLimiter, async (req, res) => {
      try {
        const email = normalizeEmail(req.body?.email);
        if (!email || !EMAIL_RE.test(email)) {
          return res.status(400).json({ error: "validation.emailInvalid" });
        }
        const cfg = PORTAL_AUTH[actor];
        const [rows] = await pool.execute<RowDataPacket[]>(
          `SELECT * FROM \`${cfg.table}\` WHERE email = ? LIMIT 1`,
          [email],
        );
        const row = rows[0];
        if (!row) {
          // Anti-enumeration: same response as inactive/suspended
          return res.json({ ok: true, sent: true });
        }
        const status = String(row.status);
        if (!["active", "prospect"].includes(status)) {
          // Pending / invited: tell the owner on the login form (keys already in i18n).
          // Inactive / suspended stay silent so we don't confirm those accounts exist.
          if (status === "pending") {
            return res.status(403).json({ error: "errors.authPending" });
          }
          if (status === "invited") {
            return res.status(403).json({ error: "errors.authInvited" });
          }
          return res.json({ ok: true, sent: true });
        }

        const code = generateOtpCode();
        const expires = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);
        const ip = clientIp(req);
        const [otpInsert] = await pool.execute<ResultSetHeader>(
          `INSERT INTO \`${cfg.otpTable}\` (${cfg.idCol}, code_hash, purpose, expires_at, ip_address)
           VALUES (?, ?, 'login', ?, ?)`,
          [row.id, sha256(code), expires, ip],
        );

        const lang = row.preferred_language === "es" ? "es" : "en";
        const mail = tplPortalOtp({
          firstName: String(row.first_name || ""),
          code,
          actor,
          lang,
        });
        let delivered = false;
        let dryRun = false;
        let mailId: string | undefined;
        try {
          const mailResult = await sendEmail({
            to: email,
            subject: mail.subject,
            html: mail.html,
          });
          delivered = mailResult.ok;
          dryRun = Boolean(mailResult.dryRun);
          mailId = mailResult.id;
        } catch (e: any) {
          console.error(`[${actor}.auth] otp email threw:`, e?.message ?? e);
        }
        if (!delivered) {
          // Never claim "sent" when delivery failed: burn the code and tell the user.
          await pool.execute(
            `UPDATE \`${cfg.otpTable}\` SET consumed_at = NOW() WHERE id = ?`,
            [otpInsert.insertId],
          );
          return res.status(502).json({ error: "errors.otpSendFailed" });
        }
        if (dryRun) {
          // Dry-run (no RESEND_API_KEY, NOTIFY_EMAILS=false, or VITEST) — surface code in server log.
          console.info(
            `[${actor}.auth] OTP dry-run (emails not delivered) → ${email}: ${code}`,
          );
        } else {
          console.info(
            `[${actor}.auth] OTP emailed via Resend → ${email}` +
              (mailId ? ` (id=${mailId})` : ""),
          );
        }
        return res.json({ ok: true, sent: true });
      } catch (e: any) {
        console.error(`[${actor}.auth] otp request failed:`, e?.message ?? e);
        return res.status(500).json({ error: "errors.server" });
      }
    });

    app.post(`${base}/otp/verify`, otpLimiter, async (req, res) => {
      try {
        const email = normalizeEmail(req.body?.email);
        const code = String(req.body?.code || "").trim();
        if (!email || !EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
          return res.status(400).json({ error: "validation.otpInvalid" });
        }
        const cfg = PORTAL_AUTH[actor];
        const [rows] = await pool.execute<RowDataPacket[]>(
          `SELECT * FROM \`${cfg.table}\` WHERE email = ? LIMIT 1`,
          [email],
        );
        const row = rows[0];
        if (!row || !["active", "prospect"].includes(String(row.status))) {
          // Same answer as a wrong code: no account-state enumeration.
          return res.status(401).json({ error: "errors.authInvalid" });
        }

        const [otps] = await pool.execute<RowDataPacket[]>(
          `SELECT * FROM \`${cfg.otpTable}\`
           WHERE ${cfg.idCol} = ? AND purpose = 'login' AND consumed_at IS NULL
             AND expires_at > NOW()
           ORDER BY id DESC LIMIT 1`,
          [row.id],
        );
        const otp = otps[0];
        if (!otp) {
          return res.status(401).json({ error: "errors.authInvalid" });
        }
        if (Number(otp.attempts) >= OTP_MAX_ATTEMPTS) {
          return res.status(401).json({ error: "errors.authLocked" });
        }
        if (otp.code_hash !== sha256(code)) {
          await pool.execute(
            `UPDATE \`${cfg.otpTable}\` SET attempts = attempts + 1 WHERE id = ?`,
            [otp.id],
          );
          return res.status(401).json({ error: "errors.authInvalid" });
        }

        // Atomic consume — parallel verifies with the same code must not mint multiple sessions.
        const [consumed] = await pool.execute<ResultSetHeader>(
          `UPDATE \`${cfg.otpTable}\` SET consumed_at = NOW()
           WHERE id = ? AND consumed_at IS NULL AND code_hash = ?`,
          [otp.id, sha256(code)],
        );
        if (Number(consumed.affectedRows) !== 1) {
          return res.status(401).json({ error: "errors.authInvalid" });
        }
        let statusForUser = String(row.status);
        if (actor === "client") {
          statusForUser = await markClientLoggedIn(
            Number(row.id),
            statusForUser,
          );
          row.status = statusForUser;
        } else {
          await pool.execute(
            `UPDATE \`${cfg.table}\` SET last_login_at = NOW() WHERE id = ?`,
            [row.id],
          );
        }

        await mintPortalSession(req, res, actor, Number(row.id));

        let authUser = toPortalUser(actor, row);
        if (actor === "admin") {
          authUser = await enrichAdminAuthUser(authUser);
        }
        const payload: PortalAuthResponse = {
          ok: true,
          actor,
          user: authUser,
        };
        return res.json(payload);
      } catch (e: any) {
        console.error(`[${actor}.auth] otp verify failed:`, e?.message ?? e);
        return res.status(500).json({ error: "errors.server" });
      }
    });

    app.get(`${base}/me`, async (req, res) => {
      try {
        const user = await loadPortalUser(actor, req);
        if (!user) return res.status(401).json({ error: "errors.unauthorized" });
        if (actor === "admin") {
          const enriched = await enrichAdminAuthUser(user);
          return res.json({ ok: true, actor, user: enriched });
        }
        return res.json({ ok: true, actor, user });
      } catch (e: any) {
        console.error(`[${actor}.auth] me failed:`, e?.message ?? e);
        return res.status(500).json({ error: "errors.server" });
      }
    });

    app.post(`${base}/logout`, async (req, res) => {
      try {
        const cfg = PORTAL_AUTH[actor];
        const token = readCookie(req, cfg.cookie);
        if (token) {
          await pool.execute(
            `UPDATE \`${cfg.sessionTable}\` SET is_active = 0 WHERE token_hash = ?`,
            [sha256(token)],
          );
        }
        clearPortalCookie(res, actor);
        return res.json({ ok: true });
      } catch (e: any) {
        console.error(`[${actor}.auth] logout failed:`, e?.message ?? e);
        return res.status(500).json({ error: "errors.server" });
      }
    });
  }

  app.post(
    "/api/public/leads",
    leadLimiter,
    async (req: Request, res: Response) => {
      try {
        const parsed = parseLeadBody(req.body);
        if (parsed.ok === false) {
          return res.status(400).json({ error: parsed.error });
        }
        const data = parsed.data;
        const ip =
          (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
          req.socket.remoteAddress ||
          null;
        const ua = String(req.headers["user-agent"] || "").slice(0, 500) || null;
        const nameParts = data.full_name.trim().split(/\s+/);
        const firstName = nameParts[0] || data.full_name;
        const lastName = nameParts.slice(1).join(" ") || "";

        // ── Event RSVP: validate event, window, duplicates, capacity ────────
        let eventRow: RowDataPacket | null = null;
        let registrationStatus: EventRegistrationStatus | null = null;
        if (data.mode === "event") {
          eventRow = await loadMarketingEventById(Number(data.event_id));
          if (!eventRow) {
            return res.status(404).json({ error: "errors.eventNotFound" });
          }
          if (!eventRegistrationOpen(eventRow)) {
            return res.status(409).json({ error: "errors.eventClosed" });
          }
          const [dupes] = await pool.execute<RowDataPacket[]>(
            `SELECT id FROM leads WHERE email = ? AND event_id = ? LIMIT 1`,
            [data.email, Number(eventRow.id)],
          );
          if (dupes[0]) {
            return res.status(409).json({ error: "errors.duplicate" });
          }
          const capacity =
            eventRow.capacity == null ? null : Number(eventRow.capacity);
          registrationStatus = "confirmed";
          if (capacity != null) {
            const confirmed = await countEventRegistrations(
              Number(eventRow.id),
              "confirmed",
            );
            if (confirmed >= capacity) {
              if (Number(eventRow.waitlist_enabled) === 1) {
                registrationStatus = "waitlisted";
              } else {
                return res.status(409).json({ error: "errors.eventFull" });
              }
            }
          }
        }
        const eventCity = eventRow ? String(eventRow.city) : data.event_city || null;

        const affiliateRef = await findActiveAffiliateByCode(req.body?.referral_code);
        let leadId: number;
        if (eventRow) {
          // Event RSVPs stay one row per event (attendee list); duplicates already 409 above.
          const [result] = await pool.execute<ResultSetHeader>(
            `INSERT INTO leads (
               first_name, last_name, full_name, email, phone, property_address,
               soft_pull_consent, sms_marketing_consent, mode, event_city, event_id,
               event_registration_status, source, preferred_language,
               affiliate_id, referral_code, status, ip_address, user_agent
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
            [
              firstName.slice(0, 100),
              lastName.slice(0, 100),
              data.full_name,
              data.email,
              data.phone,
              data.property_address,
              data.soft_pull_consent ? 1 : 0,
              data.sms_marketing_consent ? 1 : 0,
              data.mode || "standard",
              eventCity,
              Number(eventRow.id),
              registrationStatus,
              data.source || "website",
              data.preferred_language || "en",
              affiliateRef?.id ?? null,
              affiliateRef?.referral_code ?? null,
              ip,
              ua,
            ],
          );
          leadId = Number(result.insertId);
          await linkLeadToPerson(leadId);
        } else {
          // Standard leads: one per person — repeat submissions merge (email OR phone).
          ({ id: leadId } = await upsertStandardLead({
            first_name: firstName,
            last_name: lastName,
            full_name: data.full_name,
            email: data.email,
            phone: data.phone,
            property_address: data.property_address || null,
            soft_pull_consent: !!data.soft_pull_consent,
            sms_marketing_consent: !!data.sms_marketing_consent,
            source: data.source || "website",
            preferred_language: data.preferred_language || "en",
            notes: eventCity ? `event_city=${eventCity}` : null,
            affiliate_id: affiliateRef?.id ?? null,
            referral_code: affiliateRef?.referral_code ?? null,
            status: "new",
            ip,
            ua,
          }));
        }
        const leadLang = data.preferred_language || "en";
        const eventTitle = eventRow
          ? String(
              pickLangField(leadLang, eventRow.title_en, eventRow.title_es) ||
                eventRow.title_en,
            )
          : null;
        const eventLocation = eventRow
          ? pickLangField(
              leadLang,
              eventRow.location_label_en,
              eventRow.location_label_es,
            ) || eventRow.venue_name || eventRow.city
          : null;

        const confirm = tplLeadConfirmation({
          fullName: data.full_name,
          mode: data.mode || "standard",
          eventCity,
          eventTitle,
          eventLocation: eventLocation ? String(eventLocation) : null,
          eventStartsAt: eventRow ? isoDate(eventRow.starts_at) : null,
          registrationStatus,
          lang: leadLang,
        });
        await sendEmail({
          to: data.email,
          subject: confirm.subject,
          html: confirm.html,
        });

        await notifyAllTeamAdmins("lead_submitted", (admin) => {
          const adminLang = admin.preferred_language === "es" ? "es" : "en";
          return tplStaffLeadAlert({
            adminFirstName: admin.first_name,
            lang: adminLang,
            lead: {
              id: leadId,
              full_name: data.full_name,
              email: data.email,
              phone: data.phone,
              property_address: data.property_address,
              mode: data.mode || "standard",
              event_city: eventCity,
              event_title: eventRow
                ? pickLangField(adminLang, eventRow.title_en, eventRow.title_es)
                : null,
              event_registration_status: registrationStatus,
              soft_pull_consent: data.soft_pull_consent,
            },
          });
        });

        const payload: SubmitLeadResponse = {
          ok: true,
          lead_id: leadId,
          message:
            data.mode === "event"
              ? registrationStatus === "waitlisted"
                ? "You're on the waitlist. Check your email for details."
                : "You're on the list. Check your email for confirmation."
              : "Thanks — we got your request. Check your email for confirmation.",
          ...(data.mode === "event"
            ? {
                event_registration_status: registrationStatus,
                credit_cta_url: `${APP_URL}/get-credit-report`,
              }
            : {}),
        };
        return res.status(201).json(payload);
      } catch (e: any) {
        console.error("[leads] submit failed:", e?.message ?? e);
        return res.status(500).json({
          error: "errors.server",
        });
      }
    },
  );

  // ── Public marketing events ──────────────────────────────────────────────
  const publicEventView = async (row: RowDataPacket, lang: Lang) => {
    const confirmed = await countEventRegistrations(Number(row.id), "confirmed");
    return toPublicEventView(mapMarketingEventRow(row), lang, confirmed);
  };

  app.get("/api/public/events/live", async (req: Request, res: Response) => {
    try {
      const row = await loadLiveEventRow();
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        ok: true,
        event: row ? await publicEventView(row, asLang(req.query.lang)) : null,
      });
    } catch (e: any) {
      console.error("[events] live failed:", e?.message ?? e);
      return res.status(500).json({ error: "errors.server" });
    }
  });

  app.get("/api/public/events/:slug", async (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug || "").toLowerCase().slice(0, 80);
      const row = slug ? await loadMarketingEventBySlug(slug) : null;
      if (!row || row.status !== "published") {
        return res.status(404).json({ error: "errors.eventNotFound" });
      }
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        ok: true,
        event: await publicEventView(row, asLang(req.query.lang)),
      });
    } catch (e: any) {
      console.error("[events] detail failed:", e?.message ?? e);
      return res.status(500).json({ error: "errors.server" });
    }
  });

  const gcrLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.VITEST === "true" ? 1000 : 12,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "errors.tooMany" },
  });

  app.post(
    "/api/public/get-credit-report-lead",
    gcrLimiter,
    async (req: Request, res: Response) => {
      try {
        const parsed = parseGetCreditReportBody(req.body);
        if (parsed.ok === false) {
          return res.status(400).json({ error: parsed.error });
        }
        const data = parsed.data;
        const fullName = `${data.first_name} ${data.last_name}`.trim();
        const ip =
          (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
          req.socket.remoteAddress ||
          null;
        const ua = String(req.headers["user-agent"] || "").slice(0, 500) || null;
        const mfsnUrl = MFSN_FREE_SNAPSHOT_URL;
        const shortUrl = `${APP_URL}/go/free-score`;

        const affiliateRef = await findActiveAffiliateByCode(req.body?.referral_code);
        // One standard lead per person — repeat submissions merge (email OR phone).
        const { id: leadId } = await upsertStandardLead({
          first_name: data.first_name,
          last_name: data.last_name,
          full_name: fullName,
          email: data.email,
          phone: data.phone,
          property_address: null,
          soft_pull_consent: !!data.soft_pull_consent,
          source: "get_credit_report",
          preferred_language: data.preferred_language,
          notes: data.notes || null,
          affiliate_id: affiliateRef?.id ?? null,
          referral_code: affiliateRef?.referral_code ?? null,
          status: "new",
          ip,
          ua,
        });

        const welcome = tplGetCreditReportWelcome({
          firstName: data.first_name,
          mfsnUrl,
          lang: data.preferred_language,
        });
        const emailResult = await sendEmail({
          to: data.email,
          subject: welcome.subject,
          html: welcome.html,
        });

        await notifyAllTeamAdmins("get_credit_report_lead", (admin) =>
          tplStaffLeadAlert({
            adminFirstName: admin.first_name,
            lang: admin.preferred_language === "es" ? "es" : "en",
            kind: "get_credit_report",
            lead: {
              id: leadId,
              full_name: fullName,
              email: data.email,
              phone: data.phone,
              property_address: "",
              mode: "standard",
              soft_pull_consent: data.soft_pull_consent,
            },
          }),
        );

        const payload: SubmitGetCreditReportLeadResponse = {
          ok: true,
          lead_id: leadId,
          mfsn_url: mfsnUrl,
          short_url: shortUrl,
          email_sent: Boolean(emailResult.ok && !emailResult.dryRun),
          message:
            "Thanks — check your email for your free credit report link.",
        };
        return res.status(201).json(payload);
      } catch (e: any) {
        console.error("[gcr] submit failed:", e?.message ?? e);
        return res.status(500).json({
          error: "errors.server",
        });
      }
    },
  );

  app.post(
    "/api/public/contact",
    leadLimiter,
    async (req: Request, res: Response) => {
      try {
        const parsed = parseContactBody(req.body);
        if (parsed.ok === false) {
          return res.status(400).json({ error: parsed.error });
        }
        const data = parsed.data;

        // intent=partner → pending affiliate (same as /partners), not a lead.
        if (data.intent === "partner") {
          try {
            const created = await createPendingPartnerAffiliate({
              full_name: data.full_name,
              email: data.email,
              phone: data.phone,
              notes: [
                `intent=partner`,
                `sms_transactional=${data.sms_transactional_consent ? 1 : 0}`,
                `sms_marketing=${data.sms_marketing_consent ? 1 : 0}`,
              ].join("; "),
              preferred_language: data.preferred_language,
              referral_code: data.referral_code,
              notifySource: "contact",
            });
            return res.status(201).json({
              ok: true,
              affiliate_id: created.affiliate_id,
              kind: "partner_affiliate",
              message: "Application received — pending review.",
            });
          } catch (e) {
            if (e instanceof HttpError) {
              return res.status(e.status).json({ error: e.key });
            }
            throw e;
          }
        }

        const ip =
          (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
          req.socket.remoteAddress ||
          null;
        const ua = String(req.headers["user-agent"] || "").slice(0, 500) || null;
        const nameParts = data.full_name.trim().split(/\s+/);
        const firstName = nameParts[0] || data.full_name;
        const lastName = nameParts.slice(1).join(" ") || "";
        const notes = [
          `intent=${data.intent}`,
          `sms_transactional=${data.sms_transactional_consent ? 1 : 0}`,
          `sms_marketing=${data.sms_marketing_consent ? 1 : 0}`,
        ].join("; ");

        // One standard lead per person — repeat messages merge (email OR phone).
        const { id: leadId } = await upsertStandardLead({
          first_name: firstName,
          last_name: lastName,
          full_name: data.full_name,
          email: data.email,
          phone: data.phone,
          property_address: null,
          soft_pull_consent: false,
          sms_marketing_consent: !!data.sms_marketing_consent,
          source: "contact_form",
          preferred_language: data.preferred_language || "en",
          notes,
          affiliate_id: null,
          referral_code: null,
          status: "new",
          ip,
          ua,
        });

        const confirm = tplGenericConfirmation({
          fullName: data.full_name,
          kind: "contact",
          lang: data.preferred_language,
        });
        await sendEmail({
          to: data.email,
          subject: confirm.subject,
          html: confirm.html,
        });

        await notifyAllTeamAdmins("contact_submitted", (admin) =>
          tplStaffLeadAlert({
            adminFirstName: admin.first_name,
            lang: admin.preferred_language === "es" ? "es" : "en",
            kind: "contact",
            lead: {
              id: leadId,
              full_name: data.full_name,
              email: data.email,
              phone: data.phone,
              property_address: notes,
              mode: "standard",
              soft_pull_consent: false,
            },
          }),
        );

        const payload: SubmitSimpleLeadResponse = {
          ok: true,
          lead_id: leadId,
          message: "Thanks — we got your message.",
        };
        return res.status(201).json(payload);
      } catch (e: any) {
        console.error("[contact] submit failed:", e?.message ?? e);
        return res.status(500).json({ error: "errors.server" });
      }
    },
  );

  app.post(
    "/api/public/partner-referral",
    leadLimiter,
    async (req: Request, res: Response) => {
      try {
        const parsed = parsePartnerBody(req.body);
        if (parsed.ok === false) {
          return res.status(400).json({ error: parsed.error });
        }
        const data = parsed.data;
        const created = await createPendingPartnerAffiliate({
          full_name: data.full_name,
          email: data.email,
          phone: data.phone,
          company: data.company,
          notes: data.notes,
          preferred_language: data.preferred_language,
          referral_code: data.referral_code,
          notifySource: "partners",
        });
        const payload: SubmitPartnerReferralResponse = {
          ok: true,
          affiliate_id: created.affiliate_id,
          message: "Application received — pending review.",
        };
        return res.status(201).json(payload);
      } catch (e: any) {
        if (e instanceof HttpError) {
          return res.status(e.status).json({ error: e.key });
        }
        console.error("[partner] submit failed:", e?.message ?? e);
        return res.status(500).json({ error: "errors.server" });
      }
    },
  );

  registerFeatureRoutes(app, { lead: leadLimiter, referral: referralLimiter });
  registerContractorApplicationRoutes(app, { lead: leadLimiter });
  registerDuplicatesRoutes(app);

  /** Vercel Cron: sync all Anchor-linked projects. Auth: Bearer CRON_SECRET. */
  app.post("/api/cron/anchor-sync", async (req, res) => {
    try {
      const secret = String(process.env.CRON_SECRET || "").trim();
      const auth = String(req.headers.authorization || "");
      if (!secret || auth !== `Bearer ${secret}`) {
        return res.status(401).json({ error: "errors.unauthorized" });
      }
      if (!anchorConfig()) {
        return res.status(503).json({ error: "errors.anchorNotConfigured", synced: 0 });
      }
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT id, public_id FROM projects
         WHERE loan_lender_type = 'anchor' AND anchor_external_id IS NOT NULL
           AND TRIM(anchor_external_id) <> ''
         ORDER BY id ASC LIMIT 200`,
      );
      const results: Array<{ public_id: string; ok: boolean; loan_status?: string; error?: string }> =
        [];
      for (const row of rows) {
        try {
          const sync = await syncProjectAnchor(Number(row.id), null);
          results.push({
            public_id: String(row.public_id),
            ok: true,
            loan_status: sync.loan_status,
          });
        } catch (e: any) {
          results.push({
            public_id: String(row.public_id),
            ok: false,
            error: e instanceof HttpError ? e.key : "errors.anchorSyncFailed",
          });
        }
      }
      return res.json({
        ok: true,
        synced: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      });
    } catch (e: any) {
      console.error("[cron.anchor-sync] failed:", e?.message ?? e);
      return res.status(500).json({ error: "errors.server" });
    }
  });

  // ─── Remote MCP (Streamable HTTP + OAuth) — super_admin only ───────────────

  type McpToolDef = {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    readOnly: boolean;
  };

  type McpAdmin = PortalAuthUser;

  const MCP_CONFIRM_PROPERTIES: Record<string, Record<string, unknown>> = {
    confirm: {
      type: "boolean",
      description:
        "Set true only after the user approves the dry-run preview. Writes require confirm=true AND confirm_phrase=CONFIRM.",
    },
    confirm_phrase: {
      type: "string",
      description: 'Required with confirm=true. Must be exactly the string CONFIRM.',
    },
  };

  function withMcpWriteConfirm(tool: McpToolDef): McpToolDef {
    if (tool.readOnly) return tool;
    const props =
      tool.inputSchema.properties &&
      typeof tool.inputSchema.properties === "object" &&
      !Array.isArray(tool.inputSchema.properties)
        ? { ...(tool.inputSchema.properties as Record<string, unknown>) }
        : {};
    const already = props.confirm != null && props.confirm_phrase != null;
    const mergedProps = already ? props : { ...props, ...MCP_CONFIRM_PROPERTIES };
    const description = /confirm_phrase|confirm=true/i.test(tool.description)
      ? tool.description
      : `${tool.description} ALWAYS dry-run first (omit confirm or confirm=false); show the preview to the user; then re-call with confirm=true and confirm_phrase=CONFIRM to execute.`;
    return {
      ...tool,
      description,
      inputSchema: {
        ...tool.inputSchema,
        type: "object",
        properties: mergedProps,
      },
    };
  }

  function sanitizeMcpArgsForLog(args: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...args };
    for (const k of Object.keys(out)) {
      if (typeof out[k] === "string" && String(out[k]).length > 800) {
        out[k] = `[omitted, ${String(out[k]).length} chars]`;
      }
    }
    return out;
  }

  function mcpJsonSchemaToZod(
    inputSchema: Record<string, unknown>,
  ): z.ZodObject<Record<string, z.ZodTypeAny>> {
    const props =
      inputSchema.properties &&
      typeof inputSchema.properties === "object" &&
      !Array.isArray(inputSchema.properties)
        ? (inputSchema.properties as Record<string, Record<string, unknown>>)
        : {};
    const required = new Set(
      Array.isArray(inputSchema.required) ? inputSchema.required.map(String) : [],
    );
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [key, prop] of Object.entries(props)) {
      const p = prop || {};
      let base: z.ZodTypeAny;
      if (Array.isArray(p.enum) && p.enum.length > 0) {
        const vals = p.enum.map(String) as [string, ...string[]];
        base = z.enum(vals);
      } else if (p.type === "integer") {
        base = z.coerce.number().int();
      } else if (p.type === "number") {
        base = z.coerce.number();
      } else if (p.type === "boolean") {
        base = z.preprocess((v) => {
          if (v === true || v === "true" || v === 1 || v === "1") return true;
          if (v === false || v === "false" || v === 0 || v === "0") return false;
          return v;
        }, z.boolean());
      } else if (p.type === "array") {
        const items = (p.items || {}) as Record<string, unknown>;
        if (items.type === "integer") base = z.array(z.coerce.number().int());
        else if (items.type === "number") base = z.array(z.coerce.number());
        else base = z.array(z.string());
      } else {
        base = z.string();
      }
      if (typeof p.description === "string" && p.description) {
        base = base.describe(p.description);
      }
      shape[key] = required.has(key) ? base : base.optional();
    }
    return Object.keys(shape).length > 0 ? z.object(shape) : z.object({});
  }

  const MCP_TOOLS_RAW: McpToolDef[] = [
    {
      name: "dashboard_summary",
      description:
        "Groundwork admin dashboard rollup: new leads, pending affiliates, invited contractors, submitted draws, projects by milestone, and finance commission/profit totals.",
      readOnly: true,
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "search_leads",
      description: "Search ADU financing leads by name/email/phone/status.",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string", description: "Search query" },
          status: {
            type: "string",
            enum: ["new", "contacted", "qualified", "closed", "spam"],
          },
          limit: { type: "integer", description: "Max rows (default 25, max 100)" },
        },
      },
    },
    {
      name: "get_lead",
      description: "Get one lead by id.",
      readOnly: true,
      inputSchema: {
        type: "object",
        required: ["lead_id"],
        properties: { lead_id: { type: "integer" } },
      },
    },
    {
      name: "search_clients",
      description: "Search clients by name/email/phone/status.",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string" },
          status: {
            type: "string",
            enum: ["pending", "prospect", "active", "inactive", "suspended"],
          },
          limit: { type: "integer" },
        },
      },
    },
    {
      name: "get_client",
      description: "Get one client by id (includes recent projects).",
      readOnly: true,
      inputSchema: {
        type: "object",
        required: ["client_id"],
        properties: { client_id: { type: "integer" } },
      },
    },
    {
      name: "search_projects",
      description: "Search ADU projects by public_id, address, milestone, or client name.",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string" },
          milestone: {
            type: "string",
            enum: ["lead", "financing", "contracted", "in_build", "closed", "cancelled"],
          },
          limit: { type: "integer" },
        },
      },
    },
    {
      name: "get_project",
      description: "Get one project by public_id or numeric id.",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          public_id: { type: "string" },
          project_id: { type: "integer" },
        },
      },
    },
    {
      name: "search_affiliates",
      description: "Search affiliates by name/email/company/status.",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string" },
          status: {
            type: "string",
            enum: ["pending", "active", "inactive", "suspended"],
          },
          limit: { type: "integer" },
        },
      },
    },
    {
      name: "get_affiliate",
      description: "Get one affiliate by id.",
      readOnly: true,
      inputSchema: {
        type: "object",
        required: ["affiliate_id"],
        properties: { affiliate_id: { type: "integer" } },
      },
    },
    {
      name: "search_contractors",
      description: "Search contractors by name/email/company/status.",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string" },
          status: {
            type: "string",
            enum: ["pending", "invited", "active", "inactive", "suspended"],
          },
          limit: { type: "integer" },
        },
      },
    },
    {
      name: "get_contractor",
      description: "Get one contractor by id.",
      readOnly: true,
      inputSchema: {
        type: "object",
        required: ["contractor_id"],
        properties: { contractor_id: { type: "integer" } },
      },
    },
    {
      name: "list_draws",
      description: "List draw requests (excludes draft unless status=draft).",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["draft", "submitted", "approved", "rejected", "paid"],
          },
          project_public_id: { type: "string" },
          limit: { type: "integer" },
        },
      },
    },
    {
      name: "list_commissions",
      description: "List affiliate commissions.",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["pending", "approved", "paid", "void"],
          },
          limit: { type: "integer" },
        },
      },
    },
    {
      name: "list_events",
      description: "List marketing events.",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["draft", "published", "archived"],
          },
          q: { type: "string" },
          limit: { type: "integer" },
        },
      },
    },
    {
      name: "get_event",
      description: "Get one marketing event by id or slug.",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          event_id: { type: "integer" },
          slug: { type: "string" },
        },
      },
    },
    {
      name: "search_staff",
      description: "Search admin staff by name/email/role/status.",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string" },
          role: {
            type: "string",
            enum: ["super_admin", "admin", "agent", "finance", "content"],
          },
          status: {
            type: "string",
            enum: ["active", "inactive", "suspended"],
          },
          limit: { type: "integer" },
        },
      },
    },
    {
      name: "list_plans",
      description: "List ADU plans (catalog).",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          active_only: { type: "boolean" },
          limit: { type: "integer" },
        },
      },
    },
    {
      name: "convert_lead",
      description:
        "Convert a lead to client/homeowner (+ project + portal invite), affiliate, or contractor. Same rules as Admin → Leads Convert (perms, phone-link confirm, email blocks).",
      readOnly: false,
      inputSchema: {
        type: "object",
        required: ["lead_id"],
        properties: {
          lead_id: { type: "integer" },
          target: {
            type: "string",
            enum: ["client", "affiliate", "contractor"],
            description: "Default client",
          },
          adu_plan_id: { type: "integer" },
          status: {
            type: "string",
            enum: ["pending", "active"],
            description: "Affiliate/contractor account status from confirm dialog",
          },
          confirm_phone_link: {
            type: "boolean",
            description: "Set true after phone_match warning to link existing person",
          },
        },
      },
    },
    {
      name: "update_project_milestone",
      description:
        "Update a project milestone using allowed Groundwork transitions (assertMilestoneTransition).",
      readOnly: false,
      inputSchema: {
        type: "object",
        required: ["milestone"],
        properties: {
          public_id: { type: "string" },
          project_id: { type: "integer" },
          milestone: {
            type: "string",
            enum: ["lead", "financing", "contracted", "in_build", "closed", "cancelled"],
          },
          note: { type: "string" },
        },
      },
    },
    {
      name: "approve_affiliate",
      description: "Approve a pending affiliate (status → active).",
      readOnly: false,
      inputSchema: {
        type: "object",
        required: ["affiliate_id"],
        properties: { affiliate_id: { type: "integer" } },
      },
    },
    {
      name: "approve_client",
      description:
        "Approve a pending homeowner self-signup (status pending → prospect) and email a portal invite.",
      readOnly: false,
      inputSchema: {
        type: "object",
        required: ["client_id"],
        properties: { client_id: { type: "integer" } },
      },
    },
    {
      name: "approve_contractor",
      description:
        "Activate a pending contractor (pending → active) and email a login notice. Requires an approved prequalification application; otherwise pass override_reason (≥5 chars, logged on the application).",
      readOnly: false,
      inputSchema: {
        type: "object",
        required: ["contractor_id"],
        properties: {
          contractor_id: { type: "integer" },
          override_reason: {
            type: "string",
            description: "Why this contractor may skip prequalification (super_admin override; audited).",
          },
        },
      },
    },
    {
      name: "invite_contractor",
      description: "Invite a contractor: emails the prequalification application link (opening it accepts the invite).",
      readOnly: false,
      inputSchema: {
        type: "object",
        required: ["email", "first_name", "last_name"],
        properties: {
          email: { type: "string" },
          first_name: { type: "string" },
          last_name: { type: "string" },
          company: { type: "string" },
          phone: { type: "string" },
          license_number: { type: "string" },
          preferred_language: { type: "string", enum: ["en", "es"] },
        },
      },
    },
    {
      name: "invite_client_portal",
      description: "Send (or re-send) a client portal invite email.",
      readOnly: false,
      inputSchema: {
        type: "object",
        required: ["client_id"],
        properties: { client_id: { type: "integer" } },
      },
    },
    {
      name: "update_draw_status",
      description: "Review a draw request: approved, rejected, or paid.",
      readOnly: false,
      inputSchema: {
        type: "object",
        required: ["draw_id", "status"],
        properties: {
          draw_id: { type: "integer" },
          status: { type: "string", enum: ["approved", "rejected", "paid"] },
          note: { type: "string" },
        },
      },
    },
    {
      name: "update_commission_status",
      description: "Update affiliate commission status (approved/paid/void/pending).",
      readOnly: false,
      inputSchema: {
        type: "object",
        required: ["commission_id", "status"],
        properties: {
          commission_id: { type: "integer" },
          status: {
            type: "string",
            enum: ["pending", "approved", "paid", "void"],
          },
          notes: { type: "string" },
        },
      },
    },
    {
      name: "create_staff",
      description:
        "Create an admin staff member and send welcome email. Cannot create super_admin via MCP — use Admin → Staff.",
      readOnly: false,
      inputSchema: {
        type: "object",
        required: ["email", "first_name", "last_name", "role"],
        properties: {
          email: { type: "string" },
          first_name: { type: "string" },
          last_name: { type: "string" },
          role: {
            type: "string",
            enum: ["admin", "agent", "finance", "content"],
          },
          phone: { type: "string" },
          preferred_language: { type: "string", enum: ["en", "es"] },
        },
      },
    },
    {
      name: "search_contacts",
      description:
        "Search CRM Contacts address-book (not pipeline clients). Active contacts only (not soft-deleted, not converted). Returns contact_id for get_contact / update_contact / convert_contact / send_contact_sms / send_contact_email.",
      readOnly: true,
      inputSchema: {
        type: "object",
        required: ["q"],
        properties: {
          q: { type: "string", description: "Search query (name, email, phone)" },
          limit: { type: "integer", description: "Max rows (1–20, default 10)" },
        },
      },
    },
    {
      name: "get_contact",
      description:
        "Fetch one CRM contact by contacts.id from search_contacts. Address book only — use convert_contact when ready to add as a client prospect.",
      readOnly: true,
      inputSchema: {
        type: "object",
        required: ["contact_id"],
        properties: { contact_id: { type: "integer" } },
      },
    },
    {
      name: "create_contact",
      description:
        "Create a CRM Contacts address-book entry (NOT a pipeline client). Required: first_name, last_name, and phone and/or email. ALWAYS dry-run first; if phone/email duplicates exist, also confirm_duplicate=true after the user approves.",
      readOnly: false,
      inputSchema: {
        type: "object",
        required: ["first_name", "last_name"],
        properties: {
          first_name: { type: "string" },
          last_name: { type: "string" },
          phone: { type: "string" },
          email: { type: "string" },
          preferred_language: { type: "string", enum: ["en", "es"] },
          notes: { type: "string", description: "Optional admin notes" },
          assigned_admin_id: { type: "integer" },
          assigned_admin_name: { type: "string" },
          assigned_admin_email: { type: "string" },
          address_line1: { type: "string" },
          address_line2: { type: "string" },
          city: { type: "string" },
          state: { type: "string" },
          zip: { type: "string" },
          confirm_duplicate: {
            type: "boolean",
            description:
              "Required true when phone/email duplicates exist and user still wants to create",
          },
        },
      },
    },
    {
      name: "update_contact",
      description:
        "Update an active CRM contact (not converted/deleted). Patch name, phone, email, language, notes, address. Does not add to pipeline (use convert_contact).",
      readOnly: false,
      inputSchema: {
        type: "object",
        required: ["contact_id"],
        properties: {
          contact_id: { type: "integer" },
          first_name: { type: "string" },
          last_name: { type: "string" },
          phone: { type: "string" },
          email: { type: "string" },
          preferred_language: { type: "string", enum: ["en", "es"] },
          notes: { type: "string" },
          assigned_admin_id: { type: "integer" },
          assigned_admin_name: { type: "string" },
          assigned_admin_email: { type: "string" },
          address_line1: { type: "string" },
          address_line2: { type: "string" },
          city: { type: "string" },
          state: { type: "string" },
          zip: { type: "string" },
          confirm_duplicate: { type: "boolean" },
        },
      },
    },
    {
      name: "convert_contact",
      description:
        "Convert a CRM contact into a client prospect (status=prospect). Archives the contact (converted_client_id) and re-links Conversations from contact_id → client_id. Requires phone and/or email on the contact (email may be null on the new client). If phone/email already matches a client, links without creating a twin.",
      readOnly: false,
      inputSchema: {
        type: "object",
        required: ["contact_id"],
        properties: {
          contact_id: { type: "integer" },
          assigned_admin_id: { type: "integer" },
          assigned_admin_name: { type: "string" },
          assigned_admin_email: { type: "string" },
        },
      },
    },
    {
      name: "send_contact_sms",
      description:
        "Send SMS via Twilio from the acting admin's assigned Groundwork brand number to a CRM Contact (address book — NOT a pipeline client). contact_id from search_contacts. Logs Conversations hub + appends [SMS …] to contacts.admin_notes. Do NOT use send_sms for contacts.",
      readOnly: false,
      inputSchema: {
        type: "object",
        required: ["contact_id", "body"],
        properties: {
          contact_id: { type: "integer" },
          body: { type: "string", description: "SMS body (max 1600 chars)" },
          from_admin_id: { type: "integer" },
          from_admin_name: { type: "string" },
          from_admin_email: { type: "string" },
          from_phone_number_id: {
            type: "integer",
            description: "admin_phone_numbers.id from list_brand_phone_numbers",
          },
        },
      },
    },
    {
      name: "send_contact_email",
      description:
        "Send a branded email via Resend to a CRM Contact (address book — NOT a pipeline client). Appends [EMAIL …] to contacts.admin_notes. No portal upload links. Do NOT use for pipeline clients.",
      readOnly: false,
      inputSchema: {
        type: "object",
        required: ["contact_id", "subject", "body"],
        properties: {
          contact_id: { type: "integer" },
          subject: { type: "string" },
          body: {
            type: "string",
            description: "Plain-text body; Hi/Hola greeting added when missing",
          },
        },
      },
    },
    {
      name: "send_sms",
      description:
        "Send SMS via Twilio from the acting admin's assigned Groundwork brand number to a CLIENT or STAFF. Client: client_id from search_clients — logs Conversations hub + client admin_notes. Staff: to_admin_id / to_admin_name. For CRM Contacts use send_contact_sms. Optional from_admin_* / from_phone_number_id to pick the From line.",
      readOnly: false,
      inputSchema: {
        type: "object",
        required: ["body"],
        properties: {
          client_id: { type: "integer" },
          to_admin_id: { type: "integer" },
          to_admin_name: { type: "string" },
          to_admin_email: { type: "string" },
          from_admin_id: { type: "integer" },
          from_admin_name: { type: "string" },
          from_admin_email: { type: "string" },
          from_phone_number_id: { type: "integer" },
          body: { type: "string" },
          message: { type: "string", description: "Alias for body" },
        },
      },
    },
    {
      name: "send_text",
      description: "Alias for send_sms.",
      readOnly: false,
      inputSchema: {
        type: "object",
        properties: {
          client_id: { type: "integer" },
          to_admin_id: { type: "integer" },
          to_admin_name: { type: "string" },
          to_admin_email: { type: "string" },
          from_admin_id: { type: "integer" },
          from_admin_name: { type: "string" },
          from_admin_email: { type: "string" },
          from_phone_number_id: { type: "integer" },
          body: { type: "string" },
          message: { type: "string" },
        },
      },
    },
    {
      name: "list_sms",
      description:
        "Read recent SMS/call/email/internal timeline messages for a client from the Conversations hub. Use before drafting a reply with send_sms. Optional channel filter (sms|call|email|internal).",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          client_id: { type: "integer" },
          channel: {
            type: "string",
            enum: ["sms", "call", "email", "internal"],
          },
          limit: { type: "integer", description: "Max messages (1–50, default 20)" },
        },
      },
    },
    {
      name: "get_texts",
      description: "Alias for list_sms.",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          client_id: { type: "integer" },
          limit: { type: "integer" },
        },
      },
    },
    {
      name: "get_conversation",
      description: "Alias for list_sms / get_texts.",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          client_id: { type: "integer" },
          limit: { type: "integer" },
        },
      },
    },
    {
      name: "get_call_insights",
      description:
        "Read recent call/voicemail rows for a client from the Conversations hub. Returns body, duration, recording presence, and Twilio transcription text when available (metadata.transcript / transcript_full). AI summaries are not generated — answer only from returned body and transcript_full.",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          client_id: { type: "integer" },
          message_id: { type: "integer" },
          limit: { type: "integer", description: "Max call rows (1–10, default 3)" },
        },
      },
    },
    {
      name: "list_brand_phone_numbers",
      description:
        "List active Groundwork Twilio brand numbers. Defaults to numbers assigned to the MCP-connected admin; super_admin may pass all=true. Includes twilio_configured and acting_admin_from.",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          all: {
            type: "boolean",
            description:
              "super_admin only: list every active platform number (default false = acting admin's assigned numbers)",
          },
        },
      },
    },
    {
      name: "list_ofg_phone_numbers",
      description:
        "Alias for list_brand_phone_numbers (Optimum-compatible name).",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: { all: { type: "boolean" } },
      },
    },
    {
      name: "send_whatsapp",
      description:
        "WhatsApp send is not configured on Groundwork yet (no 360dialog). Tool exists for Optimum parity — always returns whatsapp_not_configured. Use send_sms / send_contact_sms instead.",
      readOnly: false,
      inputSchema: {
        type: "object",
        required: ["body"],
        properties: {
          client_id: { type: "integer" },
          contact_id: { type: "integer" },
          to_admin_id: { type: "integer" },
          body: { type: "string" },
        },
      },
    },
    {
      name: "send_wa",
      description: "Alias for send_whatsapp (not configured on Groundwork).",
      readOnly: false,
      inputSchema: {
        type: "object",
        required: ["body"],
        properties: {
          client_id: { type: "integer" },
          contact_id: { type: "integer" },
          body: { type: "string" },
        },
      },
    },
    {
      name: "send_contact_whatsapp",
      description:
        "WhatsApp to CRM contact — not configured on Groundwork yet. Use send_contact_sms.",
      readOnly: false,
      inputSchema: {
        type: "object",
        required: ["contact_id", "body"],
        properties: {
          contact_id: { type: "integer" },
          body: { type: "string" },
        },
      },
    },
    {
      name: "list_whatsapp",
      description:
        "WhatsApp timeline — not available (no whatsapp channel on Groundwork). Use list_sms.",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          client_id: { type: "integer" },
          limit: { type: "integer" },
        },
      },
    },
  ];

  const MCP_TOOLS: McpToolDef[] = MCP_TOOLS_RAW.map(withMcpWriteConfirm);

  function mcpLimit(args: Record<string, unknown>, def = 25, max = 100): number {
    const n = Number(args.limit ?? def);
    if (!Number.isFinite(n) || n < 1) return def;
    return Math.min(Math.floor(n), max);
  }

  async function executeMcpTool(
    admin: McpAdmin,
    name: string,
    args: Record<string, unknown>,
    confirm: boolean,
  ): Promise<{ ok: boolean; result?: unknown; error?: string; dry_run?: boolean }> {
    const tool = MCP_TOOLS.find((t) => t.name === name);
    if (!tool) return { ok: false, error: `Unknown tool: ${name}` };

    /** Conversations/contacts writes build a richer dry-run inside the case. */
    const MCP_RICH_DRY_RUN = new Set([
      "create_contact",
      "update_contact",
      "convert_contact",
      "send_contact_sms",
      "send_contact_email",
      "send_sms",
      "send_text",
      "send_whatsapp",
      "send_wa",
      "send_contact_whatsapp",
    ]);
    const writeConfirmed =
      confirm && mcpStr(args.confirm_phrase) === "CONFIRM";
    if (!tool.readOnly && !writeConfirmed && !MCP_RICH_DRY_RUN.has(name)) {
      return {
        ok: true,
        dry_run: true,
        result: {
          preview: true,
          tool: name,
          message: 'Pass confirm=true and confirm_phrase="CONFIRM" to execute.',
          args: sanitizeMcpArgsForLog(args),
        },
      };
    }

    try {
      switch (name) {
        case "dashboard_summary": {
          const count = async (sql: string) => {
            const [rows] = await pool.query<RowDataPacket[]>(sql);
            return Number(rows[0]?.n || 0);
          };
          const [milestones] = await pool.query<RowDataPacket[]>(
            `SELECT milestone, COUNT(*) AS n FROM projects GROUP BY milestone`,
          );
          const [draws] = await pool.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents
             FROM draw_requests WHERE status = 'submitted'`,
          );
          const [comm] = await pool.query<RowDataPacket[]>(
            `SELECT status, COALESCE(SUM(amount_cents), 0) AS cents
             FROM affiliate_commissions GROUP BY status`,
          );
          const byComm = Object.fromEntries(
            comm.map((c) => [String(c.status), Number(c.cents)]),
          );
          return {
            ok: true,
            result: {
              leads_new: await count(`SELECT COUNT(*) AS n FROM leads WHERE status = 'new'`),
              affiliates_pending: await count(
                `SELECT COUNT(*) AS n FROM affiliates WHERE status = 'pending'`,
              ),
              clients_pending: await count(
                `SELECT COUNT(*) AS n FROM clients WHERE status = 'pending'`,
              ),
              contractors_pending: await count(
                `SELECT COUNT(*) AS n FROM contractors WHERE status = 'pending'`,
              ),
              contractors_invited: await count(
                `SELECT COUNT(*) AS n FROM contractors WHERE status = 'invited'`,
              ),
              draws_submitted: Number(draws[0]?.n || 0),
              draws_submitted_cents: Number(draws[0]?.cents || 0),
              projects_by_milestone: Object.fromEntries(
                milestones.map((m) => [String(m.milestone), Number(m.n)]),
              ),
              finance: {
                commissions_pending_cents: byComm.pending || 0,
                commissions_approved_cents: byComm.approved || 0,
                commissions_paid_cents: byComm.paid || 0,
              },
            },
          };
        }
        case "search_leads": {
          const like = likeParam(args.q);
          const status = ["new", "contacted", "qualified", "closed", "spam"].includes(
            mcpStr(args.status),
          )
            ? mcpStr(args.status)
            : null;
          const limit = mcpLimit(args);
          const where: string[] = [];
          const params: any[] = [];
          if (status) {
            where.push("status = ?");
            params.push(status);
          }
          if (like) {
            where.push(
              "(first_name LIKE ? OR last_name LIKE ? OR full_name LIKE ? OR email LIKE ? OR phone LIKE ?)",
            );
            params.push(like, like, like, like, like);
          }
          const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT id, email, first_name, last_name, full_name, phone, status, mode,
                    property_address, created_at, client_id
             FROM leads
             ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
             ORDER BY id DESC LIMIT ${limit}`,
            params,
          );
          return { ok: true, result: { leads: rows } };
        }
        case "get_lead": {
          const id = Number(args.lead_id);
          if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "invalid lead_id" };
          const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT id, email, first_name, last_name, full_name, phone, status, mode,
                    property_address, soft_pull_consent, event_city, event_id,
                    event_registration_status, source, affiliate_id, client_id,
                    referral_code, preferred_language, notes, created_at, updated_at
             FROM leads WHERE id = ? LIMIT 1`,
            [id],
          );
          if (!rows[0]) return { ok: false, error: "lead not found" };
          return { ok: true, result: { lead: rows[0] } };
        }
        case "search_clients": {
          const like = likeParam(args.q);
          const status = ["pending", "prospect", "active", "inactive", "suspended"].includes(
            mcpStr(args.status),
          )
            ? mcpStr(args.status)
            : null;
          const limit = mcpLimit(args);
          const where: string[] = [];
          const params: any[] = [];
          if (status) {
            where.push("status = ?");
            params.push(status);
          }
          if (like) {
            where.push(
              "(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone LIKE ?)",
            );
            params.push(like, like, like, like);
          }
          const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT id, email, first_name, last_name, phone, status, city, created_at
             FROM clients
             ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
             ORDER BY id DESC LIMIT ${limit}`,
            params,
          );
          return { ok: true, result: { clients: rows } };
        }
        case "get_client": {
          const id = Number(args.client_id);
          if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "invalid client_id" };
          const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT id, email, first_name, last_name, phone, preferred_language, status,
                    address_line1, address_line2, city, state, zip, affiliate_id,
                    assigned_admin_id, lead_id, email_verified_at, last_login_at,
                    created_at, updated_at
             FROM clients WHERE id = ? LIMIT 1`,
            [id],
          );
          if (!rows[0]) return { ok: false, error: "client not found" };
          const [projects] = await pool.execute<RowDataPacket[]>(
            `SELECT id, public_id, milestone, property_address, loan_status, created_at
             FROM projects WHERE client_id = ? ORDER BY id DESC LIMIT 20`,
            [id],
          );
          return { ok: true, result: { client: rows[0], projects } };
        }
        case "search_projects": {
          const like = likeParam(args.q);
          const milestone = [
            "lead",
            "financing",
            "contracted",
            "in_build",
            "closed",
            "cancelled",
          ].includes(mcpStr(args.milestone))
            ? mcpStr(args.milestone)
            : null;
          const limit = mcpLimit(args);
          const where: string[] = [];
          const params: any[] = [];
          if (milestone) {
            where.push("p.milestone = ?");
            params.push(milestone);
          }
          if (like) {
            where.push(
              "(p.public_id LIKE ? OR p.property_address LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ?)",
            );
            params.push(like, like, like, like, like);
          }
          const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT p.id, p.public_id, p.milestone, p.property_address, p.loan_status,
                    p.sale_price_cents, p.created_at, c.first_name, c.last_name, c.email
             FROM projects p
             JOIN clients c ON c.id = p.client_id
             ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
             ORDER BY p.id DESC LIMIT ${limit}`,
            params,
          );
          return { ok: true, result: { projects: rows } };
        }
        case "get_project": {
          const publicId = mcpStr(args.public_id);
          const projectId = Number(args.project_id);
          let rows: RowDataPacket[] = [];
          if (publicId) {
            const [r] = await pool.execute<RowDataPacket[]>(
              `SELECT p.*, c.email AS client_email, c.first_name AS client_first, c.last_name AS client_last
               FROM projects p JOIN clients c ON c.id = p.client_id
               WHERE p.public_id = ? LIMIT 1`,
              [publicId],
            );
            rows = r;
          } else if (Number.isInteger(projectId) && projectId > 0) {
            const [r] = await pool.execute<RowDataPacket[]>(
              `SELECT p.*, c.email AS client_email, c.first_name AS client_first, c.last_name AS client_last
               FROM projects p JOIN clients c ON c.id = p.client_id
               WHERE p.id = ? LIMIT 1`,
              [projectId],
            );
            rows = r;
          } else {
            return { ok: false, error: "public_id or project_id required" };
          }
          if (!rows[0]) return { ok: false, error: "project not found" };
          return { ok: true, result: { project: rows[0] } };
        }
        case "search_affiliates": {
          const like = likeParam(args.q);
          const status = ["pending", "active", "inactive", "suspended"].includes(
            mcpStr(args.status),
          )
            ? mcpStr(args.status)
            : null;
          const limit = mcpLimit(args);
          const where: string[] = [];
          const params: any[] = [];
          if (status) {
            where.push("status = ?");
            params.push(status);
          }
          if (like) {
            where.push(
              "(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR company LIKE ?)",
            );
            params.push(like, like, like, like);
          }
          const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT id, email, first_name, last_name, company, status, referral_code, created_at
             FROM affiliates
             ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
             ORDER BY id DESC LIMIT ${limit}`,
            params,
          );
          return { ok: true, result: { affiliates: rows } };
        }
        case "get_affiliate": {
          const id = Number(args.affiliate_id);
          if (!Number.isInteger(id) || id <= 0)
            return { ok: false, error: "invalid affiliate_id" };
          const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT id, email, first_name, last_name, phone, company, status,
                    preferred_language, referral_code, slug, approved_at,
                    approved_by_admin_id, last_login_at, created_at, updated_at
             FROM affiliates WHERE id = ? LIMIT 1`,
            [id],
          );
          if (!rows[0]) return { ok: false, error: "affiliate not found" };
          return { ok: true, result: { affiliate: rows[0] } };
        }
        case "search_contractors": {
          const like = likeParam(args.q);
          const status = ["pending", "invited", "active", "inactive", "suspended"].includes(
            mcpStr(args.status),
          )
            ? mcpStr(args.status)
            : null;
          const limit = mcpLimit(args);
          const where: string[] = [];
          const params: any[] = [];
          if (status) {
            where.push("status = ?");
            params.push(status);
          }
          if (like) {
            where.push(
              "(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR company LIKE ?)",
            );
            params.push(like, like, like, like);
          }
          const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT id, email, first_name, last_name, company, status, license_number, created_at
             FROM contractors
             ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
             ORDER BY id DESC LIMIT ${limit}`,
            params,
          );
          return { ok: true, result: { contractors: rows } };
        }
        case "get_contractor": {
          const id = Number(args.contractor_id);
          if (!Number.isInteger(id) || id <= 0)
            return { ok: false, error: "invalid contractor_id" };
          const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT id, email, first_name, last_name, phone, company, license_number,
                    status, preferred_language, invited_by_admin_id, activated_at,
                    last_login_at, created_at, updated_at
             FROM contractors WHERE id = ? LIMIT 1`,
            [id],
          );
          if (!rows[0]) return { ok: false, error: "contractor not found" };
          return { ok: true, result: { contractor: rows[0] } };
        }
        case "list_draws": {
          const status = ["draft", "submitted", "approved", "rejected", "paid"].includes(
            mcpStr(args.status),
          )
            ? mcpStr(args.status)
            : null;
          const pub = mcpStr(args.project_public_id);
          const limit = mcpLimit(args, 50, 200);
          const where: string[] = [];
          const params: any[] = [];
          if (status) {
            where.push("d.status = ?");
            params.push(status);
          } else {
            where.push("d.status <> 'draft'");
          }
          if (pub) {
            where.push("p.public_id = ?");
            params.push(pub);
          }
          const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT d.id, d.amount_cents, d.status, d.note, d.created_at, d.reviewed_at, d.paid_at,
                    p.public_id AS project_public_id,
                    CONCAT(k.first_name, ' ', k.last_name) AS contractor_name
             FROM draw_requests d
             JOIN projects p ON p.id = d.project_id
             JOIN contractors k ON k.id = d.contractor_id
             WHERE ${where.join(" AND ")}
             ORDER BY d.id DESC LIMIT ${limit}`,
            params,
          );
          return { ok: true, result: { draws: rows } };
        }
        case "list_commissions": {
          const status = ["pending", "approved", "paid", "void"].includes(
            mcpStr(args.status),
          )
            ? mcpStr(args.status)
            : null;
          const limit = mcpLimit(args, 50, 200);
          const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT ac.id, ac.amount_cents, ac.status, ac.expected_pay_at, ac.paid_at, ac.created_at,
                    CONCAT(a.first_name, ' ', a.last_name) AS affiliate_name,
                    p.public_id AS project_public_id
             FROM affiliate_commissions ac
             JOIN affiliates a ON a.id = ac.affiliate_id
             JOIN projects p ON p.id = ac.project_id
             ${status ? "WHERE ac.status = ?" : ""}
             ORDER BY ac.id DESC LIMIT ${limit}`,
            status ? [status] : [],
          );
          return { ok: true, result: { commissions: rows } };
        }
        case "list_events": {
          const status = ["draft", "published", "archived"].includes(
            mcpStr(args.status),
          )
            ? mcpStr(args.status)
            : null;
          const like = likeParam(args.q);
          const limit = mcpLimit(args);
          const where: string[] = [];
          const params: any[] = [];
          if (status) {
            where.push("status = ?");
            params.push(status);
          }
          if (like) {
            where.push("(slug LIKE ? OR title_en LIKE ? OR title_es LIKE ? OR city LIKE ?)");
            params.push(like, like, like, like);
          }
          const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT id, slug, status, starts_at, city, title_en, title_es, is_featured
             FROM marketing_events
             ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
             ORDER BY starts_at DESC LIMIT ${limit}`,
            params,
          );
          return { ok: true, result: { events: rows } };
        }
        case "get_event": {
          const id = Number(args.event_id);
          const slug = mcpStr(args.slug);
          let rows: RowDataPacket[] = [];
          if (Number.isInteger(id) && id > 0) {
            const [r] = await pool.execute<RowDataPacket[]>(
              `SELECT * FROM marketing_events WHERE id = ? LIMIT 1`,
              [id],
            );
            rows = r;
          } else if (slug) {
            const [r] = await pool.execute<RowDataPacket[]>(
              `SELECT * FROM marketing_events WHERE slug = ? LIMIT 1`,
              [slug],
            );
            rows = r;
          } else {
            return { ok: false, error: "event_id or slug required" };
          }
          if (!rows[0]) return { ok: false, error: "event not found" };
          return { ok: true, result: { event: mapMarketingEventRow(rows[0]) } };
        }
        case "search_staff": {
          const like = likeParam(args.q);
          const role = ["super_admin", "admin", "agent", "finance", "content"].includes(
            mcpStr(args.role),
          )
            ? mcpStr(args.role)
            : null;
          const status = ["active", "inactive", "suspended"].includes(mcpStr(args.status))
            ? mcpStr(args.status)
            : null;
          const limit = mcpLimit(args);
          const where: string[] = [];
          const params: any[] = [];
          if (role) {
            where.push("role = ?");
            params.push(role);
          }
          if (status) {
            where.push("status = ?");
            params.push(status);
          }
          if (like) {
            where.push("(first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)");
            params.push(like, like, like);
          }
          const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT id, email, first_name, last_name, role, status, last_login_at, created_at
             FROM admins
             ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
             ORDER BY id ASC LIMIT ${limit}`,
            params,
          );
          return { ok: true, result: { staff: rows } };
        }
        case "list_plans": {
          const activeOnly = args.active_only !== false;
          const limit = mcpLimit(args, 50, 200);
          const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT id, name, sq_ft, default_commission_cents, is_active, sort_order
             FROM adu_plans
             ${activeOnly ? "WHERE is_active = 1" : ""}
             ORDER BY sort_order ASC, id ASC LIMIT ${limit}`,
          );
          return { ok: true, result: { plans: rows } };
        }
        case "convert_lead": {
          const id = Number(args.lead_id);
          if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "invalid lead_id" };
          const targetRaw = String(args.target || "client").trim().toLowerCase();
          const target =
            targetRaw === "affiliate" || targetRaw === "contractor" ? targetRaw : "client";
          if (target === "client" && !adminCan(admin.role, "projects.write")) {
            return { ok: false, error: "errors.forbidden" };
          }
          if (
            (target === "affiliate" || target === "contractor") &&
            !adminCan(admin.role, "approvals")
          ) {
            return { ok: false, error: "errors.forbidden" };
          }
          try {
            const out = await runAdminLeadConvert({
              user: admin,
              leadId: id,
              body: {
                target,
                adu_plan_id: args.adu_plan_id ?? null,
                status: args.status,
                confirm_phone_link: args.confirm_phone_link === true,
                override_reason: args.override_reason,
                shared_phone_reason: args.shared_phone_reason,
              },
            });
            if (out.status >= 400) {
              return {
                ok: false,
                error: String((out.body as { error?: string }).error || "errors.server"),
                result: out.body,
              };
            }
            return { ok: true, result: out.body };
          } catch (e) {
            if (e instanceof HttpError) return { ok: false, error: e.key, result: e.data };
            throw e;
          }
        }
        case "update_project_milestone": {
          const milestone = mcpStr(args.milestone);
          const publicId = mcpStr(args.public_id);
          const projectId = Number(args.project_id);
          let old: RowDataPacket | undefined;
          if (publicId) {
            const [r] = await pool.execute<RowDataPacket[]>(
              `SELECT id, public_id, milestone, contractor_id FROM projects WHERE public_id = ? LIMIT 1`,
              [publicId],
            );
            old = r[0];
          } else if (Number.isInteger(projectId) && projectId > 0) {
            const [r] = await pool.execute<RowDataPacket[]>(
              `SELECT id, public_id, milestone, contractor_id FROM projects WHERE id = ? LIMIT 1`,
              [projectId],
            );
            old = r[0];
          } else {
            return { ok: false, error: "public_id or project_id required" };
          }
          if (!old) return { ok: false, error: "project not found" };
          try {
            assertMilestoneTransition(old.milestone, milestone);
          } catch (e) {
            if (e instanceof HttpError) return { ok: false, error: e.key };
            throw e;
          }
          if (milestone === "in_build" && !old.contractor_id) {
            return { ok: false, error: "errors.contractorRequired" };
          }
          const note = mcpStr(args.note).slice(0, 500) || null;
          await withTx(async (conn) => {
            await conn.execute(
              `UPDATE projects SET milestone = ?, milestone_changed_at = NOW() WHERE id = ?`,
              [milestone, old!.id],
            );
            await conn.execute(
              `INSERT INTO project_milestone_events
                 (project_id, from_milestone, to_milestone, changed_by_type, changed_by_id, note)
               VALUES (?,?,?,?,?,?)`,
              [old!.id, old!.milestone, milestone, "admin", admin.id, note],
            );
          });
          return {
            ok: true,
            result: {
              public_id: old.public_id,
              from: old.milestone,
              to: milestone,
            },
          };
        }
        case "approve_affiliate": {
          const id = Number(args.affiliate_id);
          if (!Number.isInteger(id) || id <= 0)
            return { ok: false, error: "invalid affiliate_id" };
          const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT id, status, email, first_name, preferred_language FROM affiliates WHERE id = ? LIMIT 1`,
            [id],
          );
          if (!rows[0]) return { ok: false, error: "affiliate not found" };
          if (rows[0].status !== "pending" && rows[0].status !== "inactive") {
            return { ok: false, error: `cannot approve from status ${rows[0].status}` };
          }
          await pool.execute(
            `UPDATE affiliates SET status = 'active', approved_at = COALESCE(approved_at, NOW()), approved_by_admin_id = ? WHERE id = ?`,
            [admin.id, id],
          );
          const lang = asLang(rows[0].preferred_language);
          await safeSend(
            String(rows[0].email),
            tplPortalNotice({
              lang,
              subject: tr(lang, "Affiliate approved — Groundwork Capital", "Afiliado aprobado — Groundwork Capital"),
              headline: tr(lang, "You're approved.", "Estás aprobado."),
              paragraphs: [
                tr(
                  lang,
                  `Hi ${rows[0].first_name}, your affiliate account is active.`,
                  `Hola ${rows[0].first_name}, tu cuenta de afiliado está activa.`,
                ),
              ],
              cta: {
                url: `${APP_URL}/affiliate/login`,
                label: tr(lang, "Open affiliate portal", "Abrir portal de afiliados"),
              },
            }),
          );
          return { ok: true, result: { affiliate_id: id, status: "active" } };
        }
        case "approve_client": {
          const id = Number(args.client_id);
          if (!Number.isInteger(id) || id <= 0)
            return { ok: false, error: "invalid client_id" };
          const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT id, status, email, first_name, preferred_language FROM clients WHERE id = ? LIMIT 1`,
            [id],
          );
          if (!rows[0]) return { ok: false, error: "client not found" };
          if (String(rows[0].status) !== "pending") {
            return {
              ok: false,
              error: `cannot approve from status ${rows[0].status}`,
            };
          }
          await pool.execute(`UPDATE clients SET status = 'prospect' WHERE id = ?`, [
            id,
          ]);
          const token = await issueClientPortalInvite(pool, {
            clientId: id,
            email: String(rows[0].email),
            byType: "admin",
            byId: admin.id,
          });
          await sendClientPortalInviteEmail({
            email: String(rows[0].email),
            firstName: String(rows[0].first_name || ""),
            lang: asLang(rows[0].preferred_language),
            token,
          });
          return {
            ok: true,
            result: { client_id: id, status: "prospect", invite_sent: true },
          };
        }
        case "approve_contractor": {
          const id = Number(args.contractor_id);
          if (!Number.isInteger(id) || id <= 0)
            return { ok: false, error: "invalid contractor_id" };
          const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT id, status, email, first_name, preferred_language FROM contractors WHERE id = ? LIMIT 1`,
            [id],
          );
          if (!rows[0]) return { ok: false, error: "contractor not found" };
          if (String(rows[0].status) !== "pending") {
            return {
              ok: false,
              error: `cannot approve from status ${rows[0].status}`,
            };
          }
          let override: string | null = null;
          try {
            ({ override } = await assertContractorActivationAllowed(id, admin, args.override_reason));
          } catch (e) {
            if (e instanceof HttpError) return { ok: false, error: e.key };
            throw e;
          }
          await pool.execute(
            `UPDATE contractors SET status = 'active', activated_at = COALESCE(activated_at, NOW()) WHERE id = ?`,
            [id],
          );
          if (override) await recordContractorActivationOverride(id, admin.id, override);
          await sendContractorApprovedEmail({
            email: String(rows[0].email),
            first_name: String(rows[0].first_name),
            preferred_language: rows[0].preferred_language,
          });
          return { ok: true, result: { contractor_id: id, status: "active" } };
        }
        case "invite_contractor": {
          const email = normalizeEmail(args.email);
          const first = mcpStr(args.first_name).slice(0, 100);
          const last = mcpStr(args.last_name).slice(0, 100);
          const company = mcpStr(args.company).slice(0, 200) || null;
          const license = mcpStr(args.license_number).slice(0, 100) || null;
          const phone = mcpStr(args.phone).slice(0, 40) || null;
          const lang = asLang(args.preferred_language);
          if (!isValidEmail(email)) return { ok: false, error: "validation.emailInvalid" };
          if (!first) return { ok: false, error: "validation.firstNameRequired" };
          if (!last) return { ok: false, error: "validation.lastNameRequired" };
          const [ex] = await pool.execute<RowDataPacket[]>(
            `SELECT id, status FROM contractors WHERE email = ? LIMIT 1`,
            [email],
          );
          if (ex[0] && ex[0].status !== "invited") {
            return { ok: false, error: "errors.contractorExists" };
          }
          let mcpPhoneOverride: { reason: string; matches: PersonMatch[] } | null = null;
          try {
            ({ phoneOverride: mcpPhoneOverride } = await assertPersonAvailable({
              email,
              phone,
              actor: "staff",
              sharedPhoneReason: args.shared_phone_reason,
              exclude: ex[0] ? [{ entity: "contractor", id: Number(ex[0].id) }] : [],
            }));
          } catch (e) {
            if (e instanceof HttpError) return { ok: false, error: e.key, result: e.data };
            throw e;
          }
          const token = crypto.randomBytes(32).toString("hex");
          const contractorId = await withTx(async (conn) => {
            let cid: number;
            if (ex[0]) {
              cid = Number(ex[0].id);
              await conn.execute(
                `UPDATE contractors SET first_name = ?, last_name = ?, company = ?,
                   license_number = ?, phone = ?, preferred_language = ?,
                   invited_by_admin_id = ? WHERE id = ?`,
                [first, last, company, license, phone, lang, admin.id, cid],
              );
              await conn.execute(
                `UPDATE contractor_invites SET expires_at = NOW()
                 WHERE contractor_id = ? AND accepted_at IS NULL`,
                [cid],
              );
            } else {
              const [r] = await conn.execute<ResultSetHeader>(
                `INSERT INTO contractors
                   (email, first_name, last_name, phone, company, license_number, status,
                    preferred_language, invited_by_admin_id)
                 VALUES (?, ?, ?, ?, ?, ?, 'invited', ?, ?)`,
                [email, first, last, phone, company, license, lang, admin.id],
              );
              cid = Number(r.insertId);
            }
            await conn.execute(
              `INSERT INTO contractor_invites (token, email, contractor_id, created_by_admin_id, expires_at)
               VALUES (?, ?, ?, ?, ?)`,
              [token, email, cid, admin.id, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)],
            );
            return cid;
          });
          if (mcpPhoneOverride) {
            await recordSharedPhoneOverride({ entity: "contractor", id: contractorId, override: mcpPhoneOverride, adminId: admin.id });
          }
          await sendContractorApplicationLink({ contractorId, adminId: admin.id, variant: "new" });
          return { ok: true, result: { contractor_id: contractorId, invite_sent: true } };
        }
        case "invite_client_portal": {
          const id = Number(args.client_id);
          if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "invalid client_id" };
          const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT email, first_name, preferred_language, status FROM clients WHERE id = ? LIMIT 1`,
            [id],
          );
          const c = rows[0];
          if (!c) return { ok: false, error: "client not found" };
          if (!["prospect", "active"].includes(String(c.status))) {
            return { ok: false, error: "errors.authInactive" };
          }
          const token = await issueClientPortalInvite(pool, {
            clientId: id,
            email: String(c.email),
            byType: "admin",
            byId: admin.id,
          });
          await sendClientPortalInviteEmail({
            email: String(c.email),
            firstName: String(c.first_name || ""),
            lang: asLang(c.preferred_language),
            token,
            publicId: undefined,
          });
          return { ok: true, result: { client_id: id, invite_sent: true } };
        }
        case "update_draw_status": {
          const id = Number(args.draw_id);
          const next = mcpStr(args.status);
          if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "invalid draw_id" };
          if (!["approved", "rejected", "paid"].includes(next)) {
            return { ok: false, error: "invalid status" };
          }
          const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT d.id, d.status, d.amount_cents, p.public_id, k.email, k.first_name, k.preferred_language
             FROM draw_requests d JOIN projects p ON p.id = d.project_id
             JOIN contractors k ON k.id = d.contractor_id WHERE d.id = ? LIMIT 1`,
            [id],
          );
          const d = rows[0];
          if (!d) return { ok: false, error: "draw not found" };
          const allowed: Record<string, string[]> = {
            submitted: ["approved", "rejected"],
            approved: ["paid", "rejected"],
          };
          if (!allowed[String(d.status)]?.includes(next)) {
            return { ok: false, error: "errors.invalidTransition" };
          }
          const note = mcpStr(args.note).slice(0, 2000) || null;
          const updates: Record<string, unknown> = {
            status: next,
            reviewed_by_admin_id: admin.id,
            reviewed_at: new Date(),
          };
          if (note) updates.note = note;
          if (next === "paid") updates.paid_at = new Date();
          await withTx(async (conn) => {
            await applyUpdate(conn, "draw_requests", id, updates);
            if (next === "rejected") {
              await conn.execute(
                `UPDATE projects p
                 JOIN draw_requests d ON d.project_id = p.id
                 SET p.draw_committed_cents = GREATEST(0, CAST(p.draw_committed_cents AS SIGNED) - d.amount_cents)
                 WHERE d.id = ?`,
                [id],
              );
            }
          });
          return { ok: true, result: { draw_id: id, status: next, project_public_id: d.public_id } };
        }
        case "update_commission_status": {
          const id = Number(args.commission_id);
          const next = mcpStr(args.status);
          if (!Number.isInteger(id) || id <= 0)
            return { ok: false, error: "invalid commission_id" };
          if (!["pending", "approved", "paid", "void"].includes(next)) {
            return { ok: false, error: "invalid status" };
          }
          const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT ac.*, p.public_id FROM affiliate_commissions ac
             JOIN projects p ON p.id = ac.project_id WHERE ac.id = ? LIMIT 1`,
            [id],
          );
          const c = rows[0];
          if (!c) return { ok: false, error: "commission not found" };
          if (c.status === "paid") return { ok: false, error: "errors.invalidTransition" };
          const allowed: Record<string, string[]> = {
            pending: ["approved", "void"],
            approved: ["paid", "void", "pending"],
            void: ["pending"],
          };
          if (!allowed[String(c.status)]?.includes(next)) {
            return { ok: false, error: "errors.invalidTransition" };
          }
          const updates: Record<string, unknown> = { status: next };
          if (next === "paid") updates.paid_at = new Date();
          const notes = mcpStr(args.notes).slice(0, 500);
          if (notes) updates.notes = notes;
          await withTx(async (conn) => {
            await applyUpdate(conn, "affiliate_commissions", id, updates);
            if (next === "paid") {
              const projectId = Number(c.project_id);
              const [[sumRow]] = (await conn.execute<RowDataPacket[]>(
                `SELECT COALESCE(SUM(amount_cents), 0) AS n FROM affiliate_commissions
                 WHERE project_id = ? AND status IN ('pending','approved','paid')`,
                [projectId],
              )) as unknown as [RowDataPacket[]];
              const affComm = Number(sumRow?.n || 0);
              const [projRows] = await conn.execute<RowDataPacket[]>(
                `SELECT * FROM projects WHERE id = ? LIMIT 1`,
                [projectId],
              );
              const proj = projRows[0];
              if (proj) {
                const econ = computeProjectEconomics({
                  sale_price_cents: proj.sale_price_cents ?? null,
                  contractor_cost_cents: proj.contractor_cost_cents ?? null,
                  affiliate_commission_cents: affComm,
                  agent_commission_cents: proj.agent_commission_cents ?? null,
                  sq_ft: proj.sq_ft ?? null,
                });
                await conn.execute(
                  `UPDATE projects SET affiliate_commission_cents = ?, net_profit_cents = ?,
                     net_profit_per_sqft_cents = ? WHERE id = ?`,
                  [affComm, econ.net_profit_cents, econ.net_profit_per_sqft_cents, projectId],
                );
              }
              const [[open]] = (await conn.execute<RowDataPacket[]>(
                `SELECT COUNT(*) AS n FROM affiliate_commissions
                 WHERE project_id = ? AND status IN ('pending','approved')`,
                [projectId],
              )) as unknown as [RowDataPacket[]];
              if (Number(open?.n || 0) === 0) {
                await conn.execute(
                  `UPDATE projects SET commission_paid_at = NOW() WHERE id = ?`,
                  [projectId],
                );
              }
            }
          });
          return {
            ok: true,
            result: { commission_id: id, status: next, project_public_id: c.public_id },
          };
        }
        case "create_staff": {
          const email = normalizeEmail(args.email);
          const first = mcpStr(args.first_name).slice(0, 100);
          const last = mcpStr(args.last_name).slice(0, 100);
          const role = mcpStr(args.role);
          const phone = mcpStr(args.phone).slice(0, 20) || null;
          const lang = asLang(args.preferred_language);
          if (!isValidEmail(email)) return { ok: false, error: "validation.emailInvalid" };
          if (!first) return { ok: false, error: "validation.firstNameRequired" };
          if (!last) return { ok: false, error: "validation.lastNameRequired" };
          if (!["super_admin", "admin", "agent", "finance", "content"].includes(role)) {
            return { ok: false, error: "validation.invalidField" };
          }
          // MCP must not mint additional super_admins (use Admin → Staff UI for that).
          if (role === "super_admin") {
            return {
              ok: false,
              error: "MCP cannot create super_admin — use Admin → Staff",
            };
          }
          const [r] = await pool.execute<ResultSetHeader>(
            `INSERT INTO admins (email, first_name, last_name, phone, role, status, preferred_language)
             VALUES (?, ?, ?, ?, ?, 'active', ?)`,
            [email, first, last, phone, role, lang],
          );
          await safeSend(
            email,
            tplPortalNotice({
              lang,
              subject: tr(lang, "You've been added to Groundwork Admin", "Te agregaron a Groundwork Admin"),
              headline: tr(lang, "Welcome to the team.", "Bienvenido al equipo."),
              paragraphs: [
                tr(
                  lang,
                  `Hi ${first}, you now have ${role.replace("_", " ")} access.`,
                  `Hola ${first}, ahora tienes acceso de ${role.replace("_", " ")}.`,
                ),
              ],
              cta: {
                url: `${APP_URL}/admin/login`,
                label: tr(lang, "Open admin portal", "Abrir portal de administración"),
              },
            }),
          );
          return { ok: true, result: { id: Number(r.insertId), email, role } };
        }
        case "search_contacts": {
          const q = mcpStr(args.q).slice(0, 120);
          if (!q) return { ok: false, error: "q is required" };
          const limit = Math.min(20, Math.max(1, mcpLimit(args, 10, 20)));
          const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
          const parts = [
            `c.email LIKE ?`,
            `c.first_name LIKE ?`,
            `c.last_name LIKE ?`,
            `CONCAT(c.first_name,' ',c.last_name) LIKE ?`,
            `c.phone LIKE ?`,
          ];
          const params: any[] = [like, like, like, like, like];
          const digits = q.replace(/\D/g, "");
          if (digits.length >= 7 && digits.length <= 15) {
            parts.push(
              `REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(c.phone,''),'+',''),'-',''),'(',''),')','') LIKE ?`,
            );
            params.push(`%${digits}%`);
          }
          const [rows] = await pool.query<RowDataPacket[]>(
            `SELECT c.id, c.first_name, c.last_name, c.email, c.phone,
                    c.preferred_language, c.city, c.state
             FROM contacts c
             WHERE c.deleted_at IS NULL
               AND c.converted_client_id IS NULL
               AND (${parts.join(" OR ")})
             ORDER BY c.updated_at DESC, c.id DESC
             LIMIT ?`,
            [...params, limit],
          );
          return {
            ok: true,
            result: {
              contacts: rows.map((r) => ({
                id: Number(r.id),
                name: `${r.first_name || ""} ${r.last_name || ""}`.trim(),
                email: r.email,
                phone: r.phone,
                preferred_language: r.preferred_language === "es" ? "es" : "en",
                city: r.city || null,
                state: r.state || null,
                href: `/admin/contacts`,
              })),
            },
          };
        }
        case "get_contact": {
          const contactId = Number(args.contact_id);
          if (!Number.isFinite(contactId) || contactId <= 0) {
            return { ok: false, error: "contact_id is required" };
          }
          const [rows] = await pool.query<RowDataPacket[]>(
            `SELECT * FROM contacts WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
            [contactId],
          );
          if (!rows[0]) return { ok: false, error: "Contact not found" };
          const mapped = mapCrmContactRow(rows[0]);
          return {
            ok: true,
            result: {
              ...mapped,
              name: `${mapped.first_name} ${mapped.last_name}`.trim(),
              href: `/admin/contacts`,
              on_pipeline: mapped.converted_client_id != null,
              guidance:
                mapped.converted_client_id != null
                  ? `Already converted to client_id=${mapped.converted_client_id}.`
                  : "Address-book contact. Use convert_contact to add as prospect when ready.",
            },
          };
        }
        case "create_contact": {
          const firstName = mcpStr(args.first_name).slice(0, 100);
          const lastName = mcpStr(args.last_name).slice(0, 100);
          const phoneRaw = mcpStr(args.phone).slice(0, 20);
          const emailRaw = normalizeEmail(args.email);
          let phoneNormalized: string | null = phoneRaw || null;
          const email = emailRaw || null;
          const lang = asLang(args.preferred_language);
          const notes = decodeLiteralUnicodeEscapes(
            mcpStr(args.notes != null ? args.notes : args.admin_notes),
          )
            .trim()
            .slice(0, 5000);
          const addressLine1 = mcpStr(args.address_line1).slice(0, 255) || null;
          const addressLine2 = mcpStr(args.address_line2).slice(0, 255) || null;
          const city = mcpStr(args.city).slice(0, 100) || null;
          const state = mcpStr(args.state).slice(0, 50) || null;
          const zip = mcpStr(args.zip).slice(0, 20) || null;
          const missing: string[] = [];
          if (!firstName) missing.push("first_name");
          if (!lastName) missing.push("last_name");
          if (!phoneNormalized && !email) missing.push("phone or email");
          if (email && !isValidEmail(email)) {
            return { ok: false, error: "email is invalid" };
          }
          if (phoneNormalized && !normalizePhoneLast10(phoneNormalized)) {
            return { ok: false, error: "phone must include at least 10 digits" };
          }
          if (phoneNormalized) {
            phoneNormalized = toSmsE164(phoneNormalized).slice(0, 20);
          }
          const duplicates = await findCrmContactDuplicates({
            phone: phoneNormalized,
            email,
          });
          const hasDups =
            duplicates.clients.length > 0 || duplicates.contacts.length > 0;
          const namedOwner = await resolveMcpStaffAssignee({
            adminId: args.assigned_admin_id,
            name: args.assigned_admin_name,
            email: args.assigned_admin_email,
          });
          if (namedOwner.ok === false) {
            return { ok: false, error: namedOwner.message };
          }
          const ownerId = namedOwner.requested ? namedOwner.id : admin.id;
          const preview = {
            first_name: firstName || null,
            last_name: lastName || null,
            phone: phoneNormalized,
            email,
            preferred_language: lang,
            notes: notes || null,
            address_line1: addressLine1,
            address_line2: addressLine2,
            city,
            state,
            zip,
            assigned_admin_id: ownerId,
          };
          if (missing.length > 0) {
            return {
              ok: true,
              dry_run: true,
              result: {
                preview: true,
                ready: false,
                missing_fields: missing,
                preview_data: preview,
                duplicates,
              },
            };
          }
          if (!writeConfirmed) {
            return {
              ok: true,
              dry_run: true,
              result: {
                preview: true,
                ready: true,
                preview_data: preview,
                duplicates,
                requires_confirm_duplicate: hasDups,
                required_confirm_phrase: "CONFIRM",
                guidance: hasDups
                  ? 'Duplicates found. After approval, re-call with confirm=true, confirm_duplicate=true, and confirm_phrase="CONFIRM".'
                  : 'Show address-book preview. After approval, re-call with confirm=true and confirm_phrase="CONFIRM".',
              },
            };
          }
          if (hasDups && args.confirm_duplicate !== true && args.confirm_duplicate !== "true") {
            return {
              ok: false,
              error:
                "Matching phone or email already exists. Set confirm_duplicate=true only after the user approves.",
            };
          }
          const [ins] = await pool.query<ResultSetHeader>(
            `INSERT INTO contacts
               (first_name, last_name, email, phone, address_line1, address_line2,
                city, state, zip, preferred_language, admin_notes,
                assigned_admin_id, created_by_admin_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              firstName,
              lastName,
              email,
              phoneNormalized,
              addressLine1,
              addressLine2,
              city,
              state,
              zip,
              lang,
              notes || null,
              ownerId,
              admin.id,
            ],
          );
          const [rows] = await pool.query<RowDataPacket[]>(
            `SELECT * FROM contacts WHERE id = ? LIMIT 1`,
            [ins.insertId],
          );
          return {
            ok: true,
            result: {
              created: true,
              contact: mapCrmContactRow(rows[0]),
              href: `/admin/contacts`,
            },
          };
        }
        case "update_contact": {
          const contactId = Number(args.contact_id);
          if (!Number.isFinite(contactId) || contactId <= 0) {
            return { ok: false, error: "contact_id is required" };
          }
          const [existing] = await pool.query<RowDataPacket[]>(
            `SELECT * FROM contacts
             WHERE id = ? AND deleted_at IS NULL AND converted_client_id IS NULL
             LIMIT 1`,
            [contactId],
          );
          if (!existing[0]) {
            return { ok: false, error: "Contact not found (or already converted/deleted)" };
          }
          const first =
            args.first_name != null
              ? mcpStr(args.first_name).slice(0, 100)
              : String(existing[0].first_name);
          const last =
            args.last_name != null
              ? mcpStr(args.last_name).slice(0, 100)
              : String(existing[0].last_name);
          if (!first || !last) return { ok: false, error: "first_name and last_name required" };
          const email =
            args.email !== undefined
              ? normalizeEmail(args.email) || null
              : existing[0].email
                ? String(existing[0].email)
                : null;
          let phone: string | null =
            args.phone !== undefined
              ? mcpStr(args.phone).slice(0, 20) || null
              : existing[0].phone
                ? String(existing[0].phone)
                : null;
          if (!email && !phone) {
            return { ok: false, error: "phone or email required" };
          }
          if (email && !isValidEmail(email)) {
            return { ok: false, error: "email is invalid" };
          }
          if (phone && args.phone !== undefined) {
            if (!normalizePhoneLast10(phone)) {
              return { ok: false, error: "phone must include at least 10 digits" };
            }
            phone = toSmsE164(phone).slice(0, 20);
          }
          const lang =
            args.preferred_language != null
              ? asLang(args.preferred_language)
              : existing[0].preferred_language === "es"
                ? "es"
                : "en";
          const notes =
            args.notes !== undefined || args.admin_notes !== undefined
              ? decodeLiteralUnicodeEscapes(
                  mcpStr(args.notes != null ? args.notes : args.admin_notes),
                )
                  .trim()
                  .slice(0, 5000) || null
              : existing[0].admin_notes != null
                ? String(existing[0].admin_notes)
                : null;
          const namedOwner = await resolveMcpStaffAssignee({
            adminId: args.assigned_admin_id,
            name: args.assigned_admin_name,
            email: args.assigned_admin_email,
          });
          if (namedOwner.ok === false) {
            return { ok: false, error: namedOwner.message };
          }
          const ownerId = namedOwner.requested
            ? namedOwner.id
            : existing[0].assigned_admin_id != null
              ? Number(existing[0].assigned_admin_id)
              : admin.id;
          const duplicates = await findCrmContactDuplicates({
            phone,
            email,
            excludeContactId: contactId,
          });
          const hasDups =
            duplicates.clients.length > 0 || duplicates.contacts.length > 0;
          const preview = {
            contact_id: contactId,
            first_name: first,
            last_name: last,
            phone,
            email,
            preferred_language: lang,
            assigned_admin_id: ownerId,
          };
          if (!writeConfirmed) {
            return {
              ok: true,
              dry_run: true,
              result: {
                preview: true,
                ready: true,
                preview_data: preview,
                duplicates,
                requires_confirm_duplicate: hasDups,
                required_confirm_phrase: "CONFIRM",
                guidance: hasDups
                  ? 'Duplicates found. After approval, re-call with confirm=true, confirm_duplicate=true, and confirm_phrase="CONFIRM".'
                  : 'Show update preview. After approval, re-call with confirm=true and confirm_phrase="CONFIRM".',
              },
            };
          }
          if (hasDups && args.confirm_duplicate !== true && args.confirm_duplicate !== "true") {
            return {
              ok: false,
              error:
                "Matching phone or email already exists. Set confirm_duplicate=true only after the user approves.",
            };
          }
          await pool.query(
            `UPDATE contacts SET
               first_name = ?, last_name = ?, email = ?, phone = ?,
               address_line1 = ?, address_line2 = ?, city = ?, state = ?, zip = ?,
               preferred_language = ?, admin_notes = ?, assigned_admin_id = ?
             WHERE id = ?`,
            [
              first,
              last,
              email,
              phone,
              args.address_line1 !== undefined
                ? mcpStr(args.address_line1).slice(0, 255) || null
                : existing[0].address_line1,
              args.address_line2 !== undefined
                ? mcpStr(args.address_line2).slice(0, 255) || null
                : existing[0].address_line2,
              args.city !== undefined
                ? mcpStr(args.city).slice(0, 100) || null
                : existing[0].city,
              args.state !== undefined
                ? mcpStr(args.state).slice(0, 50) || null
                : existing[0].state,
              args.zip !== undefined
                ? mcpStr(args.zip).slice(0, 20) || null
                : existing[0].zip,
              lang,
              notes,
              ownerId,
              contactId,
            ],
          );
          const [rows] = await pool.query<RowDataPacket[]>(
            `SELECT * FROM contacts WHERE id = ? LIMIT 1`,
            [contactId],
          );
          return {
            ok: true,
            result: { updated: true, contact: mapCrmContactRow(rows[0]), href: `/admin/contacts` },
          };
        }
        case "convert_contact": {
          const contactId = Number(args.contact_id);
          if (!Number.isFinite(contactId) || contactId <= 0) {
            return { ok: false, error: "contact_id is required" };
          }
          const [previewRows] = await pool.query<RowDataPacket[]>(
            `SELECT * FROM contacts
             WHERE id = ? AND deleted_at IS NULL AND converted_client_id IS NULL
             LIMIT 1`,
            [contactId],
          );
          if (!previewRows[0]) {
            return { ok: false, error: "Contact not found (or already converted/deleted)" };
          }
          const c = previewRows[0];
          const phone = c.phone ? String(c.phone) : null;
          const email = c.email ? normalizeEmail(c.email) : null;
          if (!phone && !email) {
            return {
              ok: false,
              error: "Contact needs phone or email before convert. Use update_contact first.",
            };
          }
          let existingClientId: number | null = null;
          if (phone) existingClientId = await findClientIdByPhone(phone);
          if (existingClientId == null && email) {
            const [emailDup] = await pool.query<RowDataPacket[]>(
              `SELECT id FROM clients WHERE LOWER(email) = ? LIMIT 1`,
              [email],
            );
            if (emailDup[0]) existingClientId = Number(emailDup[0].id);
          }
          const lang = c.preferred_language === "es" ? "es" : "en";
          const namedOwner = await resolveMcpStaffAssignee({
            adminId: args.assigned_admin_id,
            name: args.assigned_admin_name,
            email: args.assigned_admin_email,
          });
          if (namedOwner.ok === false) {
            return { ok: false, error: namedOwner.message };
          }
          const ownerId = namedOwner.requested
            ? namedOwner.id
            : c.assigned_admin_id != null
              ? Number(c.assigned_admin_id)
              : admin.id;
          if (!writeConfirmed) {
            return {
              ok: true,
              dry_run: true,
              result: {
                preview: true,
                ready: true,
                preview_data: {
                  contact_id: contactId,
                  first_name: c.first_name,
                  last_name: c.last_name,
                  phone,
                  email,
                  preferred_language: lang,
                  assigned_admin_id: ownerId,
                  status: "prospect",
                  will_link_existing_client_id: existingClientId,
                },
                required_confirm_phrase: "CONFIRM",
                guidance:
                  existingClientId != null
                    ? `Phone/email matches client_id=${existingClientId}. After approval, re-call with confirm=true and confirm_phrase="CONFIRM" to LINK (no twin).`
                    : 'Show convert preview. After approval, re-call with confirm=true and confirm_phrase="CONFIRM".',
              },
            };
          }
          const result = await convertCrmContactToClient({
            contactId,
            ownerAdminId: admin.id,
            overrideOwnerAdminId: namedOwner.requested ? namedOwner.id : null,
          });
          if (result.ok === false) return { ok: false, error: result.error };
          return {
            ok: true,
            result: {
              converted: !result.existing,
              existing: result.existing || undefined,
              linked_existing: result.linked_existing || undefined,
              contact_id: result.contact_id,
              client_id: result.client_id,
              preferred_language: result.preferred_language,
              href: `/admin/clients/${result.client_id}`,
            },
          };
        }
        case "send_contact_sms": {
          const contactId = Number(args.contact_id);
          const body = decodeLiteralUnicodeEscapes(
            mcpStr(args.body != null ? args.body : args.message),
          ).trim();
          if (!Number.isFinite(contactId) || contactId <= 0) {
            return { ok: false, error: "contact_id is required" };
          }
          if (!body) return { ok: false, error: "body is required" };
          if ([...body].length > SMS_MAX_BODY_CHARS) {
            return { ok: false, error: `SMS body exceeds ${SMS_MAX_BODY_CHARS} characters` };
          }
          const [rows] = await pool.query<RowDataPacket[]>(
            `SELECT id, first_name, last_name, phone, deleted_at, converted_client_id
             FROM contacts WHERE id = ? LIMIT 1`,
            [contactId],
          );
          if (!rows[0] || rows[0].deleted_at) {
            return { ok: false, error: "Contact not found" };
          }
          if (rows[0].converted_client_id != null) {
            return {
              ok: false,
              error:
                "Contact already converted. Use send_sms with that client_id instead.",
            };
          }
          const contactName =
            `${rows[0].first_name || ""} ${rows[0].last_name || ""}`.trim();
          const toPhone = rows[0].phone ? String(rows[0].phone).trim() : null;
          if (!toPhone) {
            return { ok: false, error: "Contact has no phone. Use update_contact first." };
          }
          const fromResolved = await resolveMcpSmsFromE164(admin.id, args);
          if (fromResolved.ok === false) {
            return { ok: false, error: fromResolved.message };
          }
          if (!writeConfirmed) {
            return {
              ok: true,
              dry_run: true,
              result: {
                preview: true,
                ready: true,
                preview_data: {
                  audience: "contact",
                  contact_id: contactId,
                  contact_name: contactName,
                  to: toPhone,
                  from: fromResolved.e164,
                  body,
                },
                required_confirm_phrase: "CONFIRM",
                guidance:
                  'Show exact To / From / body. After approval, re-call with confirm=true and confirm_phrase="CONFIRM".',
              },
            };
          }
          const result = await deliverHubConversationMessage({
            adminId: fromResolved.from_admin_id,
            crmContactId: contactId,
            channel: "sms",
            textBody: body,
            ofgNumberId: fromResolved.ofg_number_id,
            fromE164Override: fromResolved.e164,
          });
          if (!result.ok && result.error) {
            return { ok: false, error: String(result.error).slice(0, 400) };
          }
          const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
          const stamped = `[SMS ${ts} UTC] Sent to ${toPhone}\n${body.slice(0, 1500)}`;
          const noteAppended = await appendContactAdminNote(contactId, stamped);
          return {
            ok: true,
            result: {
              sent: true,
              audience: "contact",
              contact_id: contactId,
              contact_name: contactName,
              to: toPhone,
              from: fromResolved.e164,
              body,
              message_id: result.message_id,
              conversation_id: result.conversation_id,
              provider_status: result.provider_status,
              contact_note_appended: noteAppended,
              href: `/admin/conversations?contact=${contactId}`,
            },
          };
        }
        case "send_contact_email": {
          const contactId = Number(args.contact_id);
          const subject = decodeLiteralUnicodeEscapes(mcpStr(args.subject))
            .trim()
            .slice(0, 200);
          const body = decodeLiteralUnicodeEscapes(mcpStr(args.body))
            .trim()
            .slice(0, 8000);
          if (!Number.isFinite(contactId) || contactId <= 0) {
            return { ok: false, error: "contact_id is required" };
          }
          if (!subject) return { ok: false, error: "subject is required" };
          if (!body) return { ok: false, error: "body is required" };
          const [rows] = await pool.query<RowDataPacket[]>(
            `SELECT id, first_name, last_name, email, preferred_language,
                    deleted_at, converted_client_id
             FROM contacts WHERE id = ? LIMIT 1`,
            [contactId],
          );
          if (!rows[0] || rows[0].deleted_at) {
            return { ok: false, error: "Contact not found" };
          }
          if (rows[0].converted_client_id != null) {
            return {
              ok: false,
              error: "Contact already converted. Email the client from Admin instead.",
            };
          }
          const contactName =
            `${rows[0].first_name || ""} ${rows[0].last_name || ""}`.trim();
          const toEmail = rows[0].email ? String(rows[0].email).trim() : null;
          const toLang = rows[0].preferred_language === "es" ? "es" : "en";
          if (!toEmail || !isValidEmail(toEmail)) {
            return { ok: false, error: "Contact has no valid email. Use update_contact." };
          }
          if (!writeConfirmed) {
            return {
              ok: true,
              dry_run: true,
              result: {
                preview: true,
                ready: true,
                preview_data: {
                  audience: "contact",
                  contact_id: contactId,
                  contact_name: contactName,
                  to: toEmail,
                  subject,
                  body,
                },
                required_confirm_phrase: "CONFIRM",
                guidance:
                  'Show exact To / subject / body. After approval, re-call with confirm=true and confirm_phrase="CONFIRM".',
              },
            };
          }
          const isEs = toLang === "es";
          const firstName =
            (contactName || "").split(/\s+/).filter(Boolean)[0] ||
            (isEs ? "amigo" : "there");
          const bodyLooksGreeted = /^(hi|hola|hello|dear)\b/i.test(body);
          const safeBodyHtml = escapeHtml(body).replace(/\r?\n/g, "<br/>");
          const greetingHtml = bodyLooksGreeted
            ? ""
            : `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">${
                isEs ? "Hola" : "Hi"
              } ${escapeHtml(firstName)},</p>`;
          const html = emailLayout({
            title: subject,
            preheader: subject,
            bodyHtml: `${greetingHtml}<div style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">${safeBodyHtml}</div>`,
            lang: toLang,
          });
          await sendEmail({ to: toEmail, subject, html });
          const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
          const stamped = `[EMAIL ${ts} UTC] Sent to ${toEmail}\nSubject: ${subject}\n${body.slice(0, 1500)}`;
          const noteAppended = await appendContactAdminNote(contactId, stamped);
          return {
            ok: true,
            result: {
              sent: true,
              audience: "contact",
              contact_id: contactId,
              contact_name: contactName,
              to: toEmail,
              subject,
              contact_note_appended: noteAppended,
              href: `/admin/contacts`,
            },
          };
        }
        case "send_text":
        case "send_sms": {
          const body = decodeLiteralUnicodeEscapes(
            mcpStr(args.body != null ? args.body : args.message),
          ).trim();
          if (!body) return { ok: false, error: "body is required" };
          if ([...body].length > SMS_MAX_BODY_CHARS) {
            return { ok: false, error: `SMS body exceeds ${SMS_MAX_BODY_CHARS} characters` };
          }
          const namedTo = await resolveMcpStaffAssignee({
            adminId: args.to_admin_id,
            name: args.to_admin_name,
            email: args.to_admin_email,
          });
          if (namedTo.ok === false) return { ok: false, error: namedTo.message };
          const clientId =
            args.client_id != null && Number(args.client_id) > 0
              ? Number(args.client_id)
              : null;
          if (!namedTo.requested && !clientId) {
            return {
              ok: false,
              error: "Provide client_id or to_admin_id / to_admin_name (use send_contact_sms for contacts)",
            };
          }
          const fromResolved = await resolveMcpSmsFromE164(admin.id, args);
          if (fromResolved.ok === false) {
            return { ok: false, error: fromResolved.message };
          }
          if (namedTo.requested) {
            const [staffRows] = await pool.query<RowDataPacket[]>(
              `SELECT id, first_name, last_name, phone
               FROM admins WHERE id = ? AND status = 'active' LIMIT 1`,
              [namedTo.id],
            );
            if (!staffRows[0]) return { ok: false, error: "Staff not found" };
            const toPhone = staffRows[0].phone
              ? String(staffRows[0].phone).trim()
              : null;
            if (!toPhone) {
              return { ok: false, error: "Staff has no phone on file" };
            }
            if (!writeConfirmed) {
              return {
                ok: true,
                dry_run: true,
                result: {
                  preview: true,
                  ready: true,
                  preview_data: {
                    audience: "staff",
                    to_admin_id: namedTo.id,
                    to: toPhone,
                    from: fromResolved.e164,
                    body,
                  },
                  required_confirm_phrase: "CONFIRM",
                  guidance:
                    'Show exact To / From / body. After approval, re-call with confirm=true and confirm_phrase="CONFIRM".',
                },
              };
            }
            const sent = await sendSms({
              to: toPhone,
              body,
              from: fromResolved.e164,
            });
            return {
              ok: true,
              result: {
                sent: true,
                audience: "staff",
                to_admin_id: namedTo.id,
                to: toPhone,
                from: fromResolved.e164,
                body,
                provider_message_id: sent.sid,
                provider_status: sent.status,
              },
            };
          }
          const [cRows] = await pool.query<RowDataPacket[]>(
            `SELECT id, first_name, last_name, phone, status
             FROM clients WHERE id = ? LIMIT 1`,
            [clientId],
          );
          if (!cRows[0]) return { ok: false, error: "Client not found" };
          if (!cRows[0].phone) {
            return { ok: false, error: "Client has no phone on file" };
          }
          const clientName =
            `${cRows[0].first_name || ""} ${cRows[0].last_name || ""}`.trim();
          if (!writeConfirmed) {
            return {
              ok: true,
              dry_run: true,
              result: {
                preview: true,
                ready: true,
                preview_data: {
                  audience: "client",
                  client_id: clientId,
                  client_name: clientName,
                  to: String(cRows[0].phone),
                  from: fromResolved.e164,
                  body,
                },
                required_confirm_phrase: "CONFIRM",
                guidance:
                  'Show exact To / From / body. After approval, re-call with confirm=true and confirm_phrase="CONFIRM".',
              },
            };
          }
          const result = await deliverHubConversationMessage({
            adminId: fromResolved.from_admin_id,
            clientId: clientId!,
            channel: "sms",
            textBody: body,
            ofgNumberId: fromResolved.ofg_number_id,
            fromE164Override: fromResolved.e164,
          });
          if (!result.ok && result.error) {
            return { ok: false, error: String(result.error).slice(0, 400) };
          }
          const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
          const stamped = `[SMS ${ts} UTC] Sent to ${cRows[0].phone}\n${body.slice(0, 1500)}`;
          const noteAppended = await appendClientAdminNote(clientId!, stamped);
          return {
            ok: true,
            result: {
              sent: true,
              audience: "client",
              client_id: clientId,
              client_name: clientName,
              to: String(cRows[0].phone),
              from: fromResolved.e164,
              body,
              message_id: result.message_id,
              conversation_id: result.conversation_id,
              provider_status: result.provider_status,
              client_note_appended: noteAppended,
              href: `/admin/conversations?client=${clientId}`,
            },
          };
        }
        case "get_texts":
        case "get_conversation":
        case "list_sms": {
          const clientId = Number(args.client_id);
          if (!Number.isFinite(clientId) || clientId <= 0) {
            return { ok: false, error: "client_id is required" };
          }
          const rawLimit = Number(args.limit);
          const limit = Number.isFinite(rawLimit)
            ? Math.min(50, Math.max(1, Math.floor(rawLimit)))
            : 20;
          const channelArg = mcpStr(args.channel).toLowerCase();
          const channelFilter = ["sms", "call", "email", "internal"].includes(channelArg)
            ? channelArg
            : null;
          const [convRows] = await pool.query<RowDataPacket[]>(
            channelFilter
              ? `SELECT id FROM conversations WHERE client_id = ? AND channel = ?`
              : `SELECT id FROM conversations WHERE client_id = ?`,
            channelFilter ? [clientId, channelFilter] : [clientId],
          );
          const convIds = convRows.map((r) => Number(r.id)).filter((id) => id > 0);
          if (!convIds.length) {
            return {
              ok: true,
              result: {
                client_id: clientId,
                channel: channelFilter,
                messages: [],
                note: "No Conversations hub threads yet for this client.",
                href: `/admin/conversations?client=${clientId}`,
              },
            };
          }
          const [msgs] = await pool.query<RowDataPacket[]>(
            `SELECT m.id, m.conversation_id, m.direction, m.channel, m.body,
                    m.provider_message_id, m.provider_status, m.error_message,
                    m.created_at, m.media_url IS NOT NULL AS has_media,
                    m.call_duration_sec, m.recording_url IS NOT NULL AS has_recording
             FROM conversation_messages m
             WHERE m.conversation_id IN (${convIds.map(() => "?").join(",")})
               ${channelFilter ? "AND m.channel = ?" : ""}
             ORDER BY m.id DESC
             LIMIT ?`,
            channelFilter
              ? [...convIds, channelFilter, limit]
              : [...convIds, limit],
          );
          return {
            ok: true,
            result: {
              client_id: clientId,
              channel: channelFilter,
              messages: msgs
                .map((m) => ({
                  id: Number(m.id),
                  conversation_id: Number(m.conversation_id),
                  direction: String(m.direction || ""),
                  channel: String(m.channel || "sms"),
                  body: decodeLiteralUnicodeEscapes(String(m.body || "")).slice(0, 500),
                  has_media: Number(m.has_media) === 1,
                  has_recording: Number(m.has_recording) === 1,
                  call_duration_sec:
                    m.call_duration_sec != null ? Number(m.call_duration_sec) : null,
                  provider_message_id: m.provider_message_id
                    ? String(m.provider_message_id)
                    : null,
                  provider_status: m.provider_status
                    ? String(m.provider_status)
                    : null,
                  error_message: m.error_message
                    ? String(m.error_message).slice(0, 200)
                    : null,
                  created_at: m.created_at,
                }))
                .reverse(),
              href: `/admin/conversations?client=${clientId}`,
            },
          };
        }
        case "get_call_insights": {
          const clientId = Number(args.client_id);
          if (!Number.isFinite(clientId) || clientId <= 0) {
            return { ok: false, error: "client_id is required" };
          }
          const messageIdArg =
            args.message_id != null && Number(args.message_id) > 0
              ? Number(args.message_id)
              : null;
          const rawLimit = Number(args.limit);
          const limit = Number.isFinite(rawLimit)
            ? Math.min(10, Math.max(1, Math.floor(rawLimit)))
            : 3;
          const [convRows] = await pool.query<RowDataPacket[]>(
            `SELECT id FROM conversations WHERE client_id = ?`,
            [clientId],
          );
          const convIds = convRows.map((r) => Number(r.id)).filter((id) => id > 0);
          if (!convIds.length) {
            return {
              ok: true,
              result: {
                client_id: clientId,
                calls: [],
                call_insights_enabled: false,
                note: "No Conversations hub threads yet.",
                href: `/admin/conversations?client=${clientId}`,
              },
            };
          }
          const where = [
            `m.conversation_id IN (${convIds.map(() => "?").join(",")})`,
            "m.channel = 'call'",
          ];
          const params: any[] = [...convIds];
          if (messageIdArg) {
            where.push("m.id = ?");
            params.push(messageIdArg);
          }
          params.push(messageIdArg ? 1 : limit);
          const [callRows] = await pool.query<RowDataPacket[]>(
            `SELECT m.id, m.conversation_id, m.direction, m.body, m.created_at,
                    m.call_duration_sec, m.recording_url IS NOT NULL AS has_recording,
                    m.metadata_json
             FROM conversation_messages m
             WHERE ${where.join(" AND ")}
             ORDER BY m.id DESC
             LIMIT ?`,
            params,
          );
          return {
            ok: true,
            result: {
              client_id: clientId,
              call_insights_enabled: false,
              guidance:
                "Twilio call/voicemail transcripts are returned in transcript_full when transcript_status is ready. AI call summaries are not enabled — use body text and transcript_full only; do not invent details.",
              calls: callRows.map((m) => {
                let isVoicemail = false;
                let transcriptFull: string | null = null;
                let transcriptStatus: string | null = null;
                try {
                  const meta =
                    typeof m.metadata_json === "string"
                      ? JSON.parse(m.metadata_json)
                      : m.metadata_json;
                  isVoicemail = !!(meta && meta.is_voicemail);
                  if (meta && typeof meta.transcript === "string" && meta.transcript.trim()) {
                    transcriptFull = String(meta.transcript);
                  }
                  if (meta && meta.transcript_status != null) {
                    transcriptStatus = String(meta.transcript_status);
                  }
                } catch {
                  isVoicemail = false;
                }
                const body = decodeLiteralUnicodeEscapes(String(m.body || ""));
                return {
                  message_id: Number(m.id),
                  conversation_id: Number(m.conversation_id),
                  direction: String(m.direction || ""),
                  body: body.slice(0, 240),
                  is_voicemail: isVoicemail,
                  call_duration_sec:
                    m.call_duration_sec != null ? Number(m.call_duration_sec) : null,
                  has_recording: Number(m.has_recording) === 1,
                  transcript_status: transcriptStatus,
                  transcript_full: transcriptFull,
                  created_at: m.created_at,
                };
              }),
              href: `/admin/conversations?client=${clientId}`,
            },
          };
        }
        case "list_ofg_phone_numbers":
        case "list_brand_phone_numbers": {
          const listAll = args.all === true || args.all === "true";
          // MCP is super_admin-only; all=true is allowed.
          const [rows] = await pool.query<RowDataPacket[]>(
            listAll
              ? `SELECT n.*, CONCAT(a.first_name,' ',a.last_name) AS assigned_admin_name
                 FROM admin_phone_numbers n
                 LEFT JOIN admins a ON a.id = n.assigned_admin_id
                 WHERE n.is_active = 1
                 ORDER BY n.id ASC`
              : `SELECT n.*, CONCAT(a.first_name,' ',a.last_name) AS assigned_admin_name
                 FROM admin_phone_numbers n
                 LEFT JOIN admins a ON a.id = n.assigned_admin_id
                 WHERE n.is_active = 1 AND n.assigned_admin_id = ?
                 ORDER BY n.id ASC`,
            listAll ? [] : [admin.id],
          );
          const twilioConfigured = isTwilioConfigured();
          return {
            ok: true,
            result: {
              twilio_configured: twilioConfigured,
              scope: listAll ? "all_active" : "assigned_to_acting_admin",
              numbers: rows.map(mapPhoneNumberRow),
              acting_admin_from: listAll
                ? null
                : rows[0]
                  ? String(rows[0].e164)
                  : null,
              note: !twilioConfigured
                ? "Twilio credentials are not configured — SMS cannot send until TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN are set."
                : rows.length === 0
                  ? "No active brand numbers assigned to this admin. Assign one in Staff → Brand phone numbers before send_sms."
                  : "Use acting_admin_from (or numbers[].e164) as the From line for send_sms/send_text.",
            },
          };
        }
        case "send_wa":
        case "send_whatsapp":
        case "send_contact_whatsapp":
          return {
            ok: false,
            error:
              "whatsapp_not_configured — Groundwork has no WhatsApp channel yet. Use send_sms or send_contact_sms.",
          };
        case "list_whatsapp":
          return {
            ok: false,
            error:
              "whatsapp_not_configured — no whatsapp channel. Use list_sms for the Conversations timeline.",
          };
        default:
          return { ok: false, error: `Unhandled tool: ${name}` };
      }
    } catch (err: any) {
      if (err instanceof HttpError) return { ok: false, error: err.key };
      if (err?.code === "ER_DUP_ENTRY" || err?.errno === 1062) {
        return { ok: false, error: "errors.duplicate" };
      }
      console.error("[mcp] execute", name, err);
      return { ok: false, error: err?.message || "tool_failed" };
    }
  }

  async function requireMcpAuth(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const challenge =
      `Bearer FAKESECRET_g3h4i5j6k7l8m9n0o1p2="${siteOrigin()}/.well-known/oauth-protected-resource", scope="${MCP_SCOPE}"`;
    const fail = (reason: string) => {
      console.warn("[mcp] auth_reject", { reason });
      res.setHeader("WWW-Authenticate", challenge);
      res.status(401).json({ error: "Unauthorized" });
    };
    try {
      const bearer = parseBearerAuthorization(req.headers.authorization);
      if (bearer) {
        const [mcpRows] = await pool.query<RowDataPacket[]>(
          `SELECT t.admin_id, a.*
             FROM mcp_oauth_tokens t
             JOIN admins a ON a.id = t.admin_id
            WHERE t.token_hash = ? AND t.revoked_at IS NULL AND t.expires_at > NOW()
              AND a.status = 'active' AND a.role = 'super_admin'
            LIMIT 1`,
          [sha256(bearer)],
        );
        if (mcpRows[0]) {
          await pool.execute(
            `UPDATE mcp_oauth_tokens SET last_used_at = NOW() WHERE token_hash = ?`,
            [sha256(bearer)],
          );
          res.locals.portalUser = toPortalUser("admin", mcpRows[0]);
          next();
          return;
        }
        fail("bearer_unknown_or_expired");
        return;
      }
      if (req.headers.authorization) {
        fail("authorization_not_bearer");
        return;
      }
      const user = await loadPortalUser("admin", req);
      if (!user) {
        fail("missing_authorization");
        return;
      }
      if (user.role !== "super_admin" || user.status !== "active") {
        fail("not_super_admin");
        return;
      }
      res.locals.portalUser = user;
      next();
    } catch (err) {
      console.error("[mcp] requireMcpAuth", err);
      fail("auth_error");
    }
  }

  function requireSuperAdminMcp(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    return requireAdmin()(req, res, () => {
      const user = portalUser(res);
      if (user.role !== "super_admin") {
        return res.status(403).json({ error: "errors.forbidden" });
      }
      return next();
    });
  }

  async function handleMcpStreamable(req: Request, res: Response) {
    const admin = portalUser(res);
    const server = new McpServer({
      name: "groundwork-capital",
      version: "1.0.0",
    });

    for (const t of MCP_TOOLS) {
      server.registerTool(
        t.name,
        {
          description: t.description,
          inputSchema: mcpJsonSchemaToZod(t.inputSchema),
        },
        async (toolArgs) => {
          const cleaned: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(
            (toolArgs || {}) as Record<string, unknown>,
          )) {
            if (v !== undefined) cleaned[k] = v;
          }
          const confirm = mcpWriteConfirmed(cleaned);
          try {
            const result = await executeMcpTool(admin, t.name, cleaned, confirm);
            try {
              await pool.execute(
                `INSERT INTO mcp_audit_logs (admin_id, tool_name, confirm, request_json, result_json, error_message)
                 VALUES (?,?,?,?,?,?)`,
                [
                  admin.id,
                  t.name,
                  confirm ? 1 : 0,
                  JSON.stringify(sanitizeMcpArgsForLog(cleaned)),
                  JSON.stringify(result.result ?? null),
                  result.error || null,
                ],
              );
            } catch (auditErr) {
              console.error("[mcp] audit", auditErr);
            }
            const payload = result.ok
              ? result.result
              : { ok: false, error: result.error };
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(payload, null, 2),
                },
              ],
              isError: !result.ok,
            };
          } catch (err) {
            console.error("[mcp] tool", t.name, err);
            return {
              content: [{ type: "text" as const, text: "Tool call failed." }],
              isError: true,
            };
          }
        },
      );
    }

    server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: mcpToolsListForClaude(MCP_TOOLS),
    }));

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    // Sanitize Claude-hostile fields on the wire
    const origJson = res.json.bind(res);
    (res as any).json = (body: unknown) => {
      try {
        const raw = typeof body === "string" ? body : JSON.stringify(body);
        const cleaned = sanitizeMcpJsonRpcForClaude(raw);
        res.setHeader("Content-Type", "application/json");
        return res.send(cleaned);
      } catch {
        return origJson(body);
      }
    };
    const origSend = res.send.bind(res);
    (res as any).send = (body: unknown) => {
      if (typeof body === "string" && (body.startsWith("{") || body.startsWith("["))) {
        return origSend(sanitizeMcpJsonRpcForClaude(body));
      }
      return origSend(body as any);
    };

    await server.connect(transport);
    await transport.handleRequest(req as any, res as any, req.body);
  }

  app.options("/api/mcp", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, Accept, Mcp-Session-Id",
    );
    return res.status(204).end();
  });

  app.get("/api/mcp", requireMcpAuth, (_req, res) => {
    return res.status(405).setHeader("Allow", "POST").json({ error: "use_post" });
  });

  app.post("/api/mcp", requireMcpAuth, (req, res) => {
    void handleMcpStreamable(req, res).catch((err) => {
      console.error("[mcp] streamable", err);
      if (!res.headersSent) res.status(500).json({ error: "mcp_error" });
    });
  });

  app.post("/api/mcp/", requireMcpAuth, (req, res) => {
    void handleMcpStreamable(req, res).catch((err) => {
      console.error("[mcp] streamable", err);
      if (!res.headersSent) res.status(500).json({ error: "mcp_error" });
    });
  });

  app.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.json(mcpOauthAuthorizationServerMetadata());
  });
  app.get("/.well-known/oauth-authorization-server/api/mcp", (_req, res) => {
    res.json(mcpOauthAuthorizationServerMetadata());
  });
  app.get("/.well-known/openid-configuration", (_req, res) => {
    res.json(mcpOauthAuthorizationServerMetadata());
  });
  app.get("/.well-known/openid-configuration/api/mcp", (_req, res) => {
    res.json(mcpOauthAuthorizationServerMetadata());
  });
  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.json(mcpOauthProtectedResourceMetadata());
  });
  app.get("/.well-known/oauth-protected-resource/api/mcp", (_req, res) => {
    res.json(mcpOauthProtectedResourceMetadata());
  });
  app.get("/api/mcp/.well-known/oauth-authorization-server", (_req, res) => {
    res.json(mcpOauthAuthorizationServerMetadata());
  });
  app.get("/api/mcp/.well-known/oauth-protected-resource", (_req, res) => {
    res.json(mcpOauthProtectedResourceMetadata());
  });

  app.post("/api/mcp/oauth/register", async (req, res) => {
    try {
      const clientId = `mcp_${crypto.randomBytes(18).toString("base64url")}`;
      const rawUris = Array.isArray(req.body?.redirect_uris)
        ? req.body.redirect_uris.map(String)
        : [];
      const redirectUris = rawUris.filter((u: string) =>
        mcpRedirectUriOkForRegistration(u),
      );
      if (!redirectUris.length) {
        return res.status(400).json({
          error: "invalid_redirect_uri",
          error_description:
            "redirect_uris must be a known Claude/Cursor callback, loopback http, or cursor: scheme",
        });
      }
      await pool.execute(
        `INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris_json) VALUES (?,?,?)`,
        [
          clientId,
          mcpStr(req.body?.client_name) || "MCP Client",
          JSON.stringify(redirectUris),
        ],
      );
      return res.status(201).json({
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: mcpStr(req.body?.client_name) || "MCP Client",
        redirect_uris: redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: MCP_SCOPE,
      });
    } catch (err) {
      console.error("[mcp] register", err);
      return res.status(500).json({ error: "registration_failed" });
    }
  });

  app.get("/api/mcp/oauth/authorize", async (req, res) => {
    try {
      const clientId = mcpStr(req.query.client_id);
      const redirectUri = mcpStr(req.query.redirect_uri);
      const state = mcpStr(req.query.state);
      const challenge = mcpStr(req.query.code_challenge);
      const method = mcpStr(req.query.code_challenge_method) || "S256";
      const scope = mcpStr(req.query.scope) || MCP_SCOPE;
      const resourceParam = mcpStr(req.query.resource) || mcpResourceUrl();
      const responseType = mcpStr(req.query.response_type) || "code";
      if (!clientId || !redirectUri || responseType !== "code" || !challenge) {
        return res.status(400).send("invalid_request");
      }
      if (method !== "S256") return res.status(400).send("unsupported code_challenge_method");

      const [clients] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM mcp_oauth_clients WHERE client_id = ? LIMIT 1`,
        [clientId],
      );
      if (!clients[0]) {
        if (!mcpRedirectUriOkForRegistration(redirectUri)) {
          return res.status(400).send("unknown_client");
        }
        await pool.execute(
          `INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris_json) VALUES (?,?,?)
           ON DUPLICATE KEY UPDATE client_name = VALUES(client_name)`,
          [
            clientId,
            "MCP client",
            JSON.stringify([redirectUri, ...KNOWN_MCP_REDIRECT_URIS]),
          ],
        );
      } else {
        const registered = parseMcpRedirectUris(clients[0].redirect_uris_json);
        if (!mcpRedirectUriAllowed(redirectUri, registered)) {
          return res.status(400).send("invalid redirect_uri");
        }
      }

      const consent = new URL(`${siteOrigin()}/admin/mcp-consent`);
      consent.searchParams.set("client_id", clientId);
      consent.searchParams.set("redirect_uri", redirectUri);
      consent.searchParams.set("code_challenge", challenge);
      consent.searchParams.set("code_challenge_method", "S256");
      consent.searchParams.set("scope", scope);
      consent.searchParams.set("resource", resourceParam);
      if (state) consent.searchParams.set("state", state);
      return res.redirect(302, consent.toString());
    } catch (err) {
      console.error("[mcp] authorize", err);
      return res.status(500).send("authorize_failed");
    }
  });

  app.post(
    "/api/admin/mcp/oauth/approve",
    requireSuperAdminMcp,
    async (req, res) => {
      try {
        const user = portalUser(res);
        const clientId = mcpStr(req.body?.client_id);
        const redirectUri = mcpStr(req.body?.redirect_uri);
        const codeChallenge = mcpStr(req.body?.code_challenge);
        const state = mcpStr(req.body?.state);
        const approve = req.body?.approve !== false;
        if (!clientId || !redirectUri) {
          return res.status(400).json({ error: "invalid_request" });
        }
        const [clients] = await pool.query<RowDataPacket[]>(
          `SELECT * FROM mcp_oauth_clients WHERE client_id = ? LIMIT 1`,
          [clientId],
        );
        if (!clients[0]) return res.status(400).json({ error: "unknown_client" });
        const registered = parseMcpRedirectUris(clients[0].redirect_uris_json);
        if (!mcpRedirectUriAllowed(redirectUri, registered)) {
          return res.status(400).json({ error: "invalid_redirect_uri" });
        }
        if (!approve) {
          const deny = new URL(redirectUri);
          deny.searchParams.set("error", "access_denied");
          if (state) deny.searchParams.set("state", state);
          return res.json({ redirect_to: deny.toString() });
        }
        if (!codeChallenge) {
          return res.status(400).json({ error: "invalid_request" });
        }
        const code = crypto.randomBytes(24).toString("hex");
        await pool.execute(
          `INSERT INTO mcp_oauth_codes
            (code_hash, client_id, admin_id, redirect_uri, code_challenge, code_challenge_method, scopes, expires_at)
           VALUES (?,?,?,?,?,?,?,?)`,
          [
            sha256(code),
            clientId,
            user.id,
            redirectUri,
            codeChallenge,
            "S256",
            MCP_SCOPE,
            new Date(Date.now() + 10 * 60_000),
          ],
        );
        const ok = new URL(redirectUri);
        ok.searchParams.set("code", code);
        if (state) ok.searchParams.set("state", state);
        return res.json({
          redirect_to: ok.toString(),
          client_name: clients[0].client_name
            ? String(clients[0].client_name)
            : "MCP client",
        });
      } catch (err) {
        console.error("[mcp] approve", err);
        return res.status(500).json({ error: "approve_failed" });
      }
    },
  );

  app.post("/api/mcp/oauth/token", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const grantType = mcpStr(req.body?.grant_type) || "authorization_code";
      const clientId = mcpStr(req.body?.client_id);
      if (!clientId) return res.status(400).json({ error: "invalid_client" });

      const [clients] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM mcp_oauth_clients WHERE client_id = ? LIMIT 1`,
        [clientId],
      );
      if (!clients[0]) return res.status(400).json({ error: "invalid_client" });
      const clientName = clients[0].client_name
        ? String(clients[0].client_name)
        : "MCP client";

      if (grantType === "refresh_token") {
        const refresh = mcpStr(req.body?.refresh_token);
        if (!refresh) return res.status(400).json({ error: "invalid_request" });
        const [tokRows] = await pool.query<RowDataPacket[]>(
          `SELECT t.*, a.role, a.status AS admin_status
             FROM mcp_oauth_tokens t
             JOIN admins a ON a.id = t.admin_id
            WHERE t.refresh_token_hash = ? AND t.client_id = ? AND t.revoked_at IS NULL
            LIMIT 1`,
          [sha256(refresh), clientId],
        );
        if (
          !tokRows[0] ||
          tokRows[0].role !== "super_admin" ||
          tokRows[0].admin_status !== "active"
        ) {
          return res.status(400).json({ error: "invalid_grant" });
        }
        if (
          !tokRows[0].refresh_expires_at ||
          new Date(tokRows[0].refresh_expires_at).getTime() <= Date.now()
        ) {
          return res.status(400).json({ error: "invalid_grant" });
        }
        const access = crypto.randomBytes(32).toString("hex");
        const newRefresh = crypto.randomBytes(32).toString("hex");
        await pool.execute(
          `UPDATE mcp_oauth_tokens
              SET token_hash = ?,
                  refresh_token_hash = ?,
                  expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
                  refresh_expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
                  last_used_at = NOW()
            WHERE id = ?`,
          [
            sha256(access),
            sha256(newRefresh),
            MCP_ACCESS_TTL_SEC,
            MCP_REFRESH_TTL_SEC,
            tokRows[0].id,
          ],
        );
        res.setHeader("Pragma", "no-cache");
        return res.json({
          access_token: access,
          token_type: "bearer",
          expires_in: MCP_ACCESS_TTL_SEC,
          refresh_token: newRefresh,
          scope: MCP_SCOPE,
        });
      }

      if (grantType !== "authorization_code") {
        return res.status(400).json({ error: "unsupported_grant_type" });
      }
      const code = mcpStr(req.body?.code);
      const redirectUri = mcpStr(req.body?.redirect_uri);
      const codeVerifier = mcpStr(req.body?.code_verifier);
      if (!code || !redirectUri || !codeVerifier) {
        return res.status(400).json({ error: "invalid_request" });
      }
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM mcp_oauth_codes
          WHERE code_hash = ? AND client_id = ? AND consumed_at IS NULL AND expires_at > NOW()
          LIMIT 1`,
        [sha256(code), clientId],
      );
      if (!rows[0]) return res.status(400).json({ error: "invalid_grant" });
      if (String(rows[0].redirect_uri) !== redirectUri) {
        return res.status(400).json({ error: "invalid_grant" });
      }
      if (!verifyPkceS256(codeVerifier, String(rows[0].code_challenge || ""))) {
        return res.status(400).json({ error: "invalid_grant" });
      }
      const [adminRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, role, status FROM admins WHERE id = ? LIMIT 1`,
        [rows[0].admin_id],
      );
      if (
        !adminRows[0] ||
        adminRows[0].role !== "super_admin" ||
        adminRows[0].status !== "active"
      ) {
        return res.status(400).json({ error: "invalid_grant" });
      }
      const [consumed] = await pool.execute<ResultSetHeader>(
        `UPDATE mcp_oauth_codes SET consumed_at = NOW()
          WHERE id = ? AND consumed_at IS NULL AND expires_at > NOW()`,
        [rows[0].id],
      );
      if (!consumed.affectedRows) return res.status(400).json({ error: "invalid_grant" });

      const access = crypto.randomBytes(32).toString("hex");
      const refresh = crypto.randomBytes(32).toString("hex");
      await pool.execute(
        `INSERT INTO mcp_oauth_tokens
           (token_hash, refresh_token_hash, client_id, client_name, admin_id, scopes, expires_at, refresh_expires_at)
         VALUES (?,?,?,?,?,?,DATE_ADD(NOW(), INTERVAL ? SECOND),DATE_ADD(NOW(), INTERVAL ? SECOND))`,
        [
          sha256(access),
          sha256(refresh),
          clientId,
          clientName,
          rows[0].admin_id,
          MCP_SCOPE,
          MCP_ACCESS_TTL_SEC,
          MCP_REFRESH_TTL_SEC,
        ],
      );
      res.setHeader("Pragma", "no-cache");
      return res.json({
        access_token: access,
        token_type: "bearer",
        expires_in: MCP_ACCESS_TTL_SEC,
        refresh_token: refresh,
        scope: MCP_SCOPE,
      });
    } catch (err) {
      console.error("[mcp] token", err);
      return res.status(500).json({ error: "token_failed" });
    }
  });

  app.post("/api/mcp/oauth/revoke", async (req, res) => {
    try {
      const token = mcpStr(req.body?.token);
      if (token) {
        const hash = sha256(token);
        await pool.execute(
          `UPDATE mcp_oauth_tokens SET revoked_at = NOW()
            WHERE revoked_at IS NULL AND (token_hash = ? OR refresh_token_hash = ?)`,
          [hash, hash],
        );
      }
      return res.json({ revoked: true });
    } catch (err) {
      console.error("[mcp] revoke", err);
      return res.json({ revoked: true });
    }
  });

  app.get(
    "/api/admin/me/mcp-connections",
    requireSuperAdminMcp,
    route(async (_req, res) => {
      const user = portalUser(res);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, client_id, client_name, scopes, created_at, last_used_at, expires_at, refresh_expires_at
         FROM mcp_oauth_tokens
         WHERE admin_id = ? AND revoked_at IS NULL
         ORDER BY id DESC
         LIMIT 50`,
        [user.id],
      );
      res.json({
        connections: rows.map((r) => ({
          id: Number(r.id),
          client_id: String(r.client_id),
          client_name: r.client_name ? String(r.client_name) : "MCP client",
          scopes: String(r.scopes || MCP_SCOPE),
          created_at: isoDate(r.created_at),
          last_used_at: isoDate(r.last_used_at),
          expires_at: isoDate(r.expires_at),
          refresh_expires_at: isoDate(r.refresh_expires_at),
        })),
      });
    }),
  );

  app.delete(
    "/api/admin/me/mcp-connections/:id",
    requireSuperAdminMcp,
    route(async (req, res) => {
      const user = portalUser(res);
      const id = parseId(req.params.id);
      const [result] = await pool.execute<ResultSetHeader>(
        `UPDATE mcp_oauth_tokens
         SET revoked_at = NOW()
         WHERE id = ? AND admin_id = ? AND revoked_at IS NULL`,
        [id, user.id],
      );
      if (!result.affectedRows) throw new HttpError(404, "errors.notFound");
      res.json({ ok: true });
    }),
  );

  app.get(
    "/api/admin/mcp/tools",
    requireSuperAdminMcp,
    (_req, res) => {
      res.json({
        tools: MCP_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          readOnly: t.readOnly,
          requiresConfirm: !t.readOnly,
        })),
      });
    },
  );

  registerTwilioWebhookRoutes(app);

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "errors.notFound" });
  });

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError && "body" in err) {
      return res.status(400).json({ error: "validation.invalidJson" });
    }
    if (err?.type === "entity.too.large" || err?.status === 413) {
      return res.status(413).json({ error: "errors.payloadTooLarge" });
    }
    console.error("[api] unhandled:", err?.message ?? err);
    res.status(500).json({ error: "errors.server" });
  });

  return app;
}

const app = buildApp();

export function createServer() {
  return buildApp();
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  return app(req as any, res as any);
}

/** Test helpers */
export const __test = {
  sendSms,
  normalizeE164,
  toSmsE164,
  listAssignedPhoneNumbers,
  requireConversationsAccess,
  parseLeadBody,
  parseGetCreditReportBody,
  parseContactBody,
  parsePartnerBody,
  listActiveTeamAdmins,
  notifyAllTeamAdmins,
  shouldDeliverEmail,
  pool,
  MFSN_FREE_SNAPSHOT_URL,
  ADMIN_PERMS,
  eventRegistrationOpen,
  assertMilestoneTransition,
  MILESTONE_TRANSITIONS,
  buildContractPdf,
  isAllowedPhotoUrl,
  detectImageType,
  mapAnchorLoanStatus,
  __testSetAnchorHttp,
  sanitizeMcpJsonRpcForClaude,
  mcpToolsListForClaude,
  parseBearerAuthorization,
  mcpRedirectUriAllowed,
  mcpRedirectUriOkForRegistration,
  mcpOauthReturnPathAllowed,
  verifyPkceS256,
  mcpWriteConfirmed,
  siteOrigin,
  mcpResourceUrl,
  MCP_SCOPE,
};
