/**
 * One-off: tell everyone with an SMS thread on the Groundwork line that our
 * number is now the toll-free (866) 864-7506. Sends FROM the 866 and logs each
 * text into its Conversations thread (so staff see it and replies land there).
 *
 *   npx tsx scripts/announce-new-number.ts                 # dry run (default): list recipients + copy
 *   npx tsx scripts/announce-new-number.ts --send --confirm=CONFIRM
 *
 * Safety: dry run unless --send AND --confirm=CONFIRM; VITEST / NOTIFY_SANDBOX=true
 * always dry-run. One text per person (deduped by last 10 digits); skips anyone
 * who ever replied STOP, and anyone already sent this announcement.
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const NEW_E164 = "+18668647506";
const MARK = "[new-number-announcement]";
const COPY = {
  en: "Groundwork Capital: We have a new number! Please save (866) 864-7506 for texts and calls with our team.",
  es: "Groundwork Capital: ¡Tenemos un número nuevo! Guarde el (866) 864-7506 para textos y llamadas con nuestro equipo.",
} as const;
const STOP_WORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "ALTO", "PARAR"];

const args = new Set(process.argv.slice(2));
const confirmArg = process.argv.find((a) => a.startsWith("--confirm="))?.split("=")[1];
const sandbox = process.env.VITEST === "true" || process.env.NOTIFY_SANDBOX === "true";
const live = args.has("--send") && confirmArg === "CONFIRM" && !sandbox;

const last10 = (p: unknown) => {
  const d = String(p || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
};
const e164 = (p: string) => `+1${last10(p)}`;

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 4000),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
  });
  try {
    const [[line]] = (await db.query(
      `SELECT id, assigned_admin_id FROM admin_phone_numbers WHERE e164 = ? AND is_active = 1 LIMIT 1`,
      [NEW_E164],
    )) as any;
    if (!line) throw new Error(`${NEW_E164} is not an active Groundwork line`);

    const [convs] = (await db.query(
      `SELECT cv.id, cv.client_id, cv.contact_id, cv.unknown_contact_id,
              COALESCE(c.phone, k.phone, u.phone_e164) AS phone,
              COALESCE(c.preferred_language, k.preferred_language) AS lang,
              COALESCE(CONCAT(c.first_name,' ',c.last_name), CONCAT(k.first_name,' ',k.last_name), u.display_name) AS name
       FROM conversations cv
       LEFT JOIN clients c ON c.id = cv.client_id
       LEFT JOIN contacts k ON k.id = cv.contact_id
       LEFT JOIN conversation_unknown_contacts u ON u.id = cv.unknown_contact_id
       WHERE cv.ofg_number_id = ? AND cv.channel = 'sms'
       ORDER BY cv.last_message_at DESC`,
      [line.id],
    )) as any;

    const [stops] = (await db.query(
      `SELECT from_address FROM conversation_messages
       WHERE direction = 'inbound' AND UPPER(TRIM(body)) IN (${STOP_WORDS.map(() => "?").join(",")})`,
      STOP_WORDS,
    )) as any;
    const stopped = new Set(stops.map((r: any) => last10(r.from_address)).filter(Boolean));
    const [already] = (await db.query(
      `SELECT to_address FROM conversation_messages WHERE JSON_EXTRACT(metadata_json, '$.tag') = ?`,
      [MARK],
    )) as any;
    const done = new Set(already.map((r: any) => last10(r.to_address)).filter(Boolean));

    // Never text our own team (test threads with staff cells / forwarding numbers).
    const [staff] = (await db.query(`SELECT phone, call_forwarding_phone FROM admins`)) as any;
    const staffPhones = new Set(
      staff.flatMap((a: any) => [last10(a.phone), last10(a.call_forwarding_phone)]).filter(Boolean),
    );

    // Lead language + name for unknown-number threads (matched by phone).
    const [leadLangs] = (await db.query(
      `SELECT phone, preferred_language, full_name FROM leads ORDER BY id DESC`,
    )) as any;
    const leadLang = new Map<string, string>();
    const leadName = new Map<string, string>();
    for (const l of leadLangs) {
      const k = last10(l.phone);
      if (k && !leadLang.has(k)) {
        leadLang.set(k, l.preferred_language);
        leadName.set(k, l.full_name);
      }
    }

    const seen = new Set<string>();
    const plan: { conv: any; to: string; lang: "en" | "es"; skip?: string }[] = [];
    for (const cv of convs) {
      const k = last10(cv.phone);
      if (!k) continue;
      const lang = (cv.lang || leadLang.get(k)) === "es" ? "es" : "en";
      if (seen.has(k)) continue;
      seen.add(k);
      const skip = staffPhones.has(k)
        ? "staff phone"
        : stopped.has(k)
          ? "opted out (STOP)"
          : done.has(k)
            ? "already announced"
            : undefined;
      plan.push({ conv: { ...cv, name: cv.name || leadName.get(k) }, to: e164(k), lang, skip });
    }

    const sendable = plan.filter((p) => !p.skip);
    console.log(`\nFrom ${NEW_E164} · ${live ? "LIVE SEND" : "DRY RUN"}${sandbox ? " (sandbox forced)" : ""}`);
    console.log(`Recipients: ${sendable.length} to send, ${plan.length - sendable.length} skipped\n`);
    console.log(`EN: ${COPY.en}\nES: ${COPY.es}\n`);
    for (const p of plan) {
      console.log(`${p.skip ? "SKIP" : "SEND"}  ${p.to}  ${p.lang}  ${p.conv.name || "(unknown)"}${p.skip ? `  — ${p.skip}` : ""}`);
    }
    if (!live) {
      console.log(`\nDry run only. To send: npx tsx scripts/announce-new-number.ts --send --confirm=CONFIRM`);
      return;
    }

    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
    const appUrl = (process.env.PUBLIC_APP_URL || "https://groundworkcapitalgroup.com").replace(/\/$/, "");
    let ok = 0;
    let failed = 0;
    for (const p of sendable) {
      const body = COPY[p.lang];
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          From: NEW_E164,
          To: p.to,
          Body: body,
          StatusCallback: `${appUrl}/api/webhooks/twilio/sms-status`,
        }),
      });
      const data: any = await res.json().catch(() => ({}));
      const error = res.ok ? null : `${data.code || res.status}: ${data.message || "send failed"}`;
      await db.query(
        `INSERT INTO conversation_messages
           (conversation_id, direction, channel, body, from_address, to_address, sent_by_admin_id,
            provider_message_id, provider_status, error_message, metadata_json)
         VALUES (?, 'outbound', 'sms', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          p.conv.id, body, NEW_E164, p.to, line.assigned_admin_id,
          data.sid || null, error ? "failed" : data.status || "queued", error,
          JSON.stringify({ tag: MARK }),
        ],
      );
      if (!error) {
        await db.query(
          `UPDATE conversations SET last_message_at = NOW(), last_message_preview = ? WHERE id = ?`,
          [body.slice(0, 200), p.conv.id],
        );
        if (p.conv.unknown_contact_id) {
          await db.query(
            `UPDATE conversation_unknown_contacts SET last_message_at = NOW(), last_message_preview = ? WHERE id = ?`,
            [body.slice(0, 200), p.conv.unknown_contact_id],
          );
        }
        ok++;
      } else {
        failed++;
      }
      console.log(`${error ? "FAIL" : "OK  "}  ${p.to}${error ? `  ${error}` : ""}`);
      await new Promise((r) => setTimeout(r, 1100)); // toll-free throughput headroom
    }
    console.log(`\nDone: ${ok} sent, ${failed} failed.`);
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
