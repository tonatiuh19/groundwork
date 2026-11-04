import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { __testClearEmailDryRuns, __testClearSmsDryRuns, __testGetEmailDryRuns, __testGetSmsDryRuns, createServer, leadRoleFromReply } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

describe.runIf(hasDb)("staff audit: invites, lead delete, lenders, automatic messages, templates, A/B/C replies", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwstaff-${stamp}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const ph = (n: number) => `+1555${String(stamp + n).slice(-7)}`;
  const ins = async (sql: string, p: unknown[]) => Number(((await db.execute(sql, p as any[])) as any)[0].insertId);
  const one = async (sql: string, p: unknown[]) => ((await db.query(sql, p as any[])) as any)[0][0];
  const cookies: Record<string, string> = {};
  let lineE164 = "";

  beforeAll(async () => {
    process.env.VITEST = "true";
    for (const [who, role] of [["super", "super_admin"], ["agent", "agent"]] as const) {
      const id = await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, ?, 'Audit', ?, 'active')`, [em(who), who, role]);
      const t = crypto.randomBytes(32).toString("hex");
      await db.execute(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [id, crypto.createHash("sha256").update(t).digest("hex")]);
      cookies[who] = `gw_admin_sid=${t}`;
      if (who === "super") {
        lineE164 = ph(1);
        await ins(`INSERT INTO admin_phone_numbers (e164, friendly_name, assigned_admin_id, is_active, is_primary, capabilities_json) VALUES (?, 'Audit line', ?, 1, 0, JSON_OBJECT('sms', TRUE))`, [lineE164, id]);
      }
    }
  });

  afterAll(async () => {
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("clients added by staff get their portal invite by email + text (unless unchecked), logged as automatic", async () => {
    __testClearEmailDryRuns();
    __testClearSmsDryRuns();
    const r = await request(app).post("/api/admin/clients").set("Cookie", cookies.super).send({ first_name: "Ina", last_name: "Vite", email: em("ina"), phone: ph(2) }).expect(201);
    expect(r.body.invite_sent).toBe(true);
    expect(__testGetEmailDryRuns().some((m: any) => m.to === em("ina") && /portal/i.test(m.subject))).toBe(true);
    expect((__testGetSmsDryRuns() as any[]).some((m) => m.to === ph(2) && m.body.includes("/client/invite/"))).toBe(true);
    // Logged on the record and in their thread with the "automatic" flag.
    const list = await request(app).get(`/api/admin/people/client/${r.body.client_id}/automatic-messages`).set("Cookie", cookies.super).expect(200);
    expect(list.body.messages.map((m: any) => m.channel).sort()).toEqual(["email", "sms"]);
    const auto = await one(
      `SELECT m.metadata_json FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.client_id = ? AND m.channel = 'sms' ORDER BY m.id DESC LIMIT 1`,
      [r.body.client_id],
    );
    const meta = typeof auto.metadata_json === "string" ? JSON.parse(auto.metadata_json) : auto.metadata_json;
    expect(meta.automatic).toBe(true);

    __testClearEmailDryRuns();
    const quiet = await request(app).post("/api/admin/clients").set("Cookie", cookies.super).send({ first_name: "No", last_name: "Invite", email: em("noinv"), send_invite: false }).expect(201);
    expect(quiet.body.invite_sent).toBe(false);
    expect(__testGetEmailDryRuns().some((m: any) => m.to === em("noinv"))).toBe(false);
  });

  it("leads can be deleted (preview + confirm, super admin / admin only)", async () => {
    const leadId = await ins(`INSERT INTO leads (full_name, email, phone, status) VALUES ('Del Lead', ?, ?, 'new')`, [em("dellead"), ph(3)]);
    await request(app).get(`/api/admin/people/lead/${leadId}/erase-preview`).set("Cookie", cookies.agent).expect(403);
    const pv = await request(app).get(`/api/admin/people/lead/${leadId}/erase-preview`).set("Cookie", cookies.super).expect(200);
    expect(pv.body.person).toMatchObject({ entity: "lead", name: "Del Lead" });
    await request(app).delete(`/api/admin/people/lead/${leadId}`).set("Cookie", cookies.super).send({ confirm: true, reason: "test" }).expect(200);
    expect(await one(`SELECT COUNT(*) n FROM leads WHERE id = ?`, [leadId])).toMatchObject({ n: 0 });
  });

  it("partners say Realtor (DRE #) / Lender (NMLS #); approved lenders join the Lenders directory", async () => {
    const noDre = await request(app).post("/api/public/affiliate/signup").send({ first_name: "Rea", last_name: "Tor", email: em("rea"), phone: ph(4), partner_type: "realtor", company: "Rea Realty" });
    expect(noDre.body.error).toBe("validation.dreRequired");
    await request(app)
      .post("/api/public/affiliate/signup")
      .send({ first_name: "Len", last_name: "Der", email: em("len"), phone: ph(5), partner_type: "lender", company: `${prefix}Lend Co`, license_number: "NMLS 123456" })
      .expect(201);
    const aff = await one(`SELECT id, partner_type, license_number, lender_id FROM affiliates WHERE email = ?`, [em("len")]);
    expect(aff).toMatchObject({ partner_type: "lender", license_number: "NMLS 123456", lender_id: null });
    await request(app).patch(`/api/admin/affiliates/${aff.id}`).set("Cookie", cookies.super).send({ status: "active" }).expect(200);
    const lender = await one(`SELECT l.company, l.nmls_number, l.affiliate_id FROM lenders l JOIN affiliates a ON a.lender_id = l.id WHERE a.id = ?`, [aff.id]);
    expect(lender).toMatchObject({ company: `${prefix}Lend Co`, nmls_number: "NMLS 123456", affiliate_id: aff.id });
  });

  it("a client's lender flows to its projects; projects follow the directory (Anchor → anchor type)", async () => {
    const clientId = await ins(`INSERT INTO clients (first_name, last_name, email, status) VALUES ('Lo', 'Ans', ?, 'prospect')`, [em("loans")]);
    const pub = `GW-S${String(stamp).slice(-6)}`;
    await ins(`INSERT INTO projects (public_id, client_id) VALUES (?, ?)`, [pub, clientId]);
    const anchor = await ins(`INSERT INTO lenders (company, contact_name, phone, email) VALUES (?, 'Ann Chor', '9515550000', ?)`, [`${prefix}Anchor Loans`, em("anchor")]);
    await request(app).patch(`/api/admin/clients/${clientId}`).set("Cookie", cookies.super).send({ lender_id: anchor }).expect(200);
    expect(await one(`SELECT lender_id, loan_lender_type, loan_lender_name FROM projects WHERE public_id = ?`, [pub])).toMatchObject({
      lender_id: anchor,
      loan_lender_type: "anchor",
      loan_lender_name: `${prefix}Anchor Loans`,
    });
    const detail = await request(app).get(`/api/admin/clients/${clientId}`).set("Cookie", cookies.super).expect(200);
    expect(detail.body.client).toMatchObject({ lender_id: anchor, lender_contact: "Ann Chor" });
  });

  it("email templates: separate from SMS ones, need a subject", async () => {
    const bad = await request(app).post("/api/admin/conversation-templates").set("Cookie", cookies.super).send({ title: `${prefix}Welcome`, channel: "email", body_en: "Hi {{first_name}}" });
    expect(bad.body.error).toBe("validation.mailSubject");
    await request(app)
      .post("/api/admin/conversation-templates")
      .set("Cookie", cookies.super)
      .send({ title: `${prefix}Welcome`, channel: "email", subject_en: "Welcome {{first_name}}", body_en: "Hi {{first_name}}" })
      .expect(201);
    const sms = await request(app).get("/api/admin/conversation-templates").set("Cookie", cookies.super).expect(200);
    expect(sms.body.templates.some((x: any) => x.title === `${prefix}Welcome`)).toBe(false);
    const mail = await request(app).get("/api/admin/conversation-templates?channel=email").set("Cookie", cookies.super).expect(200);
    expect(mail.body.templates.find((x: any) => x.title === `${prefix}Welcome`)).toMatchObject({ channel: "email", subject_en: "Welcome {{first_name}}" });
  });

  it("A/B/C: replies are understood in English and Spanish", () => {
    expect(leadRoleFromReply("A")).toBe("homeowner");
    expect(leadRoleFromReply(" b. ")).toBe("partner");
    expect(leadRoleFromReply("Contratista")).toBe("contractor");
    expect(leadRoleFromReply("Afiliado")).toBe("partner");
    expect(leadRoleFromReply("Dueño")).toBe("homeowner");
    expect(leadRoleFromReply("I want to know about B and C options")).toBeNull();
  });

  it("A/B/C: an event with no automation sends nothing; the event's own automation texts A/B/C and a B reply sends the affiliate link", async () => {
    const eventId = await ins(
      `INSERT INTO marketing_events (slug, title_en, title_es, city, starts_at, status, registration_opens_at) VALUES (?, 'Audit ADU event', 'Evento', 'Fontana', NOW() + INTERVAL 5 DAY, 'published', NOW() - INTERVAL 1 DAY)`,
      [`${prefix}event`],
    );
    // No automation picked: no built-in welcome by text or email.
    __testClearSmsDryRuns();
    __testClearEmailDryRuns();
    const quiet = ph(11);
    const q = await request(app)
      .post("/api/public/leads")
      .send({ full_name: "Quinn Quiet", email: em("quinn"), phone: quiet, property_address: "2 Test Way, Fontana", mode: "event", event_id: eventId, preferred_language: "en", sms_marketing_consent: true })
      .expect(201);
    expect((__testGetSmsDryRuns() as any[]).some((m) => m.to === quiet)).toBe(false);
    expect(__testGetEmailDryRuns().some((m: any) => m.to === em("quinn") && /Thank you for registering/.test(m.subject))).toBe(false);
    expect(await one(`SELECT role_prompt_sent_at FROM leads WHERE id = ?`, [q.body.lead_id])).toMatchObject({ role_prompt_sent_at: null });

    // Staff pick an Event RSVP automation on the event (other triggers are refused).
    const flow = await request(app)
      .post("/api/admin/flows")
      .set("Cookie", cookies.super)
      .send({
        name: `${prefix}RSVP welcome`,
        trigger_event: "event_rsvp",
        quiet_start_hour: 0,
        quiet_end_hour: 24,
        steps: [
          { step_key: "trigger", step_type: "trigger", label: "T", config: {}, position_x: 0, position_y: 0 },
          { step_key: "sms", step_type: "send_sms", label: "S", config: { body_en: "Hi {{first_name}}! Reply A. Homeowner, B. Affiliate / Referral Partner or C. Contractor." }, position_x: 0, position_y: 0 },
        ],
        edges: [{ source_key: "trigger", target_key: "sms", edge_type: "next" }],
      })
      .expect(201);
    const flowId = flow.body.flow.id;
    const other = await request(app).post("/api/admin/flows").set("Cookie", cookies.super).send({ name: `${prefix}Other`, trigger_event: "affiliate_signup" }).expect(201);
    await request(app).patch(`/api/admin/events/${eventId}`).set("Cookie", cookies.super).send({ rsvp_flow_id: other.body.flow.id }).expect(400);
    const picked = await request(app).patch(`/api/admin/events/${eventId}`).set("Cookie", cookies.super).send({ rsvp_flow_id: flowId }).expect(200);
    expect(picked.body.event?.rsvp_flow_id ?? (await one(`SELECT rsvp_flow_id FROM marketing_events WHERE id = ?`, [eventId])).rsvp_flow_id).toBe(flowId);
    const opts = await request(app).get("/api/admin/events/rsvp-flows").set("Cookie", cookies.super).expect(200);
    expect(opts.body.flows.some((f: any) => f.id === flowId && f.is_active === false)).toBe(true);

    // Picked but still off: nothing is sent.
    const off = ph(12);
    await request(app)
      .post("/api/public/leads")
      .send({ full_name: "Olive Off", email: em("olive"), phone: off, property_address: "3 Test Way, Fontana", mode: "event", event_id: eventId, preferred_language: "en", sms_marketing_consent: true })
      .expect(201);
    expect((__testGetSmsDryRuns() as any[]).some((m) => m.to === off)).toBe(false);

    await request(app).patch(`/api/admin/flows/${flowId}/active`).set("Cookie", cookies.super).send({ active: true }).expect(200);
    __testClearSmsDryRuns();
    __testClearEmailDryRuns();
    const phone = ph(6);
    const r = await request(app)
      .post("/api/public/leads")
      .send({ full_name: "Eve Rsvp", email: em("eve"), phone, property_address: "1 Test Way, Fontana", mode: "event", event_id: eventId, preferred_language: "en", sms_marketing_consent: true })
      .expect(201);
    const prompt = (__testGetSmsDryRuns() as any[]).find((m) => m.to === phone);
    expect(String(prompt?.body)).toMatch(/Hi Eve! Reply A\. Homeowner/);

    // The automation text marks the lead, so a short A / B / C reply is recognized.
    __testClearSmsDryRuns();
    const lead = await one(`SELECT role_token, role_prompt_sent_at FROM leads WHERE id = ?`, [r.body.lead_id]);
    expect(lead.role_token).toMatch(/^[a-f0-9]{32}$/);

    await request(app).post("/api/webhooks/twilio/sms").type("form").send({ From: phone, To: lineE164, Body: "B", MessageSid: `SM${crypto.randomBytes(8).toString("hex")}` }).expect(200);
    expect(await one(`SELECT role_answer FROM leads WHERE id = ?`, [r.body.lead_id])).toMatchObject({ role_answer: "partner" });
    const reply = (__testGetSmsDryRuns() as any[]).find((m) => m.to === phone && m.body.includes("/affiliate/signup?t="));
    expect(reply).toBeTruthy();

    const pre = await request(app).get(`/api/public/lead-prefill/${lead.role_token}`).expect(200);
    expect(pre.body.prefill).toMatchObject({ first_name: "Eve", last_name: "Rsvp", email: em("eve"), phone });
    // Email buttons: first answer wins, then they're sent to the matching form.
    const btn = await request(app).get(`/api/public/lead-role/${lead.role_token}/contractor`).expect(302);
    expect(btn.headers.location).toBe(`/contractor/signup?t=${lead.role_token}`);
    expect(await one(`SELECT role_answer FROM leads WHERE id = ?`, [r.body.lead_id])).toMatchObject({ role_answer: "partner" });
  });

  it("removing a phone line hides it from the CRM list", async () => {
    const lineId = await ins(`INSERT INTO admin_phone_numbers (e164, friendly_name, is_active, capabilities_json) VALUES (?, 'Unused', 0, JSON_OBJECT('sms', TRUE))`, [ph(7)]);
    await request(app).post(`/api/admin/phone-lines/${lineId}/disconnect`).set("Cookie", cookies.super).send({ confirm: ph(7) }).expect(200);
    const list = await request(app).get("/api/admin/phone-numbers").set("Cookie", cookies.super).expect(200);
    expect(list.body.numbers.some((n: any) => n.id === lineId)).toBe(false);
    expect(await one(`SELECT removed_at IS NOT NULL AS gone FROM admin_phone_numbers WHERE id = ?`, [lineId])).toMatchObject({ gone: 1 });
  });
});
