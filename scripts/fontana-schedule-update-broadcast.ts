/**
 * One-shot Resend broadcast: Fontana Oct 6 time correction (11 AM → 7 PM PDT).
 *
 * Usage:
 *   npx tsx scripts/fontana-schedule-update-broadcast.ts --to=axgoomez@gmail.com --send
 *   npx tsx scripts/fontana-schedule-update-broadcast.ts --all --dry-run
 *   npx tsx scripts/fontana-schedule-update-broadcast.ts --all --confirm --send
 *
 * VITEST=true or NOTIFY_EMAILS=false always dry-runs.
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { Resend } from "resend";

const APP_URL = "https://www.groundworkcapitalgroup.com";
const EVENT_URL = `${APP_URL}/events/fontana-oct-6`;
const GCR_URL = `${APP_URL}/get-credit-report`;
const LOGO_URL =
  process.env.EMAIL_LOGO_URL?.trim() ||
  `${APP_URL}/logos/groundwork-logo.png`;
const SUPPORT =
  process.env.SUPPORT_EMAIL?.trim() || "info@groundworkcapitalgroup.com";
const FROM =
  process.env.SMTP_FROM?.trim() ||
  "Groundwork Capital <no-reply@groundworkcapitalgroup.com>";

const BRAND = {
  ink: "#0e2a4a",
  gold: "#c9a24d",
  paper: "#f8f5ef",
  charcoal: "#2c333a",
};

type Recipient = {
  email: string;
  full_name: string;
  preferred_language: "en" | "es";
};

function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shouldDeliver(): boolean {
  if (process.env.VITEST === "true") return false;
  if (!String(process.env.RESEND_API_KEY || "").trim()) return false;
  if (process.env.NOTIFY_EMAILS === "false") return false;
  return true;
}

export function buildScheduleUpdateEmail(opts: {
  fullName: string;
  lang?: "en" | "es";
}): { subject: string; html: string; preheader: string } {
  const isEs = opts.lang === "es";
  const first = escapeHtml(
    opts.fullName.trim().split(/\s+/)[0] || (isEs ? "amigo" : "there"),
  );
  const whenEn = "Tuesday, October 6, 2026 at 7:00 PM PDT";
  const whenEs = "martes, 6 de octubre de 2026 a las 7:00 p. m. PDT";
  const when = isEs ? whenEs : whenEn;
  const location = "Fontana, California";

  const subject = isEs
    ? "Actualización: el evento ADU en Fontana es a las 7:00 p. m. (no a las 11:00 a. m.)"
    : "Update: Fontana ADU event is at 7:00 PM (not 11:00 AM)";

  const preheader = isEs
    ? "Corrección de horario — nos vemos a las 7:00 p. m. PDT."
    : "Schedule correction — see you at 7:00 PM PDT.";

  const bodyHtml = `
    <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND.gold};font-weight:700;">Groundwork Capital</p>
    <h1 style="margin:0 0 16px;font-size:26px;line-height:1.25;font-weight:800;color:${BRAND.ink};">
      ${isEs ? "Actualización de horario" : "Schedule update"}
    </h1>
    <p style="margin:0 0 14px;font-size:16px;line-height:1.65;color:${BRAND.charcoal};">
      ${isEs ? `Hola ${first},` : `Hi ${first},`}
    </p>
    <p style="margin:0 0 14px;font-size:16px;line-height:1.65;color:${BRAND.charcoal};">
      ${
        isEs
          ? "Queremos corregir un error en el horario que aparece en tu confirmación anterior."
          : "We need to correct the time that appeared in your earlier confirmation email."
      }
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;background:${BRAND.paper};border:1px solid rgba(14,42,74,0.08);border-radius:14px;">
      <tr><td style="padding:18px 20px;">
        <p style="margin:0 0 10px;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:#5c6470;font-weight:700;">
          ${isEs ? "Horario correcto" : "Correct time"}
        </p>
        <p style="margin:0 0 8px;font-size:17px;line-height:1.5;color:${BRAND.ink};font-weight:700;">
          ${escapeHtml(when)}
        </p>
        <p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:${BRAND.charcoal};">
          ${escapeHtml(location)}
        </p>
        <p style="margin:0;font-size:14px;line-height:1.55;color:#5c6470;">
          ${
            isEs
              ? "Tu confirmación anterior pudo decir 11:00 a. m. — ese horario era incorrecto. El evento es a las <strong style=\"color:" +
                BRAND.ink +
                ';">7:00 p. m. PDT</strong>.'
              : 'Your earlier confirmation may have said 11:00 AM — that time was incorrect. The event is at <strong style="color:' +
                BRAND.ink +
                ';">7:00 PM PDT</strong>.'
          }
        </p>
      </td></tr>
    </table>
    <p style="margin:0 0 8px;font-size:16px;line-height:1.65;color:${BRAND.charcoal};">
      ${
        isEs
          ? "Tu lugar sigue reservado. Si ya no puedes asistir, responde a este correo y lo anotamos."
          : "Your spot is still saved. If you can no longer make it, just reply to this email and we’ll note it."
      }
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px;">
      <tr><td style="border-radius:999px;background:${BRAND.gold};">
        <a href="${EVENT_URL}" style="display:inline-block;padding:14px 28px;color:${BRAND.ink};text-decoration:none;font-weight:700;font-size:15px;border-radius:999px;">
          ${isEs ? "Ver detalles del evento" : "View event details"}
        </a>
      </td></tr>
    </table>
    <p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#5c6470;">
      ${
        isEs
          ? `También puedes registrarte o revisar tu lugar en <a href="${GCR_URL}" style="color:${BRAND.ink};">${GCR_URL.replace("https://", "")}</a>.`
          : `You can also register or review your spot at <a href="${GCR_URL}" style="color:${BRAND.ink};">${GCR_URL.replace("https://", "")}</a>.`
      }
    </p>
  `;

  const tagline = isEs ? "Construye más desde casa" : "Build more from home";
  const footer = isEs
    ? `Recibes este correo porque te registraste al evento de Groundwork Capital.<br/>© ${new Date().getFullYear()} Groundwork Capital. Todos los derechos reservados.`
    : `You're receiving this email because you registered for a Groundwork Capital event.<br/>© ${new Date().getFullYear()} Groundwork Capital. All rights reserved.`;

  const html = `<!doctype html>
<html lang="${isEs ? "es" : "en"}"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.paper};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.charcoal};">
<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.paper};padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid rgba(14,42,74,0.08);box-shadow:0 12px 32px rgba(14,42,74,0.08);">
      <tr><td style="background:${BRAND.paper};padding:28px 32px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="vertical-align:middle;">
            <img src="${escapeHtml(LOGO_URL)}" alt="Groundwork Capital Group" height="44" style="display:block;height:44px;width:auto;border:0;max-width:240px;" />
          </td>
          <td align="right" style="vertical-align:middle;font-size:11px;color:${BRAND.ink};font-weight:600;letter-spacing:0.08em;text-transform:uppercase;padding-left:12px;">${tagline}</td>
        </tr></table>
      </td></tr>
      <tr><td style="height:3px;line-height:3px;font-size:0;background:linear-gradient(90deg,${BRAND.gold},#c5a059 50%,${BRAND.gold});">&nbsp;</td></tr>
      <tr><td style="padding:36px 32px;background:#ffffff;">${bodyHtml}</td></tr>
      <tr><td style="padding:22px 32px;background:${BRAND.ink};font-size:12px;color:rgba(248,245,239,0.72);text-align:center;line-height:1.65;">
        ${footer}<br/>
        <a href="mailto:${escapeHtml(SUPPORT)}" style="color:${BRAND.gold};text-decoration:none;">${escapeHtml(SUPPORT)}</a>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;

  return { subject, html, preheader };
}

async function loadAudience(pool: mysql.Pool): Promise<Recipient[]> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT email, full_name, preferred_language, created_at
     FROM leads
     WHERE mode = 'event'
     ORDER BY created_at ASC`,
  );
  const byEmail = new Map<string, Recipient>();
  for (const r of rows) {
    const email = String(r.email || "")
      .trim()
      .toLowerCase();
    if (!email || !email.includes("@")) continue;
    if (byEmail.has(email)) continue;
    const lang = r.preferred_language === "es" ? "es" : "en";
    byEmail.set(email, {
      email,
      full_name: String(r.full_name || "").replace(/\t/g, " ").trim() || "there",
      preferred_language: lang,
    });
  }
  return [...byEmail.values()];
}

async function main() {
  const args = process.argv.slice(2);
  const toArg = args.find((a) => a.startsWith("--to="))?.slice(5);
  const sendAll = args.includes("--all");
  const confirm = args.includes("--confirm");
  const doSend = args.includes("--send");
  const dryRunFlag = args.includes("--dry-run") || !doSend;

  if (!toArg && !sendAll) {
    console.error(
      "Usage: --to=email@example.com [--send]  OR  --all [--dry-run|--confirm --send]",
    );
    process.exit(1);
  }
  if (sendAll && doSend && !confirm) {
    console.error("Refusing --all --send without --confirm");
    process.exit(1);
  }

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 4000),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === "false" ? undefined : { minVersion: "TLSv1.2" },
    timezone: "Z",
    connectionLimit: 2,
  });

  let recipients: Recipient[] = [];
  if (toArg) {
    recipients = [
      {
        email: toArg.trim().toLowerCase(),
        full_name: "Alex",
        preferred_language: "en",
      },
    ];
  } else {
    recipients = await loadAudience(pool);
  }

  console.log(`Recipients: ${recipients.length}`);
  console.log(
    `Mode: ${dryRunFlag || !shouldDeliver() ? "DRY-RUN" : "LIVE SEND"}`,
  );

  const resend = process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : null;
  const live = doSend && shouldDeliver() && !!resend && !dryRunFlag;

  let ok = 0;
  let fail = 0;
  for (const r of recipients) {
    const built = buildScheduleUpdateEmail({
      fullName: r.full_name,
      lang: r.preferred_language,
    });
    if (!live) {
      console.log(`[dry-run] → ${r.email} | ${built.subject}`);
      ok++;
      continue;
    }
    const result = await resend!.emails.send({
      from: FROM,
      to: r.email,
      subject: built.subject,
      html: built.html,
    });
    if (result.error) {
      console.error(`[fail] ${r.email}`, result.error);
      fail++;
    } else {
      console.log(`[sent] ${r.email} id=${result.data?.id}`);
      ok++;
    }
    await new Promise((res) => setTimeout(res, 350));
  }

  console.log(`Done. ok=${ok} fail=${fail}`);
  if (toArg && live) {
    const sample = buildScheduleUpdateEmail({
      fullName: "Alex",
      lang: "en",
    });
    console.log("\n--- SAMPLE SUBJECT ---\n" + sample.subject);
    console.log("\n--- SAMPLE PREHEADER ---\n" + sample.preheader);
  }

  await pool.end();
}

const isDirect =
  process.argv[1]?.includes("fontana-schedule-update-broadcast");

if (isDirect) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
