import "dotenv/config";
import crypto from "crypto";
import mysql from "mysql2/promise";

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 4000),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === "false" ? undefined : { minVersion: "TLSv1.2" },
    timezone: "Z",
  });
  try {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id, email, status FROM clients
       WHERE email IS NOT NULL AND TRIM(email) <> ''
       ORDER BY id DESC LIMIT 5`,
    );
    console.error("clients", rows);
    const c = rows[0];
    if (!c) {
      console.error("NO_CLIENT");
      process.exit(2);
    }
    const t = crypto.randomBytes(32).toString("hex");
    await pool.execute(
      `INSERT INTO client_sessions (client_id, token_hash, expires_at) VALUES (?, ?, ?)`,
      [
        c.id,
        crypto.createHash("sha256").update(t).digest("hex"),
        new Date(Date.now() + 7200000),
      ],
    );
    console.log(`gw_client_sid=${t}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
