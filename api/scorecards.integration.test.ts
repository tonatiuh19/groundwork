import "dotenv/config";
import crypto from "crypto";
import type { ResultSetHeader } from "mysql2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { computeScorecardWeek, createServer, ensureScorecards, pacificDayStartUtc, scAddDays, scWeekStart } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
const MIN = 60_000;
const HOUR = 60 * MIN;

/** Admin -> Scorecards: weekly A-F scores, days off, escalations, the feature flag and access. */
describe.runIf(hasDb)("scorecards (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const prefix = `gwscore-${Date.now()}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const phone = () => `+1555${crypto.randomInt(1_000_000, 9_999_999)}`;
  // Last week (always over): Tuesday 10am Pacific is when the test lead arrives.
  const prevWs = scAddDays(scWeekStart(new Date()), -7);
  const tuesday = new Date(pacificDayStartUtc(scAddDays(prevWs, 1)).getTime() + 10 * HOUR);
  let adminCookie = "";
  let financeCookie = "";
  let contractorId = 0;
  let projectPublicId = "";
  let projectId = 0;

  const insertId = async (sql: string, params: unknown[]) =>
    Number(((await db.execute(sql, params as any[])) as unknown as [ResultSetHeader])[0].insertId);
  const session = async (id: number) => {
    const token = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, ?)`, [
      id, crypto.createHash("sha256").update(token).digest("hex"), new Date(Date.now() + 86_400_000),
    ]);
    return `gw_admin_sid=${token}`;
  };
  const lead = async (name: string, assignedAt: Date | null) =>
    insertId(
      `INSERT INTO leads (full_name, email, phone, status, assigned_contractor_id, contractor_assigned_at) VALUES (?, ?, ?, 'new', ?, ?)`,
      [`${prefix}${name}`, em(name), phone(), assignedAt ? contractorId : null, assignedAt],
    );
  const act = (kind: string, leadId: number | null, at: Date, outcome: string | null = null, note: string | null = null) =>
    insertId(
      `INSERT INTO scorecard_activities (subject_type, subject_id, kind, outcome, lead_id, note, occurred_at) VALUES ('contractor', ?, ?, ?, ?, ?, ?)`,
      [contractorId, kind, outcome, leadId, note, at],
    );
  const metric = (ms: { key: string; met: number; total: number; score: number | null }[], key: string) => ms.find((m) => m.key === key)!;

  beforeAll(async () => {
    process.env.VITEST = "true";
    process.env.SCORECARD_ENABLED = "true";
    process.env.GW_SCORECARD_TEST_PREFIX = prefix;
    adminCookie = await session(await insertId(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Score', 'Admin', 'admin', 'active')`, [em("admin")]));
    financeCookie = await session(await insertId(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Score', 'Finance', 'finance', 'active')`, [em("fin")]));
    contractorId = await insertId(`INSERT INTO contractors (email, first_name, last_name, status, phone) VALUES (?, 'Score', 'Builder', 'active', ?)`, [em("ctr"), phone()]);
    const clientId = await insertId(`INSERT INTO clients (first_name, last_name, email, status) VALUES ('Score', 'Owner', ?, 'prospect')`, [em("client")]);
    projectPublicId = `S${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
    projectId = await insertId(`INSERT INTO projects (public_id, client_id, contractor_id, milestone) VALUES (?, ?, ?, 'in_build')`, [projectPublicId, clientId, contractorId]);
  });

  afterAll(async () => {
    delete process.env.SCORECARD_ENABLED;
    delete process.env.GW_SCORECARD_TEST_PREFIX;
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("is invisible with the flag off and admins-only with it on", async () => {
    process.env.SCORECARD_ENABLED = "false";
    try {
      await request(app).get("/api/admin/scorecards").set("Cookie", adminCookie).expect(404);
      const me = await request(app).get("/api/admin/auth/me").set("Cookie", adminCookie).expect(200);
      expect(me.body.user.scorecard_enabled).toBe(false);
    } finally {
      process.env.SCORECARD_ENABLED = "true";
    }
    await request(app).get("/api/admin/scorecards").set("Cookie", financeCookie).expect(403);
    expect((await request(app).get("/api/admin/auth/me").set("Cookie", adminCookie).expect(200)).body.user.scorecard_enabled).toBe(true);
    expect((await request(app).get("/api/admin/auth/me").set("Cookie", financeCookie).expect(200)).body.user.scorecard_enabled).toBe(false);
    await request(app).get("/api/admin/scorecards").expect(401);
  });

  it("turns on contractor roles and lists them on the board", async () => {
    await request(app).patch(`/api/admin/scorecards/contractor/${contractorId}/roles`).set("Cookie", adminCookie).send({ roles: ["lead_rep", "coordinator", "bogus"] }).expect(200);
    const b = await request(app).get("/api/admin/scorecards").set("Cookie", adminCookie).expect(200);
    const mine = b.body.items.filter((r: { subject_id: number; subject_type: string }) => r.subject_type === "contractor" && r.subject_id === contractorId);
    expect(mine.map((r: { scorecard: string }) => r.scorecard).sort()).toEqual(["coordinator", "lead_rep"]);
    // Only this suite's fixtures are scored under Vitest.
    expect(b.body.items.every((r: { name: string }) => r.name.startsWith("Score") || r.name.includes(prefix))).toBe(true);
  });

  it("lead rep: 15-minute call, 48 h contact (3 unanswered = done), next step, consults", async () => {
    const l = await lead("late", tuesday);
    await act("call_attempt", l, new Date(tuesday.getTime() + 30 * MIN), "no_answer");
    await act("call_attempt", l, new Date(tuesday.getTime() + 5 * HOUR), "no_answer");
    await act("call_attempt", l, new Date(tuesday.getTime() + 20 * HOUR), "voicemail");
    const r = await computeScorecardWeek("contractor", contractorId, "lead_rep", prevWs);
    expect(metric(r.metrics, "call_15m")).toMatchObject({ met: 0, total: 1, score: 0 });
    expect(metric(r.metrics, "contact_48h")).toMatchObject({ met: 1, total: 1, score: 100 });
    expect(metric(r.metrics, "next_step")).toMatchObject({ met: 0, total: 1 });
    expect(metric(r.metrics, "consult_rate")).toMatchObject({ met: 0, total: 1 });
    // Nothing to sign without a consult -> not graded; total re-weights the other 80 points.
    expect(metric(r.metrics, "sign_rate").score).toBeNull();
    expect(r.score).toBe(25);
    expect(r.grade).toBe("F");
  });

  it("days off stop the clocks", async () => {
    await db.execute(`INSERT INTO scorecard_time_off (subject_type, subject_id, starts_on, ends_on) VALUES ('contractor', ?, ?, ?)`, [contractorId, scAddDays(prevWs, 1), scAddDays(prevWs, 1)]);
    const r = await computeScorecardWeek("contractor", contractorId, "lead_rep", prevWs);
    // The 30-minute call happened on a day off, so 0 working minutes passed.
    expect(metric(r.metrics, "call_15m")).toMatchObject({ met: 1, total: 1, score: 100 });
    await db.execute(`DELETE FROM scorecard_time_off WHERE subject_type = 'contractor' AND subject_id = ?`, [contractorId]);
  });

  it("coordinator: plans, city corrections (5 working days), weekly review and update", async () => {
    await db.execute(`INSERT INTO project_plan_deliverables (project_id, title, due_on, delivered_at) VALUES (?, 'Plans A', ?, ?)`, [projectId, scAddDays(prevWs, 2), new Date(tuesday.getTime() + 48 * HOUR)]);
    await db.execute(`INSERT INTO project_plan_deliverables (project_id, title, due_on, delivered_at) VALUES (?, 'Plans B', ?, ?)`, [projectId, scAddDays(prevWs, 1), tuesday]);
    await db.execute(`INSERT INTO project_city_corrections (project_id, received_on, resolved_on) VALUES (?, ?, ?)`, [projectId, prevWs, scAddDays(prevWs, 2)]);
    await insertId(
      `INSERT INTO scorecard_activities (subject_type, subject_id, kind, project_id, occurred_at) VALUES ('contractor', ?, 'status_review', ?, ?)`,
      [contractorId, projectId, tuesday],
    );
    const r = await computeScorecardWeek("contractor", contractorId, "coordinator", prevWs);
    expect(metric(r.metrics, "plans_on_time")).toMatchObject({ met: 1, total: 2 });
    expect(metric(r.metrics, "city_5d")).toMatchObject({ met: 1, total: 1, score: 100 });
    expect(metric(r.metrics, "status_review")).toMatchObject({ met: 1, total: 1 });
    expect(metric(r.metrics, "homeowner_update")).toMatchObject({ met: 0, total: 1, score: 0 });
    expect(metric(r.metrics, "milestones_on_time").score).toBeNull();
  });

  it("freezes a finished week, escalates once, and requires the written record to close", async () => {
    // Pretend it's Friday after last week: last week is frozen (3 days after it ended).
    const friday = new Date(pacificDayStartUtc(scAddDays(prevWs, 11)).getTime() + 9 * HOUR);
    // From Thursday on, last week is already past its freeze date in real time, so the board test
    // above froze it before this suite logged any work. Start from no stored week.
    await db.execute(`DELETE FROM scorecard_actions WHERE subject_type = 'contractor' AND subject_id = ? AND week_start = ?`, [contractorId, prevWs]);
    await db.execute(`DELETE FROM scorecard_weeks WHERE subject_type = 'contractor' AND subject_id = ? AND week_start = ?`, [contractorId, prevWs]);
    await ensureScorecards(friday);
    await ensureScorecards(friday);
    const [weeks] = (await db.query(
      `SELECT scorecard, grade, color, final FROM scorecard_weeks WHERE subject_type = 'contractor' AND subject_id = ? AND week_start = ?`,
      [contractorId, prevWs],
    )) as any;
    const lr = weeks.find((w: { scorecard: string }) => w.scorecard === "lead_rep");
    expect(lr).toMatchObject({ grade: "F", color: "red", final: 1 });
    const [acts] = (await db.query(
      `SELECT id, kind FROM scorecard_actions WHERE subject_type = 'contractor' AND subject_id = ? AND scorecard = 'lead_rep' AND week_start = ? AND auto = 1`,
      [contractorId, prevWs],
    )) as any;
    expect(acts.map((a: { kind: string }) => a.kind)).toEqual(["written_warning"]);
    const id = acts[0].id;
    await request(app).patch(`/api/admin/scorecards/actions/${id}`).set("Cookie", adminCookie).send({ status: "done" }).expect(400);
    const ok = await request(app).patch(`/api/admin/scorecards/actions/${id}`).set("Cookie", adminCookie).send({ status: "done", resolution: "Warning delivered and signed." }).expect(200);
    expect(ok.body.item).toMatchObject({ status: "done", resolution: "Warning delivered and signed." });

    // The frozen week can't be changed afterwards.
    const sunday = new Date(pacificDayStartUtc(scAddDays(prevWs, 6)).getTime() + 12 * HOUR);
    if (Date.now() - sunday.getTime() < 10 * 24 * HOUR) {
      await request(app)
        .post(`/api/admin/scorecards/contractor/${contractorId}/activities`)
        .set("Cookie", adminCookie)
        .send({ kind: "status_review", project_public_id: projectPublicId, occurred_at: sunday.toISOString() })
        .expect(409);
    }
  });

  it("logs work through the API, assigns leads, and validates input", async () => {
    const l = await lead("fresh", null);
    await request(app).put(`/api/admin/scorecards/leads/${l}/contractor`).set("Cookie", adminCookie).send({ contractor_id: contractorId }).expect(200);
    const base = `/api/admin/scorecards/contractor/${contractorId}/activities`;
    await request(app).post(base).set("Cookie", adminCookie).send({ kind: "call_attempt", lead_id: l }).expect(400);
    await request(app).post(base).set("Cookie", adminCookie).send({ kind: "next_step", lead_id: l, note: "  " }).expect(400);
    await request(app).post(base).set("Cookie", adminCookie).send({ kind: "event_held", note: "x" }).expect(400);
    await request(app).post(base).set("Cookie", adminCookie).send({ kind: "call_attempt", outcome: "answered", lead_id: l }).expect(201);
    await request(app).post(base).set("Cookie", adminCookie).send({ kind: "next_step", lead_id: l, note: "Consult Thursday 5pm" }).expect(201);
    const [[row]] = (await db.query(`SELECT status FROM leads WHERE id = ?`, [l])) as any;
    expect(row.status).toBe("contacted");

    const d = await request(app).get(`/api/admin/scorecards/contractor/${contractorId}`).set("Cookie", adminCookie).expect(200);
    expect(d.body.subject.roles.sort()).toEqual(["coordinator", "lead_rep"]);
    expect(d.body.leads.some((x: { id: number }) => x.id === l)).toBe(true);
    const cur = d.body.cards.find((c: { scorecard: string }) => c.scorecard === "lead_rep").weeks.at(-1);
    expect(metric(cur.metrics, "call_15m")).toMatchObject({ met: 1, total: 1 });
    expect(metric(cur.metrics, "next_step")).toMatchObject({ met: 1, total: 1 });

    const t = await request(app).post(`/api/admin/scorecards/projects/${projectPublicId}/corrections`).set("Cookie", adminCookie).send({ received_on: "2099-01-01" });
    expect(t.status).toBe(400);
    const tr = await request(app).put(`/api/admin/scorecards/projects/${projectPublicId}/targets`).set("Cookie", adminCookie).send({ milestone: "closed", due_on: scAddDays(prevWs, 30) }).expect(200);
    expect(tr.body.targets).toEqual([expect.objectContaining({ milestone: "closed" })]);

    await request(app).post(`/api/admin/scorecards/contractor/${contractorId}/time-off`).set("Cookie", adminCookie).send({ starts_on: scAddDays(prevWs, 44), ends_on: scAddDays(prevWs, 40) }).expect(400);
    // Relative to the scored week and well after it: fixed dates once landed inside "last week" and skewed later tests.
    await request(app).post(`/api/admin/scorecards/contractor/${contractorId}/time-off`).set("Cookie", adminCookie).send({ starts_on: scAddDays(prevWs, 44), ends_on: scAddDays(prevWs, 45), label: "Vacation" }).expect(201);
  });
  it("MCP: read-only scorecard tools for super admins, gone while the flag is off", async () => {
    const superCookie = await session(await insertId(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Score', 'Super', 'super_admin', 'active')`, [em("super")]));
    let rpc = 1;
    const mcp = async (method: string, params: Record<string, unknown>) => {
      const r = await request(app)
        .post("/api/mcp")
        .set("Cookie", superCookie)
        .set("Accept", "application/json, text/event-stream")
        .set("Content-Type", "application/json")
        .send({ jsonrpc: "2.0", id: rpc++, method, params });
      expect(r.status).toBe(200);
      const body = r.body && r.body.result ? r.body : JSON.parse(String(r.text).split("\n").find((l) => l.startsWith("data: "))!.slice(6));
      return body.result;
    };
    const names = async () => (await mcp("tools/list", {})).tools.map((t: { name: string }) => t.name);
    expect(await names()).toEqual(expect.arrayContaining(["get_scorecards", "get_scorecard"]));
    const board = JSON.parse((await mcp("tools/call", { name: "get_scorecards", arguments: {} })).content[0].text);
    expect(board.ok ?? true).toBeTruthy();
    const one = JSON.parse((await mcp("tools/call", { name: "get_scorecard", arguments: { type: "contractor", id: contractorId } })).content[0].text);
    expect(JSON.stringify(one)).toContain("lead_rep");
    process.env.SCORECARD_ENABLED = "false";
    try {
      expect(await names()).not.toContain("get_scorecards");
    } finally {
      process.env.SCORECARD_ENABLED = "true";
    }
  });
  it("lead rep: consults booked and signings (rolling 30 days)", async () => {
    const l = await lead("consult", tuesday);
    await act("call_attempt", l, new Date(tuesday.getTime() + 5 * MIN), "answered");
    await insertId(
      `INSERT INTO appointments (title, kind, starts_at, ends_at, lead_id, ics_uid, status, created_at) VALUES (?, 'consultation', ?, ?, ?, UUID(), 'completed', ?)`,
      [`${prefix}consult`, new Date(tuesday.getTime() + 24 * HOUR), new Date(tuesday.getTime() + 25 * HOUR), l, new Date(tuesday.getTime() + HOUR)],
    );
    // A cancelled consult doesn't count.
    const l2 = await lead("cancelled", tuesday);
    await insertId(
      `INSERT INTO appointments (title, kind, starts_at, ends_at, lead_id, ics_uid, status, created_at) VALUES (?, 'consultation', ?, ?, ?, UUID(), 'cancelled', ?)`,
      [`${prefix}cx`, new Date(tuesday.getTime() + 24 * HOUR), new Date(tuesday.getTime() + 25 * HOUR), l2, new Date(tuesday.getTime() + HOUR)],
    );
    // The consult lead signs: client from the lead with a contracted project.
    const cid = await insertId(`INSERT INTO clients (first_name, last_name, email, status, lead_id) VALUES ('Signed', 'Owner', ?, 'active', ?)`, [em("signed"), l]);
    await insertId(`INSERT INTO projects (public_id, client_id, milestone) VALUES (?, ?, 'contracted')`, [`S${crypto.randomBytes(6).toString("hex").toUpperCase()}`, cid]);
    const r = await computeScorecardWeek("contractor", contractorId, "lead_rep", prevWs);
    const consult = metric(r.metrics, "consult_rate");
    expect(consult.met).toBe(1);
    expect(consult.total).toBeGreaterThanOrEqual(3);
    expect(metric(r.metrics, "sign_rate")).toMatchObject({ met: 1, total: 1, score: 100 });
  });

  it("coordinator: stage target met only when reached by the (day-off shifted) date", async () => {
    await db.execute(`INSERT INTO project_milestone_targets (project_id, milestone, due_on) VALUES (?, 'in_build', ?)`, [projectId, scAddDays(prevWs, 3)]);
    await db.execute(`INSERT INTO project_milestone_events (project_id, from_milestone, to_milestone, created_at) VALUES (?, 'contracted', 'in_build', ?)`, [projectId, new Date(pacificDayStartUtc(scAddDays(prevWs, 4)).getTime() + 10 * HOUR)]);
    let r = await computeScorecardWeek("contractor", contractorId, "coordinator", prevWs);
    expect(metric(r.metrics, "milestones_on_time")).toMatchObject({ met: 0, total: 1 });
    // Day off on the due date moves it to the next day, when the stage was reached.
    await db.execute(`INSERT INTO scorecard_time_off (subject_type, subject_id, starts_on, ends_on) VALUES ('contractor', ?, ?, ?)`, [contractorId, scAddDays(prevWs, 3), scAddDays(prevWs, 3)]);
    r = await computeScorecardWeek("contractor", contractorId, "coordinator", prevWs);
    expect(metric(r.metrics, "milestones_on_time")).toMatchObject({ met: 1, total: 1 });
    await db.execute(`DELETE FROM scorecard_time_off WHERE subject_type = 'contractor' AND subject_id = ?`, [contractorId]);
  });

  it("affiliate: qualified leads, consults, events, and a grace period for new affiliates", async () => {
    const aff = await insertId(
      `INSERT INTO affiliates (email, first_name, last_name, status, referral_code, approved_at) VALUES (?, 'Score', 'Aff', 'active', ?, ?)`,
      [em("aff"), `S${crypto.randomBytes(5).toString("hex").toUpperCase()}`, new Date(tuesday.getTime() - 60 * 24 * HOUR)],
    );
    const ref = (n: string, status: string) =>
      insertId(`INSERT INTO leads (full_name, email, phone, status, affiliate_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [`${prefix}${n}`, em(n), phone(), status, aff, tuesday]);
    const q1 = await ref("q1", "qualified");
    await ref("q2", "qualified");
    await ref("new1", "new");
    await ref("spam1", "spam");
    await insertId(
      `INSERT INTO appointments (title, kind, starts_at, ends_at, lead_id, ics_uid, status, created_at) VALUES (?, 'consultation', ?, ?, ?, UUID(), 'scheduled', ?)`,
      [`${prefix}affc`, new Date(tuesday.getTime() + 24 * HOUR), new Date(tuesday.getTime() + 25 * HOUR), q1, new Date(tuesday.getTime() + HOUR)],
    );
    await db.execute(`INSERT INTO scorecard_activities (subject_type, subject_id, kind, note, occurred_at) VALUES ('affiliate', ?, 'event_held', 'Info night', ?)`, [aff, tuesday]);
    let r = await computeScorecardWeek("affiliate", aff, "affiliate", prevWs);
    expect(metric(r.metrics, "qualified_leads")).toMatchObject({ met: 2, score: 50 }); // 2 of 4
    expect(metric(r.metrics, "aff_consult_rate")).toMatchObject({ met: 1, total: 3 }); // spam excluded
    expect(metric(r.metrics, "events")).toMatchObject({ met: 1, score: 100 });

    // Approved 5 days before the week ended: monthly goals not graded yet.
    await db.execute(`UPDATE affiliates SET approved_at = ? WHERE id = ?`, [new Date(pacificDayStartUtc(scAddDays(prevWs, 2)).getTime()), aff]);
    r = await computeScorecardWeek("affiliate", aff, "affiliate", prevWs);
    expect(metric(r.metrics, "qualified_leads").score).toBeNull();
    expect(metric(r.metrics, "events").score).toBeNull();
    expect(metric(r.metrics, "aff_consult_rate").score).not.toBeNull();
  });

  it("notes, lead search, and removing days off / activities", async () => {
    const n = await request(app).post(`/api/admin/scorecards/contractor/${contractorId}/actions`).set("Cookie", adminCookie).send({ body: "Talked about call speed." }).expect(201);
    expect(n.body.item).toMatchObject({ kind: "note", status: "done", auto: false });
    await request(app).post(`/api/admin/scorecards/contractor/${contractorId}/actions`).set("Cookie", adminCookie).send({ body: "  " }).expect(400);
    const hits = await request(app).get("/api/admin/scorecards/lead-search").set("Cookie", adminCookie).query({ q: `${prefix}fresh` }).expect(200);
    expect(hits.body.items[0]).toMatchObject({ contractor_id: contractorId });
    expect((await request(app).get("/api/admin/scorecards/lead-search").set("Cookie", adminCookie).query({ q: "%_" }).expect(200)).body.items.length).toBeLessThan(16);
    await request(app).post(`/api/admin/scorecards/contractor/${contractorId}/time-off`).set("Cookie", adminCookie).send({ starts_on: scAddDays(prevWs, 50) }).expect(201);
    const d = await request(app).get(`/api/admin/scorecards/contractor/${contractorId}`).set("Cookie", adminCookie).expect(200);
    const off = d.body.time_off.find((o: { starts_on: string; ends_on: string }) => o.starts_on === scAddDays(prevWs, 50) && o.ends_on === scAddDays(prevWs, 50));
    await request(app).delete(`/api/admin/scorecards/time-off/${off.id}`).set("Cookie", adminCookie).expect(200);
    const recent = d.body.activities.find((a: { occurred_at: string }) => Date.now() - Date.parse(a.occurred_at) < HOUR);
    await request(app).delete(`/api/admin/scorecards/activities/${recent.id}`).set("Cookie", adminCookie).expect(200);
    await request(app).get(`/api/admin/scorecards/nope/1`).set("Cookie", adminCookie).expect(400);
    await request(app).get(`/api/admin/scorecards/contractor/999999999`).set("Cookie", adminCookie).expect(404);
  });
});
