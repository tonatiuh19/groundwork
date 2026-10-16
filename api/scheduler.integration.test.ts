import "dotenv/config";
import crypto from "crypto";
import type { ResultSetHeader } from "mysql2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  __testClearEmailDryRuns,
  __testClearSmsDryRuns,
  __testGetEmailDryRuns,
  __testGetSmsDryRuns,
  buildAppointmentIcs,
  createServer,
  runAppointmentReminders,
  utcToZoned,
  zonedTimeToUtc,
} from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

describe("scheduler time + invite helpers (pure)", () => {
  it("converts Pacific wall time to UTC across daylight-saving changes", () => {
    expect(zonedTimeToUtc("2026-07-15", "10:00", "America/Los_Angeles").toISOString()).toBe("2026-07-15T17:00:00.000Z"); // PDT −7
    expect(zonedTimeToUtc("2026-12-15", "10:00", "America/Los_Angeles").toISOString()).toBe("2026-12-15T18:00:00.000Z"); // PST −8
    // Day after the fall-back change still resolves to PST.
    expect(zonedTimeToUtc("2026-11-02", "09:00", "America/Los_Angeles").toISOString()).toBe("2026-11-02T17:00:00.000Z");
    const back = utcToZoned(new Date("2026-07-15T17:00:00Z"), "America/Los_Angeles");
    expect(back).toMatchObject({ date: "2026-07-15", time: "10:00", dow: 3 });
  });

  it("builds RFC 5545 invites (escaped, folded, cancel = METHOD:CANCEL)", () => {
    const ics = buildAppointmentIcs({
      uid: "u1@test",
      sequence: 2,
      start: new Date("2026-10-20T17:00:00Z"),
      end: new Date("2026-10-20T18:00:00Z"),
      title: "Inspection, Kayla; Gibson",
      location: "1 Main St, Fontana, CA " + "x".repeat(120),
    });
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("SEQUENCE:2");
    expect(ics).toContain("DTSTART:20261020T170000Z");
    expect(ics).toContain("SUMMARY:Inspection\\, Kayla\\; Gibson");
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    const cancel = buildAppointmentIcs({ uid: "u1@test", sequence: 3, start: new Date(), end: new Date(), title: "x", cancelled: true });
    expect(cancel).toContain("METHOD:CANCEL");
    expect(cancel).toContain("STATUS:CANCELLED");
  });
});

