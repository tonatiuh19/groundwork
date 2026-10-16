import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { __testClearEmailDryRuns, __testGetEmailDryRuns, __testSetBillingApi, createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";
import { makeFakeBilling } from "./testFakeBilling";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

describe.runIf(hasDb)("admin billing: overview, membership drawer actions, card links", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwbilladm-${stamp}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const billing = makeFakeBilling();
  const cookies: Record<string, string> = {};
  let ctrId = 0;
  let affId = 0;

  async function insertId(sql: string, params: unknown[]): Promise<number> {
    const [r] = await db.execute(sql, params as any[]);
    return Number((r as { insertId: number }).insertId);
  }
  async function session(actor: "admin" | "contractor", id: number) {
    const t = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO \`${actor}_sessions\` (\`${actor}_id\`, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 DAY)`, [
      id,
      crypto.createHash("sha256").update(t).digest("hex"),
    ]);
    return `gw_${actor}_sid=${t}`;
  }
  const as = (who: string) => ({
    get: (u: string) => request(app).get(u).set("Cookie", cookies[who]),
    post: (u: string) => request(app).post(u).set("Cookie", cookies[who]),
    patch: (u: string) => request(app).patch(u).set("Cookie", cookies[who]),
  });
  const row = async (table: string, id: number) => ((await db.query(`SELECT * FROM ${table} WHERE id = ?`, [id])) as any)[0][0];
  const actionsFor = async (role: string, id: number) =>
    ((await db.query(`SELECT action, reason FROM billing_admin_actions WHERE member_role = ? AND member_id = ? ORDER BY id`, [role, id])) as any)[0];

  beforeAll(async () => {
    process.env.VITEST = "true";
    __testSetBillingApi(billing.fake);
    for (const role of ["super_admin", "finance", "agent", "content"]) {
      const id = await insertId(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, ?, 'Test', ?, 'active')`, [em(role), role, role]);
      cookies[role] = await session("admin", id);
    }
    // Contractor with a running free period (card saved, approved).
    ctrId = await insertId(
      `INSERT INTO contractors (email, first_name, last_name, company, status, preferred_language, activated_at) VALUES (?, 'Cam', 'Contractor', 'Cam Builds', 'active', 'en', NOW())`,
      [em("cam")],
    );
    const c = await session("contractor", ctrId);
    await request(app).post("/api/contractor/billing/setup").set("Cookie", c).expect(200);
    await request(app).post("/api/contractor/billing/activate").set("Cookie", c).send({ setup_intent_id: "seti_gwtest" }).expect(200);
    // Approved affiliate with no plan yet (manual start via card link).
    affId = await insertId(
      `INSERT INTO affiliates (email, first_name, last_name, status, referral_code, slug, approved_at, subscription_price_cents) VALUES (?, 'Ava', 'Affiliate', 'active', ?, ?, NOW(), 1999)`,
      [em("ava"), `GWA${String(stamp).slice(-7)}`, `${prefix}ava`],
    );
  });

  afterAll(async () => {
    __testSetBillingApi(null);
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("overview: totals + rows for every staff role with people.read; content can't see it", async () => {
    const r = await as("agent").get("/api/admin/billing/overview").expect(200);
    const mine = r.body.members.find((m: any) => m.role === "contractor" && m.id === ctrId);
    expect(mine).toMatchObject({ name: "Cam Contractor", company: "Cam Builds", billing: { status: "trialing", price_cents: 9990 }, locked: false });
    expect(r.body.totals).toMatchObject({ trialing: expect.any(Number), mrr_cents: expect.any(Number) });
    expect(r.body.totals.trialing).toBeGreaterThanOrEqual(1);
    await as("content").get("/api/admin/billing/overview").expect(403);
  });

  it("agents read but can't act; actions need a reason", async () => {
    await as("agent").get(`/api/admin/billing/contractor/${ctrId}`).expect(200);
    await as("agent").post(`/api/admin/billing/contractor/${ctrId}/cancel`).send({ when: "period_end", reason: "testing" }).expect(403);
    const r = await as("finance").post(`/api/admin/billing/contractor/${ctrId}/cancel`).send({ when: "period_end", reason: "" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("validation.billingReasonRequired");
    await as("super_admin").get("/api/admin/billing/vendor/1").expect(404);
  });

  it("cancel at period end → resume, logged, member emailed", async () => {
    __testClearEmailDryRuns();
    const c = await as("finance").post(`/api/admin/billing/contractor/${ctrId}/cancel`).send({ when: "period_end", reason: "Asked by phone" }).expect(200);
    expect(c.body.billing.cancel_at_period_end).toBe(true);
    expect(__testGetEmailDryRuns().some((m: any) => m.to === em("cam") && /canceled/i.test(String(m.subject)))).toBe(true);
    const r = await as("finance").post(`/api/admin/billing/contractor/${ctrId}/resume`).send({}).expect(200);
    expect(r.body.billing.cancel_at_period_end).toBe(false);
    expect((await actionsFor("contractor", ctrId)).map((a: any) => a.action)).toEqual(["cancel_period_end", "resume"]);
  });

  it("add free days moves the next charge; out-of-range days refused", async () => {
    await as("finance").post(`/api/admin/billing/contractor/${ctrId}/extend`).send({ days: 0, reason: "courtesy" }).expect(400);
    const before = await row("contractors", ctrId);
    __testClearEmailDryRuns();
    const r = await as("super_admin").post(`/api/admin/billing/contractor/${ctrId}/extend`).send({ days: 14, reason: "Storm delay courtesy" }).expect(200);
    const upd = (billing.calls["subscriptions.update"] as any[]).slice(-1)[0];
    expect(upd.p).toMatchObject({ proration_behavior: "none" });
    const prevEnd = Math.floor(new Date(before.billing_trial_ends_at).getTime() / 1000);
    expect(upd.p.trial_end).toBeGreaterThanOrEqual(prevEnd + 14 * 86400 - 5);
    expect(r.body.billing.status).toBe("trialing");
    expect(__testGetEmailDryRuns().some((m: any) => m.to === em("cam") && /14 free days/.test(String(m.subject)))).toBe(true);
  });

  it("invoices list receipts; partial + full refunds; another member's invoice is refused", async () => {
    const k = await row("contractors", ctrId);
    billing.addInvoice(`in_gw${stamp}a`, String(k.billing_customer_id), 9990);
    billing.addInvoice(`in_gw${stamp}x`, "cus_someone_else", 9990);
    const d = await as("agent").get(`/api/admin/billing/contractor/${ctrId}`).expect(200);
    const inv = d.body.invoices.find((i: any) => i.id === `in_gw${stamp}a`);
    expect(inv).toMatchObject({ amount_paid: 9990, refundable: true, receipt_url: expect.stringContaining("receipt") });
    expect(d.body.invoices.some((i: any) => i.id === `in_gw${stamp}x`)).toBe(false);

    await as("finance").post(`/api/admin/billing/contractor/${ctrId}/refund`).send({ invoice_id: `in_gw${stamp}x`, reason: "nope" }).expect(404);
    await as("finance").post(`/api/admin/billing/contractor/${ctrId}/refund`).send({ invoice_id: `in_gw${stamp}a`, amount_cents: 20000, reason: "too much" }).expect(400);
    __testClearEmailDryRuns();
    await as("finance").post(`/api/admin/billing/contractor/${ctrId}/refund`).send({ invoice_id: `in_gw${stamp}a`, amount_cents: 4990, reason: "Half month goodwill" }).expect(200);
    expect(__testGetEmailDryRuns().some((m: any) => m.to === em("cam") && /\$49\.90/.test(String(m.subject)))).toBe(true);
    // No amount = the rest.
    const rest = await as("finance").post(`/api/admin/billing/contractor/${ctrId}/refund`).send({ invoice_id: `in_gw${stamp}a`, reason: "Full refund approved" }).expect(200);
    expect(rest.body.refund.amount_cents).toBe(5000);
    await as("finance").post(`/api/admin/billing/contractor/${ctrId}/refund`).send({ invoice_id: `in_gw${stamp}a`, reason: "again" }).expect(400);
    const after = await as("agent").get(`/api/admin/billing/contractor/${ctrId}`).expect(200);
    expect(after.body.invoices.find((i: any) => i.id === `in_gw${stamp}a`)).toMatchObject({ amount_refunded: 9990, refundable: false });
    expect(after.body.actions.filter((a: any) => a.action === "refund")).toHaveLength(2);
  });

  it("affiliate price override beats the agreement price; null restores it", async () => {
    const r = await as("finance").patch(`/api/admin/billing/affiliate/${affId}/price`).send({ price_cents: 2500, reason: "Partner rate" }).expect(200);
    expect(r.body.billing.price_cents).toBe(2500);
    const back = await as("finance").patch(`/api/admin/billing/affiliate/${affId}/price`).send({ price_cents: null }).expect(200);
    expect(back.body.billing.price_cents).toBe(1999);
  });

  it("manual start: secure card link with staff terms → member adds card → plan at that price + free days; link works once", async () => {
    // Pending members can't be started manually.
    const pendingId = await insertId(
      `INSERT INTO affiliates (email, first_name, last_name, status, referral_code, slug) VALUES (?, 'Pat', 'Pending', 'pending', ?, ?)`,
      [em("pat"), `GWP${String(stamp).slice(-7)}`, `${prefix}pat`],
    );
    expect((await as("finance").post(`/api/admin/billing/affiliate/${pendingId}/card-link`).send({})).body.error).toBe("errors.billingNotApproved");
    // Running plans can't get a start link.
    expect((await as("finance").post(`/api/admin/billing/contractor/${ctrId}/card-link`).send({})).body.error).toBe("errors.billingAlreadyActive");

    __testClearEmailDryRuns();
    await as("finance").post(`/api/admin/billing/affiliate/${affId}/card-link`).send({ price_cents: 1500, free_days: 45, note: "Welcome aboard!" }).expect(201);
    const mail = __testGetEmailDryRuns().find((m: any) => m.to === em("ava")) as any;
    expect(String(mail?.html)).toContain("45 days free, then $15.00/month");
    const token = /\/billing\/card\/([a-f0-9]{64})/.exec(String(mail?.html))![1];

    const view = await request(app).get(`/api/public/billing-link/${token}`).expect(200);
    expect(view.body.billing).toMatchObject({ price_cents: 1500, trial_days: 45 });
    await request(app).post(`/api/public/billing-link/${token}/setup`).expect(200);
    const act = await request(app).post(`/api/public/billing-link/${token}/activate`).send({ setup_intent_id: "seti_gwtest" }).expect(200);
    expect(act.body.billing).toMatchObject({ status: "trialing", price_cents: 1500 });
    const created = (billing.calls["subscriptions.create"] as any[]).slice(-1)[0];
    expect(created).toMatchObject({ trial_period_days: 45, metadata: { affiliate_id: String(affId) } });
    await request(app).get(`/api/public/billing-link/${token}`).expect(404);
    expect((await actionsFor("affiliate", affId)).map((a: any) => a.action)).toContain("card_link");
  });

  it("cancel now ends the plan immediately; resume is then refused", async () => {
    const r = await as("super_admin").post(`/api/admin/billing/affiliate/${affId}/cancel`).send({ when: "now", reason: "Left the program" }).expect(200);
    expect(r.body.billing.status).toBe("canceled");
    const again = await as("super_admin").post(`/api/admin/billing/affiliate/${affId}/resume`).send({});
    expect(again.status).toBe(409);
  });
});
