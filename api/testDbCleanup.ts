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

/** Connection-level failures (nothing reached the server's query engine): safe to retry. */
const CONNECT_FAILURE_CODES = new Set(["ETIMEDOUT", "ECONNREFUSED"]);
const TRANSIENT_DB_CODES = new Set(["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE", "PROTOCOL_CONNECTION_LOST", "ER_CON_COUNT_ERROR"]);

/**
 * Test pool for integration suites. Idle connections are retired before TiDB Cloud's gateway drops them,
 * and a query whose connection fails to open or drops is retried (twice, with a short wait) so a network
 * blip on the shared DB doesn't fail a whole suite.
 */
export function createIntegrationTestPool(): Pool {
  return withTransientRetry(createRawIntegrationTestPool());
}

/** Wraps query / execute / getConnection with the transient-connection retry (exported for its unit test). */
export function withTransientRetry<P extends Pick<Pool, "query" | "execute" | "getConnection">>(pool: P, waitMs = 1000): P {
  const withRetry =
    <F extends (...args: any[]) => Promise<any>>(fn: F): F =>
    (async (...args: any[]) => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await fn(...args);
        } catch (e: any) {
          const code = String(e?.code || "");
          // A write whose connection dropped may have applied, so repeating it can double it (or hit a
          // false duplicate key). Only failures to connect are safe, since the statement was never sent.
          const sql = typeof args[0] === "string" ? args[0] : String(args[0]?.sql || "");
          const readOnly = sql === "" || /^\s*(SELECT|SHOW)\b/i.test(sql);
          if (attempt >= 2 || !TRANSIENT_DB_CODES.has(code) || (!readOnly && !CONNECT_FAILURE_CODES.has(code))) throw e;
          await new Promise((r) => setTimeout(r, waitMs * (attempt + 1)));
        }
      }
    }) as F;
  pool.query = withRetry(pool.query.bind(pool)) as P["query"];
  pool.execute = withRetry(pool.execute.bind(pool)) as P["execute"];
  pool.getConnection = withRetry(pool.getConnection.bind(pool)) as P["getConnection"];
  return pool;
}

