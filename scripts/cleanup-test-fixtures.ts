/**
 * Purge (or preview) every integration-test leftover in the shared TiDB, so staff never see test data.
 *
 *   npm run test:cleanup-fixtures             # delete
 *   npm run test:cleanup-fixtures -- --dry-run  # read-only scan
 *
 * Removes: prefixed fixture sets (gw<suite>-<ts>-…, any age), people with @example.com /
 * @example.test emails and everything tied to them, +1555 test phone lines and their threads,
 * threads from +1555 numbers. Waits for a running test run (shared lock) before deleting.
 * Used by `npm run deploy:prod` after the test step (pass, fail or Ctrl+C).
 */
import "dotenv/config";
import { createIntegrationTestPool, purgeTestLeftovers, scanTestLeftovers } from "../api/testDbCleanup";

async function main() {
  if (!process.env.DB_HOST) {
    console.error("DB_HOST required (.env)");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");
  const pool = createIntegrationTestPool();
  try {
    const found = await purgeTestLeftovers(pool, { dryRun });
    const total = found.prefixSets.length + found.emails.length + found.testLines + found.testThreads;
    console.log(
      `${dryRun ? "Would remove" : "Removed"}: ${found.prefixSets.length} fixture set(s), ${found.emails.length} test email(s), ` +
        `${found.testLines} test line(s), ${found.testThreads} test thread(s)` +
        (found.emails.length ? `\n  emails: ${found.emails.slice(0, 20).join(", ")}${found.emails.length > 20 ? ", …" : ""}` : ""),
    );
    if (!dryRun && total) {
      const left = await scanTestLeftovers(pool);
      const remaining = left.prefixSets.length + left.emails.length + left.testLines + left.testThreads;
      if (remaining) {
        console.error(`⚠️  Still present after purge: ${JSON.stringify(left)}`);
        process.exitCode = 1;
      }
    }
    if (!total) console.log("✅ No test data in the shared DB.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
