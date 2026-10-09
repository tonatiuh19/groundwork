/**
 * Send sample Discovery Night follow-up emails (CTA version) for visual QA.
 *
 *   npx tsx scripts/send-pdf-broadcast-samples.ts --to=you@example.com
 */
import "dotenv/config";
import { Resend } from "resend";

const TO = (process.argv.find((a) => a.startsWith("--to=")) || "")
  .slice("--to=".length)
  .trim()
  .toLowerCase();

const APP_URL = "https://www.groundworkcapitalgroup.com";
const GCR = `${APP_URL}/get-credit-report`;
const AFF = `${APP_URL}/affiliate/signup`;
const CTR = `${APP_URL}/contractor/signup`;
const INFO = `${APP_URL}/`;
const LOGO =
  process.env.EMAIL_LOGO_URL?.trim() || `${APP_URL}/logos/groundwork-logo.png`;
const FROM =
  process.env.SMTP_FROM?.trim() ||
  "Groundwork Capital <no-reply@groundworkcapitalgroup.com>";
const SUPPORT =
  process.env.SUPPORT_EMAIL?.trim() || "info@groundworkcapitalgroup.com";

const INK = "#0e2a4a";
const GOLD = "#c9a24d";
const PAPER = "#f8f5ef";
const CHARCOAL = "#2c333a";

function layout(opts: {
  lang: "en" | "es";
  title: string;
  preheader: string;
  body: string;
}): string {
  const isEs = opts.lang === "es";
  const year = new Date().getFullYear();
  const tagline = isEs ? "Construye más desde casa" : "Build more from home";
  const footer = isEs
    ? `Recibes este correo porque te pusiste en contacto con Groundwork Capital.<br/>© ${year} Groundwork Capital. Todos los derechos reservados.`
    : `You're receiving this email because you reached out to Groundwork Capital.<br/>© ${year} Groundwork Capital. All rights reserved.`;
  return `<!doctype html>
<html lang="${isEs ? "es" : "en"}"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${opts.title}</title></head>
<body style="margin:0;padding:0;background:${PAPER};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${CHARCOAL};">
<div style="display:none;max-height:0;overflow:hidden;">${opts.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid rgba(14,42,74,0.08);box-shadow:0 12px 32px rgba(14,42,74,0.08);">
      <tr><td style="background:${PAPER};padding:28px 32px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="vertical-align:middle;">
            <img src="${LOGO}" alt="Groundwork Capital" height="44" style="display:block;height:44px;width:auto;border:0;max-width:240px;" />
          </td>
          <td align="right" style="vertical-align:middle;font-size:11px;color:${INK};font-weight:600;letter-spacing:0.08em;text-transform:uppercase;padding-left:12px;">${tagline}</td>
        </tr></table>
      </td></tr>
      <tr><td style="height:3px;line-height:3px;font-size:0;background:linear-gradient(90deg,${GOLD},#c5a059 50%,${GOLD});">&nbsp;</td></tr>
      <tr><td style="padding:36px 32px;background:#ffffff;">${opts.body}</td></tr>
      <tr><td style="padding:22px 32px;background:${INK};font-size:12px;color:rgba(248,245,239,0.72);text-align:center;line-height:1.65;">
        ${footer}<br/>
        <a href="mailto:${SUPPORT}" style="color:${GOLD};text-decoration:none;">${SUPPORT}</a>
        <br/><span style="opacity:0.85;">[SAMPLE — CTA version]</span>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

function btn(url: string, label: string, outline = false): string {
  const bg = outline ? "#ffffff" : GOLD;
  const border = outline ? `border:1px solid ${INK};` : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px;width:100%;">
  <tr><td align="center" style="border-radius:999px;background:${bg};${border}">
    <a href="${url}" style="display:block;padding:14px 22px;color:${INK};text-decoration:none;font-weight:700;font-size:15px;border-radius:999px;text-align:center;">${label}</a>
  </td></tr></table>`;
}

