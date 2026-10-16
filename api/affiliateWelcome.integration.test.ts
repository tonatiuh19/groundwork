import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { PNG } from "pngjs";
import Stripe from "stripe";

// ── In-memory private Blob store: signed PDFs never leave the test ───────────
const blobStore = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("@vercel/blob", async (orig) => {
  const real = await orig<typeof import("@vercel/blob")>();
  return {
    ...real,
    put: vi.fn(async (pathname: string, body: Buffer) => {
      blobStore.set(pathname, Buffer.from(body));
      return { url: `https://store.private.blob.vercel-storage.com/${pathname}`, pathname };
    }),
    issueSignedToken: vi.fn(async () => ({ clientSigningToken: "c", delegationToken: "d", validUntil: 0 })),
    presignUrl: vi.fn(async (_t: unknown, o: { pathname: string }) => ({
      presignedUrl: `https://store.private.blob.vercel-storage.com/${o.pathname}?sig=1`,
    })),
  };
});

process.env.BLOB_PRIVATE_READ_WRITE_TOKEN = "vercel_blob_rw_test_private";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_gw_test_secret";

import {
  __testClearEmailDryRuns,
  __testGetEmailDryRuns,
  __testSetAssistantApi,
  __testSetBillingApi,
  createServer,
} from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";
import { makeFakeBilling } from "./testFakeBilling";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

