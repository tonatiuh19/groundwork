/**
 * Vitest global setup for suites that write to the shared TiDB.
 *
 * - Before the run: sweep fixtures left by interrupted / crashed runs
 *   (Ctrl+C, hook timeouts) — their afterAll never ran. Only stamps older than
 *   STALE_MS, so a run in another terminal is never touched.
 * - After the run: report any suite that leaked (its own afterAll missed
 *   rows), sweep this run's leftovers, and fail if anything still remains.
 * - One run at a time: a DB-wide lock (GET_LOCK) is held for the whole run, so
 *   a second run (another terminal, a deploy preflight) waits instead of
 *   overlapping. Overlap made one run's teardown sweep the other's fixtures
 *   ("stamped after my start" = mine), breaking it mid-run with 401s / FK errors.
 */
import "dotenv/config";
import {
  createIntegrationTestPool,
  findTestFixturePrefixes,
  sweepTestFixtures,
} from "./testDbCleanup";

const STALE_MS = 2 * 60 * 60 * 1000;
const RUN_LOCK = "gw_vitest_shared_db";
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
    const swept = await sweepTestFixtures(pool, (stamp) => stamp < runStart - STALE_MS);
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
    } finally {
      await pool.end();
      clearInterval(keepAlive);
      await lockConn.query(`SELECT RELEASE_LOCK(?)`, [RUN_LOCK]).catch(() => undefined);
      lockConn.release();
      await lockPool.end();
    }
  };
}
