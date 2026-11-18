import "dotenv/config";
import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { __testClearEmailDryRuns, __testClearSmsDryRuns, __testGetEmailDryRuns, __testGetSmsDryRuns, __testSetShieldEnforced, createServer, issueShieldChallenge, leadingZeroBits, SHIELD_DIFFICULTY, type ShieldForm } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

/**
 * Spam shield wiring (shield switched on for this suite): a bot is refused and logged, a borderline
 * website lead is saved as its own Spam lead with no email, a borderline phone-only booking must
 * confirm the phone by text code (wrong code refused, right code books), and a token can't be reused.
 */
describe.skipIf(!hasDb)("spam shield (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwshield-${stamp}-`;
  const slug = `gwshield-${stamp}`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const phone = (n: number) => `+1555${String(stamp + n).slice(-7)}`;
  const ins = async (sql: string, p: unknown[]) => Number(((await db.execute(sql, p as any[])) as any)[0].insertId);
  let hostId = 0;
  let logStart = 0;
  const day = (() => {
    const d = new Date(Date.now() + 3 * 86400_000);
    while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const shield = (form: ShieldForm, ageMs: number, hp = "") => {
    const c = issueShieldChallenge(form, Date.now() - ageMs);
    let i = 0;
    while (leadingZeroBits(crypto.createHash("sha256").update(`${c.nonce}:${i}`).digest("hex")) < SHIELD_DIFFICULTY) i++;
    return { token: c.token, solution: String(i), hp };
  };

  beforeAll(async () => {
    process.env.VITEST = "true";
    __testSetShieldEnforced(true);
    const [[m]] = (await db.query(`SELECT COALESCE(MAX(id), 0) AS id FROM spam_shield_log`)) as any;
    logStart = Number(m.id);
    hostId = await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Shield', 'Host', 'admin', 'active')`, [em("host")]);
    await db.execute(
      `INSERT INTO scheduler_settings (admin_id, is_enabled, slug, duration_minutes, buffer_minutes, min_notice_hours, advance_days, allow_phone) VALUES (?, 1, ?, 30, 0, 0, 30, 1)`,
      [hostId, slug],
    );
    for (const d of [1, 2, 3, 4, 5]) await db.execute(`INSERT INTO scheduler_availability (admin_id, day_of_week, start_time, end_time) VALUES (?, ?, '09:00', '17:00')`, [hostId, d]);
  });

  afterAll(async () => {
    __testSetShieldEnforced(false);
    try {
      await db.execute(`DELETE FROM appointments WHERE owner_admin_id = ?`, [hostId]);
      await db.execute(`DELETE FROM spam_shield_log WHERE id > ?`, [logStart]);
      await db.execute(`DELETE FROM public_phone_codes WHERE phone_e164 LIKE '+1555%' AND created_at > NOW() - INTERVAL 1 HOUR`);
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  const lead = (body: Record<string, unknown>) =>
    request(app).post("/api/public/leads").send({ full_name: `${prefix}Ana Lopez`, email: em("ana"), phone: phone(1), property_address: "123 Main St, Fontana CA", mode: "standard", preferred_language: "en", ...body });

  it("a bot (trap field filled) is refused politely and logged with masked contact", async () => {
    const r = await lead({ _shield: shield("lead", 30_000, "http://spam.example") });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("errors.spamBlocked");
    const [[log]] = (await db.query(`SELECT verdict, reasons, contact_masked FROM spam_shield_log WHERE id > ? ORDER BY id DESC LIMIT 1`, [logStart])) as any;
    expect(log).toMatchObject({ verdict: "blocked", reasons: "trap_field" });
    expect(String(log.contact_masked)).not.toContain(em("ana"));
  });

  it("a borderline lead (very fast + links) is its own Spam lead: no confirmation email, never merged", async () => {
    __testClearEmailDryRuns();
    const r = await lead({ email: em("spammy"), property_address: "visit http://x.ru www.spam.xyz", _shield: shield("lead", 2500) });
    expect(r.status).toBe(201);
    const [[l]] = (await db.query(`SELECT status, notes FROM leads WHERE email = ?`, [em("spammy")])) as any;
    expect(l.status).toBe("spam");
    expect(String(l.notes)).toContain("Spam shield");
    expect(__testGetEmailDryRuns().some((m: any) => [].concat(m.to).includes(em("spammy") as never))).toBe(false);
  });

  it("a borderline phone-only booking confirms the phone by text: wrong code refused, right code books, token single-use", async () => {
    __testClearSmsDryRuns();
    const tok = shield("booking", 2500); // very fast + phone only → the shield isn't sure
    const body = { date: day, time: "10:00", name: `${prefix}Phone Only`, phone: phone(2), location_type: "phone", lang: "en", _shield: tok };
    const first = await request(app).post(`/api/public/book/${slug}`).send(body).expect(202);
    expect(first.body).toMatchObject({ needs_code: true, phone_last4: phone(2).slice(-4) });
    const sms = __testGetSmsDryRuns().find((m: any) => m.to === phone(2));
    const code = String(sms?.body.match(/\b(\d{6})\b/)?.[1]);
    expect(code).toMatch(/^\d{6}$/);
    const wrong = await request(app).post(`/api/public/book/${slug}`).send({ ...body, phone_code: code === "000000" ? "111111" : "000000" });
    expect(wrong.body.error).toBe("errors.bookingCodeInvalid");
    const ok = await request(app).post(`/api/public/book/${slug}`).send({ ...body, phone_code: code }).expect(201);
    expect(ok.body.appointment_id).toBeGreaterThan(0);
    // The token is spent once the booking is accepted.
    const again = await request(app).post(`/api/public/book/${slug}`).send({ ...body, time: "11:00", phone_code: code });
    expect(again.body.error).toBe("errors.spamBlocked");
  });

  it("a normal booking with email goes straight through (no code)", async () => {
    const r = await request(app)
      .post(`/api/public/book/${slug}`)
      .send({ date: day, time: "13:00", name: `${prefix}Normal Person`, email: em("normal"), phone: phone(3), location_type: "phone", lang: "en", _shield: shield("booking", 45_000) })
      .expect(201);
    expect(r.body.appointment_id).toBeGreaterThan(0);
  });
});
