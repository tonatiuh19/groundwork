import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { __testClearEmailDryRuns, __testClearSmsDryRuns, __testGetEmailDryRuns, __testGetSmsDryRuns, createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

describe.runIf(hasDb)("reminder flows: seeds, builder, consent + STOP, replies, controls, close", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwflows-${stamp}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const ph = (n: number) => `+1555${String(stamp + n).slice(-7)}`;
  const ins = async (sql: string, p: unknown[]) => Number(((await db.execute(sql, p as any[])) as any)[0].insertId);
  const one = async (sql: string, p: unknown[]) => ((await db.query(sql, p as any[])) as any)[0][0];
  const all = async (sql: string, p: unknown[]) => ((await db.query(sql, p as any[])) as any)[0] as any[];
  const cookies: Record<string, string> = {};
  const prevCron = process.env.CRON_SECRET;
  let flowId = 0;

  const cron = () => request(app).get("/api/cron/reminder-flows").set("Authorization", "Bearer test-cron-secret").expect(200);
  const runFor = (affId: number) => one(`SELECT * FROM reminder_flow_runs WHERE flow_id = ? AND subject_kind = 'affiliate' AND subject_id = ? ORDER BY id DESC LIMIT 1`, [flowId, affId]);
  const events = async (runId: number) => (await all(`SELECT step_key, event, channel, detail_json FROM reminder_flow_events WHERE run_id = ? ORDER BY id`, [runId])).map((e) => ({ ...e, detail: typeof e.detail_json === "string" ? JSON.parse(e.detail_json) : e.detail_json }));
  const signup = async (n: string, phone: string, consent: boolean) => {
    await request(app).post("/api/public/affiliate/signup").send({ first_name: `Flo${n}`, last_name: "Tester", email: em(n), phone, sms_marketing_consent: consent }).expect(201);
    return Number((await one(`SELECT id FROM affiliates WHERE email = ?`, [em(n)])).id);
  };

  beforeAll(async () => {
    process.env.VITEST = "true";
    process.env.CRON_SECRET = "test-cron-secret";
    for (const [who, role] of [["super", "super_admin"], ["agent", "agent"]] as const) {
      const id = await ins(`INSERT INTO admins (email, first_name, last_name, role, status, phone) VALUES (?, ?, 'Flows', ?, 'active', ?)`, [em(who), who, role, ph(who === "super" ? 1 : 2)]);
      const t = crypto.randomBytes(32).toString("hex");
      await db.execute(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [id, crypto.createHash("sha256").update(t).digest("hex")]);
      cookies[who] = `gw_admin_sid=${t}`;
    }
  });

  afterAll(async () => {
    process.env.CRON_SECRET = prevCron;
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("seeds Daniel's three sequences (inactive, 6 touches, EN + ES); agents can read but not edit", async () => {
    const r = await request(app).get("/api/admin/flows").set("Cookie", cookies.agent).expect(200);
    expect(r.body.can_edit).toBe(false);
    const seeded = r.body.flows.filter((f: any) => ["affiliate_onboarding", "contractor_onboarding", "homeowner_followup"].includes(f.system_key));
    expect(seeded).toHaveLength(3);
    const home = seeded.find((f: any) => f.system_key === "homeowner_followup");
    expect(home).toMatchObject({ trigger_event: "homeowner_lead", goal_key: "homeowner_next_step" });
    const d = await request(app).get(`/api/admin/flows/${home.id}`).set("Cookie", cookies.agent).expect(200);
    const sends = d.body.steps.filter((s: any) => s.step_type === "send_sms" || s.step_type === "send_email");
    expect(sends).toHaveLength(9); // 1h text+email, d1 email, d3 text, d5 email, d7 text+email, d14 text+email
    expect(sends.every((s: any) => s.config.body_en && s.config.body_es)).toBe(true);
    expect(sends.filter((s: any) => s.step_type === "send_sms").every((s: any) => /STOP/.test(s.config.body_en) && /STOP/.test(s.config.body_es))).toBe(true);
    expect(d.body.steps.at(-1).step_type).toBe("close");
    await request(app).put(`/api/admin/flows/${home.id}`).set("Cookie", cookies.agent).send({ name: "x", trigger_event: "homeowner_lead" }).expect(403);
    await request(app).delete(`/api/admin/flows/${home.id}`).set("Cookie", cookies.super).send({ confirm: true }).expect(409);
  });

  it("builds a flow (validates the graph), previews a step and sends a test to me", async () => {
    const c = await request(app).post("/api/admin/flows").set("Cookie", cookies.super).send({ name: `${prefix}Affiliate test`, trigger_event: "affiliate_signup", quiet_start_hour: 0, quiet_end_hour: 24 }).expect(201);
    flowId = c.body.flow.id;
    expect(c.body.flow.is_active).toBe(false);
    await request(app).patch(`/api/admin/flows/${flowId}/active`).set("Cookie", cookies.super).send({ active: true }).expect(400); // only a trigger
    const bad = await request(app)
      .put(`/api/admin/flows/${flowId}`)
      .set("Cookie", cookies.super)
      .send({ name: `${prefix}Affiliate test`, trigger_event: "affiliate_signup", steps: [{ step_key: "trigger", step_type: "trigger", label: "T", config: {} }], edges: [{ source_key: "trigger", target_key: "nope", edge_type: "next" }] });
    expect(bad.body.error).toBe("validation.flowEdge");
    const steps = [
      { step_key: "trigger", step_type: "trigger", label: "Start", config: {}, position_x: 0, position_y: 0 },
      { step_key: "email_1", step_type: "send_email", label: "Welcome", config: { subject_en: "Hi {{first_name}}", subject_es: "Hola {{first_name}}", body_en: "Finish here: {{link}}\n{{rep_name}}", body_es: "Termine aquí: {{link}}" }, position_x: 0, position_y: 100 },
      { step_key: "sms_1", step_type: "send_sms", label: "Text", config: { body_en: "Hi {{first_name}}, finish: {{link}}", body_es: "Hola {{first_name}}: {{link}}" }, position_x: 0, position_y: 200 },
      { step_key: "reply", step_type: "wait_for_reply", label: "Wait", config: { amount: 1, unit: "days" }, position_x: 0, position_y: 300 },
      { step_key: "alert", step_type: "notify_staff", label: "Alert", config: { body_en: "{{first_name}} replied" }, position_x: 0, position_y: 400 },
      { step_key: "close", step_type: "close", label: "Close", config: {}, position_x: 300, position_y: 400 },
    ];
    const edges = [
      { source_key: "trigger", target_key: "email_1", edge_type: "next" },
      { source_key: "email_1", target_key: "sms_1", edge_type: "next" },
      { source_key: "sms_1", target_key: "reply", edge_type: "next" },
      { source_key: "reply", target_key: "alert", edge_type: "replied" },
      { source_key: "reply", target_key: "close", edge_type: "no_reply" },
    ];
    const saved = await request(app).put(`/api/admin/flows/${flowId}`).set("Cookie", cookies.super).send({ name: `${prefix}Affiliate test`, trigger_event: "affiliate_signup", goal_key: "affiliate_onboarded", stop_on_reply: false, quiet_start_hour: 0, quiet_end_hour: 24, steps, edges }).expect(200);
    expect(saved.body.steps).toHaveLength(6);
    const pv = await request(app).post(`/api/admin/flows/${flowId}/preview`).set("Cookie", cookies.agent).send({ step_key: "email_1", lang: "es" }).expect(200);
    expect(pv.body).toMatchObject({ channel: "email", subject: "Hola Maria" });
    expect(pv.body.html).toContain("Termine aquí");
    __testClearSmsDryRuns();
    const tst = await request(app).post(`/api/admin/flows/${flowId}/test`).set("Cookie", cookies.super).send({ step_key: "sms_1" }).expect(200);
    expect(tst.body.sent_to).toBe(ph(1));
    expect((__testGetSmsDryRuns() as any[]).some((m) => m.to === ph(1) && m.body.startsWith("[TEST] Hi Maria"))).toBe(true);
    await request(app).patch(`/api/admin/flows/${flowId}/active`).set("Cookie", cookies.super).send({ active: true }).expect(200);
  });

  it("a signup enters the flow: email with a tracked link, text only with consent, opt-outs honored", async () => {
    __testClearEmailDryRuns();
    __testClearSmsDryRuns();
    const yes = await signup("yes", ph(10), true);
    const run = await runFor(yes);
    expect(run).toMatchObject({ status: "active", current_step_key: "reply" });
    const mail = __testGetEmailDryRuns().find((m: any) => m.to === em("yes") && m.subject === "Hi Floyes");
    expect(mail).toBeTruthy();
    const token = String((mail as any).html).match(/\/api\/public\/fl\/([a-f0-9]{24})/)?.[1];
    expect(token).toBeTruthy();
    expect(String((mail as any).html)).toContain("the Groundwork team");
    expect((__testGetSmsDryRuns() as any[]).some((m) => m.to === ph(10) && /Reply STOP/.test(m.body))).toBe(true);
    // Click → event + redirect to our own site.
    const click = await request(app).get(`/api/public/fl/${token}`).expect(302);
    expect(String(click.headers.location)).toContain("/affiliate/");
    expect((await events(run.id)).some((e) => e.event === "clicked")).toBe(true);

    const no = await signup("no", ph(11), false);
    expect((await events((await runFor(no)).id)).find((e) => e.step_key === "sms_1")).toMatchObject({ event: "skipped", detail: { reason: "no text consent" } });

    await db.execute(`INSERT INTO sms_opt_outs (phone_last10, keyword) VALUES (?, 'STOP')`, [ph(12).slice(-10)]);
    const stop = await signup("stop", ph(12), true);
    expect((await events((await runFor(stop)).id)).find((e) => e.step_key === "sms_1")).toMatchObject({ event: "skipped", detail: { reason: "opted out" } });

    // Person timeline on the record page.
    const tl = await request(app).get(`/api/admin/flows-for/affiliate/${yes}`).set("Cookie", cookies.agent).expect(200);
    expect(tl.body.runs[0].events.map((e: any) => e.event)).toEqual(expect.arrayContaining(["entered", "sent", "clicked"]));
  });

  it("wait for reply: a reply takes the Replied branch; silence closes the application and tells the team", async () => {
    const yes = Number((await one(`SELECT id FROM affiliates WHERE email = ?`, [em("yes")])).id);
    const replied = await runFor(yes);
    await db.execute(`UPDATE reminder_flow_runs SET last_reply_at = NOW(), next_run_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?`, [replied.id]);
    const noId = Number((await one(`SELECT id FROM affiliates WHERE email = ?`, [em("no")])).id);
    const silent = await runFor(noId);
    await db.execute(`UPDATE reminder_flow_runs SET waiting_since = NOW() - INTERVAL 2 DAY, next_run_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?`, [silent.id]);
    await cron();
    expect(await one(`SELECT status FROM reminder_flow_runs WHERE id = ?`, [replied.id])).toMatchObject({ status: "completed" });
    expect((await events(replied.id)).some((e) => e.step_key === "alert" && e.event === "sent" && e.channel === "staff")).toBe(true);
    expect(await one(`SELECT status FROM reminder_flow_runs WHERE id = ?`, [silent.id])).toMatchObject({ status: "closed" });
    expect(await one(`SELECT status FROM affiliates WHERE id = ?`, [noId])).toMatchObject({ status: "inactive" });
  });

  it("staff controls: pause, resume, skip, remove, add manually (one live run per person)", async () => {
    const stopId = Number((await one(`SELECT id FROM affiliates WHERE email = ?`, [em("stop")])).id);
    const run = await runFor(stopId);
    await request(app).post(`/api/admin/flow-runs/${run.id}/pause`).set("Cookie", cookies.agent).expect(403);
    await request(app).post(`/api/admin/flow-runs/${run.id}/pause`).set("Cookie", cookies.super).expect(200);
    expect(await one(`SELECT status FROM reminder_flow_runs WHERE id = ?`, [run.id])).toMatchObject({ status: "paused" });
    await request(app).post(`/api/admin/flow-runs/${run.id}/pause`).set("Cookie", cookies.super).expect(409);
    await request(app).post(`/api/admin/flow-runs/${run.id}/resume`).set("Cookie", cookies.super).expect(200);
    await request(app).post(`/api/admin/flows/${flowId}/enroll`).set("Cookie", cookies.super).send({ subject_kind: "affiliate", subject_id: stopId }).expect(409);
    await request(app).post(`/api/admin/flow-runs/${run.id}/remove`).set("Cookie", cookies.super).expect(200);
    expect(await one(`SELECT status, active_key FROM reminder_flow_runs WHERE id = ?`, [run.id])).toMatchObject({ status: "stopped", active_key: null });
    const again = await request(app).post(`/api/admin/flows/${flowId}/enroll`).set("Cookie", cookies.super).send({ subject_kind: "affiliate", subject_id: stopId }).expect(201);
    await request(app).post(`/api/admin/flow-runs/${again.body.run_id}/skip`).set("Cookie", cookies.super).expect(200);
    expect((await events(again.body.run_id)).some((e) => e.event === "skipped_step")).toBe(true);
    const people = await request(app).get(`/api/admin/flows/${flowId}/runs?status=all`).set("Cookie", cookies.agent).expect(200);
    expect(people.body.runs.length).toBeGreaterThanOrEqual(4);
    const stats = await request(app).get(`/api/admin/flows/${flowId}`).set("Cookie", cookies.agent).expect(200);
    expect(stats.body.flow.stats.closed).toBeGreaterThanOrEqual(1);
    expect(stats.body.engagement.clicked).toBeGreaterThanOrEqual(1);
  });

  it("edge cases: concurrent processing never double-sends; a loop without a wait fails instead of repeating", async () => {
    const c = await request(app)
      .post("/api/admin/flows")
      .set("Cookie", cookies.super)
      .send({
        name: `${prefix}Edge`,
        trigger_event: "affiliate_signup",
        quiet_start_hour: 0,
        quiet_end_hour: 24,
        steps: [
          { step_key: "trigger", step_type: "trigger", label: "T", config: {}, position_x: 0, position_y: 0 },
          { step_key: "wait", step_type: "wait", label: "W", config: { amount: 1, unit: "days" }, position_x: 0, position_y: 0 },
          { step_key: "mail", step_type: "send_email", label: "M", config: { subject_en: "Edge {{first_name}}", body_en: "Hi" }, position_x: 0, position_y: 0 },
        ],
        edges: [
          { source_key: "trigger", target_key: "wait", edge_type: "next" },
          { source_key: "wait", target_key: "mail", edge_type: "next" },
        ],
      })
      .expect(201);
    const edgeId = c.body.flow.id;
    await request(app).patch(`/api/admin/flows/${edgeId}/active`).set("Cookie", cookies.super).send({ active: true }).expect(200);
    const affId = Number((await one(`SELECT id FROM affiliates WHERE email = ?`, [em("yes")])).id);
    const enr = await request(app).post(`/api/admin/flows/${edgeId}/enroll`).set("Cookie", cookies.super).send({ subject_kind: "affiliate", subject_id: affId }).expect(201);
    const runId = enr.body.run_id;
    expect(await one(`SELECT current_step_key FROM reminder_flow_runs WHERE id = ?`, [runId])).toMatchObject({ current_step_key: "mail" });
    await db.execute(`UPDATE reminder_flow_runs SET next_run_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?`, [runId]);
    __testClearEmailDryRuns();
    await Promise.all([cron(), cron(), cron()]);
    expect(__testGetEmailDryRuns().filter((m: any) => m.subject === "Edge Floyes")).toHaveLength(1);
    expect((await events(runId)).filter((e) => e.step_key === "mail" && e.event === "sent")).toHaveLength(1);

    // Graph loops back with no wait: the run fails once instead of re-sending every few minutes.
    await request(app)
      .put(`/api/admin/flows/${edgeId}`)
      .set("Cookie", cookies.super)
      .send({
        name: `${prefix}Edge`,
        trigger_event: "affiliate_signup",
        quiet_start_hour: 0,
        quiet_end_hour: 24,
        steps: [
          { step_key: "trigger", step_type: "trigger", label: "T", config: {}, position_x: 0, position_y: 0 },
          { step_key: "a", step_type: "condition", label: "A", config: { check: "has_email" }, position_x: 0, position_y: 0 },
          { step_key: "b", step_type: "condition", label: "B", config: { check: "has_email" }, position_x: 0, position_y: 0 },
        ],
        edges: [
          { source_key: "trigger", target_key: "a", edge_type: "next" },
          { source_key: "a", target_key: "b", edge_type: "yes" },
          { source_key: "b", target_key: "a", edge_type: "yes" },
        ],
      })
      .expect(200);
    const loop = await request(app).post(`/api/admin/flows/${edgeId}/enroll`).set("Cookie", cookies.super).send({ subject_kind: "affiliate", subject_id: affId }).expect(201);
    expect(await one(`SELECT status, end_reason FROM reminder_flow_runs WHERE id = ?`, [loop.body.run_id])).toMatchObject({ status: "failed", end_reason: "loop without a wait" });
    // Inactive flows can't take new people; custom flows can be deleted (runs cascade).
    await request(app).patch(`/api/admin/flows/${edgeId}/active`).set("Cookie", cookies.super).send({ active: false }).expect(200);
    await request(app).post(`/api/admin/flows/${edgeId}/enroll`).set("Cookie", cookies.super).send({ subject_kind: "affiliate", subject_id: affId }).expect(409);
    await request(app).delete(`/api/admin/flows/${edgeId}`).set("Cookie", cookies.super).send({ confirm: true }).expect(200);
    expect(await one(`SELECT COUNT(*) n FROM reminder_flow_runs WHERE flow_id = ?`, [edgeId])).toMatchObject({ n: 0 });
  });

  it("erasing a person removes their automation runs and timeline", async () => {
    const noId = Number((await one(`SELECT id FROM affiliates WHERE email = ?`, [em("no")])).id);
    expect(Number((await one(`SELECT COUNT(*) n FROM reminder_flow_runs WHERE subject_kind = 'affiliate' AND subject_id = ?`, [noId])).n)).toBeGreaterThan(0);
    await request(app).delete(`/api/admin/people/affiliate/${noId}`).set("Cookie", cookies.super).send({ confirm: true, reason: "test" }).expect(200);
    expect(await one(`SELECT COUNT(*) n FROM reminder_flow_runs WHERE subject_kind = 'affiliate' AND subject_id = ?`, [noId])).toMatchObject({ n: 0 });
  });
});
