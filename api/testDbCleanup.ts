/**
 * Shared cleanup for API integration tests that seed rows into shared TiDB.
 *
 * Safe email domains only: @example.com, @example.test
 * Never match real customer emails.
 *
 * Pattern mirrors optimum-credit/api/testDbCleanup.ts (simplified for leads).
 */
import mysql, { type Pool } from "mysql2/promise";

const SAFE_EMAIL_SUFFIXES = ["@example.com", "@example.test"] as const;

export function createIntegrationTestPool(): Pool {
  return mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 4000),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl:
      process.env.DB_SSL === "false"
        ? undefined
        : { minVersion: "TLSv1.2" as const },
    waitForConnections: true,
    connectionLimit: 2,
    queueLimit: 0,
    timezone: "Z",
    enableKeepAlive: true,
    connectTimeout: 60_000,
  });
}

function assertSafeTestEmail(email: string): void {
  const normalized = email.trim().toLowerCase();
  const ok = SAFE_EMAIL_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
  if (!ok) {
    throw new Error(
      `[testDbCleanup] refusing to delete non-test email: ${email}`,
    );
  }
}

/** Delete lead rows for known test emails (exact match). */
export async function cleanupTestLeadsByEmail(
  pool: Pool,
  emails: string[],
): Promise<number> {
  if (!emails.length) return 0;
  for (const email of emails) assertSafeTestEmail(email);
  const [result] = await pool.execute(
    `DELETE FROM leads WHERE email IN (${emails.map(() => "?").join(",")})`,
    emails.map((e) => e.trim().toLowerCase()),
  );
  return Number((result as { affectedRows?: number }).affectedRows || 0);
}

/** Delete lead by id only when its email is a safe test domain. */
export async function cleanupTestLeadById(
  pool: Pool,
  leadId: number,
): Promise<void> {
  const [rows] = await pool.query(
    `SELECT email FROM leads WHERE id = ? LIMIT 1`,
    [leadId],
  );
  const email = String((rows as { email?: string }[])[0]?.email || "");
  if (!email) return;
  assertSafeTestEmail(email);
  await pool.execute(`DELETE FROM leads WHERE id = ?`, [leadId]);
}

/** Sweep leftover vitest leads matching prefix + safe domain. */
export async function cleanupTestLeadsByPrefix(
  pool: Pool,
  prefix: string,
): Promise<number> {
  if (!prefix.trim()) {
    throw new Error("[testDbCleanup] empty prefix — refusing cleanup");
  }
  const like = `${prefix.trim().toLowerCase()}%@example.com`;
  const [result] = await pool.execute(
    `DELETE FROM leads WHERE LOWER(email) LIKE ?`,
    [like],
  );
  return Number((result as { affectedRows?: number }).affectedRows || 0);
}

/** Delete test marketing events whose slug starts with `prefix` (lowercased). */
export async function cleanupMarketingEventsBySlugPrefix(
  pool: Pool,
  prefix: string,
): Promise<number> {
  const p = prefix.trim().toLowerCase();
  if (p.length < 6) {
    throw new Error(
      "[testDbCleanup] event slug prefix too short — refusing cleanup",
    );
  }
  const like = `${p.replace(/[%_\\]/g, "\\$&")}%`;
  const [result] = await pool.execute(
    `DELETE FROM marketing_events WHERE slug LIKE ?`,
    [like],
  );
  return Number((result as { affectedRows?: number }).affectedRows || 0);
}

/**
 * Remove every portal fixture whose email starts with `prefix` and ends with
 * @example.com (admins, affiliates, contractors, clients, leads, notify extras
 * + dependent projects/photos/draws/commissions via FK cascade). Order matters:
 * projects reference clients with ON DELETE RESTRICT.
 */
export async function cleanupPortalFixturesByPrefix(
  pool: Pool,
  prefix: string,
): Promise<void> {
  if (!prefix.trim()) {
    throw new Error("[testDbCleanup] empty prefix — refusing cleanup");
  }
  const like = `${prefix.trim().toLowerCase()}%@example.com`;
  await pool.execute(
    `DELETE FROM projects WHERE client_id IN (SELECT id FROM clients WHERE LOWER(email) LIKE ?)`,
    [like],
  );
  await pool.execute(`DELETE FROM contractor_invites WHERE LOWER(email) LIKE ?`, [like]);
  await pool.execute(
    `DELETE FROM admin_notify_extra_emails WHERE LOWER(email) LIKE ?`,
    [like],
  );
  await pool.execute(`DELETE FROM contacts WHERE LOWER(email) LIKE ?`, [like]);
  for (const table of ["clients", "affiliates", "contractors", "admins", "leads"]) {
    await pool.execute(`DELETE FROM \`${table}\` WHERE LOWER(email) LIKE ?`, [like]);
  }
  // Test MCP dynamic clients: client_id starts with prefix (e.g. gwmcp-…-client)
  const clientLike = `${prefix.trim().toLowerCase().replace(/[%_\\]/g, "\\$&")}%`;
  await pool.execute(`DELETE FROM mcp_oauth_clients WHERE client_id LIKE ?`, [
    clientLike,
  ]);
  // Leads are gone, so test events (slug = prefix + suffix) can be removed safely.
  await cleanupMarketingEventsBySlugPrefix(pool, prefix);
}

/**
 * Serialize tests that temporarily change global `system_settings` (shared DB).
 * Without it, one suite can snapshot another suite's temporary values and
 * "restore" them permanently (e.g. commission rates 999/1 leaking to prod).
 */
export async function withSystemSettingsLock<T>(pool: Pool, fn: () => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(`SELECT GET_LOCK('gw_test_system_settings', 120) AS ok`);
    if (Number((rows as Array<{ ok: number }>)[0]?.ok) !== 1) {
      throw new Error("[testDbCleanup] could not acquire system_settings test lock");
    }
    return await fn();
  } finally {
    await conn.query(`SELECT RELEASE_LOCK('gw_test_system_settings')`).catch(() => undefined);
    conn.release();
  }
}
