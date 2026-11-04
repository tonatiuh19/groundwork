import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { __testClearEmailDryRuns, __testGetEmailDryRuns, __testSetBillingApi, createServer, runLegalNotices, runTrialEndingReminders } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";
import { makeFakeBilling } from "./testFakeBilling";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

describe.runIf(hasDb)("legal pages: drafts → publish, public pages, signup acceptance, re-acceptance, free-period reminder, call notice", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwlegal-${stamp}-`;
  // Only this suite sees legal versions tagged with its prefix (never the real pages, never other suites).
  process.env.GW_LEGAL_TEST_PREFIX = prefix;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const ph = (n: number) => `+1555${String(stamp + n).slice(-7)}`;
  const ins = async (sql: string, p: unknown[]) => Number(((await db.execute(sql, p as any[])) as any)[0].insertId);
  const one = async (sql: string, p: unknown[]) => ((await db.query(sql, p as any[])) as any)[0][0];
  const cookies: Record<string, string> = {};
  const base = 6_000_000 + (stamp % 900_000);
  const body = (s: string) => `# ${s}\n\nAffiliates pay {{affiliate_price}} per month after {{affiliate_free_days}} free days. Contractors pay {{contractor_price}} after {{contractor_free_days}}.\n\nEffective date: {{effective_date}}\n\n## Section\n\n- See the [Refund & Cancellation Policy](/refund-policy).`;
  // Effective "today" in California (a future date would only schedule the version).
  const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const longDate = (lang: string) =>
    new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "long", day: "numeric" }).format(new Date(`${TODAY}T12:00:00Z`));
  let veteranId = 0;
  let veteranCookie = "";

  beforeAll(async () => {
    process.env.VITEST = "true";
    for (const [who, role] of [["super", "super_admin"], ["admin", "admin"], ["agent", "agent"]] as const) {
      const id = await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, ?, 'Legal', ?, 'active')`, [em(who), who, role]);
      const t = crypto.randomBytes(32).toString("hex");
      await db.execute(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [id, crypto.createHash("sha256").update(t).digest("hex")]);
      cookies[who] = `gw_admin_sid=${t}`;
    }
    for (const slug of ["terms", "privacy", "refunds"]) {
      await db.execute(`INSERT INTO legal_documents (slug, version, status, title_en, title_es, body_en, body_es, notes) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)`, [
        slug,
        base,
        `Test ${slug}`,
        `Prueba ${slug}`,
        body(`Test ${slug}`),
        body(`Prueba ${slug}`),
        `${prefix}seed`,
      ]);
    }
    // An existing affiliate (signed up before the Terms existed) with a portal session.
    veteranId = await ins(`INSERT INTO affiliates (email, first_name, last_name, phone, status, referral_code) VALUES (?, 'Vera', 'Veteran', ?, 'active', ?)`, [
      em("veteran"),
      ph(1),
      `L${crypto.randomBytes(5).toString("hex").toUpperCase()}`,
    ]);
    const t = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO affiliate_sessions (affiliate_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [veteranId, crypto.createHash("sha256").update(t).digest("hex")]);
    veteranCookie = `gw_affiliate_sid=${t}`;
  });

  afterAll(async () => {
    __testSetBillingApi(null);
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      delete process.env.GW_LEGAL_TEST_PREFIX;
      await db.end();
    }
  });

  it("before publishing: public pages say 'being updated', signups don't need the checkbox, members aren't asked", async () => {
    const r = await request(app).get("/api/public/legal/terms").expect(404);
    expect(r.body.error).toBe("errors.legalNotPublished");
    const st = await request(app).get("/api/public/legal-status").expect(200);
    expect(st.body.versions).toEqual({ terms: null, privacy: null, refunds: null });
    await request(app).post("/api/public/affiliate/signup").send({ first_name: "Pre", last_name: "Terms", email: em("pre"), phone: ph(2) }).expect(201);
    const pend = await request(app).get("/api/affiliate/legal/pending").set("Cookie", veteranCookie).expect(200);
    expect(pend.body.pending).toEqual([]);
  });

  it("admins edit the draft; only a super admin publishes, with a valid effective date", async () => {
    const list = await request(app).get("/api/admin/legal").set("Cookie", cookies.agent).expect(200);
    expect(list.body.can_edit).toBe(false);
    const terms = list.body.docs.find((d: any) => d.slug === "terms");
    expect(terms.draft.version).toBe(base);
    expect(list.body.live_fields.en.affiliate_price).toMatch(/^\$\d/);
    await request(app).put("/api/admin/legal/terms/draft").set("Cookie", cookies.agent).send({}).expect(403);
    const short = await request(app).put("/api/admin/legal/terms/draft").set("Cookie", cookies.admin).send({ title_en: "T", title_es: "T", body_en: "x", body_es: "x" });
    expect(short.body.error).toBe("validation.legalBody");
    await request(app)
      .put("/api/admin/legal/terms/draft")
      .set("Cookie", cookies.admin)
      .send({ title_en: "Terms of Service", title_es: "Términos de Servicio", body_en: body("Terms of Service"), body_es: body("Términos de Servicio"), notes: "escape attempt" })
      .expect(200);
    // Notes edits can't take a test version out of the test scope.
    expect((await one(`SELECT notes FROM legal_documents WHERE slug = 'terms' AND version = ?`, [base])).notes).toBe(`${prefix}seed`);
    await request(app).post("/api/admin/legal/terms/publish").set("Cookie", cookies.admin).send({ effective_date: TODAY, requires_reacceptance: true }).expect(403);
    const bad = await request(app).post("/api/admin/legal/terms/publish").set("Cookie", cookies.super).send({ effective_date: "Nov 1" });
    expect(bad.body.error).toBe("validation.legalEffectiveDate");
    for (const slug of ["terms", "privacy", "refunds"]) {
      await request(app).post(`/api/admin/legal/${slug}/publish`).set("Cookie", cookies.super).send({ effective_date: TODAY, requires_reacceptance: slug !== "privacy" }).expect(200);
    }
    await request(app).put("/api/admin/legal/terms/draft").set("Cookie", cookies.admin).send({ title_en: "Terms", title_es: "Términos", body_en: body("Terms"), body_es: body("Términos") }).expect(409); // no draft left
  });

  it("public pages fill live fields (prices, free days, effective date) in each language", async () => {
    const en = await request(app).get("/api/public/legal/terms?lang=en").expect(200);
    expect(en.body).toMatchObject({ slug: "terms", version: base, title: "Terms of Service", effective_date: TODAY });
    expect(en.body.body).not.toContain("{{");
    expect(en.body.body).toMatch(/\$\d[\d,.]* per month after \d+ free days/);
    expect(en.body.body).toContain(longDate("en"));
    const es = await request(app).get("/api/public/legal/refund-policy?lang=es").expect(200);
    expect(es.body).toMatchObject({ slug: "refunds", title: "Prueba refunds" });
    expect(es.body.body).toContain(longDate("es"));
    const st = await request(app).get("/api/public/legal-status").expect(200);
    expect(st.body.versions).toEqual({ terms: base, privacy: base, refunds: base });
  });

  it("signups now require the checkbox and record which versions were accepted", async () => {
    const no = await request(app).post("/api/public/affiliate/signup").send({ first_name: "No", last_name: "Accept", email: em("noacc"), phone: ph(3) });
    expect(no.status).toBe(400);
    expect(no.body.error).toBe("validation.acceptTerms");
    await request(app).post("/api/public/affiliate/signup").send({ first_name: "Yes", last_name: "Accept", email: em("yes"), phone: ph(4), accept_terms: true }).expect(201);
    const affId = Number((await one(`SELECT id FROM affiliates WHERE email = ?`, [em("yes")])).id);
    const rows = ((await db.query(`SELECT slug, version, context, ip FROM legal_acceptances WHERE person_kind = 'affiliate' AND person_id = ? ORDER BY slug`, [affId])) as any)[0];
    expect(rows.map((r: any) => `${r.slug}:${r.version}:${r.context}`).sort()).toEqual([`privacy:${base}:signup`, `refunds:${base}:signup`, `terms:${base}:signup`]);
    const ctr = await request(app).post("/api/public/contractor/signup").send({ first_name: "Con", last_name: "Tractor", email: em("ctr"), phone: ph(5), company: `${prefix}Co` });
    expect(ctr.body.error).toBe("validation.acceptTerms");
    const partner = await request(app).post("/api/public/partner-referral").send({ full_name: "Par Tner", email: em("partner"), phone: ph(6) });
    expect(partner.body.error).toBe("validation.acceptTerms");
  });

  it("existing members accept once in the portal; a 'must accept again' version asks again, a minor one doesn't", async () => {
    const pend = await request(app).get("/api/affiliate/legal/pending").set("Cookie", veteranCookie).expect(200);
    expect(pend.body.pending.map((p: any) => p.slug).sort()).toEqual(["refunds", "terms"]);
    await request(app).post("/api/affiliate/legal/accept").set("Cookie", veteranCookie).send({}).expect(400);
    await request(app).post("/api/affiliate/legal/accept").set("Cookie", veteranCookie).send({ accept: true }).expect(200);
    expect((await request(app).get("/api/affiliate/legal/pending").set("Cookie", veteranCookie)).body.pending).toEqual([]);

    // Minor change to the Refund policy: no new acceptance needed.
    await request(app).post("/api/admin/legal/refunds/draft").set("Cookie", cookies.admin).expect(201);
    await request(app).post("/api/admin/legal/refunds/publish").set("Cookie", cookies.super).send({ effective_date: TODAY, requires_reacceptance: false }).expect(200);
    expect((await request(app).get("/api/affiliate/legal/pending").set("Cookie", veteranCookie)).body.pending).toEqual([]);
    // Material change to the Terms: asked again; the old version is archived (kept as proof).
    await request(app).post("/api/admin/legal/terms/draft").set("Cookie", cookies.admin).expect(201);
    await request(app).post("/api/admin/legal/terms/publish").set("Cookie", cookies.super).send({ effective_date: TODAY, requires_reacceptance: true }).expect(200);
    const again = await request(app).get("/api/affiliate/legal/pending").set("Cookie", veteranCookie).expect(200);
    expect(again.body.pending).toEqual([expect.objectContaining({ slug: "terms", version: base + 1, path: "/terms" })]);
    expect((await one(`SELECT status FROM legal_documents WHERE slug = 'terms' AND version = ?`, [base])).status).toBe("archived");
    const admin = await request(app).get("/api/admin/legal").set("Cookie", cookies.super).expect(200);
    const terms = admin.body.docs.find((d: any) => d.slug === "terms");
    expect(terms.versions.find((v: any) => v.version === base).accepted_count).toBeGreaterThanOrEqual(2);
  });

  it("future effective date: scheduled (current version stays live), members notified weekly once, then it switches on by itself", async () => {
    const future = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    await request(app).post("/api/admin/legal/privacy/draft").set("Cookie", cookies.admin).expect(201);
    await request(app)
      .post("/api/admin/legal/privacy/publish")
      .set("Cookie", cookies.super)
      .send({ effective_date: future, requires_reacceptance: false, notify_members: true })
      .expect(200);
    // Still the old version publicly and for signups.
    const pub = await request(app).get("/api/public/legal/privacy").expect(200);
    expect(pub.body.version).toBe(base);
    expect((await request(app).get("/api/public/legal-status")).body.versions.privacy).toBe(base);
    const admin = await request(app).get("/api/admin/legal").set("Cookie", cookies.super).expect(200);
    const privacy = admin.body.docs.find((d: any) => d.slug === "privacy");
    expect(privacy.published.version).toBe(base);
    expect(privacy.scheduled).toMatchObject({ version: base + 1, status: "scheduled", effective_date: future });
    expect(admin.body.member_count).toBeGreaterThan(0);

    // Weekly notice: only fixture members, once each, in their language.
    __testClearEmailDryRuns();
    const first = await runLegalNotices(prefix);
    expect(first.legal_notices).toBeGreaterThanOrEqual(2);
    const mails = __testGetEmailDryRuns().filter((m: any) => String(m.to).startsWith(prefix));
    expect(mails.length).toBe(first.legal_notices);
    expect(mails.every((m: any) => /updating our Prueba privacy|Test privacy|Actualizamos/.test(m.subject))).toBe(true);
    expect(await runLegalNotices(prefix)).toEqual({ legal_notices: 0 });
    expect(await runLegalNotices(null)).toEqual({ legal_notices: 0 }); // tests never reach real members
    // Cron requires the secret.
    await request(app).get("/api/cron/legal-notices").expect(401);

    // When the date arrives it switches on with no further action.
    await db.execute(`UPDATE legal_documents SET effective_date = CURDATE() - INTERVAL 1 DAY WHERE slug = 'privacy' AND version = ?`, [base + 1]);
    expect((await request(app).get("/api/public/legal/privacy")).body.version).toBe(base + 1);
  });

  it("free period ending: one reminder (email + text) about 7 days before the first charge, never twice", async () => {
    __testSetBillingApi(makeFakeBilling());
    const now = new Date();
    const ends = new Date(now.getTime() + 6 * 86_400_000);
    const id = await ins(
      `INSERT INTO affiliates (email, first_name, last_name, phone, status, referral_code, billing_status, billing_trial_ends_at, billing_card_brand, billing_card_last4, subscription_price_cents, sms_marketing_consent)
       VALUES (?, 'Tri', 'Al', ?, 'active', ?, 'trialing', ?, 'visa', '4242', 1999, 1)`,
      [em("trial"), ph(7), `T${crypto.randomBytes(5).toString("hex").toUpperCase()}`, ends],
    );
    // Not yet in the window (20 days out): nothing.
    const far = await ins(
      `INSERT INTO affiliates (email, first_name, last_name, status, referral_code, billing_status, billing_trial_ends_at, subscription_price_cents) VALUES (?, 'Far', 'Out', 'active', ?, 'trialing', ?, 1999)`,
      [em("far"), `F${crypto.randomBytes(5).toString("hex").toUpperCase()}`, new Date(now.getTime() + 20 * 86_400_000)],
    );
    __testClearEmailDryRuns();
    expect(await runTrialEndingReminders(now, prefix)).toEqual({ trial_reminders: 1 });
    const mail = __testGetEmailDryRuns().find((m: any) => m.to === em("trial"));
    expect(mail?.subject).toMatch(/^Your free period ends /);
    expect(String((mail as any).html)).toContain("$19.99");
    expect(String((mail as any).html)).toContain("VISA •••• 4242");
    expect(await runTrialEndingReminders(now, prefix)).toEqual({ trial_reminders: 0 });
    expect((await one(`SELECT billing_trial_reminder_sent_at s FROM affiliates WHERE id = ?`, [id])).s).toBeTruthy();
    expect((await one(`SELECT billing_trial_reminder_sent_at s FROM affiliates WHERE id = ?`, [far])).s).toBeNull();
    // Without a fixture scope, a test run never touches real members.
    expect(await runTrialEndingReminders(now)).toEqual({ trial_reminders: 0 });
  });

  it("recorded calls: the person who answers hears the recording notice in English and Spanish", async () => {
    const r = await request(app).post("/api/voice/recording-notice").expect(200);
    expect(r.headers["content-type"]).toContain("xml");
    expect(r.text).toContain("This call may be recorded");
    expect(r.text).toContain("Esta llamada puede ser grabada");
    const out = await request(app).post("/api/voice/twiml").send({ To: "+15555550199", From: "client:admin_1" }).expect(200);
    expect(out.text).toContain('record="record-from-answer-dual"');
    expect(out.text).toMatch(/<Number url="[^"]*\/api\/voice\/recording-notice"/);
  });
});
