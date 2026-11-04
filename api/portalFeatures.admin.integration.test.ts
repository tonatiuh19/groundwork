// Part 3 of portalFeatures (see portalFeatures.integration.test.ts).
import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import request from "supertest";
import {
  __test,
  __testClearEmailDryRuns,
  __testClearSmsDryRuns,
  __testGetEmailDryRuns,
  __testGetSmsDryRuns,
  addDaysIso,
  computeProjectEconomics,
  createServer,
  resolveAffiliateCommissionSplit,
  resolveCommissionCents,
  __testSetNotifyRouting,
} from "./index";
import {
  cleanupPortalFixturesByPrefix,
  createIntegrationTestPool,
  withSystemSettingsLock,
} from "./testDbCleanup";
import { ADMIN_PERMS } from "../shared/api";

// Unique-per-run test phones: the one-person-per-phone rule must never match other suites or real rows.
const RUN_PHONE = String(100 + Math.floor(Math.random() * 900));
const ph = (last4: string) => `949${RUN_PHONE}${last4}`;

const app = createServer();
const db = createIntegrationTestPool();
const prefix = `gwfeata-${Date.now()}-`;
const em = (name: string) => `${prefix}${name}@example.com`;

type Actor = "admin" | "affiliate" | "contractor" | "client";

async function makeSession(actor: Actor, id: number): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  await db.execute(
    `INSERT INTO \`${actor}_sessions\` (\`${actor}_id\`, token_hash, expires_at) VALUES (?, ?, ?)`,
    [
      id,
      crypto.createHash("sha256").update(token).digest("hex"),
      new Date(Date.now() + 86_400_000),
    ],
  );
  return `gw_${actor}_sid=${token}`;
}

/** Agreement Section 2: payouts need a signed agreement + W-9 on file + an active plan (card on file). */
async function markOnboarded(affiliateId: number): Promise<void> {
  await db.execute(`UPDATE affiliates SET billing_status = 'trialing' WHERE id = ?`, [affiliateId]);
  await db.execute(
    `INSERT INTO affiliate_agreements
       (affiliate_id, template_version, lang, legal_name, address, email, subscription_price_cents, body_sha256, signature_image)
     VALUES (?, 1, 'en', 'Test Affiliate', '1 Test Way, Irvine, CA', 'fixture@example.com', 0, REPEAT('a', 64), 'data:image/png;base64,AA==')`,
    [affiliateId],
  );
  await db.execute(
    `INSERT INTO affiliate_w9s
       (affiliate_id, legal_name, tax_classification, tin_type, tin_last4, address, city_state_zip, pdf_blob_pathname)
     VALUES (?, 'Test Affiliate', 'individual', 'ssn', '0000', '1 Test Way', 'Irvine, CA 92618', 'affiliates/test/w9.pdf')`,
    [affiliateId],
  );
}

async function insertId(sql: string, params: any[]): Promise<number> {
  const [r] = await db.execute(sql, params);
  return Number((r as { insertId: number }).insertId);
}

const as = (cookie: string) => ({
  get: (u: string) => request(app).get(u).set("Cookie", cookie),
  post: (u: string) => request(app).post(u).set("Cookie", cookie),
  patch: (u: string) => request(app).patch(u).set("Cookie", cookie),
  put: (u: string) => request(app).put(u).set("Cookie", cookie),
  delete: (u: string) => request(app).delete(u).set("Cookie", cookie),
});

