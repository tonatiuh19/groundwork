/**
 * Groundwork Capital — Vercel serverless Express monolith.
 * Keep all runtime API logic inline in this file (no relative value imports).
 * `import type` from shared/ is allowed.
 */
import "dotenv/config";
import crypto from "crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import cors from "cors";
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
import { put as putBlob } from "@vercel/blob";
import type {
  AdminNotifyEventKey,
  AdminRole,
  ContactIntent,
  EventRegistrationStatus,
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
  SubmitSimpleLeadResponse,
} from "../shared/api";

const APP_NAME = "Groundwork Capital";
const APP_URL = (
  process.env.PUBLIC_APP_URL || "https://groundworkcapitalgroup.com"
).replace(/\/$/, "");

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
 * Live email when Resend is configured. Same rule in local and production.
 * VITEST always dry-runs (never hits Resend). Set NOTIFY_EMAILS=false to force dry-run.
 */
function shouldDeliverEmail(): boolean {
  if (process.env.VITEST === "true") return false;
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
  preferred_language: string | null;
};

async function listActiveTeamAdmins(): Promise<TeamAdminRecipient[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, email, first_name, preferred_language
     FROM admins
     WHERE status = 'active'
       AND role IN ('super_admin', 'admin', 'agent', 'finance', 'content')
       AND email IS NOT NULL AND TRIM(email) <> ''`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    email: String(r.email),
    first_name: String(r.first_name || "Admin"),
    preferred_language: (r.preferred_language as string) || "en",
  }));
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
    if (r.events_json == null) {
      out.push(email);
      continue;
    }
    try {
      const parsed = JSON.parse(String(r.events_json));
      if (Array.isArray(parsed) && parsed.includes(eventKey)) out.push(email);
    } catch {
      out.push(email);
    }
  }
  return out;
}

async function notifyAllTeamAdmins(
  eventKey: AdminNotifyEventKey,
  build: (admin: TeamAdminRecipient) => {
    subject: string;
    html: string;
  },
): Promise<number> {
  const admins = await listActiveTeamAdmins();
  let sent = 0;
  await Promise.all(
    admins.map(async (admin) => {
      try {
        const tpl = build(admin);
        const result = await sendEmail({
          to: admin.email,
          subject: tpl.subject,
          html: tpl.html,
        });
        if (result.ok) sent += 1;
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
      .map(async (email) => {
        try {
          const tpl = build({
            id: 0,
            email,
            first_name: "Team",
            preferred_language: "en",
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
    },
  };
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
  | "settings";

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
  ) {
    super(key);
  }
}

/** Wrap a handler so thrown HttpError maps to `{ error }` with status. */
function route(fn: (req: Request, res: Response) => Promise<unknown>) {
  return handle(async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof HttpError) {
        return res.status(e.status).json({ error: e.key });
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

/** Commission: admin override → plan default → sq ft × configured rate (decision 7C). */
export function resolveCommissionCents(input: {
  override_cents: number | null;
  plan_default_cents: number | null;
  sq_ft: number | null;
  rate_cents_per_sqft: number;
}): number {
  if (input.override_cents != null) return Number(input.override_cents);
  if (input.plan_default_cents != null) return Number(input.plan_default_cents);
  return Math.max(0, Math.round(Number(input.sq_ft || 0) * input.rate_cents_per_sqft));
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

async function recalcProject(conn: Pool | PoolConnection, projectId: number) {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT p.*, pl.default_commission_cents AS plan_default_cents
     FROM projects p LEFT JOIN adu_plans pl ON pl.id = p.adu_plan_id
     WHERE p.id = ? LIMIT 1`,
    [projectId],
  );
  const p = rows[0];
  if (!p) return;
  const paid = await projectHasPaidCommission(conn, projectId);
  const rate = await getSettingInt("commission_cents_per_sqft", 1000, conn);
  // After payout, freeze the project commission amount used in profit math.
  const affComm = paid
    ? p.affiliate_commission_cents == null
      ? null
      : Number(p.affiliate_commission_cents)
    : p.affiliate_id
      ? resolveCommissionCents({
          override_cents: p.commission_override_cents ?? null,
          plan_default_cents: p.plan_default_cents ?? null,
          sq_ft: p.sq_ft ?? null,
          rate_cents_per_sqft: rate,
        })
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
  // Keep an unpaid commission row in sync with the latest amount (never mutate paid).
  if (!paid && p.affiliate_id && affComm != null) {
    await conn.execute(
      `UPDATE affiliate_commissions
       SET amount_cents = ?, sq_ft = ?, rate_cents_per_sqft = ?
       WHERE project_id = ? AND affiliate_id = ? AND status IN ('pending','approved')`,
      [
        affComm,
        p.sq_ft ?? null,
        p.sq_ft ? Math.round(affComm / Number(p.sq_ft)) : null,
        projectId,
        p.affiliate_id,
      ],
    );
  }
}