const signaturePng = () => {
  const png = new PNG({ width: 120, height: 40 });
  for (let x = 10; x < 110; x++) {
    const i = (20 * 120 + x) << 2;
    png.data[i + 3] = 255;
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
};


describe.runIf(hasDb)("affiliate welcome: link, signing while pending, card on file, FAQ, assistant", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwwelc-${stamp}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const billing = makeFakeBilling();
  const assistantCalls: any[] = [];
  let assistantReply = "You earn $7 per square foot when you have a Sponsor (Section 4).";
  let affiliateId = 0;
  let token = "";
  const eventIds: string[] = [];
  const withToken = (r: request.Test) => r.set("x-onboarding-token", token);
  let adminCookie = "";

  beforeAll(async () => {
    process.env.VITEST = "true";
    const [adm] = (await db.execute(
      `INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Ada', 'Approver', 'super_admin', 'active')`,
      [em("admin")],
    )) as any;
    const adminToken = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 DAY)`, [
      Number(adm.insertId),
      crypto.createHash("sha256").update(adminToken).digest("hex"),
    ]);
    adminCookie = `gw_admin_sid=${adminToken}`;
    __testSetBillingApi(billing.fake);
    __testSetAssistantApi({
      beta: {
        messages: {
          create: async (p: unknown) => {
            assistantCalls.push(p);
            return { content: [{ type: "text", text: assistantReply }], stop_reason: "end_turn", usage: { input_tokens: 1200, output_tokens: 40 } };
          },
        },
      },
    });
  });

  afterAll(async () => {
    __testSetBillingApi(null);
    __testSetAssistantApi(null);
    try {
      if (eventIds.length) await db.query(`DELETE FROM billing_webhook_events WHERE event_id IN (?)`, [eventIds]);
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("signup sends the welcome (presentation + secure link) and sets the default price", async () => {
    __testClearEmailDryRuns();
    await request(app)
      .post("/api/public/affiliate/signup")
      .send({ first_name: "Wendy", last_name: "Welcome", email: em("aff"), phone: `951${String(stamp).slice(-7)}`, preferred_language: "en" })
      .expect(201);
    const [[a]] = (await db.query(`SELECT id, status, subscription_price_cents FROM affiliates WHERE email = ?`, [em("aff")])) as any;
    affiliateId = Number(a.id);
    expect(a).toMatchObject({ status: "pending", subscription_price_cents: 1999 });
    const mail = __testGetEmailDryRuns().find((m: any) => String(m.to).includes(em("aff")));
    expect(mail).toBeTruthy();
    const html = String((mail as any).html);
    expect(html).toContain("canva.link/gcgaffiliate");
    const m = html.match(/\/affiliate\/welcome\/([a-f0-9]{64})/);
    expect(m).toBeTruthy();
    token = m![1];
    const [[link]] = (await db.query(`SELECT token_hash, expires_at FROM affiliate_onboarding_links WHERE affiliate_id = ?`, [affiliateId])) as any;
    expect(link.token_hash).toBe(crypto.createHash("sha256").update(token).digest("hex"));
    expect(link.token_hash).not.toBe(token); // only the hash is stored
  });

  it("the link authorizes onboarding only, while pending; bad / revoked links are refused", async () => {
    const ok = await withToken(request(app).get("/api/affiliate/onboarding?lang=en")).expect(200);
    expect(ok.body.affiliate.status).toBe("pending");
    expect(ok.body.presentation_url).toContain("canva.link");
    expect(ok.body.billing).toMatchObject({ configured: true, status: "none", trial_days: 90, price_cents: 1999 });
    await request(app).get("/api/affiliate/onboarding").set("x-onboarding-token", "f".repeat(64)).expect(401);
    await request(app).get("/api/affiliate/onboarding").set("x-onboarding-token", "not-a-token").expect(401);
    // Not a session: the rest of the portal stays closed.
    await withToken(request(app).get("/api/affiliate/clients")).expect(401);
    // ?ot= works only for GET (download links), never for writes.
    await request(app).get(`/api/affiliate/onboarding?ot=${token}`).expect(200);
    await request(app).post(`/api/affiliate/onboarding/billing/setup?ot=${token}`).expect(401);
  });

  it("card requires a signed agreement; pending affiliates can sign from the link", async () => {
    await withToken(request(app).post("/api/affiliate/onboarding/billing/setup")).expect(409);
    const ob = await withToken(request(app).get("/api/affiliate/onboarding?lang=en")).expect(200);
    await withToken(request(app).post("/api/affiliate/onboarding/agreement"))
      .send({
        version: ob.body.template.version, lang: "en", legal_name: "Wendy Welcome", address: "1 Welcome Way, Fontana, CA 92335",
        signature_image: signaturePng(), consent: true,
      })
      .expect(201);
    const [[ag]] = (await db.query(`SELECT subscription_price_cents FROM affiliate_agreements WHERE affiliate_id = ? AND status = 'signed'`, [affiliateId])) as any;
    expect(Number(ag.subscription_price_cents)).toBe(1999);
  });

  it("a pending affiliate's card is saved; the 90-day free period starts only on approval", async () => {
    const setup = await withToken(request(app).post("/api/affiliate/onboarding/billing/setup")).expect(200);
    expect(setup.body.client_secret).toBe("seti_gwtest_secret_x");
    await withToken(request(app).post("/api/affiliate/onboarding/billing/activate")).send({ setup_intent_id: "nope" }).expect(400);
    const act = await withToken(request(app).post("/api/affiliate/onboarding/billing/activate")).send({ setup_intent_id: "seti_gwtest" }).expect(200);
    expect(act.body.billing).toMatchObject({
      status: "none",
      awaiting_approval: true,
      approved: false,
      card: { brand: "visa", last4: "4242", exp: "12/2030" },
      price_cents: 1999,
    });
    expect(billing.calls["subscriptions.create"] ?? []).toHaveLength(0);
    const pending = await withToken(request(app).get("/api/affiliate/onboarding?lang=en")).expect(200);
    expect(pending.body.state.billing_ready).toBe(true); // setup step done
    expect(pending.body.state.payout_ready).toBe(false);

    // Groundwork approves → the plan starts now with the free period at the signed price.
    await request(app).patch(`/api/admin/affiliates/${affiliateId}`).set("Cookie", adminCookie).send({ status: "active" }).expect(200);
    const created = billing.calls["subscriptions.create"][0] as any;
    expect(created).toMatchObject({ trial_period_days: 90, default_payment_method: "pm_gwtest", metadata: { affiliate_id: String(affiliateId) } });
    expect(billing.calls["prices.create"][0]).toMatchObject({ unit_amount: 1999, currency: "usd", recurring: { interval: "month" } });
    const after = await withToken(request(app).get("/api/affiliate/onboarding/billing")).expect(200);
    expect(after.body.billing).toMatchObject({ status: "trialing", awaiting_approval: false, approved: true });
    // Re-approving (inactive → active) or replacing the card never grants a second free period.
    await withToken(request(app).post("/api/affiliate/onboarding/billing/activate")).send({ setup_intent_id: "seti_gwtest" }).expect(200);
    await request(app).patch(`/api/admin/affiliates/${affiliateId}`).set("Cookie", adminCookie).send({ status: "active" }).expect(200);
    expect(billing.calls["subscriptions.create"]).toHaveLength(1);
  });

  it("webhooks: signature-verified or re-fetched, idempotent, past_due blocks payouts", async () => {
    const subId = [...billing.subs.keys()][0];
    const sub = billing.subs.get(subId) as any;
    billing.subs.set(subId, { ...sub, status: "past_due" });
    const evt = { id: `evt_gwtest${stamp}a`, object: "event", type: "invoice.payment_failed", data: { object: { id: "in_1", parent: { subscription_details: { subscription: subId } } } } };
    eventIds.push(evt.id);
    const payload = JSON.stringify(evt);
    const header = new Stripe("sk_test_offline_only").webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });
    await request(app).post("/api/webhooks/billing").set("stripe-signature", "t=1,v1=bad").set("Content-Type", "application/json").send(payload).expect(400);
    await request(app).post("/api/webhooks/billing").set("stripe-signature", header).set("Content-Type", "application/json").send(payload).expect(200);
    const [[a]] = (await db.query(`SELECT billing_status FROM affiliates WHERE id = ?`, [affiliateId])) as any;
    expect(a.billing_status).toBe("past_due");
    // Replay → ignored (idempotent).
    await request(app).post("/api/webhooks/billing").set("stripe-signature", header).set("Content-Type", "application/json").send(payload).expect(200);
    expect(await countRows(`SELECT COUNT(*) n FROM billing_webhook_events WHERE event_id = ?`, [evt.id])).toBe(1);
    // No signature: only an event the provider confirms by id is trusted.
    billing.subs.set(subId, { ...sub, status: "active" });
    const evt2 = { id: `evt_gwtest${stamp}b`, type: "customer.subscription.updated", data: { object: { id: subId } } } as unknown as Stripe.Event;
    eventIds.push(evt2.id);
    billing.events.set(evt2.id, evt2);
    await request(app).post("/api/webhooks/billing").send({ id: evt2.id, type: "customer.subscription.deleted", data: { object: { id: "sub_forged" } } }).expect(200);
    const [[b]] = (await db.query(`SELECT billing_status FROM affiliates WHERE id = ?`, [affiliateId])) as any;
    expect(b.billing_status).toBe("active");
  });

  async function countRows(sql: string, params: unknown[]) {
    const [[r]] = (await db.query(sql, params)) as any;
    return Number(r.n);
  }

  it("FAQ is readable from the link; assistant answers from the agreement + FAQ and hands off what it can't", async () => {
    const faqs = await withToken(request(app).get("/api/affiliate/faqs")).expect(200);
    expect(faqs.body.faqs.length).toBeGreaterThan(0);
    const r = await withToken(request(app).post("/api/affiliate/assistant")).send({ message: "How much do I earn with a sponsor?", lang: "en" }).expect(200);
    expect(r.body).toMatchObject({ handoff: false, reply: assistantReply });
    const call = assistantCalls[0];
    const system = call.system[0];
    expect(system.cache_control).toEqual({ type: "ephemeral" });
    expect(system.text).toContain("<affiliate_agreement>");
    expect(system.text).toContain("$19.99");
    expect(system.text).toContain("<faq>");
    expect(call.fallbacks).toBe("default");
    expect(call.output_config).toEqual({ effort: "low" });

    assistantReply = "I'll pass this to the team. [HANDOFF]";
    const h = await withToken(request(app).post("/api/affiliate/assistant")).send({ message: "Can you pay me early this month?", lang: "en" }).expect(200);
    expect(h.body.handoff).toBe(true);
    expect(h.body.reply).not.toContain("[HANDOFF]");
    // History is sent back (user/assistant alternating).
    expect(assistantCalls[1].messages.map((m: any) => m.role)).toEqual(["user", "assistant", "user"]);
    const hist = await withToken(request(app).get("/api/affiliate/assistant")).expect(200);
    expect(hist.body.messages).toHaveLength(4);
    await withToken(request(app).post("/api/affiliate/assistant")).send({ message: "x" }).expect(400);
  });
});
