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

const escLike = (v: string) => v.replace(/[%_\\]/g, "\\$&");

/** `IN (?)` helper — mysql2 expands arrays; an empty list must match nothing. */
const ids = (rows: unknown): number[] => (rows as Array<{ id: number }>).map((r) => Number(r.id));
const inList = (list: number[]) => (list.length ? list : [0]);

/**
 * Remove every fixture tagged with `prefix` (emails `prefix…@example.com|test`,
 * slugs / titles / labels / client ids starting with `prefix`) plus everything
 * hanging off them — including rows whose FK is SET NULL (templates, phone
 * lines, campaigns, events, contact threads) and FK-less logs that would
 * otherwise outlive the fixtures (people_dedupe_log, bell rows).
 *
 * Every step runs even if an earlier one fails (one bad DELETE used to skip
 * the rest and leak the admins / affiliates); errors are re-thrown at the end.
 */
export async function cleanupPortalFixturesByPrefix(
  pool: Pool,
  prefix: string,
): Promise<void> {
  const p = prefix.trim().toLowerCase();
  if (p.length < 6) {
    throw new Error("[testDbCleanup] empty/short prefix — refusing cleanup");
  }
  const emailLikes = SAFE_EMAIL_SUFFIXES.map((suffix) => `${escLike(p)}%${suffix}`);
  const byEmail = (alias = "") => `(LOWER(${alias}email) LIKE ? OR LOWER(${alias}email) LIKE ?)`;
  const startsWith = `${escLike(p)}%`;
  const contains = `%${escLike(p)}%`;
  const errors: string[] = [];
  const step = async (label: string, sql: string, params: unknown[]) => {
    try {
      await pool.query(sql, params);
    } catch (e) {
      errors.push(`${label}: ${(e as Error).message}`);
    }
  };
  const select = async (sql: string, params: unknown[]) => {
    try {
      return ids((await pool.query(sql, params))[0]);
    } catch (e) {
      errors.push(`select: ${(e as Error).message}`);
      return [];
    }
  };

  const adminIds = await select(`SELECT id FROM admins WHERE ${byEmail()}`, emailLikes);
  const clientIds = await select(`SELECT id FROM clients WHERE ${byEmail()}`, emailLikes);
  const contactIds = await select(
    `SELECT id FROM contacts WHERE ${byEmail()} OR created_by_admin_id IN (?)`,
    [...emailLikes, inList(adminIds)],
  );
  // Test lines only (+1555 fixtures) — a real line is never removed here.
  const lineIds = await select(
    `SELECT id FROM admin_phone_numbers WHERE assigned_admin_id IN (?) AND e164 LIKE '+1555%'`,
    [inList(adminIds)],
  );

  // Threads on test lines / with test contacts (FKs are SET NULL → would orphan).
  await step("line threads", `DELETE FROM conversations WHERE ofg_number_id IN (?) OR contact_id IN (?)`, [inList(lineIds), inList(contactIds)]);
  await step(
    "unknown contacts",
    `DELETE FROM conversation_unknown_contacts WHERE ofg_number_id IN (?) OR linked_client_id IN (?) OR linked_contact_id IN (?)`,
    [inList(lineIds), inList(clientIds), inList(contactIds)],
  );
  await step("lines", `DELETE FROM admin_phone_numbers WHERE id IN (?)`, [inList(lineIds)]);
  // Appointments outlive SET NULL parents — remove the ones tied to fixtures (attendees cascade).
  const leadIds = await select(`SELECT id FROM leads WHERE ${byEmail()}`, emailLikes);
  await step(
    "appointments",
    `DELETE FROM appointments WHERE client_id IN (?) OR lead_id IN (?) OR owner_admin_id IN (?) OR created_by_admin_id IN (?) OR LOWER(title) LIKE ?`,
    [inList(clientIds), inList(leadIds), inList(adminIds), inList(adminIds), contains],
  );
  // projects → clients is ON DELETE RESTRICT.
  await step("projects", `DELETE FROM projects WHERE client_id IN (?)`, [inList(clientIds)]);
  await step("contractor invites", `DELETE FROM contractor_invites WHERE ${byEmail()}`, emailLikes);
  await step("notify extras", `DELETE FROM admin_notify_extra_emails WHERE ${byEmail()}`, emailLikes);
  await step("contacts", `DELETE FROM contacts WHERE id IN (?)`, [inList(contactIds)]);
  // Created by test admins (FK SET NULL) or tagged with the prefix.
  await step(
    "templates",
    `DELETE FROM conversation_templates WHERE created_by_admin_id IN (?) OR LOWER(title) LIKE ?`,
    [inList(adminIds), startsWith],
  );
  await step("campaigns", `DELETE FROM campaigns WHERE created_by_admin_id IN (?)`, [inList(adminIds)]);
  await step(
    "lenders",
    `DELETE FROM lenders WHERE created_by_admin_id IN (?) OR LOWER(company) LIKE ? OR LOWER(email) LIKE ? OR LOWER(email) LIKE ?`,
    [inList(adminIds), startsWith, ...emailLikes],
  );
  await step(
    "deal statuses",
    `DELETE FROM deal_statuses WHERE LOWER(label_en) LIKE ? AND id NOT IN (SELECT deal_status_id FROM clients WHERE deal_status_id IS NOT NULL AND id NOT IN (?))`,
    [startsWith, inList(clientIds)],
  );
  // FK-less logs that only mention the fixture.
  // Audit rows only mention the fixture (reason / snapshot of a merged, deleted or reverted record).
  await step(
    "dedupe log",
    `DELETE FROM people_dedupe_log WHERE LOWER(reason) LIKE ? OR LOWER(CAST(snapshot_json AS CHAR)) LIKE ?`,
    [contains, contains],
  );
  await step(
    "bell rows",
    `DELETE FROM admin_notifications WHERE LOWER(title) LIKE ? OR LOWER(body) LIKE ?`,
    [contains, contains],
  );
  // MCP audit rows keep admin_id (SET NULL on delete) — drop the test admins' rows first.
  await step("mcp audit", `DELETE FROM mcp_audit_logs WHERE admin_id IN (?)`, [inList(adminIds)]);
  await step("clients", `DELETE FROM clients WHERE id IN (?)`, [inList(clientIds)]);
  // Billing log + card links reference members by (role, id) without an FK.
  const affIds = await select(`SELECT id FROM affiliates WHERE ${byEmail()}`, emailLikes);
  const ctrIds = await select(`SELECT id FROM contractors WHERE ${byEmail()}`, emailLikes);
  for (const t of ["billing_admin_actions", "billing_card_links"]) {
    await step(
      t,
      `DELETE FROM ${t} WHERE (member_role = 'affiliate' AND member_id IN (?)) OR (member_role = 'contractor' AND member_id IN (?))`,
      [inList(affIds), inList(ctrIds)],
    );
  }
  for (const table of ["affiliates", "contractors", "leads"]) {
    await step(table, `DELETE FROM \`${table}\` WHERE ${byEmail()}`, emailLikes);
  }
  // Events before admins: marketing_events.created_by_admin_id is SET NULL.
  await step(
    "events",
    `DELETE FROM marketing_events WHERE slug LIKE ? OR created_by_admin_id IN (?)`,
    [startsWith, inList(adminIds)],
  );
  await step("admins", `DELETE FROM admins WHERE id IN (?)`, [inList(adminIds)]);
  // Test MCP dynamic clients: client_id starts with prefix (e.g. gwmcp-…-client)
  await step("mcp clients", `DELETE FROM mcp_oauth_clients WHERE client_id LIKE ?`, [startsWith]);

  if (errors.length) {
    throw new Error(`[testDbCleanup] ${p}: ${errors.length} step(s) failed — ${errors.join(" | ")}`);
  }
}

