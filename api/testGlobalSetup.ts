/**
 * Vitest global setup for suites that write to the shared TiDB.
 *
 * - Before the run: sweep fixtures left by interrupted / crashed runs
 *   (Ctrl+C, hook timeouts) — their afterAll never ran. Every set stamped before
 *   this run started: we hold the run lock, so any other run is already dead.
 * - After the run: report any suite that leaked (its own afterAll missed
 *   rows), sweep this run's leftovers, and fail if anything still remains.
 * - One run at a time: a DB-wide lock (GET_LOCK) is held for the whole run, so
 *   a second run (another terminal, a deploy preflight) waits instead of
 *   overlapping. Overlap made one run's teardown sweep the other's fixtures
 *   ("stamped after my start" = mine), breaking it mid-run with 401s / FK errors.
 */
import "dotenv/config";
import {
  TEST_RUN_LOCK,
  createIntegrationTestPool,
  findTestFixturePrefixes,
  purgeTestLeftovers,
  scanTestLeftovers,
  sweepTestFixtures,
} from "./testDbCleanup";

const RUN_LOCK = TEST_RUN_LOCK;
const RUN_LOCK_WAIT_S = 30 * 60;

export default async function setup() {
  if (!process.env.DB_HOST) return;

  // Hold the run lock on a dedicated connection until teardown.
  const lockPool = createIntegrationTestPool();
  const lockConn = await lockPool.getConnection();
  const [[got]] = (await lockConn.query(`SELECT GET_LOCK(?, 0) AS l`, [RUN_LOCK])) as any;
  if (Number(got?.l) !== 1) {
    console.warn(`[test-db] another test run is using the shared DB; waiting for it to finish (up to ${RUN_LOCK_WAIT_S / 60} min)…`);
    const [[waited]] = (await lockConn.query(`SELECT GET_LOCK(?, ?) AS l`, [RUN_LOCK, RUN_LOCK_WAIT_S])) as any;
    if (Number(waited?.l) !== 1) {
      lockConn.release();
      await lockPool.end();
      throw new Error("[test-db] timed out waiting for another test run on the shared DB");
    }
  }
  // Start the clock only once we own the DB: nothing stamped by an earlier run counts as ours.
  const runStart = Date.now();
  // Keep the lock's connection alive for long runs (idle connections can be dropped, releasing the lock).
  const keepAlive = setInterval(() => void lockConn.query("SELECT 1").catch(() => undefined), 60_000);
  keepAlive.unref?.();

  const pool = createIntegrationTestPool();
  try {
    // We hold the run lock, so no other test run is alive: every fixture set stamped before we
    // started belongs to a dead (killed / crashed) run, however recent. Waiting 2h let a run stopped
    // minutes ago break the next one (slugs like "pat-pending" still taken).
    const swept = await sweepTestFixtures(pool, (stamp) => stamp < runStart);
    if (swept.length) {
      console.warn(`[test-db] swept ${swept.length} stale fixture set(s) from interrupted runs: ${swept.join(", ")}`);
    }
  } catch (e) {
    console.warn(`[test-db] stale sweep failed: ${(e as Error).message}`);
  } finally {
    await pool.end();
  }

  return async function teardown() {
    const pool = createIntegrationTestPool();
    try {
      const mine = (stamp: number) => stamp >= runStart;
      const leaked = [...(await findTestFixturePrefixes(pool))].filter(([, s]) => mine(s)).map(([p]) => p);
      if (leaked.length) {
        console.warn(`[test-db] suites left fixtures behind (fix their afterAll): ${leaked.join(", ")} — sweeping now`);
        await sweepTestFixtures(pool, mine);
        const still = [...(await findTestFixturePrefixes(pool))].filter(([, s]) => mine(s)).map(([p]) => p);
        if (still.length) {
          throw new Error(`[test-db] fixtures could not be removed from the shared DB: ${still.join(", ")}`);
        }
      }
      // Then everything that looks like a test fixture (any run, any age, incl. rows outside the
      // prefix convention: @example.com people, +1555 lines / threads). Staff must never see test data.
      await purgeTestLeftovers(pool, { lockHeld: true });
      const left = await scanTestLeftovers(pool);
      const total = left.prefixSets.length + left.emails.length + left.testLines + left.testThreads;
      if (total) {
        throw new Error(`[test-db] test data is still visible in the shared DB after the run: ${JSON.stringify(left)}`);
      }
    } finally {
      await pool.end();
      clearInterval(keepAlive);
      await lockConn.query(`SELECT RELEASE_LOCK(?)`, [RUN_LOCK]).catch(() => undefined);
      lockConn.release();
      await lockPool.end();
    }
  };
}