/** Create/void the affiliate commission when a loan is finalized / un-finalized. */
async function syncCommissionForLoan(
  conn: Pool | PoolConnection,
  projectId: number,
  finalized: boolean,
  adminId: number | null,
) {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT id, affiliate_id, client_id, sq_ft, affiliate_commission_cents
     FROM projects WHERE id = ? LIMIT 1`,
    [projectId],
  );
  const p = rows[0];
  if (!p || !p.affiliate_id) return;
  if (finalized) {
    const days = await getSettingInt("commission_payout_days_after_loan_close", 5, conn);
    const expected = addDaysIso(new Date(), days);
    const amount = Number(p.affiliate_commission_cents || 0);
    // Skip $0 accruals (no plan / sq ft / override yet).
    if (amount <= 0) return;
    await conn.execute(
      `INSERT INTO affiliate_commissions
         (affiliate_id, project_id, client_id, amount_cents, sq_ft,
          rate_cents_per_sqft, status, expected_pay_at, created_by_admin_id)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
       ON DUPLICATE KEY UPDATE
         amount_cents = IF(status = 'paid', amount_cents, VALUES(amount_cents)),
         expected_pay_at = IF(status = 'paid', expected_pay_at, VALUES(expected_pay_at)),
         status = IF(status = 'void', 'pending', status)`,
      [
        p.affiliate_id,
        projectId,
        p.client_id,
        amount,
        p.sq_ft ?? null,
        p.sq_ft ? Math.round(amount / Number(p.sq_ft)) : null,
        expected,
        adminId,
      ],
    );
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
      `UPDATE projects SET commission_expected_pay_at = NULL WHERE id = ?`,
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
      return tplPortalNotice({ ...build(lang), lang });
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
const fSlug: FieldParser = (v) =>
  v === null || v === "" || v === undefined
    ? { ok: true, value: null }
    : /^[a-z0-9-]{3,64}$/.test(String(v))
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
  const W = 612;
  const H = 792;
  const M = 54;
  const BOTTOM = 72;
  const MAX_CHARS = 88;
  const pages: string[][] = [[]];
  let y = H - M;
  const ops = () => pages[pages.length - 1];
  const ensure = (need: number) => {
    if (y - need < BOTTOM) {
      pages.push([]);
      y = H - M;
    }
  };
  const text = (font: "F1" | "F2", size: number, x: number, s: string, rgb = "0.12 0.14 0.19") => {
    ops().push(`${rgb} rg BT /${font} ${size} Tf ${x} ${y.toFixed(2)} Td (${pdfEscape(s)}) Tj ET`);
  };
  const line = (x1: number, x2: number, rgb: string, w = 0.75) => {
    ops().push(`${rgb} RG ${w} w ${x1} ${y.toFixed(2)} m ${x2} ${y.toFixed(2)} l S`);
  };
  const heading = (s: string) => {
    ensure(40);
    y -= 14;
    text("F2", 12, M, s, "0.055 0.165 0.29");
    y -= 6;
    line(M, W - M, "0.85 0.64 0.25", 1);
    y -= 14;
  };
  const row = (label: string, value: unknown) => {
    const v = value == null || value === "" ? c.none : String(value);
    const lines = wrapPdfText(v, MAX_CHARS - 22);
    ensure(lines.length * 14 + 2);
    text("F2", 10, M, label);
    for (const l of lines) {
      text("F1", 10, M + 120, l);
      y -= 14;
    }
  };
  const para = (s: string) => {
    for (const l of wrapPdfText(s, MAX_CHARS)) {
      ensure(14);
      text("F1", 10, M, l);
      y -= 14;
    }
  };

  y -= 10;
  text("F2", 10, M, c.brand.toUpperCase(), "0.85 0.64 0.25");
  y -= 26;
  for (const l of wrapPdfText(c.titles[input.kind] || c.titles.other, 52)) {
    text("F2", 20, M, l, "0.055 0.165 0.29");
    y -= 26;
  }

  heading(c.project);
  row(c.project, p.project);
  row(c.status, c.statuses[input.status] || input.status);
  row(c.generated, p.generated_on);

  heading(c.property);
  const pr = p.property || {};
  row(c.property, pr.address);
  row("", [pr.city, [pr.state, pr.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "));

  if (p.plan) {
    heading(c.plan);
    row(c.plan, p.plan.name);
    const specs = [
      p.plan.sq_ft != null ? `${p.plan.sq_ft} ${c.area}` : null,
      p.plan.bedrooms != null ? `${p.plan.bedrooms} ${c.beds}` : null,
      p.plan.bathrooms != null ? `${p.plan.bathrooms} ${c.baths}` : null,
    ].filter(Boolean);
    row("", specs.join(" · "));
  }

  heading(c.client);
  row(c.name, p.client?.name);
  row(c.email, p.client?.email);
  row(c.phone, p.client?.phone);

  if (p.contractor) {
    heading(c.contractor);
    row(c.name, p.contractor.name);
    row(c.company, p.contractor.company);
    row(c.license, p.contractor.license);
    row(c.email, p.contractor.email);
  }

  heading(c.price);
  row(
    c.price,
    p.contract_price_cents == null ? null : money(Number(p.contract_price_cents)),
  );

  heading(c.terms);
  para(c.termsBody);

  const signers = [c.client, ...(p.contractor ? [c.contractor] : [])];
  ensure(40 + signers.length * 52);
  y -= 24;
  for (const who of signers) {
    y -= 18;
    line(M, M + 260, "0.12 0.14 0.19");
    line(M + 300, W - M, "0.12 0.14 0.19");
    y -= 12;
    text("F1", 9, M, `${who} — ${c.sign}`, "0.4 0.44 0.52");
    text("F1", 9, M + 300, c.date, "0.4 0.44 0.52");
    y -= 20;
  }

  // Footers (need the final page count).
  const total = pages.length;
  pages.forEach((pageOps, i) => {
    pageOps.push(
      `0.4 0.44 0.52 rg BT /F1 8 Tf ${M} 36 Td (${pdfEscape(
        `${c.brand} · ${p.project || ""} · ${c.page} ${i + 1} ${c.of} ${total}`,
      )}) Tj ET`,
    );
  });

  // Objects: 1 catalog, 2 pages, 3 F1, 4 F2, 5 info, then (content, page) pairs.
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${7 + i * 2} 0 R`).join(" ");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${total} >>`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  objs.push(
    `<< /Title (${pdfEscape(`${c.titles[input.kind] || c.titles.other} ${p.project || ""}`.trim())}) /Producer (Groundwork Capital) >>`,
  );
  pages.forEach((pageOps, i) => {
    const stream = pageOps.join("\n");
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`,
    );
  });

  let pdf = "%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n";
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
  const [p] = await conn.execute<ResultSetHeader>(
    `INSERT INTO projects
       (public_id, client_id, lead_id, affiliate_id, assigned_admin_id, adu_plan_id,
        milestone, milestone_changed_at, property_address, property_city, property_zip, sq_ft)
     VALUES (?, ?, ?, ?, ?, ?, 'lead', NOW(), ?, ?, ?, ?)`,
    [
      publicId,
      clientId,
      input.lead_id,
      input.affiliate_id,
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
  if (canFinance) {
    const [c] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM affiliate_commissions WHERE project_id = ? LIMIT 1`,
      [pid],
    );
    commission = c[0] || null;
  }
  return {
    project: shapeAdminProject(project, canFinance),
    photos,
    draws,
    contracts,
    events,
    commission,
  };
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

      const code = await uniqueReferralCode();
      await pool.execute(
        `INSERT INTO affiliates
           (email, first_name, last_name, phone, company, status, preferred_language, referral_code)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
        [email, first, last, phone, company, lang, code],
      );

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
      const [dup] = await pool.execute<RowDataPacket[]>(
        `SELECT id FROM clients WHERE email = ? LIMIT 1`,
        [email],
      );
      if (dup.length) throw new HttpError(409, "errors.clientExists");

      const created = await withTx(async (conn) => {
        const [leadIns] = await conn.execute<ResultSetHeader>(
          `INSERT INTO leads
             (first_name, last_name, full_name, email, phone, property_address,
              soft_pull_consent, mode, source, preferred_language,
              affiliate_id, referral_code, status, ip_address, user_agent)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'standard', 'enroll', ?, ?, ?, 'qualified', ?, ?)`,
          [
            first,
            last,
            `${first} ${last}`,
            email,
            phone,
            address,
            softPull ? 1 : 0,
            lang,
            affiliateRef?.id ?? null,
            affiliateRef?.referral_code ?? null,
            clientIp(req),
            String(req.headers["user-agent"] || "").slice(0, 500) || null,
          ],
        );
        const leadId = Number(leadIns.insertId);
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
        await conn.execute(`UPDATE leads SET client_id = ? WHERE id = ?`, [
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
      `SELECT i.id, i.email, i.contractor_id, c.first_name, c.company
       FROM contractor_invites i
       JOIN contractors c ON c.id = i.contractor_id
       WHERE i.token = ? AND i.accepted_at IS NULL AND i.expires_at > NOW()
         AND c.status = 'invited' LIMIT 1`,
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
      await withTx(async (conn) => {
        await conn.execute(
          `UPDATE contractors SET status = 'active', activated_at = NOW() WHERE id = ?`,
          [inv.contractor_id],
        );
        await conn.execute(
          `UPDATE contractor_invites SET accepted_at = NOW() WHERE id = ?`,
          [inv.id],
        );
      });
      res.json({ ok: true, email: inv.email });
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
                phone, preferred_language, email
         FROM affiliates WHERE id = ? LIMIT 1`,
        [user.id],
      );
      const a = aRows[0];
      const [[clicks]] = (await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM affiliate_link_clicks WHERE affiliate_id = ?`,
        [user.id],
      )) as unknown as [RowDataPacket[]];
      const [[leads]] = (await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM leads WHERE affiliate_id = ?`,
        [user.id],
      )) as unknown as [RowDataPacket[]];
      const [milestones] = await pool.execute<RowDataPacket[]>(
        `SELECT milestone, COUNT(*) AS n FROM projects WHERE affiliate_id = ? GROUP BY milestone`,
        [user.id],
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
           ON ac.project_id = p.id AND ac.affiliate_id = p.affiliate_id
         WHERE p.affiliate_id = ?
         ORDER BY p.created_at DESC LIMIT 500`,
        [user.id],
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
        `SELECT ac.id, p.public_id AS project_public_id,
                CONCAT(c.first_name, ' ', c.last_name) AS client_name,
                ac.amount_cents, ac.sq_ft, ac.status, ac.expected_pay_at, ac.paid_at, ac.created_at
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
                l.source, l.affiliate_id, l.client_id, l.referral_code, l.notes, l.status,
                l.created_at, CONCAT(a.first_name, ' ', a.last_name) AS affiliate_name
         FROM leads l LEFT JOIN affiliates a ON a.id = l.affiliate_id
         LEFT JOIN marketing_events e ON e.id = l.event_id
         ${whereSql}
         ORDER BY l.id DESC
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
    requireAdmin("projects.write"),
    route(async (req, res) => {
      const user = portalUser(res);
      const id = parseId(req.params.id);
      const planId = req.body?.adu_plan_id ? parseId(req.body.adu_plan_id) : null;
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT * FROM leads WHERE id = ? LIMIT 1`,
        [id],
      );
      const lead = rows[0];
      if (!lead) throw new HttpError(404, "errors.notFound");
      if (lead.client_id) throw new HttpError(409, "errors.leadAlreadyConverted");
      const created = await withTx(async (conn) => {
        const [ex] = await conn.execute<RowDataPacket[]>(
          `SELECT id FROM clients WHERE email = ? LIMIT 1`,
          [String(lead.email).toLowerCase()],
        );
        const out = await createClientWithProject(conn, {
          email: String(lead.email).toLowerCase(),
          first_name: String(lead.first_name || lead.full_name).slice(0, 100),
          last_name: String(lead.last_name || "").slice(0, 100),
          phone: lead.phone,
          lang: asLang(lead.preferred_language),
          property_address: lead.property_address,
          property_city: null,
          property_zip: null,
          affiliate_id: lead.affiliate_id ?? null,
          lead_id: Number(lead.id),
          adu_plan_id: planId,
          assigned_admin_id: user.id,
          byType: "admin",
          byId: user.id,
          existingClientId: ex[0] ? Number(ex[0].id) : null,
        });
        await conn.execute(
          `UPDATE leads SET client_id = ?, status = 'qualified' WHERE id = ?`,
          [out.clientId, id],
        );
        const token = await issueClientPortalInvite(conn, {
          clientId: out.clientId,
          email: String(lead.email).toLowerCase(),
          byType: "admin",
          byId: user.id,
        });
        return { ...out, token };
      });
      const lang = asLang(lead.preferred_language);
      const first = String(lead.first_name || lead.full_name || "").slice(0, 100);
      await sendClientPortalInviteEmail({
        email: String(lead.email).toLowerCase(),
        firstName: first,
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
      res.status(201).json({
        ok: true,
        client_id: created.clientId,
        project_public_id: created.publicId,
        invite_sent: true,
      });
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
          "(a.first_name LIKE ? OR a.last_name LIKE ? OR a.email LIKE ? OR a.company LIKE ?)",
        );
        params.push(like, like, like, like);
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
                a.preferred_language,
                (SELECT COUNT(*) FROM affiliate_link_clicks k WHERE k.affiliate_id = a.id) AS click_count,
                (SELECT COUNT(*) FROM projects p WHERE p.affiliate_id = a.id) AS client_count
         FROM affiliates a
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
                a.preferred_language, a.avatar_url, a.bio,
                (SELECT COUNT(*) FROM affiliate_link_clicks k WHERE k.affiliate_id = a.id) AS click_count,
                (SELECT COUNT(*) FROM projects p WHERE p.affiliate_id = a.id) AS client_count
         FROM affiliates a WHERE a.id = ? LIMIT 1`,
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
        slug: fSlug,
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
      const approving = updates.status === "active" && a.status === "pending";
      if (approving) {
        updates.approved_at = new Date();
        updates.approved_by_admin_id = user.id;
      }
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
        "invited",
        "active",
        "inactive",
        "suspended",
      ]);
      const { limit, offset } = parseListPaging(req);
      const where: string[] = [];
      const params: any[] = [];
      if (status) {
        where.push("k.status = ?");
        params.push(status);
      }
      if (like) {
        where.push(
          "(k.first_name LIKE ? OR k.last_name LIKE ? OR k.email LIKE ? OR k.company LIKE ?)",
        );
        params.push(like, like, like, like);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const [countRows] = await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM contractors k ${whereSql}`,
        params,
      );
      const total = Number(countRows[0]?.n || 0);
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT k.id, k.email, k.first_name, k.last_name, k.phone, k.company, k.license_number,
                k.status, k.notes, k.activated_at, k.last_login_at, k.created_at, k.preferred_language,
                (SELECT COUNT(*) FROM projects p WHERE p.contractor_id = k.id) AS project_count
         FROM contractors k
         ${whereSql}
         ORDER BY k.id DESC
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
                (SELECT COUNT(*) FROM projects p WHERE p.contractor_id = k.id) AS project_count
         FROM contractors k WHERE k.id = ? LIMIT 1`,
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
      await safeSend(
        email,
        tplPortalNotice({
          lang,
          subject: tr(lang, "You're invited to the Groundwork contractor portal", "Te invitamos al portal de contratistas de Groundwork"),
          headline: tr(lang, "Build with Groundwork.", "Construye con Groundwork."),
          paragraphs: [
            tr(lang, `Hi ${first}, you've been invited to manage ADU projects, upload progress photos and request draws.`, `Hola ${first}, te invitamos a gestionar proyectos ADU, subir fotos de avance y solicitar desembolsos.`),
            tr(lang, "Accept your invite to activate your account. The link expires in 7 days.", "Acepta tu invitación para activar tu cuenta. El enlace caduca en 7 días."),
          ],
          cta: { url: `${APP_URL}/contractor/invite/${token}`, label: tr(lang, "Accept invite", "Aceptar invitación") },
        }),
      );
      res.status(201).json({ ok: true, contractor_id: contractorId });
    }),
  );

  app.patch(
    "/api/admin/contractors/:id",
    requireAdmin("approvals"),
    route(async (req, res) => {
      const id = parseId(req.params.id);
      const { updates } = parsePatch(req.body, {
        status: fEnum(["active", "inactive", "suspended"] as const),
        notes: fStr(5000),
        company: fStr(200),
        license_number: fStr(100),
        phone: fStr(40),
      });
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT status FROM contractors WHERE id = ? LIMIT 1`,
        [id],
      );
      if (!rows[0]) throw new HttpError(404, "errors.notFound");
      if (rows[0].status === "invited" && "status" in updates) {
        throw new HttpError(409, "errors.contractorInvited");
      }
      await applyUpdate(pool, "contractors", id, updates);
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
         ORDER BY c.id DESC
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
      const id = parseId(req.params.id);
      const { updates } = parsePatch(req.body, {
        first_name: fStr(100, { min: 1 }),
        last_name: fStr(100, { min: 1 }),
        phone: fStr(40),
        status: fEnum(["prospect", "active", "inactive", "suspended"] as const),
        address_line1: fStr(255),
        city: fStr(100),
        zip: fStr(20),
        affiliate_id: fInt(1),
        assigned_admin_id: fInt(1),
        admin_notes: fStr(5000),
        preferred_language: fLang,
      });
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT id FROM clients WHERE id = ? LIMIT 1`,
        [id],
      );
      if (!rows[0]) throw new HttpError(404, "errors.notFound");
      if (updates.affiliate_id) {
        const [a] = await pool.execute<RowDataPacket[]>(
          `SELECT id, status FROM affiliates WHERE id = ? LIMIT 1`,
          [updates.affiliate_id],
        );
        if (!a[0]) throw new HttpError(400, "errors.invalidReference");
        if (a[0].status !== "active") throw new HttpError(400, "errors.affiliateInactive");
      }
      await applyUpdate(pool, "clients", id, updates);
      res.json({ ok: true });
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
      const token = await issueClientPortalInvite(pool, {
        clientId: id,
        email: String(c.email),
        byType: "admin",
        byId: user.id,
      });
      await sendClientPortalInviteEmail({
        email: String(c.email),
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
      if (updates.affiliate_id) {
        const [a] = await pool.execute<RowDataPacket[]>(
          `SELECT id, status FROM affiliates WHERE id = ? LIMIT 1`,
          [updates.affiliate_id],
        );
        if (!a[0]) throw new HttpError(400, "errors.invalidReference");
        if (a[0].status !== "active") throw new HttpError(400, "errors.affiliateInactive");
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

      if (becameFinalized && old.affiliate_id) {
        const [affRows] = await pool.execute<RowDataPacket[]>(
          `SELECT a.email, a.first_name, a.preferred_language, ac.amount_cents, ac.id AS commission_id
           FROM affiliates a
           JOIN projects p ON p.affiliate_id = a.id
           LEFT JOIN affiliate_commissions ac
             ON ac.project_id = p.id AND ac.affiliate_id = a.id AND ac.status = 'pending'
           WHERE p.id = ? LIMIT 1`,
          [old.id],
        );
        const aff = affRows[0];
        if (aff?.email && Number(aff.amount_cents || 0) > 0) {
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
                  `Hi ${aff.first_name}, loan finalize on ${publicId} created a pending commission of ${money(aff.amount_cents)}.`,
                  `Hola ${aff.first_name}, al finalizar el préstamo de ${publicId} se creó una comisión pendiente de ${money(aff.amount_cents)}.`,
                ),
              ],
              cta: {
                url: `${APP_URL}/affiliate/commissions`,
                label: tr(lang, "View commissions", "Ver comisiones"),
              },
            }),
          );
          await notifyStaff("commission_accrued", (l) => ({
            subject: tr(l, `Commission accrued · ${publicId}`, `Comisión acumulada · ${publicId}`),
            headline: tr(l, "Affiliate commission pending.", "Comisión de afiliado pendiente."),
            paragraphs: [
              tr(
                l,
                `${money(aff.amount_cents)} pending for ${publicId}.`,
                `${money(aff.amount_cents)} pendiente para ${publicId}.`,
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
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT ac.*, CONCAT(a.first_name, ' ', a.last_name) AS affiliate_name,
                a.email AS affiliate_email, p.public_id AS project_public_id,
                CONCAT(c.first_name, ' ', c.last_name) AS client_name
         FROM affiliate_commissions ac
         JOIN affiliates a ON a.id = ac.affiliate_id
         JOIN projects p ON p.id = ac.project_id
         LEFT JOIN clients c ON c.id = ac.client_id
         ${status ? "WHERE ac.status = ?" : ""}
         ORDER BY FIELD(ac.status, 'pending', 'approved', 'paid', 'void'), ac.id DESC
         LIMIT 500`,
        status ? [status] : [],
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
      await withTx(async (conn) => {
        await applyUpdate(conn, "affiliate_commissions", id, updates);
        if (next === "paid") {
          await conn.execute(`UPDATE projects SET commission_paid_at = NOW() WHERE id = ?`, [c.project_id]);
        }
        if ("amount_cents" in updates) {
          // Admin-entered amount becomes the project override so recalcs keep it (decision 7C).
          await conn.execute(
            `UPDATE projects SET commission_override_cents = ? WHERE id = ?`,
            [updates.amount_cents, c.project_id],
          );
          await recalcProject(conn, Number(c.project_id));
        }
      });
      if (next === "paid") {
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
      res.json({
        ok: true,
        settings: {
          commission_payout_days_after_loan_close: await getSettingInt(
            "commission_payout_days_after_loan_close",
            5,
          ),
          commission_cents_per_sqft: await getSettingInt("commission_cents_per_sqft", 1000),
        },
        notify_extra_emails: extras.map((r) => ({
          id: Number(r.id),
          email: String(r.email),
          label: r.label == null ? null : String(r.label),
          is_active: Number(r.is_active) === 1,
          events_json: r.events_json == null ? null : String(r.events_json),
          created_at: r.created_at,
        })),
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
      });
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
      let eventsJson: string | null = null;
      if (req.body?.events != null) {
        if (!Array.isArray(req.body.events)) throw new HttpError(400, "validation.invalidField");
        eventsJson = JSON.stringify(req.body.events.map(String));
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
        if (req.body.events == null) updates.events_json = null;
        else if (!Array.isArray(req.body.events)) throw new HttpError(400, "validation.invalidField");
        else updates.events_json = JSON.stringify(req.body.events.map(String));
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

        const payload: PortalAuthResponse = {
          ok: true,
          actor,
          user: toPortalUser(actor, row),
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
        const [result] = await pool.execute<ResultSetHeader>(
          `INSERT INTO leads (
             first_name, last_name, full_name, email, phone, property_address,
             soft_pull_consent, mode, event_city, event_id, event_registration_status,
             source, preferred_language,
             affiliate_id, referral_code, status, ip_address, user_agent
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
          [
            firstName.slice(0, 100),
            lastName.slice(0, 100),
            data.full_name,
            data.email,
            data.phone,
            data.property_address,
            data.soft_pull_consent ? 1 : 0,
            data.mode || "standard",
            eventCity,
            eventRow ? Number(eventRow.id) : null,
            registrationStatus,
            data.source || "website",
            data.preferred_language || "en",
            affiliateRef?.id ?? null,
            affiliateRef?.referral_code ?? null,
            ip,
            ua,
          ],
        );

        const leadId = Number(result.insertId);
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
        const [result] = await pool.execute<ResultSetHeader>(
          `INSERT INTO leads (
             first_name, last_name, full_name, email, phone, property_address,
             soft_pull_consent, mode, source, preferred_language, notes,
             affiliate_id, referral_code, status, ip_address, user_agent
           ) VALUES (?, ?, ?, ?, ?, NULL, ?, 'standard', 'get_credit_report', ?, ?, ?, ?, 'new', ?, ?)`,
          [
            data.first_name,
            data.last_name,
            fullName,
            data.email,
            data.phone,
            data.soft_pull_consent ? 1 : 0,
            data.preferred_language,
            data.notes || null,
            affiliateRef?.id ?? null,
            affiliateRef?.referral_code ?? null,
            ip,
            ua,
          ],
        );

        const leadId = Number(result.insertId);

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

        const [result] = await pool.execute<ResultSetHeader>(
          `INSERT INTO leads (
             first_name, last_name, full_name, email, phone, property_address,
             soft_pull_consent, mode, source, preferred_language, notes,
             status, ip_address, user_agent
           ) VALUES (?, ?, ?, ?, ?, NULL, 0, 'standard', 'contact_form', ?, ?, 'new', ?, ?)`,
          [
            firstName.slice(0, 100),
            lastName.slice(0, 100),
            data.full_name,
            data.email,
            data.phone,
            data.preferred_language || "en",
            notes,
            ip,
            ua,
          ],
        );
        const leadId = Number(result.insertId);

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
        const ip =
          (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
          req.socket.remoteAddress ||
          null;
        const ua = String(req.headers["user-agent"] || "").slice(0, 500) || null;
        const nameParts = data.full_name.trim().split(/\s+/);
        const firstName = nameParts[0] || data.full_name;
        const lastName = nameParts.slice(1).join(" ") || "";
        const notes = [
          data.company ? `company=${data.company}` : null,
          data.notes || null,
        ]
          .filter(Boolean)
          .join("; ");

        const [result] = await pool.execute<ResultSetHeader>(
          `INSERT INTO leads (
             first_name, last_name, full_name, email, phone, property_address,
             soft_pull_consent, mode, source, preferred_language, notes,
             status, ip_address, user_agent
           ) VALUES (?, ?, ?, ?, ?, NULL, 0, 'standard', 'partner_referral', ?, ?, 'new', ?, ?)`,
          [
            firstName.slice(0, 100),
            lastName.slice(0, 100),
            data.full_name,
            data.email,
            data.phone,
            data.preferred_language || "en",
            notes || null,
            ip,
            ua,
          ],
        );
        const leadId = Number(result.insertId);

        const confirm = tplGenericConfirmation({
          fullName: data.full_name,
          kind: "partner",
          lang: data.preferred_language,
        });
        await sendEmail({
          to: data.email,
          subject: confirm.subject,
          html: confirm.html,
        });

        await notifyAllTeamAdmins("partner_referral", (admin) =>
          tplStaffLeadAlert({
            adminFirstName: admin.first_name,
            lang: admin.preferred_language === "es" ? "es" : "en",
            kind: "partner",
            lead: {
              id: leadId,
              full_name: data.full_name,
              email: data.email,
              phone: data.phone,
              property_address: notes || "",
              mode: "standard",
              soft_pull_consent: false,
            },
          }),
        );

        const payload: SubmitSimpleLeadResponse = {
          ok: true,
          lead_id: leadId,
          message: "Thanks — welcome to the partner program.",
        };
        return res.status(201).json(payload);
      } catch (e: any) {
        console.error("[partner] submit failed:", e?.message ?? e);
        return res.status(500).json({ error: "errors.server" });
      }
    },
  );

  registerFeatureRoutes(app, { lead: leadLimiter, referral: referralLimiter });

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
};
