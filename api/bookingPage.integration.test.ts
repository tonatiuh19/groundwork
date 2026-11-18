import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

/**
 * Public booking page: call types (affiliate call is off until the host turns it on, then has its own
 * length), phone-only booking, affiliate link credit, and video bookings never left without a way in.
 */
describe.skipIf(!hasDb)("public booking page (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwbook-${stamp}-`;
  const slug = `gwbook-${stamp}`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const phone = (n: number) => `+1555${String(stamp + n).slice(-7)}`;
  const ins = async (sql: string, p: unknown[]) => Number(((await db.execute(sql, p as any[])) as any)[0].insertId);
  let hostId = 0;
  let affiliateId = 0;
  const code = `GWB${String(stamp).slice(-9)}`;
  // Next weekday at least 3 days out (Pacific), so min notice never bites.
  const day = (() => {
    const d = new Date(Date.now() + 3 * 86400_000);
    while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  beforeAll(async () => {
    process.env.VITEST = "true";
    hostId = await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Book', 'Host', 'admin', 'active')`, [em("host")]);
    await db.execute(
      `INSERT INTO scheduler_settings (admin_id, is_enabled, slug, duration_minutes, buffer_minutes, min_notice_hours, advance_days, allow_phone, allow_video, allow_onsite) VALUES (?, 1, ?, 30, 0, 0, 30, 1, 1, 0)`,
      [hostId, slug],
    );
    for (const d of [1, 2, 3, 4, 5]) await db.execute(`INSERT INTO scheduler_availability (admin_id, day_of_week, start_time, end_time) VALUES (?, ?, '09:00', '17:00')`, [hostId, d]);
    affiliateId = await ins(`INSERT INTO affiliates (email, first_name, last_name, referral_code, status) VALUES (?, 'Ref', 'Aff', ?, 'active')`, [em("aff"), code]);
  });

  afterAll(async () => {
    try {
      await db.execute(`DELETE FROM appointments WHERE owner_admin_id = ?`, [hostId]);
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("the affiliate call is off until the host turns it on, then it has its own length", async () => {
    // Off: a shared ?type=affiliate link shows the homeowner consultation, and booking it is refused.
    expect((await request(app).get(`/api/public/book/${slug}`).query({ type: "affiliate" }).expect(200)).body.type).toBe("homeowner");
    await request(app).post(`/api/public/book/${slug}`).send({ type: "affiliate", date: day, time: "09:00", name: `${prefix}Off`, phone: phone(9), lang: "en" }).expect(404);
    await db.execute(`UPDATE scheduler_settings SET booking_types_json = ? WHERE admin_id = ?`, [JSON.stringify({ affiliate: { enabled: true, duration_minutes: 20 } }), hostId]);
    const r = await request(app).get(`/api/public/book/${slug}`).query({ type: "affiliate", lang: "es" }).expect(200);
    expect(r.body).toMatchObject({ type: "affiliate", duration_minutes: 20, title: "Conviértase en afiliado de Groundwork" });
    expect(r.body.types.map((x: any) => x.key)).toEqual(["homeowner", "affiliate"]);
  });

  it("phone-only affiliate-call booking: lead tagged + credited to the affiliate link, 20 minutes", async () => {
    const r = await request(app)
      .post(`/api/public/book/${slug}`)
      .send({ type: "affiliate", date: day, time: "10:00", name: `${prefix}Ana Lopez`, phone: phone(1), location_type: "phone", lang: "en", referral_code: code })
      .expect(201);
    const [[a]] = (await db.query(`SELECT kind, lead_id, TIMESTAMPDIFF(MINUTE, starts_at, ends_at) AS mins FROM appointments WHERE id = ?`, [r.body.appointment_id])) as any;
    expect(a).toMatchObject({ kind: "call", mins: 20 });
    const [[l]] = (await db.query(`SELECT email, audience_tag, role_answer, affiliate_id FROM leads WHERE id = ?`, [a.lead_id])) as any;
    expect(l).toMatchObject({ email: "", audience_tag: "affiliate_lead", role_answer: "partner", affiliate_id: affiliateId });
    // A bad email is still refused (email is optional, not unchecked).
    const bad = await request(app).post(`/api/public/book/${slug}`).send({ date: day, time: "11:00", name: `${prefix}Bad`, email: "nope", phone: phone(2), lang: "en" });
    expect(bad.body.error).toBe("validation.emailInvalid");
  });

  it("video with no saved room and no Outlook: the booking becomes a phone call instead of a link-less invite", async () => {
    const r = await request(app)
      .post(`/api/public/book/${slug}`)
      .send({ date: day, time: "14:00", name: `${prefix}Video Person`, email: em("video"), phone: phone(3), location_type: "video", lang: "en" })
      .expect(201);
    const [[a]] = (await db.query(`SELECT location_type, video_url FROM appointments WHERE id = ?`, [r.body.appointment_id])) as any;
    expect(a).toMatchObject({ location_type: "phone", video_url: null });
  });
});
