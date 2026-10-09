/**
 * Mint short-lived portal sessions for mobile QA (prints cookie lines only).
 *
 *   npx tsx scripts/mint-portal-sessions.ts
 */
import "dotenv/config";
import crypto from "crypto";
import mysql from "mysql2/promise";

function token() {
  return crypto.randomBytes(32).toString("hex");
}
function hash(t: string) {
  return crypto.createHash("sha256").update(t).digest("hex");
}

async function main() {
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

  const expires = new Date(Date.now() + 2 * 3_600_000);
  const out: Record<string, { cookie: string; path: string; who: string }> = {};

  try {
    const [admins] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id, email, role FROM admins WHERE status = 'active' ORDER BY id ASC LIMIT 1`,
    );
    if (admins[0]) {
      const t = token();
      await pool.execute(
        `INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, ?)`,
        [admins[0].id, hash(t), expires],
      );
      out.admin = {
        cookie: `gw_admin_sid=${t}`,
        path: "/admin",
        who: `${admins[0].email} (${admins[0].role})`,
      };
    }

    const [affs] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id, email FROM affiliates WHERE status = 'active' ORDER BY id ASC LIMIT 1`,
    );
    if (affs[0]) {
      const t = token();
      await pool.execute(
        `INSERT INTO affiliate_sessions (affiliate_id, token_hash, expires_at) VALUES (?, ?, ?)`,
        [affs[0].id, hash(t), expires],
      );
      out.affiliate = {
        cookie: `gw_affiliate_sid=${t}`,
        path: "/affiliate",
        who: String(affs[0].email),
      };
    }

    const [ctrs] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id, email FROM contractors WHERE status = 'active' ORDER BY id ASC LIMIT 1`,
    );
    if (ctrs[0]) {
      const t = token();
      await pool.execute(
        `INSERT INTO contractor_sessions (contractor_id, token_hash, expires_at) VALUES (?, ?, ?)`,
        [ctrs[0].id, hash(t), expires],
      );
      out.contractor = {
        cookie: `gw_contractor_sid=${t}`,
        path: "/contractor",
        who: String(ctrs[0].email),
      };
    }

    // Prefer an existing portal-capable client; seed a disposable @example.com
    // fixture when the DB has none (common in fresh/local TiDB).
    type ClientPick = { id: number; email: string; status: string };
    let clientRow: ClientPick | undefined;
    const [clients] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id, email, status FROM clients
       WHERE email IS NOT NULL AND email <> ''
         AND status IN ('active','prospect')
       ORDER BY id ASC
       LIMIT 1`,
    );
    if (clients[0]) {
      clientRow = {
        id: Number(clients[0].id),
        email: String(clients[0].email),
        status: String(clients[0].status),
      };
    }
    if (!clientRow) {
      const qaEmail = "mobile-qa-client@example.com";
      const [existingQa] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT id, email, status FROM clients WHERE LOWER(email) = ? LIMIT 1`,
        [qaEmail],
      );
      if (existingQa[0]) {
        clientRow = {
          id: Number(existingQa[0].id),
          email: String(existingQa[0].email),
          status: String(existingQa[0].status),
        };
        if (!["active", "prospect"].includes(clientRow.status)) {
          await pool.execute(
            `UPDATE clients SET status = 'active' WHERE id = ?`,
            [clientRow.id],
          );
          clientRow.status = "active";
        }
      } else {
        const [ins] = await pool.execute<mysql.ResultSetHeader>(
          `INSERT INTO clients
             (email, first_name, last_name, phone, preferred_language, status,
              address_line1, city, state, zip)
           VALUES (?, 'Mobile', 'QA', NULL, 'en', 'active',
                   '1 QA St', 'Los Angeles', 'CA', '90001')`,
          [qaEmail],
        );
        clientRow = {
          id: Number(ins.insertId),
          email: qaEmail,
          status: "active",
        };
      }
    }
    if (clientRow) {
      const t = token();
      await pool.execute(
        `INSERT INTO client_sessions (client_id, token_hash, expires_at) VALUES (?, ?, ?)`,
        [clientRow.id, hash(t), expires],
      );
      out.client = {
        cookie: `gw_client_sid=${t}`,
        path: "/client",
        who: `${clientRow.email} (${clientRow.status})`,
      };
    }

    console.log(JSON.stringify(out, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
