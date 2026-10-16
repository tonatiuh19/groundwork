/**
 * End-to-end billing check against Stripe TEST mode + the local dev server.
 *
 *   1. Start the dev server with CLI webhooks:   (launch config "dev-stripe")  bash scripts/dev-stripe.sh
 *   2. Forward webhooks:  stripe listen --api-key $STRIPE_SECRET_KEY --forward-to https://localhost:8080/api/webhooks/billing --skip-verify
 *   3. Run:               npx tsx scripts/stripe-e2e.mts
 *
 * Uses test clocks to fast-forward trials / renewals and Stripe's test payment methods for declines and
 * authentication. Every fixture is an @example.com row tagged `gwstripe-<ts>-`; every Stripe object is
 * tagged metadata.gw_e2e and removed at the end (test clocks delete their customers + subscriptions).
 * Refuses to run with a live key or a non-local server.
 */
import "dotenv/config";
import crypto from "crypto";
import Stripe from "stripe";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "../api/testDbCleanup.ts";

const KEY = String(process.env.STRIPE_SECRET_KEY || "");
const BASE = process.env.E2E_BASE || "https://localhost:8080";
if (!KEY.startsWith("sk_test_")) throw new Error("stripe-e2e: test-mode key required");
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("stripe-e2e: local server only");
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // local self-signed dev cert

const stripe = new Stripe(KEY);
const db = createIntegrationTestPool();
const prefix = `gwstripe-${Date.now()}-`;
const em = (n: string) => `${prefix}${n}@example.com`;
const sha = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
const clocks: string[] = [];
const results: { name: string; ok: boolean; detail?: string }[] = [];

