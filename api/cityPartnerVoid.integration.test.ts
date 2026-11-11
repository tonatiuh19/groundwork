import "dotenv/config";
import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { __testClearEmailDryRuns, __testGetEmailDryRuns, createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

/**
 * Void & re-issue a City Partner agreement (e.g. $2.00 → $1.00 after signing). Wiring only:
 * super admin + reason + typed LLC name; voided copy kept; rate changes; partner emailed; they can sign again.
 */
describe.skipIf(!hasDb)("City Partner agreement void (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const prefix = `gwcpvoid-${Date.now()}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const ins = async (sql: string, p: unknown[]) => Number(((await db.execute(sql, p as any[])) as any)[0].insertId);
  const session = async (table: string, col: string, id: number, cookie: string) => {
    const t = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO ${table} (${col}, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [id, crypto.createHash("sha256").update(t).digest("hex")]);
    return `${cookie}=${t}`;
  };
  let superCookie = "";
  let agentCookie = "";
  let partnerCookie = "";
  let partnerId = 0;
  let agreementId = 0;

  beforeAll(async () => {
    process.env.VITEST = "true";
    process.env.GW_CP_TEST_PREFIX = prefix;
    const body = "Test agreement with {{partner_legal_name}} at {{fee_per_sqft}} per square foot. " + "Terms. ".repeat(40);
    await db.execute(`INSERT INTO city_partner_agreement_templates (version, body, approved_at, notes) VALUES (?, ?, NOW(), ?)`, [
      900_000 + Math.floor(Math.random() * 90_000_000),
      body,
      `${prefix}test agreement`,
    ]);
    superCookie = await session("admin_sessions", "admin_id", await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Cv', 'Super', 'super_admin', 'active')`, [em("super")]), "gw_admin_sid");
    agentCookie = await session("admin_sessions", "admin_id", await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Cv', 'Admin', 'admin', 'active')`, [em("admin")]), "gw_admin_sid");
    partnerId = await ins(`INSERT INTO city_partners (email, first_name, last_name, company, status, fee_cents_per_sqft) VALUES (?, 'Peter', 'Void', 'Remedio Test LLC', 'active', 200)`, [em("peter")]);
    partnerCookie = await session("city_partner_sessions", "city_partner_id", partnerId, "gw_city_sid");
    agreementId = await ins(
      `INSERT INTO city_partner_agreements (city_partner_id, template_version, fee_cents_per_sqft, body_rendered, body_sha256, signer_name, signed_at) VALUES (?, 2, 200, 'Signed at $2.00', ?, 'Peter Void', NOW())`,
      [partnerId, "a".repeat(64)],
    );
  });

  afterAll(async () => {
    delete process.env.GW_CP_TEST_PREFIX;
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  const voidIt = (cookie: string, body: Record<string, unknown>) =>
    request(app).post(`/api/admin/city-partners/${partnerId}/agreements/${agreementId}/void`).set("Cookie", cookie).send(body);

  it("only a super admin, with a reason and the LLC name typed exactly", async () => {
    const ok = { reason: "Rate changed to $1.00", confirm_name: "remedio test llc", fee_cents_per_sqft: 100 };
    expect((await voidIt(agentCookie, ok)).status).toBe(403);
    expect((await voidIt(superCookie, { ...ok, confirm_name: "Remedio" })).body.error).toBe("validation.confirmNameMismatch");
    expect((await voidIt(superCookie, { ...ok, reason: "" })).body.error).toBe("validation.voidReason");
  });

  it("voids, keeps the copy, sets the new rate, emails the partner, and lets them sign again", async () => {
    __testClearEmailDryRuns();
    await voidIt(superCookie, { reason: "Rate changed to $1.00", confirm_name: "Remedio Test LLC", fee_cents_per_sqft: 100 }).expect(200);
    const [[ag]] = (await db.query(`SELECT voided_at, void_reason FROM city_partner_agreements WHERE id = ?`, [agreementId])) as any;
    expect(ag.voided_at).toBeTruthy();
    expect(ag.void_reason).toBe("Rate changed to $1.00");
    const [[p]] = (await db.query(`SELECT fee_cents_per_sqft FROM city_partners WHERE id = ?`, [partnerId])) as any;
    expect(Number(p.fee_cents_per_sqft)).toBe(100);
    expect(__testGetEmailDryRuns().some((m: any) => [].concat(m.to).includes(em("peter") as never) && /New City Partner agreement/.test(m.subject))).toBe(true);
    // The partner sees a fresh agreement to sign at $1.00.
    const o = await request(app).get("/api/city/onboarding").set("Cookie", partnerCookie).expect(200);
    expect(o.body.agreement).toBeFalsy();
    expect(o.body.template.body).toContain("$1.00 per square foot");
    // Voiding twice is refused.
    expect((await voidIt(superCookie, { reason: "again", confirm_name: "Remedio Test LLC", fee_cents_per_sqft: 100 })).status).toBe(404);
  });
});