const samples: Array<{
  subject: string;
  lang: "en" | "es";
  preheader: string;
  body: string;
}> = [
  {
    subject:
      "[SAMPLE CTA] Thanks for joining ADU Discovery Night — pick your next step",
    lang: "en",
    preheader: "Choose your path with one tap — no need to reply.",
    body: `
      <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${GOLD};font-weight:700;">Leads · opener (CTA)</p>
      <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:800;color:${INK};">Thanks for coming to Fontana</h1>
      <p style="margin:0 0 14px;font-size:16px;line-height:1.65;color:${CHARCOAL};">Hi Alex,</p>
      <p style="margin:0 0 14px;font-size:16px;line-height:1.65;color:${CHARCOAL};">
        This is Cesar with Groundwork Capital. Thank you for your interest in our ADU Discovery Night in Fontana! It was the first of many events.
      </p>
      <p style="margin:0 0 20px;font-size:16px;line-height:1.65;color:${CHARCOAL};">
        Tap the path that fits you — we'll take you straight to the right next step:
      </p>
      ${btn(GCR, "I'm a homeowner — free credit report")}
      ${btn(INFO, "I want more ADU information first", true)}
      ${btn(AFF, "I'm a realtor or loan officer", true)}
      ${btn(CTR, "I'm a contractor", true)}
      <p style="margin:24px 0 0;font-size:16px;line-height:1.65;color:${CHARCOAL};">Thank you!<br/>Cesar Gomez and Daniel Carrillo</p>
      <p style="margin:28px 0 0;font-size:12px;line-height:1.5;color:#6b7280;">You can unsubscribe here: [unsubscribe link in live Broadcasts]</p>
    `,
  },
  {
    subject:
      "[SAMPLE CTA] Gracias por la Noche de ADU — elija su siguiente paso",
    lang: "es",
    preheader: "Elija su camino con un toque — no hace falta responder.",
    body: `
      <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${GOLD};font-weight:700;">Prospectos · apertura (CTA)</p>
      <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:800;color:${INK};">Gracias por venir a Fontana</h1>
      <p style="margin:0 0 14px;font-size:16px;line-height:1.65;color:${CHARCOAL};">Hola Alex,</p>
      <p style="margin:0 0 14px;font-size:16px;line-height:1.65;color:${CHARCOAL};">
        Soy César de Groundwork Capital. ¡Gracias por su interés en nuestra Noche de ADU en Fontana! Fue el primero de muchos eventos.
      </p>
      <p style="margin:0 0 20px;font-size:16px;line-height:1.65;color:${CHARCOAL};">
        Toque el camino que le corresponde — lo llevamos al siguiente paso:
      </p>
      ${btn(GCR, "Soy propietario — reporte de crédito gratis")}
      ${btn(INFO, "Primero quiero más información sobre ADU", true)}
      ${btn(AFF, "Soy realtor o loan officer", true)}
      ${btn(CTR, "Soy contratista", true)}
      <p style="margin:24px 0 0;font-size:16px;line-height:1.65;color:${CHARCOAL};">¡Gracias!<br/>César Gomez y Daniel Carrillo</p>
      <p style="margin:28px 0 0;font-size:12px;line-height:1.5;color:#6b7280;">Puede darse de baja aquí: [enlace en Broadcasts en vivo]</p>
    `,
  },
  {
    subject: "[SAMPLE CTA] Welcome as a Groundwork affiliate — next steps",
    lang: "en",
    preheader: "Affiliate follow-up with a clear CTA.",
    body: `
      <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${GOLD};font-weight:700;">Affiliates · opener (CTA)</p>
      <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:800;color:${INK};">Welcome to Groundwork Capital</h1>
      <p style="margin:0 0 14px;font-size:16px;line-height:1.65;color:${CHARCOAL};">Hi Alex,</p>
      <p style="margin:0 0 14px;font-size:16px;line-height:1.65;color:${CHARCOAL};">
        Welcome to Groundwork Capital, and thank you for joining us as an affiliate! Here are your next steps:
      </p>
      <ol style="margin:0 0 14px;padding-left:1.2rem;font-size:16px;line-height:1.7;color:${CHARCOAL};">
        <li>Log in to your back office with the login we emailed you. If you don't see it, please check your spam or junk folder.</li>
        <li>Your personal link is in your back office. Any client who signs up through it is attached to you.</li>
        <li>Review and sign your affiliate agreement (link in your portal).</li>
        <li>We'll send you the date for our first affiliate training on Zoom.</li>
      </ol>
      ${btn(AFF, "Open affiliate portal")}
      <p style="margin:16px 0 0;font-size:16px;line-height:1.65;color:${CHARCOAL};">
        You're welcome to promote with the Groundwork Capital brand or with your own. Do you have any questions for us?<br/><br/>
        Thank you!<br/>Cesar Gomez and Daniel Carrillo
      </p>
    `,
  },
  {
    subject: "[SAMPLE CTA] Thank you for applying — contractor next steps",
    lang: "en",
    preheader: "Contractor follow-up with a clear CTA.",
    body: `
      <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${GOLD};font-weight:700;">Contractors · opener (CTA)</p>
      <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:800;color:${INK};">Thanks for applying</h1>
      <p style="margin:0 0 14px;font-size:16px;line-height:1.65;color:${CHARCOAL};">Hi Alex,</p>
      <p style="margin:0 0 14px;font-size:16px;line-height:1.65;color:${CHARCOAL};">
        Thank you for applying to build with Groundwork Capital! We received your application. Here is what comes next:
      </p>
      <ol style="margin:0 0 14px;padding-left:1.2rem;font-size:16px;line-height:1.7;color:${CHARCOAL};">
        <li>Daniel Carrillo will reach out to learn about your company and go over what we look for in our contractors.</li>
        <li>Once you're approved, you'll get your login to our contractor platform. Every project runs through it.</li>
      </ol>
      <p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:${CHARCOAL};">
        What is the best day and time for Daniel to call you? Reply to this email, or open your application below.
      </p>
      ${btn(CTR, "Open contractor application")}
      <p style="margin:16px 0 0;font-size:16px;line-height:1.65;color:${CHARCOAL};">
        Thank you!<br/>Cesar Gomez and Daniel Carrillo
      </p>
    `,
  },
];

async function main() {
  if (!TO || !TO.includes("@")) {
    console.error(
      "Usage: npx tsx scripts/send-pdf-broadcast-samples.ts --to=you@example.com",
    );
    process.exit(1);
  }
  const key = String(process.env.RESEND_API_KEY || "").trim();
  if (!key) {
    console.error("RESEND_API_KEY missing");
    process.exit(1);
  }
  const resend = new Resend(key);
  console.log(`Sending ${samples.length} CTA samples → ${TO}`);
  console.log(`From: ${FROM}`);

  for (const s of samples) {
    const html = layout({
      lang: s.lang,
      title: s.subject,
      preheader: s.preheader,
      body: s.body,
    });
    const result = await resend.emails.send({
      from: FROM,
      to: TO,
      subject: s.subject,
      html,
    });
    if (result.error) {
      console.error(`[fail] ${s.subject}`, result.error);
    } else {
      console.log(`[sent] ${s.subject} id=${result.data?.id}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log("Done. Check your inbox (and spam).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