// ── helpers ──────────────────────────────────────────────────────────────────
async function ins(sql: string, p: unknown[]): Promise<number> {
  return Number(((await db.execute(sql, p as any[])) as any)[0].insertId);
}
async function session(actor: "admin" | "contractor" | "affiliate", id: number): Promise<string> {
  const t = crypto.randomBytes(32).toString("hex");
  await db.execute(`INSERT INTO \`${actor}_sessions\` (\`${actor}_id\`, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 3 HOUR)`, [id, sha(t)]);
  return `gw_${actor}_sid=${t}`;
}
async function call(method: string, path: string, opts: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.headers || {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let body: any = null;
  try {
    body = await r.json();
  } catch {
    /* empty */
  }
  return { status: r.status, body };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined | false>, ms = 90_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error(`timeout: ${label}`);
    await sleep(1500);
  }
}
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    results.push({ name, ok: false, detail: e?.message ?? String(e) });
    console.log(`  ✗ ${name}\n      ${e?.message ?? e}`);
  }
}
function expect(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
/** Confirm a setup secret server-side with a Stripe test payment method (what the card form does). */
async function confirmCard(clientSecret: string, pm: string): Promise<{ id: string; status?: string; error?: string }> {
  const id = clientSecret.split("_secret_")[0];
  try {
    const si = await stripe.setupIntents.confirm(id, { payment_method: pm, return_url: `${BASE}/done` });
    return { id, status: si.status };
  } catch (e: any) {
    return { id, error: e?.code || e?.message };
  }
}
async function clockFor(name: string) {
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: `${prefix}${name}` });
  clocks.push(clock.id);
  return clock;
}
/** Stripe lets a clock jump at most two billing intervals at once — advance in ≤55-day steps. */
async function advance(clockId: string, days: number) {
  for (let left = days; left > 0; left -= 55) {
    const step = Math.min(left, 55);
    const c = await stripe.testHelpers.testClocks.retrieve(clockId);
    await stripe.testHelpers.testClocks.advance(clockId, { frozen_time: c.frozen_time + Math.round(step * 86400) });
    await waitFor(`clock ${clockId} ready`, async () => (await stripe.testHelpers.testClocks.retrieve(clockId)).status === "ready", 180_000);
  }
}
/** Pre-create the processor customer on a test clock; the app reuses billing_customer_id. */
async function attachClockCustomer(table: "contractors" | "affiliates", id: number, email: string, clockId: string) {
  const c = await stripe.customers.create({
    email,
    test_clock: clockId,
    metadata: { gw_e2e: prefix, [table === "contractors" ? "contractor_id" : "affiliate_id"]: String(id), app: "groundwork" },
  });
  await db.execute(`UPDATE ${table} SET billing_customer_id = ? WHERE id = ?`, [c.id, id]);
  return c.id;
}
async function row(table: "contractors" | "affiliates", id: number) {
  const [[r]] = (await db.query(`SELECT * FROM ${table} WHERE id = ?`, [id])) as any;
  return r;
}
async function newApplicant(name: string) {
  const id = await ins(
    `INSERT INTO contractors (email, first_name, last_name, company, status, preferred_language) VALUES (?, ?, 'E2E', 'E2E Builders LLC', 'pending', 'en')`,
    [em(name), name],
  );
  const appId = await ins(`INSERT INTO contractor_applications (contractor_id, application_number, status) VALUES (?, ?, 'draft')`, [
    id,
    `CPQ-2026-E${crypto.randomBytes(3).toString("hex").toUpperCase().slice(0, 5)}`,
  ]);
  const token = crypto.randomBytes(32).toString("hex");
  await db.execute(`INSERT INTO contractor_application_tokens (application_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 3 HOUR)`, [appId, sha(token)]);
  return { id, token, base: `/api/public/contractor-application/${token}` };
}
async function approve(adminCookie: string, id: number, decision: "approved" | "denied" = "approved") {
  await db.execute(
    `UPDATE contractor_applications SET status = 'submitted', submitted_at = NOW(), license_verified = 1, insurance_verified = 1 WHERE contractor_id = ?`,
    [id],
  );
  return call("POST", `/api/admin/contractors/${id}/application/decision`, {
    cookie: adminCookie,
    body: decision === "approved" ? { decision, allow_missing: true, notes: "stripe-e2e fixture" } : { decision },
  });
}
async function saveCardViaApplication(base: string, pm: string) {
  const s = await call("POST", `${base}/billing/setup`);
  expect(s.status === 200, `setup ${s.status} ${JSON.stringify(s.body)}`);
  const c = await confirmCard(s.body.client_secret, pm);
  const a = await call("POST", `${base}/billing/activate`, { body: { setup_intent_id: c.id } });
  return { confirm: c, activate: a };
}
async function saveCardViaPortal(cookie: string, pm: string) {
  const s = await call("POST", "/api/contractor/billing/setup", { cookie });
  expect(s.status === 200, `setup ${s.status} ${JSON.stringify(s.body)}`);
  const c = await confirmCard(s.body.client_secret, pm);
  const a = await call("POST", "/api/contractor/billing/activate", { cookie, body: { setup_intent_id: c.id } });
  return { confirm: c, activate: a };
}
const portalOpen = async (cookie: string) => (await call("GET", "/api/contractor/projects", { cookie })).status;

