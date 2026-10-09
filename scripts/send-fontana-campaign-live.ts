/**
 * Live-send a draft campaign by id (same path as Admin → Confirm → Send live).
 *
 *   npx tsx scripts/send-fontana-campaign-live.ts --id=60001 --confirm
 */
import "dotenv/config";
import crypto from "crypto";
import request from "supertest";
import mysql from "mysql2/promise";
import { createServer } from "../api/index";

async function main() {
  const idArg = process.argv.find((a) => a.startsWith("--id="));
  const campaignId = Number(idArg?.slice("--id=".length) || 0);
  if (!campaignId) {
    console.error("Usage: npx tsx scripts/send-fontana-campaign-live.ts --id=60001 --confirm");
    process.exit(1);
  }
  if (!process.argv.includes("--confirm")) {
    console.error("Refusing live send without --confirm");
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

  try {
    const [campRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id, name, status, channels_json, audience_filter_json
       FROM campaigns WHERE id = ? LIMIT 1`,
      [campaignId],
    );
    const camp = campRows[0];
    if (!camp) {
      console.error(`Campaign #${campaignId} not found`);
      process.exit(1);
    }
    console.log(
      `Campaign #${camp.id}: ${camp.name} status=${camp.status} channels=${camp.channels_json}`,
    );
    if (camp.status !== "draft" && camp.status !== "failed") {
      console.error(`Cannot send: status is ${camp.status}`);
      process.exit(1);
    }

    const [adminRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id FROM admins
       WHERE status = 'active' AND role IN ('super_admin','admin')
       ORDER BY id ASC LIMIT 1`,
    );
    const adminId = Number(adminRows[0]?.id || 0);
    if (!adminId) {
      console.error("No active admin for session");
      process.exit(1);
    }

    const token = crypto.randomBytes(32).toString("hex");
    await pool.execute(
      `INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, ?)`,
      [
        adminId,
        crypto.createHash("sha256").update(token).digest("hex"),
        new Date(Date.now() + 3_600_000),
      ],
    );
    const cookie = `gw_admin_sid=${token}`;

    // Ensure live email path is not dry-run blocked by VITEST
    delete process.env.VITEST;

    const app = createServer();
    console.log("Sending live…");
    const res = await request(app)
      .post(`/api/admin/campaigns/${campaignId}/send`)
      .set("Cookie", cookie)
      .send({ confirm: true });

    console.log(`HTTP ${res.status}`);
    console.log(JSON.stringify(res.body, null, 2));
    if (res.status >= 400) process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
