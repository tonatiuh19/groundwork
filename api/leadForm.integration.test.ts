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

describe.runIf(hasDb)("POST /api/public/leads (integration)", () => {
  const app = createServer();
  const stamp = Date.now();
  const email = `lead.test.${stamp}@example.com`;
  const leadIds: number[] = [];

  beforeAll(() => {
    process.env.VITEST = "true";
    delete process.env.NOTIFY_EMAILS;
    __testClearEmailDryRuns();
  });

  afterAll(async () => {
    await cleanupTestLeadsByEmail(__test.pool, [email]);
    await cleanupTestLeadsByPrefix(__test.pool, "lead.test.");
  });

  it("never delivers live email under VITEST", () => {
    process.env.VITEST = "true";
    expect(__test.shouldDeliverEmail()).toBe(false);
  });

  it("persists lead, dry-runs confirmation + staff emails, then cleans up", async () => {
    __testClearEmailDryRuns();
    const res = await request(app)
      .post("/api/public/leads")
      .send({
        full_name: "Test Lead",
        email,
        phone: "5550109999",
        property_address: "100 Test Ave, Fontana, CA",
        soft_pull_consent: true,
        preferred_language: "es",
        mode: "standard",
        source: "vitest",
      })
      .expect(201);

    expect(res.body.ok).toBe(true);
    expect(res.body.lead_id).toBeGreaterThan(0);
    leadIds.push(res.body.lead_id);

    const dry = __testGetEmailDryRuns();
    expect(dry.length).toBeGreaterThanOrEqual(1);
    expect(dry.every((d) => d.at)).toBe(true);
    expect(dry.some((d) => String(d.to).includes(email))).toBe(true);
    expect(dry.some((d) => d.html.includes("Estás en la lista"))).toBe(true);
    // Guard: no Resend id means we never hit the live API path
    expect(__test.shouldDeliverEmail()).toBe(false);

    const [rows] = await __test.pool.query(
      `SELECT full_name, email, status, preferred_language FROM leads WHERE id = ?`,
      [res.body.lead_id],
    );
    const row = (rows as any[])[0];
    expect(row?.email).toBe(email);
    expect(row?.status).toBe("new");
    expect(row?.preferred_language).toBe("es");
  });

  it("lists active platform owners for notify fan-out", async () => {
    const admins = await __test.listActiveTeamAdmins();
    const emails = admins.map((a) => a.email.toLowerCase());
    expect(emails).toContain("teamdc@encoremortgage.org");
    expect(emails).toContain("cesar@optimum-financial-group.com");
  });
});