// ── scenarios ────────────────────────────────────────────────────────────────
async function main() {
  const ping = await call("GET", "/api/contractor/billing");
  expect(ping.status === 401, `dev server not reachable at ${BASE} (got ${ping.status})`);
  const adminCookie = await session("admin", await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'E2E', 'Admin', 'super_admin', 'active')`, [em("admin")]));

  console.log("\nContractor — happy path (application card → approval → trial → renewal → cancel → rejoin)");
  const happy = await newApplicant("happy");
  const hClock = await clockFor("happy");
  await attachClockCustomer("contractors", happy.id, em("happy"), hClock.id);
  let hCookie = "";
  await check("application shows $99.90 + 30 free days, no card yet", async () => {
    const r = await call("GET", `${happy.base}/billing`);
    expect(r.body?.billing?.price_cents === 9990 && r.body.billing.trial_days === 30 && !r.body.billing.card, JSON.stringify(r.body));
  });
  await check("submit is refused without a card", async () => {
    const r = await call("POST", `${happy.base}/submit`, { body: { certify: true } });
    expect(r.status === 409 && r.body?.error === "errors.cardRequiredToSubmit", JSON.stringify(r));
  });
  await check("Visa saved during application → awaiting approval, no subscription", async () => {
    const { activate } = await saveCardViaApplication(happy.base, "pm_card_visa");
    expect(activate.status === 200 && activate.body.billing.awaiting_approval && activate.body.billing.card?.last4 === "4242", JSON.stringify(activate));
    const subs = await stripe.subscriptions.list({ customer: (await row("contractors", happy.id)).billing_customer_id });
    expect(subs.data.length === 0, "subscription created before approval");
  });
  await check("approval starts a 30-day trial at $99.90", async () => {
    const r = await approve(adminCookie, happy.id);
    expect(r.status === 200, JSON.stringify(r));
    const k = await row("contractors", happy.id);
    const sub = await stripe.subscriptions.retrieve(k.billing_subscription_id);
    const days = Math.round(((sub.trial_end || 0) - (sub.trial_start || 0)) / 86400);
    expect(sub.status === "trialing" && days === 30, `status ${sub.status}, trial ${days}d`);
    expect(sub.items.data[0].price.unit_amount === 9990, `price ${sub.items.data[0].price.unit_amount}`);
    hCookie = await session("contractor", happy.id);
    expect((await portalOpen(hCookie)) === 200, "portal locked during trial");
  });
  await check("trial ends → $99.90 charged → webhook marks active (signed via CLI)", async () => {
    await advance(hClock.id, 31);
    await waitFor("billing_status active", async () => (await row("contractors", happy.id)).billing_status === "active");
    const inv = await stripe.invoices.list({ subscription: (await row("contractors", happy.id)).billing_subscription_id, status: "paid" });
    expect(inv.data.some((i) => i.amount_paid === 9990), "no paid $99.90 invoice");
    expect((await portalOpen(hCookie)) === 200, "portal locked while active");
  });
  await check("replace a healthy card → old card detached, plan on new card, next renewal charged to it", async () => {
    const before = await row("contractors", happy.id);
    const { activate } = await saveCardViaPortal(hCookie, "pm_card_mastercard");
    expect(activate.status === 200 && activate.body.billing.card?.last4 === "4444" && activate.body.billing.status === "active", JSON.stringify(activate.body));
    const after = await row("contractors", happy.id);
    expect((await stripe.paymentMethods.retrieve(before.billing_payment_method_id)).customer === null, "old card still attached");
    const sub = await stripe.subscriptions.retrieve(after.billing_subscription_id);
    expect(sub.default_payment_method === after.billing_payment_method_id, "subscription not on the new card");
    await advance(hClock.id, 32);
    const inv = await waitFor("renewal on new card", async () => {
      const list = await stripe.invoices.list({ subscription: after.billing_subscription_id, status: "paid", limit: 1, expand: ["data.payments"] });
      const i = list.data[0];
      return i && i.created > sub.created + 86400 ? i : null;
    });
    const pi = (inv as any).payments?.data?.[0]?.payment?.payment_intent;
    if (pi) {
      const intent = await stripe.paymentIntents.retrieve(typeof pi === "string" ? pi : pi.id);
      expect(intent.payment_method === after.billing_payment_method_id, `charged ${intent.payment_method}`);
    }
  });
  await check("cancel at period end → resume → cancel again", async () => {
    let r = await call("POST", "/api/contractor/billing/cancel", { cookie: hCookie, body: {} });
    expect(r.body?.billing?.cancel_at_period_end === true, JSON.stringify(r.body));
    r = await call("POST", "/api/contractor/billing/cancel", { cookie: hCookie, body: { resume: true } });
    expect(r.body?.billing?.cancel_at_period_end === false, JSON.stringify(r.body));
    r = await call("POST", "/api/contractor/billing/cancel", { cookie: hCookie, body: {} });
    expect(r.body?.billing?.cancel_at_period_end === true, "second cancel");
    expect((await portalOpen(hCookie)) === 200, "cancel must keep access until period end");
  });
  await check("period ends → canceled → portal paused (402)", async () => {
    await advance(hClock.id, 32);
    await waitFor("canceled", async () => (await row("contractors", happy.id)).billing_status === "canceled");
    expect((await portalOpen(hCookie)) === 402, "portal should be paused");
  });
  await check("rejoin with a card → billed immediately (no second free period) → unlocked", async () => {
    const { activate } = await saveCardViaPortal(hCookie, "pm_card_mastercard");
    expect(activate.status === 200, JSON.stringify(activate));
    const k = await waitFor("active again", async () => {
      const r = await row("contractors", happy.id);
      return r.billing_status === "active" ? r : null;
    });
    const sub = await stripe.subscriptions.retrieve(k.billing_subscription_id);
    expect(!sub.trial_end, "second trial granted");
    expect((await portalOpen(hCookie)) === 200, "still locked after rejoin");
  });
  await check("admin custom price $120 → next cycle at $120 (no proration)", async () => {
    const r = await call("PATCH", `/api/admin/contractors/${happy.id}/billing`, { cookie: adminCookie, body: { price_cents: 12000 } });
    expect(r.status === 200 && r.body.billing.price_cents === 12000, JSON.stringify(r));
    await advance(hClock.id, 32); // past the renewal + Stripe's ~1h finalization delay
    const subId = (await row("contractors", happy.id)).billing_subscription_id;
    await waitFor("$120 invoice paid", async () => (await stripe.invoices.list({ subscription: subId, status: "paid" })).data.some((i) => i.amount_paid === 12000));
  });
  await check("admin drawer lists real invoices with receipts + PDFs", async () => {
    const d = await call("GET", `/api/admin/billing/contractor/${happy.id}`, { cookie: adminCookie });
    expect(d.status === 200, JSON.stringify(d.body));
    const paid = (d.body.invoices as any[]).filter((i) => i.status === "paid" && i.amount_paid > 0);
    expect(paid.length >= 2, `paid invoices ${paid.length}`);
    expect(paid.every((i) => i.receipt_url && i.pdf_url && i.refundable), JSON.stringify(paid[0]));
  });
  await check("admin refund: $20 partial, then the rest; over-refund refused", async () => {
    const d = await call("GET", `/api/admin/billing/contractor/${happy.id}`, { cookie: adminCookie });
    const inv = (d.body.invoices as any[]).find((i) => i.amount_paid === 12000);
    expect(inv, "no $120 invoice");
    let r = await call("POST", `/api/admin/billing/contractor/${happy.id}/refund`, { cookie: adminCookie, body: { invoice_id: inv.id, amount_cents: 2000, reason: "e2e partial" } });
    expect(r.status === 200 && r.body.refund.status === "succeeded", JSON.stringify(r.body));
    r = await call("POST", `/api/admin/billing/contractor/${happy.id}/refund`, { cookie: adminCookie, body: { invoice_id: inv.id, amount_cents: 20000, reason: "e2e too much" } });
    expect(r.status === 400, `over-refund ${r.status}`);
    r = await call("POST", `/api/admin/billing/contractor/${happy.id}/refund`, { cookie: adminCookie, body: { invoice_id: inv.id, reason: "e2e rest" } });
    expect(r.status === 200 && r.body.refund.amount_cents === 10000, JSON.stringify(r.body));
    const after = await call("GET", `/api/admin/billing/contractor/${happy.id}`, { cookie: adminCookie });
    const same = (after.body.invoices as any[]).find((i) => i.id === inv.id);
    expect(same.amount_refunded === 12000 && !same.refundable, JSON.stringify(same));
  });
  await check("admin add 10 free days → Stripe moves the next charge, no proration", async () => {
    const before = await stripe.subscriptions.retrieve((await row("contractors", happy.id)).billing_subscription_id);
    const nextBefore = before.items.data[0].current_period_end;
    const r = await call("POST", `/api/admin/billing/contractor/${happy.id}/extend`, { cookie: adminCookie, body: { days: 10, reason: "e2e courtesy" } });
    expect(r.status === 200 && r.body.billing.status === "trialing", JSON.stringify(r.body));
    const sub = await stripe.subscriptions.retrieve(before.id);
    expect(sub.trial_end === nextBefore + 10 * 86400, `trial_end ${sub.trial_end} vs ${nextBefore + 10 * 86400}`);
    expect((await portalOpen(hCookie)) === 200, "paused after extension");
  });
  await check("admin waive → plan canceled, portal stays open", async () => {
    const r = await call("PATCH", `/api/admin/contractors/${happy.id}/billing`, { cookie: adminCookie, body: { price_cents: 0 } });
    expect(r.status === 200 && r.body.billing.waived && !r.body.locked, JSON.stringify(r.body));
    const sub = await stripe.subscriptions.retrieve((await row("contractors", happy.id)).billing_subscription_id);
    expect(sub.status === "canceled", `sub ${sub.status}`);
    expect((await portalOpen(hCookie)) === 200, "waived contractor locked");
  });

  console.log("\nAdmin — manual start with a secure card link");
  const man = await ins(
    `INSERT INTO contractors (email, first_name, last_name, status, preferred_language, activated_at) VALUES (?, 'Mia', 'Manual', 'active', 'en', NOW())`,
    [em("manual")],
  );
  await check("card link at $50, no free days → member adds card → charged $50 now; link then dead", async () => {
    const r = await call("POST", `/api/admin/billing/contractor/${man}/card-link`, { cookie: adminCookie, body: { price_cents: 5000, free_days: 0, note: "e2e" } });
    expect(r.status === 201, JSON.stringify(r.body));
    // The emailed token is only in the dry-run mail; mint one the same way for the test.
    const token = crypto.randomBytes(32).toString("hex");
    await db.execute(`UPDATE billing_card_links SET token_hash = ? WHERE member_role = 'contractor' AND member_id = ? AND used_at IS NULL AND revoked_at IS NULL`, [sha(token), man]);
    const view = await call("GET", `/api/public/billing-link/${token}`);
    expect(view.body?.billing?.price_cents === 5000 && view.body.billing.trial_days === 0, JSON.stringify(view.body));
    const s = await call("POST", `/api/public/billing-link/${token}/setup`);
    const c = await confirmCard(s.body.client_secret, "pm_card_visa");
    const a = await call("POST", `/api/public/billing-link/${token}/activate`, { body: { setup_intent_id: c.id } });
    expect(a.status === 200 && a.body.billing.status === "active" && a.body.billing.price_cents === 5000, JSON.stringify(a.body));
    const k = await row("contractors", man);
    const inv = await stripe.invoices.list({ subscription: k.billing_subscription_id, status: "paid" });
    expect(inv.data.some((i) => i.amount_paid === 5000), "no $50 charge");
    expect((await call("GET", `/api/public/billing-link/${token}`)).status === 404, "link reusable");
  });
  await check("admin cancel now → canceled in Stripe, portal paused", async () => {
    const r = await call("POST", `/api/admin/billing/contractor/${man}/cancel`, { cookie: adminCookie, body: { when: "now", reason: "e2e" } });
    expect(r.status === 200 && r.body.billing.status === "canceled" && r.body.locked === true, JSON.stringify(r.body));
    const sub = await stripe.subscriptions.retrieve((await row("contractors", man)).billing_subscription_id);
    expect(sub.status === "canceled", sub.status);
  });

  console.log("\nContractor — card declines and authentication");
  const dec = await newApplicant("declines");
  await check("generic decline at save → nothing stored, activate refused", async () => {
    const { confirm, activate } = await saveCardViaApplication(dec.base, "pm_card_chargeDeclined");
    expect(confirm.error === "card_declined", `confirm ${JSON.stringify(confirm)}`);
    expect(activate.status === 409 && activate.body?.error === "errors.cardNotConfirmed", JSON.stringify(activate));
    expect(!(await row("contractors", dec.id)).billing_card_last4, "card stored after decline");
  });
  for (const [pm, code] of [
    ["pm_card_chargeDeclinedInsufficientFunds", "card_declined"],
    ["pm_card_chargeDeclinedExpiredCard", "expired_card"],
    ["pm_card_chargeDeclinedIncorrectCvc", "incorrect_cvc"],
  ] as const) {
    await check(`${pm.replace("pm_card_chargeDeclined", "") || "decline"} at save → refused (${code})`, async () => {
      const { confirm, activate } = await saveCardViaApplication(dec.base, pm);
      expect(confirm.error === code, `confirm ${JSON.stringify(confirm)}`);
      expect(activate.status === 409, `activate ${activate.status}`);
    });
  }
  await check("3-D Secure card at save → requires action → not saved until authenticated", async () => {
    const { confirm, activate } = await saveCardViaApplication(dec.base, "pm_card_authenticationRequired");
    expect(confirm.status === "requires_action", `confirm ${JSON.stringify(confirm)}`);
    expect(activate.status === 409, `activate ${activate.status}`);
  });

  const fail = await newApplicant("renewfail");
  const fClock = await clockFor("renewfail");
  await attachClockCustomer("contractors", fail.id, em("renewfail"), fClock.id);
  let fCookie = "";
  await check("card that saves but fails to charge: trial ends → past_due → portal paused", async () => {
    const { activate } = await saveCardViaApplication(fail.base, "pm_card_chargeCustomerFail");
    expect(activate.status === 200, JSON.stringify(activate));
    expect((await approve(adminCookie, fail.id)).status === 200, "approve");
    fCookie = await session("contractor", fail.id);
    await advance(fClock.id, 31);
    await waitFor("past_due", async () => (await row("contractors", fail.id)).billing_status === "past_due");
    const r = await call("GET", "/api/contractor/projects", { cookie: fCookie });
    expect(r.status === 402 && r.body?.error === "errors.billingRequired", JSON.stringify(r));
    const me = await call("GET", "/api/contractor/billing", { cookie: fCookie });
    expect(me.body?.locked === true, "billing route should say locked");
    expect((await call("GET", "/api/contractor/application", { cookie: fCookie })).status === 200, "application should stay open");
  });
  await check("replacement card that also declines → 402 cardChargeFailed, still paused", async () => {
    const { activate } = await saveCardViaPortal(fCookie, "pm_card_chargeCustomerFail");
    expect(activate.status === 402 && activate.body?.error === "errors.cardChargeFailed", JSON.stringify(activate));
    expect((await portalOpen(fCookie)) === 402, "unlocked with a failing card");
  });
  await check("good replacement card → open invoice paid now → unlocked", async () => {
    const { activate } = await saveCardViaPortal(fCookie, "pm_card_visa");
    expect(activate.status === 200 && activate.body?.locked === false, JSON.stringify(activate.body));
    expect((await portalOpen(fCookie)) === 200, "still paused after paying");
  });

  console.log("\nContractor — denial, existing contractors, deleted customer");
  const den = await newApplicant("denied");
  await check("denied application → saved card detached, never charged", async () => {
    await saveCardViaApplication(den.base, "pm_card_visa");
    const pm = (await row("contractors", den.id)).billing_payment_method_id;
    expect((await approve(adminCookie, den.id, "denied")).status === 200, "deny");
    const after = await stripe.paymentMethods.retrieve(pm);
    expect(!after.customer, "payment method still attached");
    expect(!(await row("contractors", den.id)).billing_card_last4, "card shown after denial");
    const subs = await stripe.subscriptions.list({ customer: (await row("contractors", den.id)).billing_customer_id });
    expect(subs.data.length === 0, "subscription exists");
  });
  const old = await ins(`INSERT INTO contractors (email, first_name, last_name, status, preferred_language, activated_at) VALUES (?, 'Olga', 'Existing', 'active', 'en', NOW())`, [em("existing")]);
  const oCookie = await session("contractor", old);
  await check("existing active contractor without card → paused; card → trial starts now → open", async () => {
    expect((await portalOpen(oCookie)) === 402, "should be paused");
    const { activate } = await saveCardViaPortal(oCookie, "pm_card_visa");
    expect(activate.status === 200 && activate.body.billing.status === "trialing" && !activate.body.locked, JSON.stringify(activate.body));
  });
  await check("customer deleted in the dashboard → next card setup recovers with a new customer", async () => {
    const before = (await row("contractors", old)).billing_customer_id;
    await stripe.customers.del(before);
    const { activate } = await saveCardViaPortal(oCookie, "pm_card_visa");
    const after = await row("contractors", old);
    expect(activate.status === 200 && after.billing_customer_id && after.billing_customer_id !== before, JSON.stringify(activate));
    expect(activate.body.billing.status === "active", `free period granted again: ${activate.body.billing.status}`);
    await stripe.customers.update(after.billing_customer_id, { metadata: { gw_e2e: prefix } });
  });

  console.log("\nAffiliate — card while pending, trial from approval");
  const aff = await ins(
    `INSERT INTO affiliates (email, first_name, last_name, status, referral_code, slug, subscription_price_cents) VALUES (?, 'Ari', 'Pending', 'pending', ?, ?, 1999)`,
    [em("aff"), `E2E${crypto.randomBytes(4).toString("hex").toUpperCase()}`, `${prefix}ari`],
  );
  await db.execute(
    `INSERT INTO affiliate_agreements (affiliate_id, template_version, lang, status, legal_name, address, email, subscription_price_cents, body_sha256, signature_image)
     VALUES (?, 2, 'en', 'signed', 'Ari Pending', '1 Test Way, Fontana, CA', ?, 1999, ?, 'data:image/png;base64,AA==')`,
    [aff, em("aff"), sha("e2e")],
  );
  const aCookie = await session("affiliate", aff);
  const aClock = await clockFor("aff");
  await attachClockCustomer("affiliates", aff, em("aff"), aClock.id);
  // Pending affiliates use the onboarding link; the session works once approved.
  const linkToken = crypto.randomBytes(32).toString("hex");
  await db.execute(`INSERT INTO affiliate_onboarding_links (affiliate_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 DAY)`, [aff, sha(linkToken)]);
  const ot = { "x-onboarding-token": linkToken };
  await check("pending affiliate saves a card → no subscription yet", async () => {
    const s = await call("POST", "/api/affiliate/onboarding/billing/setup", { headers: ot });
    const c = await confirmCard(s.body.client_secret, "pm_card_chargeCustomerFail");
    const a = await call("POST", "/api/affiliate/onboarding/billing/activate", { headers: ot, body: { setup_intent_id: c.id } });
    expect(a.status === 200 && a.body.billing.awaiting_approval && a.body.billing.status === "none", JSON.stringify(a.body));
  });
  await check("staff approve → 90-day trial at $19.99 starts", async () => {
    const r = await call("PATCH", `/api/admin/affiliates/${aff}`, { cookie: adminCookie, body: { status: "active" } });
    expect(r.status === 200, JSON.stringify(r));
    const a = await row("affiliates", aff);
    const sub = await stripe.subscriptions.retrieve(a.billing_subscription_id);
    const days = Math.round(((sub.trial_end || 0) - (sub.trial_start || 0)) / 86400);
    expect(sub.status === "trialing" && days === 90 && sub.items.data[0].price.unit_amount === 1999, `status ${sub.status} ${days}d ${sub.items.data[0].price.unit_amount}`);
  });
  await check("affiliate renewal fails → past_due → portal paused, payouts held, link still public", async () => {
    await advance(aClock.id, 91);
    await waitFor("affiliate past_due", async () => (await row("affiliates", aff)).billing_status === "past_due");
    const r = await call("GET", "/api/affiliate/clients", { cookie: aCookie });
    expect(r.status === 402 && r.body?.error === "errors.billingRequired", JSON.stringify(r));
    const st = await call("GET", "/api/affiliate/billing/status", { cookie: aCookie });
    expect(st.body?.locked === true, JSON.stringify(st.body));
    const ob = await call("GET", "/api/affiliate/onboarding?lang=en", { cookie: aCookie });
    expect(ob.body?.state?.payout_ready === false, "payouts not held");
    const a = await row("affiliates", aff);
    expect((await call("GET", `/api/public/affiliates/by-code/${a.referral_code}`)).status === 200, "public link broken");
  });
  await check("affiliate updates the card → open invoice paid → portal reopens, old card detached", async () => {
    const before = (await row("affiliates", aff)).billing_payment_method_id;
    const s = await call("POST", "/api/affiliate/onboarding/billing/setup", { cookie: aCookie });
    const c = await confirmCard(s.body.client_secret, "pm_card_visa");
    const a = await call("POST", "/api/affiliate/onboarding/billing/activate", { cookie: aCookie, body: { setup_intent_id: c.id } });
    expect(a.status === 200 && a.body.billing.status === "active", JSON.stringify(a.body));
    expect((await call("GET", "/api/affiliate/clients", { cookie: aCookie })).status === 200, "still paused");
    expect((await stripe.paymentMethods.retrieve(before)).customer === null, "old card still attached");
    expect((await call("POST", "/api/affiliate/billing/cancel", { cookie: aCookie, body: {} })).status === 200, "affiliate cancel");
  });

  console.log("\nWebhooks");
  await check("bad signature → 400; no signature + forged id → 400", async () => {
    const bad = await fetch(`${BASE}/api/webhooks/billing`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=bad" }, body: "{}" });
    expect(bad.status === 400, `bad sig ${bad.status}`);
    const forged = await call("POST", "/api/webhooks/billing", { body: { id: "not_an_event" } });
    expect(forged.status === 400, `forged ${forged.status}`);
  });
  await check("events arrived signed via the CLI, and a replayed event is processed only once", async () => {
    const [[n]] = (await db.query(`SELECT COUNT(*) n FROM billing_webhook_events WHERE processed_at > NOW() - INTERVAL 2 HOUR`)) as any;
    expect(Number(n.n) > 5, `only ${n.n} events processed`);
    const [[last]] = (await db.query(`SELECT event_id FROM billing_webhook_events ORDER BY id DESC LIMIT 1`)) as any;
    const replay = await call("POST", "/api/webhooks/billing", { body: { id: last.event_id } });
    expect(replay.status === 200, `replay ${replay.status}`);
    const [[c]] = (await db.query(`SELECT COUNT(*) n FROM billing_webhook_events WHERE event_id = ?`, [last.event_id])) as any;
    expect(Number(c.n) === 1, `rows ${c.n}`);
  });
}

async function cleanup() {
  for (const id of clocks) {
    try {
      await stripe.testHelpers.testClocks.del(id);
    } catch (e: any) {
      console.warn("clock cleanup:", e?.message);
    }
  }
  for await (const c of stripe.customers.search({ query: `metadata['gw_e2e']:'${prefix}'` })) {
    try {
      await stripe.customers.del(c.id);
    } catch {
      /* already gone with its clock */
    }
  }
  // Customers the app created itself (no clock) + leftovers from interrupted runs: every gwstripe- fixture.
  for await (const c of stripe.customers.list({ limit: 100 })) {
    if (String(c.email || "").startsWith("gwstripe-")) await stripe.customers.del(c.id).catch(() => undefined);
  }
  for await (const c of stripe.testHelpers.testClocks.list({ limit: 100 })) {
    if (String(c.name || "").startsWith("gwstripe-")) await stripe.testHelpers.testClocks.del(c.id).catch(() => undefined);
  }
  await cleanupPortalFixturesByPrefix(db, prefix);
  await db.end();
}

try {
  // E2E_SWEEP_ONLY=1: just remove leftovers from earlier runs.
  if (!process.env.E2E_SWEEP_ONLY) await main();
} catch (e: any) {
  results.push({ name: "setup", ok: false, detail: e?.message });
  console.error(e);
} finally {
  await cleanup();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed${bad.length ? ` — failed: ${bad.map((b) => b.name).join("; ")}` : ""}`);
  process.exitCode = bad.length ? 1 : 0;
}