/** Run-tagged fixture prefix: `gw<suite>-<Date.now()>-`. */
export const TEST_PREFIX_RE = /\b(gw[a-z0-9]*-(\d{13})-)/;

/**
 * Find every run prefix still present in the shared DB (fixtures from
 * interrupted / crashed runs never reach their afterAll).
 */
export async function findTestFixturePrefixes(pool: Pool): Promise<Map<string, number>> {
  const sql = `
    SELECT email AS v FROM admins WHERE email REGEXP '^gw[a-z0-9]*-[0-9]{13}-'
    UNION SELECT email FROM affiliates WHERE email REGEXP '^gw[a-z0-9]*-[0-9]{13}-'
    UNION SELECT email FROM clients WHERE email REGEXP '^gw[a-z0-9]*-[0-9]{13}-'
    UNION SELECT email FROM contractors WHERE email REGEXP '^gw[a-z0-9]*-[0-9]{13}-'
    UNION SELECT email FROM leads WHERE email REGEXP '^gw[a-z0-9]*-[0-9]{13}-'
    UNION SELECT email FROM contacts WHERE email REGEXP '^gw[a-z0-9]*-[0-9]{13}-'
    UNION SELECT slug FROM marketing_events WHERE slug REGEXP '^gw[a-z0-9]*-[0-9]{13}-'
    UNION SELECT title FROM conversation_templates WHERE title REGEXP '^gw[a-z0-9]*-[0-9]{13}-'
    UNION SELECT label_en FROM deal_statuses WHERE label_en REGEXP '^gw[a-z0-9]*-[0-9]{13}-'
    UNION SELECT client_id FROM mcp_oauth_clients WHERE client_id REGEXP '^gw[a-z0-9]*-[0-9]{13}-'
    UNION SELECT reason FROM people_dedupe_log WHERE reason REGEXP 'gw[a-z0-9]*-[0-9]{13}-'
    UNION SELECT CAST(snapshot_json AS CHAR) FROM people_dedupe_log WHERE CAST(snapshot_json AS CHAR) REGEXP 'gw[a-z0-9]*-[0-9]{13}-'
    UNION SELECT body FROM admin_notifications WHERE body REGEXP 'gw[a-z0-9]*-[0-9]{13}-'`;
  const [rows] = await pool.query(sql);
  const found = new Map<string, number>();
  for (const r of rows as Array<{ v: string | null }>) {
    const m = String(r.v || "").toLowerCase().match(TEST_PREFIX_RE);
    if (m) found.set(m[1], Number(m[2]));
  }
  return found;
}

/**
 * Sweep run prefixes whose stamp matches `when` (e.g. older than 2h before a
 * run, or started during this run at teardown). Returns the prefixes swept.
 */
export async function sweepTestFixtures(
  pool: Pool,
  when: (stampMs: number) => boolean,
): Promise<string[]> {
  const swept: string[] = [];
  const errors: string[] = [];
  for (const [prefix, stamp] of await findTestFixturePrefixes(pool)) {
    if (!when(stamp)) continue;
    try {
      await cleanupPortalFixturesByPrefix(pool, prefix);
      swept.push(prefix);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  // Lead-form suites tag leads `gcr.test.<stamp>@` / `lead.test.<stamp>@`.
  for (const p of ["gcr.test.", "lead.test."]) {
    await cleanupTestLeadsByPrefix(pool, p).catch((e) => errors.push((e as Error).message));
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return swept;
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
