import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type Stripe from "stripe";
import { __testClearEmailDryRuns, __testGetEmailDryRuns, __testSetBillingApi, createServer, runCardExpiryReminders } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";
import { makeFakeBilling } from "./testFakeBilling";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
const RUN_PHONE = String(100 + Math.floor(Math.random() * 900));
const ph = (last4: string) => `951${RUN_PHONE}${last4}`;

describe.runIf(hasDb)("contractor membership: card in the application, free period from approval, portal lock", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwctrbill-${stamp}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const billing = makeFakeBilling();
  const eventIds: string[] = [];
  let adminCookie = "";
  let contractorId = 0;
  let ctrCookie = "";
  let token = "";
  const appBase = () => `/api/public/contractor-application/${token}`;

  async function insertId(sql: string, params: unknown[]): Promise<number> {
    const [r] = await db.execute(sql, params as any[]);
    return Number((r as { insertId: number }).insertId);
  }
  async function session(actor: "admin" | "contractor" | "affiliate", id: number): Promise<string> {
    const t = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO \`${actor}_sessions\` (\`${actor}_id\`, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 DAY)`, [
      id,
      crypto.createHash("sha256").update(t).digest("hex"),
    ]);
    return `gw_${actor}_sid=${t}`;
  }
  async function signupApplicant(name: string, last4: string): Promise<{ id: number; token: string }> {
    __testClearEmailDryRuns();
    const email = em(name);
    await request(app)
      .post("/api/public/contractor/signup")
      .send({ first_name: "Cora", last_name: "Builder", email, phone: ph(last4), company: "Cora Builds LLC", preferred_language: "en" })
      .expect(201);
    const mail = [...__testGetEmailDryRuns()].reverse().find((m: any) => m.to === email) as any;
    const m = /contractor\/apply\/([a-f0-9]{64})/.exec(mail?.html || "");
    if (!m) throw new Error("no application link");
    const [[k]] = (await db.query(`SELECT id FROM contractors WHERE email = ?`, [email])) as any;
    return { id: Number(k.id), token: m[1] };
  }
  /** Skip the wizard: mark the application submitted + verified so staff can decide. */
  async function readyForDecision(id: number) {
    await db.execute(
      `UPDATE contractor_applications SET status = 'submitted', submitted_at = NOW(), license_verified = 1, insurance_verified = 1 WHERE contractor_id = ?`,
      [id],
    );
  }
  async function fireEvent(type: string, subId: string) {
    const evt = { id: `evt_gwctr${stamp}${eventIds.length}`, type, data: { object: { id: "in_x", parent: { subscription_details: { subscription: subId } } } } };
    eventIds.push(evt.id);
    billing.events.set(evt.id, evt as unknown as Stripe.Event);
    await request(app).post("/api/webhooks/billing").send({ id: evt.id }).expect(200);
  }

  beforeAll(async () => {
    process.env.VITEST = "true";
    __testSetBillingApi(billing.fake);
    const adminId = await insertId(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Ada', 'Admin', 'super_admin', 'active')`, [em("admin")]);
    adminCookie = await session("admin", adminId);
  });

  afterAll(async () => {
    __testSetBillingApi(null);
    try {
      if (eventIds.length) await db.query(`DELETE FROM billing_webhook_events WHERE event_id IN (?)`, [eventIds]);
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("the application asks for the card first; nothing is charged before approval", async () => {
    ({ id: contractorId, token } = await signupApplicant("cora", "0101"));
    const view = await request(app).get(`${appBase()}/billing`).expect(200);
    expect(view.body.billing).toMatchObject({ configured: true, status: "none", price_cents: 9990, trial_days: 30, card: null, approved: false });
    // Submitting without a card is refused before anything else.
    const early = await request(app).post(`${appBase()}/submit`).send({ certify: true });
    expect(early.status).toBe(409);
    expect(early.body.error).toBe("errors.cardRequiredToSubmit");

    await request(app).post(`${appBase()}/billing/setup`).expect(200);
    const act = await request(app).post(`${appBase()}/billing/activate`).send({ setup_intent_id: "seti_gwtest" }).expect(200);
    expect(act.body.billing).toMatchObject({ status: "none", awaiting_approval: true, card: { last4: "4242" } });
    expect(billing.calls["subscriptions.create"] ?? []).toHaveLength(0);
    const [[cust]] = (billing.calls["customers.create"] as any[]).slice(-1).map((c) => [c]);
    expect(cust.metadata).toMatchObject({ contractor_id: String(contractorId) });
    // With the card saved, submit moves on to the normal checks.
    expect((await request(app).post(`${appBase()}/submit`).send({ certify: true })).body.error).not.toBe("errors.cardRequiredToSubmit");
  });

  it("approval starts the 30-day free period at $99.90 and says so in the approval email", async () => {
    await readyForDecision(contractorId);
    __testClearEmailDryRuns();
    const r = await request(app)
      .post(`/api/admin/contractors/${contractorId}/application/decision`)
      .set("Cookie", adminCookie)
      .send({ decision: "approved", allow_missing: true, notes: "Docs waived for vitest." })
      .expect(200);
    expect(r.body.contractor_status).toBe("active");
    const created = billing.calls["subscriptions.create"][0] as any;
    expect(created).toMatchObject({ trial_period_days: 30, default_payment_method: "pm_gwtest", metadata: { contractor_id: String(contractorId) } });
    const price = (billing.calls["prices.create"] as any[]).find((p) => p.lookup_key === "gw_contractor_platform_usd_9990");
    expect(price).toMatchObject({ unit_amount: 9990, product_data: { name: "Groundwork contractor platform" } });
    const mail = __testGetEmailDryRuns().find((m: any) => m.to === em("cora")) as any;
    expect(String(mail?.html)).toContain("30 days free, then $99.90/month");

    ctrCookie = await session("contractor", contractorId);
    const me = await request(app).get("/api/contractor/billing").set("Cookie", ctrCookie).expect(200);
    expect(me.body).toMatchObject({ locked: false, billing: { status: "trialing", approved: true } });
    await request(app).get("/api/contractor/projects").set("Cookie", ctrCookie).expect(200);
  });

  it("a failed payment pauses the portal (billing + application stay open); updating the card is allowed", async () => {
    const subId = [...billing.subs.keys()][0];
    billing.subs.set(subId, { ...(billing.subs.get(subId) as any), status: "past_due" });
    __testClearEmailDryRuns();
    await fireEvent("invoice.payment_failed", subId);
    expect(__testGetEmailDryRuns().some((m: any) => m.to === em("cora") && /paused/.test(String(m.html)))).toBe(true);
    const blocked = await request(app).get("/api/contractor/projects").set("Cookie", ctrCookie);
    expect(blocked.status).toBe(402);
    expect(blocked.body.error).toBe("errors.billingRequired");
    const me = await request(app).get("/api/contractor/billing").set("Cookie", ctrCookie).expect(200);
    expect(me.body.locked).toBe(true);
    await request(app).get("/api/contractor/application").set("Cookie", ctrCookie).expect(200);
    await request(app).post("/api/contractor/billing/setup").set("Cookie", ctrCookie).expect(200);
    // Paid again → open.
    billing.subs.set(subId, { ...(billing.subs.get(subId) as any), status: "active" });
    await fireEvent("invoice.paid", subId);
    await request(app).get("/api/contractor/projects").set("Cookie", ctrCookie).expect(200);
  });

  it("admin price: waive cancels the plan and unlocks; a custom price restarts billing without a second free period", async () => {
    const waive = await request(app).patch(`/api/admin/contractors/${contractorId}/billing`).set("Cookie", adminCookie).send({ price_cents: 0 }).expect(200);
    expect(billing.calls["subscriptions.cancel"]).toHaveLength(1);
    expect(waive.body).toMatchObject({ locked: false, billing: { waived: true, in_good_standing: true } });
    await request(app).get("/api/contractor/projects").set("Cookie", ctrCookie).expect(200);

    await request(app).patch(`/api/admin/contractors/${contractorId}/billing`).set("Cookie", adminCookie).send({ price_cents: -5 }).expect(400);
    const custom = await request(app).patch(`/api/admin/contractors/${contractorId}/billing`).set("Cookie", adminCookie).send({ price_cents: 12000 }).expect(200);
    const second = (billing.calls["subscriptions.create"] as any[])[1];
    expect(second.trial_period_days).toBeUndefined();
    expect((billing.calls["prices.create"] as any[]).some((p) => p.unit_amount === 12000)).toBe(true);
    expect(custom.body.billing).toMatchObject({ price_cents: 12000, status: "active" });
    // Agents can read but not change the price.
    const agentId = await insertId(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Al', 'Agent', 'agent', 'active')`, [em("agent")]);
    const agent = await session("admin", agentId);
    await request(app).patch(`/api/admin/contractors/${contractorId}/billing`).set("Cookie", agent).send({ price_cents: null }).expect(403);
  });

  it("a denied application releases the saved card; it was never charged", async () => {
    const other = await signupApplicant("dee", "0102");
    token = other.token;
    await request(app).post(`${appBase()}/billing/setup`).expect(200);
    await request(app).post(`${appBase()}/billing/activate`).send({ setup_intent_id: "seti_gwtest" }).expect(200);
    await readyForDecision(other.id);
    const creates = (billing.calls["subscriptions.create"] as any[]).length;
    await request(app)
      .post(`/api/admin/contractors/${other.id}/application/decision`)
      .set("Cookie", adminCookie)
      .send({ decision: "denied" })
      .expect(200);
    expect(billing.calls["paymentMethods.detach"]).toContain("pm_gwtest");
    expect((billing.calls["subscriptions.create"] as any[]).length).toBe(creates);
    const [[k]] = (await db.query(`SELECT billing_payment_method_id, billing_card_last4 FROM contractors WHERE id = ?`, [other.id])) as any;
    expect(k).toMatchObject({ billing_payment_method_id: null, billing_card_last4: null });
  });

  it("an existing active contractor without a card is sent to billing on their next visit", async () => {
    const id = await insertId(
      `INSERT INTO contractors (email, first_name, last_name, status, preferred_language, activated_at) VALUES (?, 'Eli', 'Existing', 'active', 'en', NOW())`,
      [em("eli")],
    );
    const c = await session("contractor", id);
    expect((await request(app).get("/api/contractor/projects").set("Cookie", c)).status).toBe(402);
    const me = await request(app).get("/api/contractor/billing").set("Cookie", c).expect(200);
    expect(me.body).toMatchObject({ locked: true, billing: { approved: true, status: "none" } });
    // Card saved while already approved → the plan starts right away (with the free period).
    await request(app).post("/api/contractor/billing/setup").set("Cookie", c).expect(200);
    const act = await request(app).post("/api/contractor/billing/activate").set("Cookie", c).send({ setup_intent_id: "seti_gwtest" }).expect(200);
    expect(act.body).toMatchObject({ locked: false, billing: { status: "trialing" } });
    await request(app).get("/api/contractor/projects").set("Cookie", c).expect(200);
  });

  it("sub-affiliates start pending; only Groundwork approves them", async () => {
    const parentId = await insertId(
      `INSERT INTO affiliates (email, first_name, last_name, status, referral_code, slug, approved_at) VALUES (?, 'Pat', 'Parent', 'active', ?, ?, NOW())`,
      [em("parent"), `GWB${String(stamp).slice(-7)}`, `${prefix}pat`],
    );
    const parent = await session("affiliate", parentId);
    const add = await request(app)
      .post("/api/affiliate/team")
      .set("Cookie", parent)
      .send({ first_name: "Sid", last_name: "Sub", email: em("sub"), phone: ph("0103"), preferred_language: "en" })
      .expect(201);
    const subId = Number(add.body.affiliate_id);
    const [[sub]] = (await db.query(`SELECT status, approved_at FROM affiliates WHERE id = ?`, [subId])) as any;
    expect(sub).toMatchObject({ status: "pending", approved_at: null });
    const r = await request(app).patch(`/api/affiliate/team/${subId}`).set("Cookie", parent).send({ status: "active" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("errors.affiliatePendingApproval");
  });

  it("replacing a healthy card: plan switches, old card detached, no second free period", async () => {
    // Tess: approved with pm_gwtest, then replaces with a Mastercard.
    const id = await insertId(
      `INSERT INTO contractors (email, first_name, last_name, status, preferred_language, activated_at) VALUES (?, 'Tess', 'Swap', 'active', 'en', NOW())`,
      [em("tess")],
    );
    const c = await session("contractor", id);
    await request(app).post("/api/contractor/billing/setup").set("Cookie", c).expect(200);
    await request(app).post("/api/contractor/billing/activate").set("Cookie", c).send({ setup_intent_id: "seti_gwtest" }).expect(200);
    const creates = (billing.calls["subscriptions.create"] as any[]).length;
    billing.cards.set("pm_gwswap", { brand: "mastercard", last4: "4444", exp_month: 3, exp_year: 2031 });
    await request(app).post("/api/contractor/billing/setup").set("Cookie", c).expect(200);
    const r = await request(app).post("/api/contractor/billing/activate").set("Cookie", c).send({ setup_intent_id: "seti_gwtestZgwswap" }).expect(200);
    expect(r.body.billing).toMatchObject({ status: "trialing", card: { brand: "mastercard", last4: "4444", exp: "03/2031" } });
    expect((billing.calls["subscriptions.create"] as any[]).length).toBe(creates);
    const upd = (billing.calls["subscriptions.update"] as any[]).slice(-1)[0];
    expect(upd.p).toMatchObject({ default_payment_method: "pm_gwswap" });
    expect(billing.calls["paymentMethods.detach"]).toContain("pm_gwtest");
  });

  it("the bank refreshes a card: stored brand / last 4 / expiry follow automatically", async () => {
    const [[k]] = (await db.query(`SELECT id FROM contractors WHERE email = ?`, [em("tess")])) as any;
    billing.cards.set("pm_gwswap", { brand: "mastercard", last4: "9999", exp_month: 8, exp_year: 2033 });
    const evt = { id: `evt_gwctr${stamp}pm`, type: "payment_method.automatically_updated", data: { object: { id: "pm_gwswap" } } };
    eventIds.push(evt.id);
    billing.events.set(evt.id, evt as unknown as Stripe.Event);
    await request(app).post("/api/webhooks/billing").send({ id: evt.id }).expect(200);
    const [[row]] = (await db.query(`SELECT billing_card_last4, billing_card_exp FROM contractors WHERE id = ?`, [k.id])) as any;
    expect(row).toMatchObject({ billing_card_last4: "9999", billing_card_exp: "08/2033" });
  });

  it("card-expiry reminders: 30 days, then 7 days, once each; nothing for a fresh card", async () => {
    const [[k]] = (await db.query(`SELECT id FROM contractors WHERE email = ?`, [em("tess")])) as any;
    // Card ends 2027-01-31: 20 days before → 30-day notice; 3 days before → 7-day notice.
    await db.execute(`UPDATE contractors SET billing_card_exp = '01/2027', billing_expiry_notice = NULL WHERE id = ?`, [k.id]);
    const mine = () => __testGetEmailDryRuns().filter((m: any) => m.to === em("tess") && /expires soon/.test(String(m.subject)));
    __testClearEmailDryRuns();
    await runCardExpiryReminders(new Date("2026-12-01T12:00:00Z")); // 61 days out → nothing
    expect(mine()).toHaveLength(0);
    await runCardExpiryReminders(new Date("2027-01-12T12:00:00Z"));
    await runCardExpiryReminders(new Date("2027-01-13T12:00:00Z")); // same threshold → no repeat
    expect(mine()).toHaveLength(1);
    await runCardExpiryReminders(new Date("2027-01-28T12:00:00Z"));
    expect(mine()).toHaveLength(2);
    const [[row]] = (await db.query(`SELECT billing_expiry_notice FROM contractors WHERE id = ?`, [k.id])) as any;
    expect(row.billing_expiry_notice).toBe("01/2027:7");
    const c = await session("contractor", Number(k.id));
    await db.execute(`UPDATE contractors SET billing_card_exp = DATE_FORMAT(NOW() + INTERVAL 10 DAY, '%m/%Y') WHERE id = ?`, [k.id]);
    const me = await request(app).get("/api/contractor/billing").set("Cookie", c).expect(200);
    expect(me.body.billing.card_expiring).toBe(true);
  });

  it("renewal needing bank authentication → member asked to update the card", async () => {
    const [[k]] = (await db.query(`SELECT id, billing_subscription_id FROM contractors WHERE email = ?`, [em("tess")])) as any;
    __testClearEmailDryRuns();
    const evt = { id: `evt_gwctr${stamp}3ds`, type: "invoice.payment_action_required", data: { object: { id: "in_3ds", subscription: k.billing_subscription_id } } };
    eventIds.push(evt.id);
    billing.events.set(evt.id, evt as unknown as Stripe.Event);
    await request(app).post("/api/webhooks/billing").send({ id: evt.id }).expect(200);
    expect(__testGetEmailDryRuns().some((m: any) => m.to === em("tess") && /update your card/i.test(String(m.html)))).toBe(true);
  });

  it("a reset processor customer never re-grants the free period", async () => {
    const id = await insertId(
      `INSERT INTO contractors (email, first_name, last_name, status, preferred_language, activated_at, billing_trial_used_at) VALUES (?, 'Rae', 'Reset', 'active', 'en', NOW(), NOW())`,
      [em("rae")],
    );
    const c = await session("contractor", id);
    await request(app).post("/api/contractor/billing/setup").set("Cookie", c).expect(200);
    const r = await request(app).post("/api/contractor/billing/activate").set("Cookie", c).send({ setup_intent_id: "seti_gwtest" }).expect(200);
    expect(r.body.billing.status).toBe("active");
    expect((billing.calls["subscriptions.create"] as any[]).slice(-1)[0].trial_period_days).toBeUndefined();
  });

  it("affiliate payment failed → portal paused (billing, setup, help stay open); payouts held", async () => {
    const id = await insertId(
      `INSERT INTO affiliates (email, first_name, last_name, status, referral_code, slug, approved_at, subscription_price_cents, billing_status, billing_subscription_id)
       VALUES (?, 'Pia', 'PastDue', 'active', ?, ?, NOW(), 1999, 'past_due', 'sub_gwpia')`,
      [em("pia"), `GWP${String(stamp).slice(-7)}`, `${prefix}pia`],
    );
    const c = await session("affiliate", id);
    const blocked = await request(app).get("/api/affiliate/clients").set("Cookie", c);
    expect(blocked.status).toBe(402);
    expect(blocked.body.error).toBe("errors.billingRequired");
    const st = await request(app).get("/api/affiliate/billing/status").set("Cookie", c).expect(200);
    expect(st.body.locked).toBe(true);
    await request(app).get("/api/affiliate/me").set("Cookie", c).expect(200);
    await request(app).get("/api/affiliate/faqs").set("Cookie", c).expect(200);
    const ob = await request(app).get("/api/affiliate/onboarding?lang=en").set("Cookie", c).expect(200);
    expect(ob.body.state.payout_ready).toBe(false);
    // Back in good standing → open again.
    await db.execute(`UPDATE affiliates SET billing_status = 'active' WHERE id = ?`, [id]);
    await request(app).get("/api/affiliate/clients").set("Cookie", c).expect(200);
  });
});
