import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  createServer,
  __testClearEmailDryRuns,
  __testGetEmailDryRuns,
  __test,
} from "./index";
import {
  cleanupTestLeadsByEmail,
  cleanupTestLeadsByPrefix,
} from "./testDbCleanup";

const hasDb =
  Boolean(process.env.DB_HOST) &&
  Boolean(process.env.DB_USER) &&
  Boolean(process.env.DB_PASSWORD) &&
  Boolean(process.env.DB_NAME);

describe.runIf(hasDb)("POST /api/public/get-credit-report-lead", () => {
  const app = createServer();
  const stamp = Date.now();
  const email = `gcr.test.${stamp}@example.com`;

  beforeAll(() => {
    process.env.VITEST = "true";
    delete process.env.NOTIFY_EMAILS;
    __testClearEmailDryRuns();
  });

  afterAll(async () => {
    await cleanupTestLeadsByEmail(__test.pool, [email]);
    await cleanupTestLeadsByPrefix(__test.pool, "gcr.test.");
  });

  it("creates lead, returns MFSN url, dry-runs emails (never live)", async () => {
    __testClearEmailDryRuns();
    expect(__test.shouldDeliverEmail()).toBe(false);

    const res = await request(app)
      .post("/api/public/get-credit-report-lead")
      .send({
        first_name: "Test",
        last_name: "Lead",
        email,
        phone: "5550108888",
        preferred_language: "en",
        soft_pull_consent: true,
        notes: "vitest",
      })
      .expect(201);

    expect(res.body.ok).toBe(true);
    expect(res.body.mfsn_url).toBe(__test.MFSN_FREE_SNAPSHOT_URL);
    expect(res.body.short_url).toContain("/go/free-score");
    expect(res.body.email_sent).toBe(false);

    const dry = __testGetEmailDryRuns();
    expect(dry.some((d) => String(d.to).includes(email))).toBe(true);
    expect(dry.some((d) => d.html.includes("myfreescorenow.com"))).toBe(true);

    const [rows] = await __test.pool.query(
      `SELECT source, first_name, preferred_language FROM leads WHERE id = ?`,
      [res.body.lead_id],
    );
    const row = (rows as any[])[0];
    expect(row?.source).toBe("get_credit_report");
    expect(row?.first_name).toBe("Test");
  });

  it("redirects free-score short path", async () => {
    const res = await request(app).get("/go/free-score").expect(302);
    expect(res.headers.location).toBe(__test.MFSN_FREE_SNAPSHOT_URL);
  });
});