describe.runIf(hasDb)("scheduler (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwsched-${stamp}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const tail = String(100000 + Math.floor(Math.random() * 899999));
  let adminCookie = "";
  let adminId = 0;
  let contractorCookie = "";
  let contractorId = 0;
  let affCookie = "";
  let clientId = 0;
  let projectId = 0;
  let lenderId = 0;
  let apptId = 0;

  const insertId = async (sql: string, params: unknown[]) =>
    Number(((await db.execute(sql, params as any[])) as unknown as [ResultSetHeader])[0].insertId);
  const session = async (actor: "admin" | "contractor" | "affiliate", id: number) => {
    const token = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO \`${actor}_sessions\` (\`${actor}_id\`, token_hash, expires_at) VALUES (?, ?, ?)`, [
      id, crypto.createHash("sha256").update(token).digest("hex"), new Date(Date.now() + 86_400_000),
    ]);
    return `gw_${actor}_sid=${token}`;
  };
  const day = (offsetDays: number) => utcToZoned(new Date(Date.now() + offsetDays * 86400_000), "America/Los_Angeles").date;
  const mailsTo = (addr: string) => __testGetEmailDryRuns().filter((m: any) => String(m.to) === addr);

  beforeAll(async () => {
    process.env.VITEST = "true";
    adminId = await insertId(`INSERT INTO admins (email, first_name, last_name, phone, role, status) VALUES (?, 'Sam', 'Scheduler', ?, 'admin', 'active')`, [em("admin"), `+1951${tail}1`]);
    adminCookie = await session("admin", adminId);
    contractorId = await insertId(`INSERT INTO contractors (email, first_name, last_name, phone, company, status) VALUES (?, 'Carl', 'Builder', ?, 'Build Co', 'active')`, [em("contractor"), `+1951${tail}2`]);
    contractorCookie = await session("contractor", contractorId);
    const affId = await insertId(`INSERT INTO affiliates (email, first_name, last_name, status, referral_code) VALUES (?, 'Ana', 'Ref', 'active', ?)`, [em("aff"), `S${crypto.randomBytes(5).toString("hex").toUpperCase()}`]);
    affCookie = await session("affiliate", affId);
    clientId = await insertId(
      `INSERT INTO clients (first_name, last_name, email, phone, status, affiliate_id, address_line1, city, zip, preferred_language) VALUES ('Kayla', 'Gibson', ?, ?, 'prospect', ?, '1 Main St', 'Fontana', '92335', 'es')`,
      [em("kayla"), `+1951${tail}3`, affId],
    );
    projectId = await insertId(`INSERT INTO projects (public_id, client_id, affiliate_id) VALUES (?, ?, ?)`, [`S${crypto.randomBytes(6).toString("hex").toUpperCase()}`, clientId, affId]);
  });

  afterAll(async () => {
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("lenders directory: create, link to a project (name kept in sync)", async () => {
    const r = await request(app).post("/api/admin/lenders").set("Cookie", adminCookie)
      .send({ company: `${prefix}Pacific Lending`, contact_name: "Lena Loan", email: em("lender"), phone: `+1951${tail}4` }).expect(201);
    lenderId = r.body.lenders.find((l: any) => l.company === `${prefix}Pacific Lending`).id;
    await request(app).post("/api/admin/lenders").set("Cookie", adminCookie).send({ company: "x" }).expect(400);
    const [[pr]] = (await db.query(`SELECT public_id FROM projects WHERE id = ?`, [projectId])) as any;
    await request(app).patch(`/api/admin/projects/${pr.public_id}`).set("Cookie", adminCookie).send({ lender_id: lenderId }).expect(200);
    const [[p]] = (await db.query(`SELECT lender_id, loan_lender_name, loan_lender_type FROM projects WHERE id = ?`, [projectId])) as any;
    expect(p).toMatchObject({ lender_id: lenderId, loan_lender_name: `${prefix}Pacific Lending`, loan_lender_type: "external" });
  });

  it("creates an appointment: tagged contractor, lender, staff + homeowner each get email + invite (+ text)", async () => {
    __testClearEmailDryRuns();
    __testClearSmsDryRuns();
    const r = await request(app).post("/api/admin/appointments").set("Cookie", adminCookie).send({
      kind: "property_inspection",
      date: day(5),
      start: "10:00",
      duration_minutes: 60,
      client_id: clientId,
      notify_homeowner: true,
      notes: "Bring the tape measure",
      attendees: [{ kind: "contractor", contractor_id: contractorId }, { kind: "lender", lender_id: lenderId }],
    }).expect(201);
    apptId = r.body.appointment.id;
    expect(r.body.appointment).toMatchObject({ kind: "property_inspection", project_id: projectId, location: "1 Main St, Fontana, 92335", status: "scheduled" });
    expect(r.body.appointment.attendees.map((a: any) => a.kind).sort()).toEqual(["admin", "contractor", "homeowner", "lender"]);
    for (const addr of [em("admin"), em("contractor"), em("lender"), em("kayla")]) {
      const m = mailsTo(addr);
      expect(m).toHaveLength(1);
      expect(m[0].attachments?.[0]).toMatchObject({ filename: "invite.ics" });
      expect(m[0].attachments![0].content).toContain("METHOD:REQUEST");
    }
    // Homeowner (Spanish) gets the manage link; internal notes never leave staff.
    const home = mailsTo(em("kayla"))[0];
    expect(home.subject).toMatch(/^Cita:/);
    expect(home.html).toMatch(/\/appointment\/[a-f0-9]{48}/);
    for (const m of __testGetEmailDryRuns()) expect(m.html).not.toContain("tape measure");
    expect(__testGetSmsDryRuns().length).toBeGreaterThanOrEqual(1);
    // Overlap warning (not a block).
    const clash = await request(app).post("/api/admin/appointments").set("Cookie", adminCookie)
      .send({ kind: "call", date: day(5), start: "10:30", duration_minutes: 30, notify_homeowner: false, attendees: [] }).expect(201);
    expect(clash.body.conflicts.map((c: any) => c.id)).toContain(apptId);
    await request(app).post(`/api/admin/appointments/${clash.body.appointment.id}/cancel`).set("Cookie", adminCookie).send({}).expect(200);
  });

  it("reschedule → 'updated' invites (sequence bumps); untagging the lender sends them a cancellation", async () => {
    __testClearEmailDryRuns();
    const r = await request(app).patch(`/api/admin/appointments/${apptId}`).set("Cookie", adminCookie)
      .send({ start: "14:00", attendees: [{ kind: "contractor", contractor_id: contractorId }] }).expect(200);
    expect(r.body.appointment.attendees.map((a: any) => a.kind).sort()).toEqual(["admin", "contractor", "homeowner"]);
    const lenderMail = mailsTo(em("lender"));
    expect(lenderMail).toHaveLength(1);
    expect(lenderMail[0].attachments![0].content).toContain("METHOD:CANCEL");
    const cm = mailsTo(em("contractor")).slice(-1)[0];
    expect(cm.subject).toMatch(/^Updated appointment/);
    expect(cm.attachments![0].content).toMatch(/SEQUENCE:[1-9]/);
    const [[row]] = (await db.query(`SELECT starts_at FROM appointments WHERE id = ?`, [apptId])) as any;
    expect(utcToZoned(new Date(row.starts_at), "America/Los_Angeles").time).toBe("14:00");
  });

  it("contractor portal lists it; affiliate sees time + type only for their referred client", async () => {
    const c = await request(app).get("/api/contractor/appointments").set("Cookie", contractorCookie).expect(200);
    const mine = c.body.appointments.find((a: any) => a.id === apptId);
    expect(mine).toMatchObject({ location: "1 Main St, Fontana, 92335" });
    expect(mine.notes).toBeUndefined();
    const a = await request(app).get("/api/affiliate/appointments").set("Cookie", affCookie).expect(200);
    const seen = a.body.appointments.find((x: any) => x.id === apptId);
    expect(seen).toMatchObject({ kind: "property_inspection", client_name: "Kayla G." });
    expect(seen.location).toBeUndefined();
    await request(app).get("/api/admin/appointments").set("Cookie", contractorCookie).expect(401);
  });

  it("reminders: 24h once (scoped), skipped when booked inside the window", async () => {
    await db.execute(`UPDATE appointments SET starts_at = NOW() + INTERVAL 20 HOUR, ends_at = NOW() + INTERVAL 21 HOUR, created_at = NOW() - INTERVAL 3 DAY WHERE id = ?`, [apptId]);
    __testClearEmailDryRuns();
    const first = await runAppointmentReminders(new Date(), [apptId]);
    expect(first.reminded_24h).toBe(1);
    expect(mailsTo(em("contractor")).slice(-1)[0].subject).toMatch(/^Tomorrow:/);
    const again = await runAppointmentReminders(new Date(), [apptId]);
    expect(again.reminded_24h).toBe(0);
  });

  it("cancel → everyone gets the cancellation invite", async () => {
    __testClearEmailDryRuns();
    await request(app).post(`/api/admin/appointments/${apptId}/cancel`).set("Cookie", adminCookie).send({ reason: "Homeowner traveling" }).expect(200);
    for (const addr of [em("admin"), em("contractor"), em("kayla")]) {
      expect(mailsTo(addr)[0].attachments![0].content).toContain("METHOD:CANCEL");
    }
    await request(app).patch(`/api/admin/appointments/${apptId}`).set("Cookie", adminCookie).send({ start: "09:00" }).expect(409);
  });

  it("booking link: slots, book (lead created), no double-booking, manage → reschedule → cancel", async () => {
    const me = await request(app).get("/api/admin/scheduler").set("Cookie", adminCookie).expect(200);
    expect(me.body.settings.availability).toHaveLength(5); // Mon–Fri default
    const slug = `${prefix}book`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    await request(app).put("/api/admin/scheduler").set("Cookie", adminCookie).send({
      is_enabled: true, slug, duration_minutes: 30, buffer_minutes: 0, min_notice_hours: 0, advance_days: 30,
      availability: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, start_time: "09:00", end_time: "12:00" })),
    }).expect(200);
    const date = day(7);
    const info = await request(app).get(`/api/public/book/${slug}?lang=en`).expect(200);
    expect(info.body).toMatchObject({ duration_minutes: 30, host: { name: "Sam Scheduler" } });
    const slots = (await request(app).get(`/api/public/book/${slug}/slots?date=${date}`).expect(200)).body.slots;
    expect(slots[0]).toBe("09:00");
    expect(slots).toHaveLength(6);
    __testClearEmailDryRuns();
    const body = { date, time: "09:00", name: "Bea Booker", email: em("bea"), phone: `+1951${tail}5`, location_type: "phone", lang: "en" };
    await request(app).post(`/api/public/book/${slug}`).send(body).expect(201);
    await request(app).post(`/api/public/book/${slug}`).send({ ...body, email: em("bea2"), phone: `+1951${tail}6` }).expect(409);
    const after = (await request(app).get(`/api/public/book/${slug}/slots?date=${date}`).expect(200)).body.slots;
    expect(after).not.toContain("09:00");
    const [[lead]] = (await db.query(`SELECT id, source FROM leads WHERE email = ?`, [em("bea")])) as any;
    expect(lead.source).toBe("booking");
    const token = String(mailsTo(em("bea"))[0].html).match(/\/appointment\/([a-f0-9]{48})/)![1];
    expect(mailsTo(em("admin")).length).toBe(1); // host notified
    const manage = await request(app).get(`/api/public/appointments/${token}`).expect(200);
    expect(manage.body).toMatchObject({ appointment: { status: "scheduled", host: "Sam Scheduler" }, reschedule_slug: slug });
    await request(app).post(`/api/public/appointments/${token}/reschedule`).send({ date, time: "10:30" }).expect(200);
    const moved = (await request(app).get(`/api/public/book/${slug}/slots?date=${date}`).expect(200)).body.slots;
    expect(moved).toContain("09:00");
    expect(moved).not.toContain("10:30");
    await request(app).post(`/api/public/appointments/${token}/cancel`).send({}).expect(200);
    const gone = await request(app).get(`/api/public/appointments/${token}`).expect(200);
    expect(gone.body.appointment.status).toBe("cancelled");
    await request(app).get(`/api/public/appointments/${"0".repeat(48)}`).expect(404);
    await request(app).put("/api/admin/scheduler").set("Cookie", adminCookie).send({ is_enabled: false }).expect(200);
    await request(app).get(`/api/public/book/${slug}`).expect(404);
  });
});