function createRawIntegrationTestPool(): Pool {
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
    keepAliveInitialDelay: 10_000,
    idleTimeout: 60_000,
    maxIdle: 2,
    connectTimeout: 20_000,
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
  // Phone-only homeowners have no email: their signature is the run prefix in the first name.
  const clientIds = await select(`SELECT id FROM clients WHERE ${byEmail()} OR (email IS NULL AND first_name LIKE ?)`, [...emailLikes, `${escLike(p)}%`]);
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
  // Automatic-message log rows for fixture addresses (email prefix or fictional +1555 phones).
  await step("automatic_messages", `DELETE FROM automatic_messages WHERE LOWER(to_address) LIKE ? OR LOWER(to_address) LIKE ?`, emailLikes);
  // Test mailboxes (@example.com, or owned by fixture staff): threads, messages, calendar links cascade.
  await step(
    "mailboxes",
    `DELETE FROM mailboxes WHERE ${byEmail()} OR owner_admin_id IN (?) OR created_by_admin_id IN (?)`,
    [...emailLikes, inList(adminIds), inList(adminIds)],
  );
  // Appointments outlive SET NULL parents — remove the ones tied to fixtures (attendees cascade).
  const leadIds = await select(`SELECT id FROM leads WHERE ${byEmail()}`, emailLikes);
  await step(
    "appointments",
    `DELETE FROM appointments WHERE client_id IN (?) OR lead_id IN (?) OR owner_admin_id IN (?) OR created_by_admin_id IN (?) OR LOWER(title) LIKE ?`,
    [inList(clientIds), inList(leadIds), inList(adminIds), inList(adminIds), contains],
  );
  // Reminder-flow runs reference people by (kind, id) without an FK (events + links cascade).
  {
    const fAff = await select(`SELECT id FROM affiliates WHERE ${byEmail()}`, emailLikes);
    const fCtr = await select(`SELECT id FROM contractors WHERE ${byEmail()}`, emailLikes);
    const fPrj = await select(`SELECT id FROM projects WHERE client_id IN (?)`, [inList(clientIds)]);
    const fixtureRuns = await select(
      `SELECT id FROM reminder_flow_runs WHERE (subject_kind = 'client' AND subject_id IN (?)) OR (subject_kind = 'lead' AND subject_id IN (?))
         OR (subject_kind = 'affiliate' AND subject_id IN (?)) OR (subject_kind = 'contractor' AND subject_id IN (?))
         OR (subject_kind = 'project' AND subject_id IN (?)) OR added_by_admin_id IN (?)`,
      [inList(clientIds), inList(leadIds), inList(fAff), inList(fCtr), inList(fPrj), inList(adminIds)],
    );
    if (fixtureRuns.length) await step("flow runs", `DELETE FROM reminder_flow_runs WHERE id IN (?)`, [fixtureRuns]);
    // Test automations: named with the prefix or built by fixture staff (steps, edges, runs cascade).
    await step(
      "flows",
      `DELETE FROM reminder_flows WHERE system_key IS NULL AND (LOWER(name) LIKE ? OR created_by_admin_id IN (?))`,
      [startsWith, inList(adminIds)],
    );
    // Test QR codes: slug carries the prefix, or made by fixture staff.
    {
      const qr = await select(`SELECT id FROM qr_links WHERE slug LIKE ? OR created_by_admin_id IN (?)`, [startsWith, inList(adminIds)]);
      if (qr.length) await step("qr links", `DELETE FROM qr_links WHERE id IN (?)`, [qr]);
      await step("city partners", `DELETE FROM city_partners WHERE LOWER(email) LIKE ?`, [startsWith]);
      await step("cities", `DELETE FROM service_cities WHERE LOWER(name) LIKE ?`, [startsWith]);
      await step("qr external links", `DELETE FROM qr_external_links WHERE LOWER(label) LIKE ? OR created_by_admin_id IN (?)`, [startsWith, inList(adminIds)]);
    }
    // Scorecard rows of fixture affiliates / contractors (no FK to the person).
    for (const t of ["scorecard_weeks", "scorecard_actions", "scorecard_time_off", "scorecard_activities"]) {
      await step(
        t,
        `DELETE FROM ${t} WHERE (subject_type = 'affiliate' AND subject_id IN (?)) OR (subject_type = 'contractor' AND subject_id IN (?))`,
        [inList(fAff), inList(fCtr)],
      );
    }
    // Test legal page versions (notes carry the prefix) and acceptances by fixture people (no FK).
    await step("legal documents", `DELETE FROM legal_documents WHERE LOWER(notes) LIKE ?`, [startsWith]);
    // Test City Partner agreement versions (notes carry the prefix; agreements keep only the version number).
    await step("city partner templates", `DELETE FROM city_partner_agreement_templates WHERE LOWER(notes) LIKE ?`, [startsWith]);
    {
      const acc = await select(
        `SELECT id FROM legal_acceptances WHERE (person_kind = 'affiliate' AND person_id IN (?)) OR (person_kind = 'contractor' AND person_id IN (?)) OR (person_kind = 'client' AND person_id IN (?))`,
        [inList(fAff), inList(fCtr), inList(clientIds)],
      );
      if (acc.length) await step("legal acceptances", `DELETE FROM legal_acceptances WHERE id IN (?)`, [acc]);
      const notices = await select(
        `SELECT id FROM legal_notices WHERE (person_kind = 'affiliate' AND person_id IN (?)) OR (person_kind = 'contractor' AND person_id IN (?))`,
        [inList(fAff), inList(fCtr)],
      );
      if (notices.length) await step("legal notices", `DELETE FROM legal_notices WHERE id IN (?)`, [notices]);
    }
    // Test agreement template versions (notes carry the prefix). Agreements cascade with projects.
    await step("agreement templates", `DELETE FROM construction_agreement_templates WHERE LOWER(notes) LIKE ?`, [startsWith]);
    // STOP replies from this run's own fictional +1555 numbers only: suites run in parallel, so wiping every
    // 555 opt-out would erase another suite's STOP mid-test. Leftovers go in purgeTestLeftovers (no run active).
    {
      const phones = (
        await select(
          `SELECT RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10) AS id FROM (
             SELECT phone FROM affiliates WHERE ${byEmail()} UNION ALL SELECT phone FROM contractors WHERE ${byEmail()}
             UNION ALL SELECT phone FROM clients WHERE id IN (?) UNION ALL SELECT phone FROM leads WHERE id IN (?)
             UNION ALL SELECT phone FROM contacts WHERE id IN (?)) p WHERE phone LIKE '%555%'`,
          [...emailLikes, ...emailLikes, inList(clientIds), inList(leadIds), inList(contactIds)],
        )
      ).map(String).filter((x) => x.startsWith("555"));
      if (phones.length) await step("sms opt-outs", `DELETE FROM sms_opt_outs WHERE phone_last10 IN (?)`, [phones]);
    }
  }
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

  // Flow runs whose person is gone. Read first (no locks), then delete by id: a joined DELETE
  // would lock rows across people tables while other suites run.
  {
    const orphanRuns = await select(
      `SELECT r.id FROM reminder_flow_runs r
       LEFT JOIN clients c ON r.subject_kind = 'client' AND c.id = r.subject_id
       LEFT JOIN affiliates a ON r.subject_kind = 'affiliate' AND a.id = r.subject_id
       LEFT JOIN contractors k ON r.subject_kind = 'contractor' AND k.id = r.subject_id
       LEFT JOIN leads l ON r.subject_kind = 'lead' AND l.id = r.subject_id
       LEFT JOIN projects pr ON r.subject_kind = 'project' AND pr.id = r.subject_id
       LEFT JOIN appointments ap ON r.subject_kind = 'appointment' AND ap.id = r.subject_id
       WHERE COALESCE(c.id, a.id, k.id, l.id, pr.id, ap.id) IS NULL`,
      [],
    );
    if (orphanRuns.length) await step("flow run orphans", `DELETE FROM reminder_flow_runs WHERE id IN (?)`, [orphanRuns]);
  }
  // Automatic-message rows whose person is gone (texts to fixture phones).
  await step(
    "automatic_messages orphans",
    `DELETE am FROM automatic_messages am
     LEFT JOIN clients c ON am.person_kind = 'client' AND c.id = am.person_id
     LEFT JOIN affiliates a ON am.person_kind = 'affiliate' AND a.id = am.person_id
     LEFT JOIN contractors k ON am.person_kind = 'contractor' AND k.id = am.person_id
     LEFT JOIN leads l ON am.person_kind = 'lead' AND l.id = am.person_id
     LEFT JOIN contacts ct ON am.person_kind = 'contact' AND ct.id = am.person_id
     WHERE COALESCE(c.id, a.id, k.id, l.id, ct.id) IS NULL`,
    [],
  );
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
    UNION SELECT first_name FROM clients WHERE email IS NULL AND first_name REGEXP '^gw[a-z0-9]*-[0-9]{13}-'
    UNION SELECT email FROM contractors WHERE email REGEXP '^gw[a-z0-9]*-[0-9]{13}-'
    UNION SELECT email FROM leads WHERE email REGEXP '^gw[a-z0-9]*-[0-9]{13}-'
    UNION SELECT email FROM contacts WHERE email REGEXP '^gw[a-z0-9]*-[0-9]{13}-'
    UNION SELECT slug FROM marketing_events WHERE slug REGEXP '^gw[a-z0-9]*-[0-9]{13}-'
    UNION SELECT slug FROM qr_links WHERE slug REGEXP '^gw[a-z0-9]*-[0-9]{13}-'
    UNION SELECT label FROM qr_external_links WHERE label REGEXP '^gw[a-z0-9]*-[0-9]{13}-'
    UNION SELECT name FROM service_cities WHERE name REGEXP '^gw[a-z0-9]*-[0-9]{13}-'
    UNION SELECT email FROM city_partners WHERE email REGEXP '^gw[a-z0-9]*-[0-9]{13}-'
    UNION SELECT notes FROM city_partner_agreement_templates WHERE notes REGEXP '^gw[a-z0-9]*-[0-9]{13}-'
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
 * Kept for older suites: settings changes in tests no longer touch `system_settings` (under Vitest every
 * write lands in the per-file in-memory test settings, see TEST_SETTING_DEFAULTS in api/index.ts), so there
 * is nothing shared to serialize and no DB lock is taken.
 */
export async function withSystemSettingsLock<T>(_pool: Pool, fn: () => Promise<T>): Promise<T> {
  return fn();
}

// ─── Signature purge (ops): everything that looks like a test fixture ────────

/** Lock every Vitest run holds for its whole duration (see testGlobalSetup). */
export const TEST_RUN_LOCK = "gw_vitest_shared_db";
const TEST_EMAIL_SQL = (col: string) => `(LOWER(${col}) LIKE '%@example.com' OR LOWER(${col}) LIKE '%@example.test')`;

export type TestLeftovers = {
  prefixSets: string[];
  emails: string[];
  testLines: number;
  testThreads: number;
};

/** Read-only: what test-signature data exists right now (staff could see it). */
export async function scanTestLeftovers(pool: Pool): Promise<TestLeftovers> {
  const prefixSets = [...(await findTestFixturePrefixes(pool)).keys()];
  const [emailRows] = await pool.query(`
    SELECT email AS e FROM admins WHERE ${TEST_EMAIL_SQL("email")}
    UNION SELECT email FROM clients WHERE ${TEST_EMAIL_SQL("email")}
    UNION SELECT email FROM affiliates WHERE ${TEST_EMAIL_SQL("email")}
    UNION SELECT email FROM contractors WHERE ${TEST_EMAIL_SQL("email")}
    UNION SELECT email FROM leads WHERE ${TEST_EMAIL_SQL("email")}
    UNION SELECT email FROM contacts WHERE ${TEST_EMAIL_SQL("email")}
    UNION SELECT email FROM mailboxes WHERE ${TEST_EMAIL_SQL("email")}`);
  const emails = (emailRows as Array<{ e: string }>)
    .map((r) => String(r.e).toLowerCase())
    .filter((e) => !prefixSets.some((p) => e.startsWith(p)));
  const [[lines]] = (await pool.query(`SELECT COUNT(*) n FROM admin_phone_numbers WHERE e164 LIKE '+1555%'`)) as any;
  const [[threads]] = (await pool.query(`SELECT COUNT(*) n FROM conversation_unknown_contacts WHERE phone_e164 LIKE '+1555%'`)) as any;
  return { prefixSets, emails: [...new Set(emails)], testLines: Number(lines.n), testThreads: Number(threads.n) };
}

/**
 * Purge every test-signature leftover from the shared DB, whatever run made it:
 * prefixed fixture sets (any age), people with @example.com / @example.test
 * emails (and everything tied to them), +1555 test phone lines with their
 * threads, and threads from +1555 numbers. Never touches real rows: real
 * emails are never example domains and +1555 numbers are fictional.
 *
 * Takes the test-run lock first (waits for a running test run to finish) so
 * it can never delete fixtures out from under live tests; pass
 * `{ lockHeld: true }` from inside a run that already owns it.
 */
export async function purgeTestLeftovers(
  pool: Pool,
  opts: { dryRun?: boolean; lockHeld?: boolean; waitSeconds?: number } = {},
): Promise<TestLeftovers> {
  const conn = opts.lockHeld ? null : await pool.getConnection();
  try {
    if (conn) {
      const [rows] = await conn.query(`SELECT GET_LOCK(?, ?) AS ok`, [TEST_RUN_LOCK, opts.waitSeconds ?? 1800]);
      if (Number((rows as Array<{ ok: number }>)[0]?.ok) !== 1) {
        throw new Error("[testDbCleanup] a test run is still using the shared DB; try again when it finishes");
      }
    }
    const found = await scanTestLeftovers(pool);
    if (opts.dryRun) return found;
    const errors: string[] = [];
    await sweepTestFixtures(pool, () => true).catch((e) => errors.push((e as Error).message));
    for (const email of found.emails) {
      // Exact email as the "prefix": removes the person and everything keyed to them.
      await cleanupPortalFixturesByPrefix(pool, email).catch((e) => errors.push((e as Error).message));
    }
    // Test lines (+1555) and their threads; threads from +1555 numbers on any line.
    const [lineRows] = await pool.query(`SELECT id FROM admin_phone_numbers WHERE e164 LIKE '+1555%'`);
    const lineIds = ids(lineRows);
    const [unkRows] = await pool.query(
      `SELECT id FROM conversation_unknown_contacts WHERE phone_e164 LIKE '+1555%' OR ofg_number_id IN (?)`,
      [inList(lineIds)],
    );
    const unkIds = ids(unkRows);
    const run = async (sql: string, params: unknown[]) => {
      try {
        await pool.query(sql, params as any[]);
      } catch (e) {
        errors.push((e as Error).message);
      }
    };
    await run(`DELETE FROM conversations WHERE ofg_number_id IN (?) OR unknown_contact_id IN (?)`, [inList(lineIds), inList(unkIds)]);
    await run(`DELETE FROM conversation_unknown_contacts WHERE id IN (?)`, [inList(unkIds)]);
    await run(`DELETE FROM admin_phone_numbers WHERE id IN (?) AND e164 LIKE '+1555%'`, [inList(lineIds)]);
    // No run is active here (run lock held): every STOP from a fictional +1555 number is a leftover.
    await run(`DELETE FROM sms_opt_outs WHERE phone_last10 LIKE '555%'`, []);
    if (errors.length) throw new Error(errors.join("\n"));
    return found;
  } finally {
    if (conn) {
      await conn.query(`SELECT RELEASE_LOCK(?)`, [TEST_RUN_LOCK]).catch(() => undefined);
      conn.release();
    }
  }
}
