import "dotenv/config";
import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { __testClearEmailDryRuns, __testClearSmsDryRuns, __testGetEmailDryRuns, __testGetSmsDryRuns, createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

/** Sign-in by text code (every portal) and homeowners added without an email (portal link by text). */
describe.skipIf(!hasDb)("phone sign-in + phone-only homeowners (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwphone-${stamp}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const ph = (n: number) => `+1555${String(stamp + n).slice(-7)}`;
  const ins = async (sql: string, p: unknown[]) => Number(((await db.execute(sql, p as any[])) as any)[0].insertId);
  const one = async (sql: string, p: unknown[]) => ((await db.query(sql, p as any[])) as any)[0][0];
  let affCookie = "";

  beforeAll(async () => {
    process.env.VITEST = "true";
    const affId = await ins(`INSERT INTO affiliates (email, first_name, last_name, phone, status, referral_code) VALUES (?, 'Ana', 'Phone', ?, 'active', ?)`, [
      em("aff"),
      ph(1),
      `PH${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
    ]);
    const t = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO affiliate_sessions (affiliate_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [affId, crypto.createHash("sha256").update(t).digest("hex")]);
    affCookie = `gw_affiliate_sid=${t}`;
  });

  afterAll(async () => {
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("text code: request by phone texts the code (never logged), verify by phone signs in; a shared number is refused", async () => {
    __testClearSmsDryRuns();
    await request(app).post("/api/affiliate/auth/otp/request").send({ phone: ph(1) }).expect(200);
    const sms = (__testGetSmsDryRuns() as any[]).find((m) => m.to.endsWith(ph(1).slice(-10)));
    const code = String(sms?.body || "").match(/\b(\d{6})\b/)?.[1];
    expect(code).toMatch(/^\d{6}$/);
    // Sign-in codes never land in the person's message history.
    expect(await one(`SELECT COUNT(*) n FROM automatic_messages WHERE body_preview LIKE ?`, [`%${code}%`])).toMatchObject({ n: 0 });
    await request(app).post("/api/affiliate/auth/otp/verify").send({ phone: ph(1), code: "000000" }).expect(401);
    const ok = await request(app).post("/api/affiliate/auth/otp/verify").send({ phone: `(${ph(1).slice(2, 5)}) ${ph(1).slice(5, 8)}-${ph(1).slice(8)}`, code }).expect(200);
    expect(String([].concat(ok.headers["set-cookie"] as never).join(";"))).toMatch(/gw_affiliate_sid=/);
    // Two live accounts on one number: use your email instead.
    await ins(`INSERT INTO affiliates (email, first_name, last_name, phone, status, referral_code) VALUES (?, 'Twin', 'Phone', ?, 'active', ?)`, [
      em("twin"),
      ph(1),
      `PT${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
    ]);
    const shared = await request(app).post("/api/affiliate/auth/otp/request").send({ phone: ph(1) }).expect(409);
    expect(shared.body.error).toBe("errors.phoneShared");
    // Email sign-in is unchanged (and its code isn't logged either).
    __testClearEmailDryRuns();
    await request(app).post("/api/affiliate/auth/otp/request").send({ email: em("aff") }).expect(200);
    expect(__testGetEmailDryRuns().some((m: any) => [].concat(m.to).includes(em("aff") as never))).toBe(true);
  });

  it("affiliate adds a homeowner with no email: needs text consent, invite link goes by text, client has no email", async () => {
    const body = {
      first_name: `${prefix}Pia`,
      last_name: "Phoneonly",
      email: "",
      phone: ph(2),
      property_address: "12 Test Lane, Fontana",
      homeowner_consent: true,
      preferred_language: "en",
    };
    const refused = await request(app).post("/api/affiliate/clients").set("Cookie", affCookie).send(body).expect(400);
    expect(refused.body.error).toBe("validation.smsConsentNoEmail");
    __testClearSmsDryRuns();
    __testClearEmailDryRuns();
    const r = await request(app).post("/api/affiliate/clients").set("Cookie", affCookie).send({ ...body, sms_consent: true }).expect(201);
    const client = await one(`SELECT id, email, sms_marketing_consent FROM clients WHERE id = (SELECT client_id FROM projects WHERE public_id = ?)`, [r.body.project_public_id]);
    expect(client).toMatchObject({ email: null, sms_marketing_consent: 1 });
    const invite = (__testGetSmsDryRuns() as any[]).find((m) => m.to.endsWith(ph(2).slice(-10)) && /\/client\/invite\//.test(m.body));
    expect(invite).toBeTruthy();
    expect(__testGetEmailDryRuns().some((m: any) => /Open your ADU project portal/.test(m.subject))).toBe(false);
    // Email only (no phone) is fine too; neither is refused.
    const emailOnly = await request(app).post("/api/affiliate/clients").set("Cookie", affCookie).send({ ...body, first_name: "Eli", email: em("emailonly"), phone: "" }).expect(201);
    expect(await one(`SELECT email, phone FROM clients WHERE id = (SELECT client_id FROM projects WHERE public_id = ?)`, [emailOnly.body.project_public_id])).toMatchObject({ email: em("emailonly"), phone: null });
    const neither = await request(app).post("/api/affiliate/clients").set("Cookie", affCookie).send({ ...body, phone: "", sms_consent: true }).expect(400);
    expect(neither.body.error).toBe("validation.emailOrPhoneOne");
    // The homeowner can then sign in by text too.
    await db.execute(`UPDATE clients SET status = 'prospect' WHERE id = ?`, [client.id]);
    await request(app).post("/api/client/auth/otp/request").send({ phone: ph(2) }).expect(200);
  });

  it("admin adds a homeowner with only a phone; with neither email nor phone it is refused", async () => {
    const admin = await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Ph', 'Admin', 'super_admin', 'active')`, [em("admin")]);
    const t = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [admin, crypto.createHash("sha256").update(t).digest("hex")]);
    const cookie = `gw_admin_sid=${t}`;
    const none = await request(app).post("/api/admin/clients").set("Cookie", cookie).send({ first_name: "No", last_name: "Contact" }).expect(400);
    expect(none.body.error).toBe("validation.emailOrPhoneOne");
    const r = await request(app).post("/api/admin/clients").set("Cookie", cookie).send({ first_name: `${prefix}Ph`, last_name: "Only", phone: ph(3), send_invite: false }).expect(201);
    expect(await one(`SELECT email, phone FROM clients WHERE id = ?`, [r.body.client_id])).toMatchObject({ email: null });
  });
});