describe("portal features: staff, settings, notifications (integration)", () => {
  let superCookie = "";
  let agentCookie = "";
  let financeCookie = "";
  let contentCookie = "";
  let superId = 0;
  let financeId = 0;
  let affId = 0;
  let affCookie = "";
  let affCode = "";
  let ctrId = 0;
  let ctrCookie = "";
  let clientId = 0;
  let clientCookie = "";
  let otherClientCookie = "";
  let publicId = "";
  let planId = 0;
  // Live catalog values (plans get renamed/resized in prod — never hardcode them).
  let planSqFt = 0;
  let planName = "";
  let directRate = 0;
  const planCommission = () => planSqFt * directRate;

  beforeAll(async () => {
    process.env.VITEST = "true";
    __testClearEmailDryRuns();
    const mkAdmin = (name: string, role: string) =>
      insertId(
        `INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, ?, 'Test', ?, 'active')`,
        [em(name), name, role],
      );
    superId = await mkAdmin("super", "super_admin");
    const agentId = await mkAdmin("agent", "agent");
    financeId = await mkAdmin("finance", "finance");
    const contentId = await mkAdmin("content", "content");
    superCookie = await makeSession("admin", superId);
    agentCookie = await makeSession("admin", agentId);
    financeCookie = await makeSession("admin", financeId);
    contentCookie = await makeSession("admin", contentId);

    affCode = crypto.randomBytes(4).toString("hex").toUpperCase();
    affId = await insertId(
      `INSERT INTO affiliates (email, first_name, last_name, status, referral_code) VALUES (?, 'Ada', 'Affiliate', 'active', ?)`,
      [em("aff"), affCode],
    );
    affCookie = await makeSession("affiliate", affId);

    ctrId = await insertId(
      `INSERT INTO contractors (email, first_name, last_name, company, status) VALUES (?, 'Cole', 'Builder', 'Cole Builds', 'active')`,
      [em("ctr")],
    );
    ctrCookie = await makeSession("contractor", ctrId);

    clientId = await insertId(
      `INSERT INTO clients (email, first_name, last_name, status, affiliate_id) VALUES (?, 'Hana', 'Homeowner', 'prospect', ?)`,
      [em("client"), affId],
    );
    clientCookie = await makeSession("client", clientId);
    const otherId = await insertId(
      `INSERT INTO clients (email, first_name, last_name, status) VALUES (?, 'Olga', 'Other', 'prospect')`,
      [em("other")],
    );
    otherClientCookie = await makeSession("client", otherId);

    const [plans] = await db.query(
      `SELECT id, sq_ft, name FROM adu_plans WHERE code = 'fontana-1br' LIMIT 1`,
    );
    const plan = (plans as { id: number; sq_ft: number; name: string }[])[0];
    planId = Number(plan.id);
    planSqFt = Number(plan.sq_ft);
    planName = String(plan.name);
    const [rate] = await db.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'commission_direct_cents_per_sqft'`,
    );
    directRate = Number((rate as any[])[0]?.setting_value || 1000);
  });

  afterAll(async () => {
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
      __testClearEmailDryRuns();
    }
  });

  it("rejects inactive affiliate assignment on client and project", async () => {
    const inactiveAff = await insertId(
      `INSERT INTO affiliates (email, first_name, last_name, status, referral_code) VALUES (?, 'Ina', 'Active', 'inactive', ?)`,
      [em("inactive-aff"), crypto.randomBytes(4).toString("hex").toUpperCase()],
    );

    const create = await as(agentCookie)
      .post("/api/admin/clients")
      .send({
        email: em("aff-inactive-client"),
        first_name: "No",
        last_name: "Affiliate",
        affiliate_id: inactiveAff,
      });
    expect(create.status).toBe(400);
    expect(create.body.error).toBe("errors.affiliateInactive");

    const patchClient = await as(agentCookie)
      .patch(`/api/admin/clients/${clientId}`)
      .send({ affiliate_id: inactiveAff });
    expect(patchClient.status).toBe(400);
    expect(patchClient.body.error).toBe("errors.affiliateInactive");

    // Separate unlocked project (publicId may already be loan-finalized / locked)
    const unlockedClient = await insertId(
      `INSERT INTO clients (email, first_name, last_name, status) VALUES (?, 'Una', 'Locked', 'prospect')`,
      [em("unlocked-client")],
    );
    const unlocked = await as(superCookie)
      .post("/api/admin/projects")
      .send({ client_id: unlockedClient, adu_plan_id: planId });
    expect(unlocked.status).toBe(201);
    const patchProject = await as(superCookie)
      .patch(`/api/admin/projects/${unlocked.body.project_public_id}`)
      .send({ affiliate_id: inactiveAff });
    expect(patchProject.status).toBe(400);
    expect(patchProject.body.error).toBe("errors.affiliateInactive");
  });

  it("paginates people list (clients) with total/limit/offset", async () => {
    // Ensure at least two fixture clients exist for a second page
    await insertId(
      `INSERT INTO clients (email, first_name, last_name, status) VALUES (?, 'Page', 'Two', 'prospect')`,
      [em("page-two")],
    );
    const q = encodeURIComponent(prefix);
    const page0 = await as(financeCookie).get(
      `/api/admin/clients?q=${q}&limit=1&offset=0`,
    );
    expect(page0.status).toBe(200);
    expect(page0.body.limit).toBe(1);
    expect(page0.body.offset).toBe(0);
    expect(typeof page0.body.total).toBe("number");
    expect(page0.body.total).toBeGreaterThanOrEqual(2);
    expect(page0.body.clients).toHaveLength(1);

    const page1 = await as(financeCookie).get(
      `/api/admin/clients?q=${q}&limit=1&offset=1`,
    );
    expect(page1.status).toBe(200);
    expect(page1.body.limit).toBe(1);
    expect(page1.body.offset).toBe(1);
    expect(page1.body.total).toBe(page0.body.total);
    expect(page1.body.clients).toHaveLength(1);
    expect(page1.body.clients[0].id).not.toBe(page0.body.clients[0].id);
  });

  it("CRUD notify extra emails for settings-capable admin", async () => {
    expect((await as(agentCookie).get("/api/admin/settings")).status).toBe(403);

    const before = await as(financeCookie).get("/api/admin/settings");
    expect(before.status).toBe(200);
    expect(Array.isArray(before.body.notify_extra_emails)).toBe(true);

    const email = em("notify-extra");
    const created = await as(financeCookie)
      .post("/api/admin/settings/notify-extras")
      .send({ email, label: "Ops pager", events: ["client_created"] });
    expect(created.status).toBe(201);
    expect(created.body.id).toBeGreaterThan(0);
    const extraId = Number(created.body.id);

    const listed = await as(superCookie).get("/api/admin/settings");
    expect(
      listed.body.notify_extra_emails.some(
        (r: { id: number; email: string }) =>
          r.id === extraId && r.email === email,
      ),
    ).toBe(true);

    const listedRow = listed.body.notify_extra_emails.find(
      (r: { id: number }) => r.id === extraId,
    );
    expect(listedRow.events).toEqual(["client_created"]);
    expect(Array.isArray(listed.body.notify_event_keys)).toBe(true);
    expect(listed.body.notify_event_keys).toContain("inbound_sms");

    const eventsPatch = await as(financeCookie)
      .patch(`/api/admin/settings/notify-extras/${extraId}`)
      .send({ events: ["draw_submitted", "milestone_changed"] });
    expect(eventsPatch.status).toBe(200);
    const afterEvents = (
      await as(financeCookie).get("/api/admin/settings")
    ).body.notify_extra_emails.find((r: { id: number }) => r.id === extraId);
    expect(afterEvents.events).toEqual(
      expect.arrayContaining(["draw_submitted", "milestone_changed"]),
    );
    expect(afterEvents.events).toHaveLength(2);

    const allEvents = await as(financeCookie)
      .patch(`/api/admin/settings/notify-extras/${extraId}`)
      .send({ events: null });
    expect(allEvents.status).toBe(200);
    const afterAll = (
      await as(financeCookie).get("/api/admin/settings")
    ).body.notify_extra_emails.find((r: { id: number }) => r.id === extraId);
    expect(afterAll.events).toBeNull();

    const toggled = await as(financeCookie)
      .patch(`/api/admin/settings/notify-extras/${extraId}`)
      .send({ is_active: false });
    expect(toggled.status).toBe(200);
    const afterToggle = (
      await as(financeCookie).get("/api/admin/settings")
    ).body.notify_extra_emails.find((r: { id: number }) => r.id === extraId);
    expect(afterToggle.is_active).toBe(false);

    const removed = await as(financeCookie).delete(
      `/api/admin/settings/notify-extras/${extraId}`,
    );
    expect(removed.status).toBe(200);
    expect(
      (
        await as(financeCookie).get("/api/admin/settings")
      ).body.notify_extra_emails.some((r: { id: number }) => r.id === extraId),
    ).toBe(false);
  });

  it("lists team notify recipients and updates staff prefs", async () => {
    expect(
      (await as(agentCookie).get("/api/admin/notify-recipients")).status,
    ).toBe(403);

    const recipients = await as(financeCookie).get(
      "/api/admin/notify-recipients",
    );
    expect(recipients.status).toBe(200);
    expect(Array.isArray(recipients.body.staff)).toBe(true);
    expect(Array.isArray(recipients.body.extras)).toBe(true);
    expect(recipients.body.events).toContain("lead_submitted");
    expect(recipients.body.staff.length).toBeGreaterThan(0);

    const target = recipients.body.staff.find(
      (s: { email: string }) => typeof s.email === "string",
    );
    expect(target?.id).toBeGreaterThan(0);
    expect(target.prefs.email.lead_submitted).toBe(true);
    expect(target.channels.email.available).toBe(true);

    const off = await as(financeCookie)
      .put(`/api/admin/admins/${target.id}/notification-prefs`)
      .send({ email: { lead_submitted: false } });
    expect(off.status).toBe(200);
    expect(off.body.staff.prefs.email.lead_submitted).toBe(false);

    const masterOff = await as(financeCookie)
      .put(`/api/admin/admins/${target.id}/notification-prefs`)
      .send({ channel_masters: { email: false } });
    expect(masterOff.status).toBe(200);
    expect(masterOff.body.staff.prefs.email.client_created).toBe(false);

    // Restore defaults for other tests
    const restore = await as(financeCookie)
      .put(`/api/admin/admins/${target.id}/notification-prefs`)
      .send({ channel_masters: { email: true, in_app: true } });
    expect(restore.status).toBe(200);
    expect(restore.body.staff.prefs.email.lead_submitted).toBe(true);

    const badEvents = await as(financeCookie)
      .post("/api/admin/settings/notify-extras")
      .send({ email: em("bad-events"), events: "not-an-array" });
    expect(badEvents.status).toBe(400);

    const defaultExtra = await as(financeCookie)
      .post("/api/admin/settings/notify-extras")
      .send({ email: em("default-extra"), label: "Ops" });
    expect(defaultExtra.status).toBe(201);
    const defaultId = Number(defaultExtra.body.id);
    const defaultRow = (
      await as(financeCookie).get("/api/admin/notify-recipients")
    ).body.extras.find((r: { id: number }) => r.id === defaultId);
    expect(Array.isArray(defaultRow.events)).toBe(true);
    expect(defaultRow.events).not.toContain("inbound_sms");
    expect(defaultRow.events).toContain("client_created");
    await as(financeCookie).delete(
      `/api/admin/settings/notify-extras/${defaultId}`,
    );
  });

  it("skips staff email when notification prefs mute the event", async () => {
    const financeEmail = em("finance");
    await as(financeCookie)
      .put(`/api/admin/admins/${financeId}/notification-prefs`)
      .send({ email: { affiliate_signup: false } });

    __testClearEmailDryRuns();
    const body = {
      first_name: "Muted",
      last_name: "Prefs",
      email: em("muted-aff"),
      phone: ph("9999"),
      company: "Mute Co",
      preferred_language: "en",
    };
    const res = await request(app)
      .post("/api/public/affiliate/signup")
      .send(body);
    expect(res.status).toBe(201);
    const sent = __testGetEmailDryRuns();
    expect(sent.some((m) => m.to === financeEmail)).toBe(false);
    expect(sent.some((m) => m.to === em("super"))).toBe(true);

    // Restore
    await as(financeCookie)
      .put(`/api/admin/admins/${financeId}/notification-prefs`)
      .send({ email: { affiliate_signup: true } });
  });

  it("self-service prefs, in-app inbox, and team SMS fan-out", async () => {
    // Alerts are routed by area now: send every area to this finance fixture (in memory, never the shared table).
    __testSetNotifyRouting(
      Object.fromEntries(
        (["leads", "clients", "contractors", "affiliates", "projects", "system"] as const).map((a) => [a, { adminIds: [financeId], includeOwner: true }]),
      ),
    );
    onTestFinished(() => __testSetNotifyRouting(null));
    const mePrefs = await as(financeCookie).get(
      "/api/admin/me/notification-prefs",
    );
    expect(mePrefs.status).toBe(200);
    expect(mePrefs.body.prefs.email.lead_submitted).toBe(true);
    expect(mePrefs.body.channels.email.available).toBe(true);
    expect(Array.isArray(mePrefs.body.events)).toBe(true);

    const muteInApp = await as(financeCookie)
      .put("/api/admin/me/notification-prefs")
      .send({ in_app: { affiliate_signup: false } });
    expect(muteInApp.status).toBe(200);
    expect(muteInApp.body.prefs.in_app.affiliate_signup).toBe(false);

    await db.execute(`DELETE FROM admin_notifications WHERE admin_id = ?`, [
      financeId,
    ]);

    __testClearEmailDryRuns();
    const mutedBody = {
      first_name: "InApp",
      last_name: "Mute",
      email: em("inapp-mute-aff"),
      phone: ph("8888"),
      company: "InApp Mute Co",
      preferred_language: "en",
    };
    expect(
      (await request(app).post("/api/public/affiliate/signup").send(mutedBody))
        .status,
    ).toBe(201);

    const mutedInbox = await as(financeCookie).get(
      "/api/admin/me/notifications?limit=10",
    );
    expect(mutedInbox.status).toBe(200);
    expect(
      mutedInbox.body.notifications.some(
        (n: { event_key: string }) => n.event_key === "affiliate_signup",
      ),
    ).toBe(false);

    await as(financeCookie)
      .put("/api/admin/me/notification-prefs")
      .send({ in_app: { affiliate_signup: true } });

    // Clear again — parallel suites may have fan-out notifyStaff to this admin.
    await db.execute(`DELETE FROM admin_notifications WHERE admin_id = ?`, [
      financeId,
    ]);

    __testClearEmailDryRuns();
    const openBody = {
      first_name: "InApp",
      last_name: "Open",
      email: em("inapp-open-aff"),
      phone: `949${String(Date.now()).slice(-7)}`,
      company: "InApp Open Co",
      preferred_language: "en",
    };
    expect(
      (await request(app).post("/api/public/affiliate/signup").send(openBody))
        .status,
    ).toBe(201);

    const inbox = await as(financeCookie).get("/api/admin/me/notifications");
    expect(inbox.status).toBe(200);
    const hit = inbox.body.notifications.find(
      (n: { event_key: string; read_at: string | null }) =>
        n.event_key === "affiliate_signup" && n.read_at == null,
    );
    expect(hit?.id).toBeGreaterThan(0);
    expect(inbox.body.unread_count).toBeGreaterThan(0);

    const marked = await as(financeCookie)
      .post("/api/admin/me/notifications/read")
      .send({ ids: [hit.id] });
    expect(marked.status).toBe(200);
    const after = await as(financeCookie).get("/api/admin/me/notifications");
    const hitAfter = after.body.notifications.find(
      (n: { id: number }) => n.id === hit.id,
    );
    // Assert the row was marked read (unread_count can race when parallel suites
    // notifyStaff fan-out to this admin between GET and POST /read).
    expect(hitAfter?.read_at).toBeTruthy();
    expect(marked.body.unread_count).toBeLessThanOrEqual(
      inbox.body.unread_count,
    );

    // SMS fan-out: personal phone + assigned brand From
    const ofgE164 = `+1555${String(Date.now()).slice(-7)}`;
    const personalPhone = "+15559876099";
    await db.execute(`UPDATE admins SET phone = ? WHERE id = ?`, [
      personalPhone,
      financeId,
    ]);
    const phoneNumberId = await insertId(
      `INSERT INTO admin_phone_numbers
         (e164, friendly_name, assigned_admin_id, is_active, capabilities_json)
       VALUES (?, 'Vitest Notify SMS', ?, 1, JSON_OBJECT('sms', TRUE, 'voice', TRUE))`,
      [ofgE164, financeId],
    );

    try {
      const smsMeta = await as(financeCookie).get(
        "/api/admin/me/notification-prefs",
      );
      expect(smsMeta.body.channels.sms.available).toBe(true);

      await as(financeCookie)
        .put("/api/admin/me/notification-prefs")
        .send({
          channel_masters: { sms: true },
          email: { affiliate_signup: false },
          in_app: { affiliate_signup: false },
        });

      __testClearSmsDryRuns();
      const smsBody = {
        first_name: "Sms",
        last_name: "Fanout",
        email: em("sms-fanout-aff"),
        phone: ph("6666"),
        company: "SMS Fanout Co",
        preferred_language: "en",
      };
      expect(
        (await request(app).post("/api/public/affiliate/signup").send(smsBody))
          .status,
      ).toBe(201);
      const smsSent = __testGetSmsDryRuns();
      expect(
        smsSent.some(
          (m) =>
            m.from === ofgE164 &&
            (m.to.includes("5559876099") || m.to.includes(personalPhone)),
        ),
      ).toBe(true);
    } finally {
      await as(financeCookie)
        .put("/api/admin/me/notification-prefs")
        .send({
          channel_masters: { email: true, in_app: true, sms: true },
        });
      await db
        .execute(`DELETE FROM admin_phone_numbers WHERE id = ?`, [
          phoneNumberId,
        ])
        .catch(() => {});
      await db
        .execute(`UPDATE admins SET phone = NULL WHERE id = ?`, [financeId])
        .catch(() => {});
      await db
        .execute(`DELETE FROM admin_notifications WHERE admin_id = ?`, [
          financeId,
        ])
        .catch(() => {});
    }
  });
});
