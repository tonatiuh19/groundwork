import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { __testClearEmailDryRuns, __testGetEmailDryRuns, __testSetBillingApi, runAffiliateCardReminders } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";
import { makeFakeBilling } from "./testFakeBilling";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

/** Daily add-your-card reminders: active affiliates with no membership, 3 at most, never twice in a run. */
describe.runIf(hasDb)("affiliate card reminders", () => {
  const db = createIntegrationTestPool();
  const prefix = `gwcard-${Date.now()}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  let code = 0;
  const aff = async (n: string, fields: Record<string, unknown>) => {
    const cols = { email: em(n), first_name: "Cara", last_name: "Card", status: "active", referral_code: `C${Date.now() % 1e9}${code++}`, subscription_price_cents: 1999, approved_at: new Date(Date.now() - 10 * 86_400_000), ...fields };
    const [r] = (await db.execute(`INSERT INTO affiliates (${Object.keys(cols).join(", ")}) VALUES (${Object.keys(cols).map(() => "?").join(", ")})`, Object.values(cols) as any[])) as any;
    return Number(r.insertId);
  };
  const sentTo = () => __testGetEmailDryRuns().flatMap((m) => m.to).filter((to) => String(to).startsWith(prefix));

  beforeAll(() => {
    process.env.VITEST = "true";
    __testSetBillingApi(makeFakeBilling().fake);
  });
  beforeEach(() => __testClearEmailDryRuns());
  afterAll(async () => {
    __testSetBillingApi(null);
    await cleanupPortalFixturesByPrefix(db, prefix);
    await db.end();
  });

  it("only reminds who is due, follows the spacing, and stops at 3", async () => {
    const due = await aff("due", {});
    await aff("fresh", { approved_at: new Date() });
    await aff("pending", { status: "pending" });
    await aff("trial", { billing_status: "trialing" });
    await aff("free", { subscription_price_cents: 0 });

    expect((await runAffiliateCardReminders(prefix)).card_reminders).toBe(1);
    expect(sentTo()).toEqual([em("due")]);
    // Same day: nothing more.
    expect((await runAffiliateCardReminders(prefix)).card_reminders).toBe(0);

    await db.execute(`UPDATE affiliates SET card_reminder_last_at = NOW() - INTERVAL 5 DAY WHERE id = ?`, [due]);
    expect((await runAffiliateCardReminders(prefix)).card_reminders).toBe(1);
    await db.execute(`UPDATE affiliates SET card_reminder_last_at = NOW() - INTERVAL 5 DAY WHERE id = ?`, [due]);
    expect((await runAffiliateCardReminders(prefix)).card_reminders).toBe(0);
    await db.execute(`UPDATE affiliates SET card_reminder_last_at = NOW() - INTERVAL 8 DAY WHERE id = ?`, [due]);
    expect((await runAffiliateCardReminders(prefix)).card_reminders).toBe(1);
    await db.execute(`UPDATE affiliates SET card_reminder_last_at = NOW() - INTERVAL 60 DAY WHERE id = ?`, [due]);
    expect((await runAffiliateCardReminders(prefix)).card_reminders).toBe(0);
  });

  it("does nothing without a fixture prefix under tests", async () => {
    expect((await runAffiliateCardReminders()).card_reminders).toBe(0);
  });
});
