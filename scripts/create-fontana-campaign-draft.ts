/**
 * Create a draft Fontana Discovery Night campaign (CTA opener, email-only)
 * scoped to marketing event slug fontana-oct-6, ready for Admin confirm/send.
 *
 *   npx tsx scripts/create-fontana-campaign-draft.ts --confirm
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const APP_URL = "https://www.groundworkcapitalgroup.com";
const EVENT_SLUG = "fontana-oct-6";
const INK = "#0e2a4a";
const GOLD = "#d9a441";

function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pathBtn(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px;width:100%;">
  <tr><td align="center" style="border-radius:999px;background:${GOLD};">
    <a href="${escapeHtml(url)}" style="display:block;padding:14px 22px;color:${INK};text-decoration:none;font-weight:700;font-size:15px;border-radius:999px;text-align:center;">${escapeHtml(label)}</a>
  </td></tr></table>`;
}

function templates() {
  const gcr = `${APP_URL}/get-credit-report`;
  const aff = `${APP_URL}/affiliate/signup`;
  const ctr = `${APP_URL}/contractor/signup`;
  const info = `${APP_URL}/`;
  const openerCtasEn = [
    pathBtn(gcr, "I'm a homeowner — free credit report"),
    pathBtn(info, "I want more ADU information first"),
    pathBtn(aff, "I'm a realtor or loan officer"),
    pathBtn(ctr, "I'm a contractor"),
  ].join("");
  const openerCtasEs = [
    pathBtn(gcr, "Soy propietario — reporte de crédito gratis"),
    pathBtn(info, "Primero quiero más información sobre ADU"),
    pathBtn(aff, "Soy realtor o loan officer"),
    pathBtn(ctr, "Soy contratista"),
  ].join("");
  return [
    {
      role: "opener",
      subject_en:
        "Thanks for joining ADU Discovery Night — pick your next step",
      subject_es: "Gracias por la Noche de ADU — elija su siguiente paso",
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

async function main() {
  if (!process.argv.includes("--confirm")) {
    console.error(
      "Dry preview only. Re-run with --confirm to insert the draft campaign.",
    );
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

  try {
    const [evRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id, slug, title_en, city FROM marketing_events WHERE slug = ? LIMIT 1`,
      [EVENT_SLUG],
    );
    const ev = evRows[0];
    if (!ev) {
      console.error(`Event slug ${EVENT_SLUG} not found`);
      process.exit(1);
    }
    const eventId = Number(ev.id);

    const [counts] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN email IS NOT NULL AND email <> '' THEN 1 ELSE 0 END) AS with_email,
         SUM(CASE WHEN preferred_language = 'es' THEN 1 ELSE 0 END) AS es_n,
         SUM(CASE WHEN preferred_language <> 'es' OR preferred_language IS NULL THEN 1 ELSE 0 END) AS en_n,
         SUM(CASE WHEN phone IS NOT NULL AND phone <> '' AND sms_marketing_consent = 1 THEN 1 ELSE 0 END) AS sms_ok
       FROM leads WHERE event_id = ?`,
      [eventId],
    );
    const c = (counts[0] || {}) as {
      total?: number;
      with_email?: number;
      en_n?: number;
      es_n?: number;
      sms_ok?: number;
    };
    console.log(`Event: ${ev.title_en} (#${eventId}, ${ev.city})`);
    console.log(
      `Audience: total=${c.total ?? 0} email=${c.with_email ?? 0} EN≈${c.en_n ?? 0} ES≈${c.es_n ?? 0} sms_consent=${c.sms_ok ?? 0}`,
    );

    if (!process.argv.includes("--confirm")) {
      console.log("No insert (missing --confirm).");
      return;
    }

    const [adminRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id FROM admins
       WHERE status = 'active' AND role IN ('super_admin','admin')
       ORDER BY id ASC LIMIT 1`,
    );
    const adminId = adminRows[0]?.id ? Number(adminRows[0].id) : null;

    const name = "Fontana Discovery Night — lead follow-up";
    const filter = { event_id: eventId };
    const channels = { email: true, sms: false };

    const [ins] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO campaigns
         (name, audience_kind, audience_filter_json, channels_json, status, created_by_admin_id)
       VALUES (?, 'leads', ?, ?, 'draft', ?)`,
      [name, JSON.stringify(filter), JSON.stringify(channels), adminId],
    );
    const campaignId = Number(ins.insertId);

    for (const t of templates()) {
      await pool.query(
        `INSERT INTO campaign_templates
           (campaign_id, role, subject_en, subject_es, email_html_en, email_html_es,
            sms_body_en, sms_body_es)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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

    console.log(`Created draft campaign #${campaignId}: ${name}`);
    console.log("Channels: email only (SMS off)");
    console.log("Open Admin → Campaigns, select it, review list, confirm → Send live.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
